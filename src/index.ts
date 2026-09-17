#!/usr/bin/env node

/**
 * Letterdrop MCP Server
 * Main entry point for the Model Context Protocol server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import type { Request, Response } from "express";
import {
  LETTERDROP_ORCHESTRATION_PLAYBOOK,
  LETTERDROP_ORCHESTRATION_PROMPT_NAME,
  LETTERDROP_ORCHESTRATION_RESOURCE_NAME,
  LETTERDROP_ORCHESTRATION_RESOURCE_URI
} from "./playbook.js";
import { LetterboxClient } from "./client/letterbox-client.js";
import { tools, toolHandlers, toolSchemas } from "./tools/index.js";
import {
  MCP_SCOPE_WRITE,
  createScopeResolver,
  filterToolsForScope,
  isToolAllowedForScope
} from "./scope.js";
import {
  MCP_RESOURCE_PATHS,
  SCOPES_SUPPORTED,
  SERVER_NAME,
  mcpResourcePath
} from "./catalog.js";
import "dotenv/config";

// Environment configuration (Cloud Run sets PORT; fall back to MCP_SERVER_PORT or 3002)
const LETTERBOX_API_URL =
  process.env.LETTERBOX_API_URL || "https://api.letterdrop.com";
const PORT = parseInt(
  process.env.PORT || process.env.MCP_SERVER_PORT || "3002",
  10
);

// OAuth discovery: ChatGPT redirects user to API authorize URL; API redirects to frontend for login/consent
//
// letterbox publishes the RFC 8414 document at this issuer and stamps it as the
// `iss` claim, resolving it from `MCP_OAUTH_ISSUER || SERVER_URL`
// (`src/utils/mcp-oauth-metadata.js`). Read the same override here so one env var
// governs both sides: if they disagree, a client finds `issuer` !== the URL it
// was pointed at and rejects the document under RFC 8414 3.3.
const OAUTH_ISSUER = process.env.MCP_OAUTH_ISSUER || LETTERBOX_API_URL;
const OAUTH_AUTHORIZATION_ENDPOINT = `${LETTERBOX_API_URL}/api/v1/mcp/oauth/authorize`;
const OAUTH_TOKEN_ENDPOINT = `${LETTERBOX_API_URL}/api/v1/mcp/oauth/token`;
const OAUTH_REGISTRATION_ENDPOINT = `${LETTERBOX_API_URL}/api/v1/mcp/oauth/register`;
const FRONTEND_URL = process.env.FRONTEND_URL || "https://app.letterdrop.com";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://claude.com",
  "https://chatgpt.com",
  "https://chat.openai.com",
  FRONTEND_URL,
  "http://localhost:6274"
];

function parseAllowedOrigins(): Set<string> {
  const additionalOrigins = (process.env.MCP_CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const origins = new Set<string>([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...additionalOrigins
  ]);

  return origins;
}

const ALLOWED_CORS_ORIGINS = parseAllowedOrigins();

function isOriginAllowed(origin: string): boolean {
  if (ALLOWED_CORS_ORIGINS.has(origin)) {
    return true;
  }

  if (
    process.env.NODE_ENV !== "production" &&
    origin.startsWith("http://localhost:")
  ) {
    return true;
  }

  return false;
}

// Auth: client sends MCP OAuth access token in Authorization header; we forward it to Letterbox API (no LETTERBOX_API_KEY).
function extractAccessToken(authHeader: string | undefined): string | null {
  if (!authHeader || typeof authHeader !== "string") {
    return process.env.NODE_ENV === "development"
      ? String(process.env.LETTERBOX_API_KEY)
      : null;
  }
  const trimmed = authHeader.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice(7).trim() || null;
  }
  return (
    trimmed ||
    (process.env.NODE_ENV === "development"
      ? String(process.env.LETTERBOX_API_KEY)
      : null)
  );
}

function createLetterboxClientForRequest(
  accessToken: string | null
): LetterboxClient {
  return new LetterboxClient({
    apiUrl: LETTERBOX_API_URL,
    accessToken:
      accessToken ||
      (process.env.NODE_ENV === "development"
        ? String(process.env.LETTERBOX_API_KEY)
        : undefined)
  });
}

/**
 * The catalog and the tool handler both consult the scope carried by
 * the access token. This server cannot verify the token itself, so it asks
 * letterbox; an unavailable answer means "unknown", which shows the full catalog
 * and lets the call through to letterbox, where the real gate is.
 */
