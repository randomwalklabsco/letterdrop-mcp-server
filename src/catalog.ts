/**
 * Server identity and OAuth resource paths.
 *
 * This server offers one fixed catalog — the competitor monitoring table, its
 * per-account drill-down, the buyer-filter definition, and the workspace list.
 * Nothing on it can send a message from a customer's connected account or arm a
 * sequence that would.
 */

import { MCP_SCOPE_READ, MCP_SCOPE_WRITE } from "./scope.js";

export const SERVER_NAME = "letterdrop-mcp-server";

export const SCOPES_SUPPORTED = [MCP_SCOPE_READ, MCP_SCOPE_WRITE];

/**
 * The paths a client may connect on. Each gets its own RFC 9728
 * protected-resource document, because a client validates that `resource`
 * byte-matches the URL it was pointed at.
 */
export const MCP_RESOURCE_PATHS = ["", "/mcp"];

/**
 * The RFC 9728 resource path for the URL a request actually arrived on.
 *
 * `baseUrl` is the Express mount and `path` the remainder, with "/" meaning the
 * root. Together they reproduce exactly the registered paths: "" and "/mcp".
 */
export function mcpResourcePath(
  baseUrl: string | undefined,
  path: string | undefined
): string {
  const mount = baseUrl || "";
  const rest = !path || path === "/" ? "" : path;
  return `${mount}${rest}`;
}