const resolveTokenScope = createScopeResolver({ apiUrl: LETTERBOX_API_URL });

// Store transports and servers by session ID
const transports: Record<string, SSEServerTransport> = {};
const servers: Record<string, McpServer> = {};
// SSE: store Authorization header per session (client sends token when connecting)
const sessionAuth: Record<string, string> = {};

const SERVER_VERSION = "1.0.0";

// Cloud Run's default grace period before SIGKILL is 10s; stay under it so the
// drain finishes on our terms rather than being cut off mid-way.
const SHUTDOWN_DRAIN_MS = 8000;

const ORCHESTRATION_PROMPT_TITLE = "Letterdrop Orchestration Playbook";
const ORCHESTRATION_PROMPT_DESCRIPTION =
  "Guidance for answering competitor sales-cycle questions with the Letterdrop competitor monitoring tools.";
const ORCHESTRATION_RESOURCE_TITLE = "Letterdrop Orchestration Guide";
const ORCHESTRATION_RESOURCE_DESCRIPTION =
  "How to read the competitor monitoring table, drill into accounts, and work with buyer filters.";

function getOrchestrationPromptResult() {
  return {
    description: ORCHESTRATION_PROMPT_DESCRIPTION,
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: LETTERDROP_ORCHESTRATION_PLAYBOOK
        }
      }
    ]
  };
}

async function executeTool(
  client: LetterboxClient,
  toolName: string,
  args: unknown
): Promise<string> {
  const handler = toolHandlers[toolName as keyof typeof toolHandlers];
  const schema = toolSchemas[toolName as keyof typeof toolSchemas];

  if (!handler || !schema) {
    throw new Error(`Tool not found: ${toolName}`);
  }

  const validatedArgs = schema.parse(args ?? {});
  return handler(client, validatedArgs as any);
}

/**
 * Create and configure MCP server instance (used for SSE; requires client to send token when connecting).
 */
function createServer(
  getLetterboxClient: () => LetterboxClient,
  scope: string | null = null
): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {}
      }
    }
  );

  server.registerPrompt(
    LETTERDROP_ORCHESTRATION_PROMPT_NAME,
    {
      title: ORCHESTRATION_PROMPT_TITLE,
      description: ORCHESTRATION_PROMPT_DESCRIPTION
    },
    async () => getOrchestrationPromptResult()
  );

  server.registerResource(
    LETTERDROP_ORCHESTRATION_RESOURCE_NAME,
    LETTERDROP_ORCHESTRATION_RESOURCE_URI,
    {
      title: ORCHESTRATION_RESOURCE_TITLE,
      description: ORCHESTRATION_RESOURCE_DESCRIPTION,
      mimeType: "text/markdown"
    },
    async () => ({
      contents: [
        {
          uri: LETTERDROP_ORCHESTRATION_RESOURCE_URI,
          mimeType: "text/markdown",
          text: LETTERDROP_ORCHESTRATION_PLAYBOOK
        }
      ]
    })
  );

  // Register the tools this grant is entitled to: a read-only grant is not
  // offered the tools that write.
  filterToolsForScope(tools, scope).forEach((tool) => {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema as any,
        title: (tool as any).title,
        annotations: (tool as any).annotations
      },
      async (args: any) => {
        try {
          const client = getLetterboxClient();
          const result = await executeTool(client, tool.name, args);
          return {
            content: [
              {
                type: "text" as const,
                text: result
              }
            ]
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error occurred";
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${errorMessage}`
              }
            ],
            isError: true
          };
        }
      }
    );
  });

  return server;
}

/**
 * The origin this server publishes about itself, pinned when we know it.
 *
 * `MCP_PUBLIC_URL` wins outright. Without it the origin is derived from the
 * request, which is correct but request-controlled: `trust proxy` is on (Cloud
 * Run terminates TLS and forwards over http, so `req.protocol` is only right
 * because of it), and that same setting makes Express believe an
 * `X-Forwarded-Host` the caller supplied. A caller can therefore make this
 * server describe itself at a host it does not own.
 *
 * The blast radius is small — `authorization_servers` is the constant
 * OAUTH_ISSUER, so the authorization endpoint cannot be moved, and nothing here
 * is cached, so a spoofed header only poisons the response to the request that
 * sent it. But this value goes into OAuth metadata, and metadata should not be
 * something the reader gets to choose. Setting MCP_PUBLIC_URL in a deployed
 * environment removes the input entirely.
 *
 * Getting the derived path wrong is not cosmetic either: `resource` has to match
 * the URL the user entered in Claude exactly, and an `http://` resource matches
 * nothing.
 */
const PUBLIC_ORIGIN = (process.env.MCP_PUBLIC_URL || "").replace(/\/+$/, "");

function externalOrigin(req: Request): string {
  if (PUBLIC_ORIGIN) {
    return PUBLIC_ORIGIN;
  }
  return `${req.protocol}://${req.get("host") || `localhost:${PORT}`}`;
}

/** RFC 9728 §3.1: the metadata for `https://host/x/mcp` lives at `/.well-known/oauth-protected-resource/x/mcp`. */
function protectedResourceMetadataUrl(req: Request, resourcePath: string) {
  return `${externalOrigin(req)}/.well-known/oauth-protected-resource${resourcePath}`;
}

/**
 * Methods a client may call before it has a token.
 *
 * `initialize` and the catalog are open on purpose — a client has to be able to
 * discover what a server is before deciding to authorize against it, and the
 * catalog leaks nothing a directory listing does not already publish.
 */
const UNAUTHENTICATED_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "prompts/list",
  "prompts/get",
  "resources/list",
  "resources/read"
]);

function needsAuthChallenge(requestBody: any, authHeader?: string): boolean {
  if (extractAccessToken(authHeader)) {
    return false;
  }
  const requests = Array.isArray(requestBody) ? requestBody : [requestBody];
  return requests.some(
    (request: any) =>
      request &&
      typeof request.method === "string" &&
      !UNAUTHENTICATED_METHODS.has(request.method)
  );
}

/**
 * Start the OAuth flow the way Claude expects it to start.
 *
 * This used to answer an unauthenticated `tools/call` with HTTP 200 and a
 * JSON-RPC error, which reads as "the tool failed" rather than "you need to log
 * in". Claude only honours `WWW-Authenticate` on a 401, and the
 * `resource_metadata` pointer is what saves it from probing well-known paths to
 * find the authorization server.
 */
function sendAuthChallenge(req: Request, res: Response) {
  // The resource path is the URL THIS request came in on ("" or "/mcp"): a
  // client validates that `resource` byte-matches the URL it was pointed at.
  const resourcePath = mcpResourcePath(req.baseUrl, req.path);
  const resourceMetadata = protectedResourceMetadataUrl(req, resourcePath);
  res.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${resourceMetadata}", scope="${SCOPES_SUPPORTED.join(" ")}"`
  );
  res.status(401).json({
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32001,
      message:
        "Authorization required. Send MCP OAuth access token in Authorization: Bearer header."
    }
  });
}

/**
 * Handle JSON-RPC request for streamable HTTP transport.
 * Client sends MCP OAuth access token in Authorization header; we forward it to Letterbox API.
 */
async function handleStreamableHttpRequest(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization;
    const requestBody = req.body;
    if (needsAuthChallenge(requestBody, authHeader)) {
      sendAuthChallenge(req, res);
      return;
    }

    if (Array.isArray(requestBody)) {
      console.log("requestBody is array");
      const responses = await Promise.all(
        requestBody.map((request: any) =>
          handleJsonRpcRequest(request, authHeader)
        )
      );
      res.json(responses);
    } else {
      console.log("requestBody is not array");
      const response = await handleJsonRpcRequest(requestBody, authHeader);
      res.json(response);
    }
  } catch (error) {
    console.error("Error handling streamable HTTP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        id: req.body?.id || null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal error"
        }
      });
    }
  }
}

/**
 * Handle individual JSON-RPC request.
 * authHeader: Authorization header from client (Bearer &lt;MCP OAuth access token&gt;); used for tools/call to call Letterbox API.
 */
async function handleJsonRpcRequest(
  request: any,
  authHeader?: string
): Promise<any> {
  if (!request || typeof request !== "object") {
    return {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        message: "Invalid Request"
      }
    };
  }

  const { jsonrpc, method, id, params } = request;

  if (jsonrpc !== "2.0") {
    return {
      jsonrpc: "2.0",
      id: id || null,
      error: {
        code: -32600,
        message: 'Invalid Request: jsonrpc must be "2.0"'
      }
    };
  }
  console.log(
    "handleJsonRpcRequest",
    JSON.stringify({ method, id, params }, null, 2)
  );
  // Handle MCP protocol methods
  try {
    switch (method) {
      case "initialize": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              prompts: {},
              resources: {},
              tools: {}
            },
            serverInfo: {
              name: SERVER_NAME,
              version: SERVER_VERSION
            }
          }
        };
      }

      case "tools/list": {
        // Narrow the catalog to the grant, so a read-only connection is not
        // offered a write tool it would be refused for calling.
        const listScope = await resolveTokenScope(
          extractAccessToken(authHeader)
        );
        const toolList = filterToolsForScope(tools, listScope).map((tool) => ({
          name: tool.name,
          title: (tool as any).title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: (tool as any).annotations
        }));

        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: toolList
          }
        };
      }

      case "prompts/list": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            prompts: [
              {
                name: LETTERDROP_ORCHESTRATION_PROMPT_NAME,
                title: ORCHESTRATION_PROMPT_TITLE,
                description: ORCHESTRATION_PROMPT_DESCRIPTION
              }
            ]
          }
        };
      }

      case "prompts/get": {
        const { name } = params || {};
        if (name !== LETTERDROP_ORCHESTRATION_PROMPT_NAME) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: `Prompt not found: ${name}`
            }
          };
        }

        return {
          jsonrpc: "2.0",
          id,
          result: getOrchestrationPromptResult()
        };
      }

      case "resources/list": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            resources: [
              {
                uri: LETTERDROP_ORCHESTRATION_RESOURCE_URI,
                name: LETTERDROP_ORCHESTRATION_RESOURCE_NAME,
                title: ORCHESTRATION_RESOURCE_TITLE,
                description: ORCHESTRATION_RESOURCE_DESCRIPTION,
                mimeType: "text/markdown"
              }
            ]
          }
        };
      }

      case "resources/read": {
        const { uri } = params || {};
        if (uri !== LETTERDROP_ORCHESTRATION_RESOURCE_URI) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: `Resource not found: ${uri}`
            }
          };
        }

        return {
          jsonrpc: "2.0",
          id,
          result: {
            contents: [
              {
                uri: LETTERDROP_ORCHESTRATION_RESOURCE_URI,
                mimeType: "text/markdown",
                text: LETTERDROP_ORCHESTRATION_PLAYBOOK
              }
            ]
          }
        };
      }

      case "tools/call": {
        const { name, arguments: args } = params || {};
        if (!name) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: "Invalid params: tool name is required"
            }
          };
        }

        const accessToken = extractAccessToken(authHeader);
        if (!accessToken) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32001,
              message:
                "Authorization required. Send MCP OAuth access token in Authorization: Bearer header."
            }
          };
        }

        // Repeat the scope check at the top of the handler: hiding a tool from
        // the catalog is not authorization, and a client can call a tool it was
        // never offered. Refuse before any work starts.
        const callScope = await resolveTokenScope(accessToken);
        if (!isToolAllowedForScope(name, callScope)) {
          console.warn(
            `[mcp-scope] denied tools/call ${name}: grant "${callScope}" lacks ${MCP_SCOPE_WRITE}`
          );
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32001,
              message: `This connection was granted ${callScope} access. The tool "${name}" requires the ${MCP_SCOPE_WRITE} scope. Reconnect and grant write access to use it.`
            }
          };
        }

        const handler = toolHandlers[name as keyof typeof toolHandlers];
        const schema = toolSchemas[name as keyof typeof toolSchemas];

        if (!handler || !schema) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Tool not found: ${name}`
            }
          };
        }

        const letterboxClient = createLetterboxClientForRequest(accessToken);
        try {
          const result = await executeTool(letterboxClient, name, args);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: result
                }
              ]
            }
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error occurred";
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32603,
              message: `Tool execution error: ${errorMessage}`
            }
          };
        }
      }

      case "ping": {
        return {
          jsonrpc: "2.0",
          id,
          result: {}
        };
      }

      default: {
        return {
          jsonrpc: "2.0",
          id: id || null,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
      }
    }
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: id || null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : "Internal error"
      }
    };
  }
}

/**
 * SSE stream. One `McpServer` per session, built with the grant's scope.
 */
async function handleSseRequest(req: Request, res: Response) {
  console.log("Received GET request to /mcp (establishing SSE stream)");
  try {
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    transports[sessionId] = transport;
    sessionAuth[sessionId] = req.headers.authorization ?? "";

    const getLetterboxClient = () =>
      createLetterboxClientForRequest(
        extractAccessToken(sessionAuth[sessionId])
      );
    // SSE resolves the scope once and bakes it into the registrations; see
    // the note on createScopeResolver about why that staleness is safe.
    const sessionScope = await resolveTokenScope(
      extractAccessToken(sessionAuth[sessionId])
    );
    const server = createServer(getLetterboxClient, sessionScope);
    servers[sessionId] = server;

    transport.onclose = () => {
      console.log(`SSE transport closed for session ${sessionId}`);
      delete transports[sessionId];
      delete servers[sessionId];
      delete sessionAuth[sessionId];
    };

    // Connect the transport to the MCP server
    await server.connect(transport);

    console.log(`Established SSE stream with session ID: ${sessionId}`);
  } catch (error) {
    console.error("Error establishing SSE stream:", error);
    if (!res.headersSent) {
      res.status(500).send("Error establishing SSE stream");
    }
  }
}

/**
 * SSE message sink, keyed by session.
 */
async function handleSseMessage(req: Request, res: Response) {
  console.log("Received POST request to /messages");

  // Extract session ID from URL query parameter
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    console.error("No session ID provided in request URL");
    res.status(400).send("Missing sessionId parameter");
    return;
  }

  const transport = transports[sessionId];
  const server = servers[sessionId];

  if (!transport) {
    console.error(`No transport found for session ID: ${sessionId}`);
    res.status(404).send("Session not found");
    return;
  }

  if (!server) {
    console.error(`No server found for session ID: ${sessionId}`);
    res.status(404).send("Server not found for session");
    return;
  }

  try {
    await transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error("Error handling POST message:", error);
    if (!res.headersSent) {
      res.status(500).send("Error processing message");
    }
  }
}

/**
 * Start SSE server
 */
async function startServer() {
  const app = express();

  // Cloud Run terminates TLS and forwards over http. Without this, req.protocol
  // is "http" and every URL this server publishes about itself — the OAuth
  // protected-resource `resource` above all — is wrong in a way no client
  // accepts.
  //
  // `true` trusts the whole forwarded chain, which also means Express will
  // believe a caller-supplied X-Forwarded-Host. Set MCP_PUBLIC_URL to take the
  // published origin out of the request's hands entirely — see externalOrigin.
  app.set("trust proxy", true);

  // Middleware for parsing JSON bodies
  app.use(express.json());

  // CORS headers for browser auth clients (Claude web / local MCP inspector) and MCP consumers.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && isOriginAllowed(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Vary", "Origin");

    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Authorization, Mcp-Session-Id, X-Requested-With"
    );
    res.header(
      "Access-Control-Expose-Headers",
      "WWW-Authenticate, Mcp-Session-Id"
    );

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    if (req.method === "HEAD") {
      res.sendStatus(200);
      return;
    }

    next();
  });

  // Health check endpoint (must return 200 for Cloud Run to consider the container healthy)
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version: SERVER_VERSION
    });
  });

  // OAuth / OpenID discovery so ChatGPT (and other clients) can find the authorization server
  // RFC 8414: OAuth 2.0 Authorization Server Metadata
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.type("application/json").json({
      issuer: OAUTH_ISSUER,
      authorization_endpoint: OAUTH_AUTHORIZATION_ENDPOINT,
      token_endpoint: OAUTH_TOKEN_ENDPOINT,
      registration_endpoint: OAUTH_REGISTRATION_ENDPOINT,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: [
        "none",
        "client_secret_basic",
        "client_secret_post"
      ],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp.read", "mcp.write"]
    });
  });

  // OpenID Connect discovery (many OAuth clients also check this)
  app.get("/.well-known/openid-configuration", (_req, res) => {
    res.type("application/json").json({
      issuer: OAUTH_ISSUER,
      authorization_endpoint: OAUTH_AUTHORIZATION_ENDPOINT,
      token_endpoint: OAUTH_TOKEN_ENDPOINT,
      registration_endpoint: OAUTH_REGISTRATION_ENDPOINT,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: [
        "none",
        "client_secret_basic",
        "client_secret_post"
      ],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp.read", "mcp.write"]
    });
  });

  // RFC 9728: OAuth 2.0 Protected Resource Metadata, one document per path a
  // client may connect on. `resource` must byte-match the URL the user entered,
  // path and all — a document that answers with the bare origin is rejected by
  // a client that connected to `/mcp`.
  for (const resourcePath of MCP_RESOURCE_PATHS) {
    app.get(
      `/.well-known/oauth-protected-resource${resourcePath}`,
      (req, res) => {
        res.type("application/json").json({
          resource: `${externalOrigin(req)}${resourcePath}`,
          authorization_servers: [OAUTH_ISSUER],
          scopes_supported: SCOPES_SUPPORTED,
          bearer_methods_supported: ["header"]
        });
      }
    );
  }

  // Streamable HTTP transport endpoint (POST to the root or /mcp)
  app.post("/", handleStreamableHttpRequest);
  app.post("/mcp", handleStreamableHttpRequest);
  // SSE endpoint for establishing the stream (client should send Authorization: Bearer <token>)
  app.get("/mcp", handleSseRequest);
  // Messages endpoint for receiving client JSON-RPC requests
  app.post("/messages", handleSseMessage);

  // Bind to 0.0.0.0 so Cloud Run (and other hosts) can reach the server
  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Letterdrop MCP Server running on port ${PORT}`);
    console.log(
      `MCP endpoint: http://localhost:${PORT}/mcp (${tools.length} tools)`
    );
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(
      `OAuth discovery: /.well-known/oauth-authorization-server, openid-configuration, oauth-protected-resource`
    );
    console.log(
      `Connected to Letterbox API: ${LETTERBOX_API_URL} (auth from client Authorization header)`
    );
  });

  installShutdownHandler(httpServer);
}

// Error handling
/**
 * Cloud Run sends SIGTERM and then waits before killing the container. Without
 * this the process exits immediately on every deploy, cutting off whatever tool
 * calls were mid-flight — the client sees a dropped connection rather than a
 * result, and a directory listing's health metric counts it.
 *
 * Stop accepting new connections, let in-flight requests finish, and only then
 * exit. The timer is the backstop for a request that never completes.
 */
function installShutdownHandler(server: import("http").Server) {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received — draining in-flight requests`);

    const forceExit = setTimeout(() => {
      console.error("Drain timed out; exiting anyway");
      process.exit(1);
    }, SHUTDOWN_DRAIN_MS);
    // Do not let the timer itself hold the event loop open once the server has
    // closed — that would turn a clean drain into a wait for the full timeout.
    forceExit.unref();

    server.close(() => {
      clearTimeout(forceExit);
      console.log("Drained; exiting");
      process.exit(0);
    });

    // SSE sessions hold their sockets open indefinitely, so server.close()
    // would never fire while one is connected. Close the transports too.
    for (const sessionId of Object.keys(transports)) {
      try {
        // close() is async. A bare call leaves the rejection unhandled, and the
        // `unhandledRejection` handler below exits the process immediately —
        // skipping the very drain this block exists to perform. Promise.resolve
        // covers both shapes; the try/catch still covers a synchronous throw.
        Promise.resolve(transports[sessionId].close?.()).catch((error) =>
          console.error(`Error closing SSE session ${sessionId}:`, error)
        );
      } catch (error) {
        console.error(`Error closing SSE session ${sessionId}:`, error);
      }
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Start server
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
