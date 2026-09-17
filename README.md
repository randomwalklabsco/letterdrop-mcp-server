# letterdrop-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server for Letterdrop **competitor monitoring**. It lets an AI assistant find the accounts that are in a competitor's sales cycle, see who at those accounts is involved, and check what the CRM says about them.

The server only reads. The one thing it can change is the workspace's buyer-filter definition. It cannot send messages from a connected account or create outreach sequences.

## Tools

| Tool                                        | Access | What it does                                                                                                                                                                                            |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_competitor_monitoring_table`           | read   | The full competitor monitoring table, one row per company: engaged contacts, buying committee, recommended outreach, CRM deal fields, custom columns. Supports search, filters, sorting and pagination. |
| `get_competitor_monitoring_account_details` | read   | Everything known about one company: CRM outreach rollup, activity timeline, competitor signals, opportunities and the buying committee.                                                                 |
| `get_knowledge_base_buyer_filters`          | read   | The workspace's buyer definition: company filters, decision-maker titles, individual-contributor titles.                                                                                                |
| `update_knowledge_base_buyer_filters`       | write  | Replaces that buyer definition. Needs the `mcp.write` scope.                                                                                                                                            |
| `list_workspaces`                           | read   | The workspaces the connected user can see, with the active one flagged.                                                                                                                                 |

The server also publishes one prompt and one resource (`letterdrop://guides/orchestration-playbook`) explaining how to use these tools together.

## Endpoints

| Path                                                   | Purpose                                |
| ------------------------------------------------------ | -------------------------------------- |
| `POST /mcp`, `POST /`                                  | Streamable HTTP transport (JSON-RPC)   |
| `GET /mcp` + `POST /messages`                          | SSE transport                          |
| `GET /health`                                          | Health check                           |
| `GET /.well-known/oauth-protected-resource`, `.../mcp` | RFC 9728 protected-resource metadata   |
| `GET /.well-known/oauth-authorization-server`          | RFC 8414 authorization-server metadata |
| `GET /.well-known/openid-configuration`                | OpenID discovery                       |

## Authentication

Clients authenticate with OAuth 2.1 (authorization code + PKCE S256, dynamic client registration). The authorization server is the Letterdrop API. This server forwards the bearer token to the API on every tool call. An unauthenticated `tools/call` gets a `401` with a `WWW-Authenticate` header that points at the protected-resource metadata.

Scopes:

- `mcp.read`: every read tool
- `mcp.write`: also allows `update_knowledge_base_buyer_filters`

A read-only grant never sees the write tool in `tools/list`, and the call is refused if made anyway. The Letterdrop API also checks scope on every request, and that API check is the real authorization.

## Configuration

Copy `.env.example` to `.env`.

| Variable                   | Default                      | Description                                                                |
| -------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `LETTERBOX_API_URL`        | `https://api.letterdrop.com` | Letterdrop API base URL                                                    |
| `FRONTEND_URL`             | `https://app.letterdrop.com` | Allowed CORS origin                                                        |
| `MCP_SERVER_PORT` / `PORT` | `3002`                       | Listen port (`PORT` wins)                                                  |
| `MCP_PUBLIC_URL`           | derived from request         | Public origin published in OAuth metadata; set it in deployed environments |
| `MCP_OAUTH_ISSUER`         | `LETTERBOX_API_URL`          | OAuth issuer; must match the API's issuer                                  |
| `MCP_CORS_ORIGINS`         | –                            | Extra comma-separated CORS origins                                         |
| `NODE_ENV`                 | –                            | `development` allows `LETTERBOX_API_KEY` in place of a bearer token        |

## Development

Requires Node.js 20+.

```bash
npm install
npm run dev          # tsx watch on src/index.ts
npm run typecheck
npm test             # builds, then runs node --test test/*.test.mjs
npm run format:check
```

Try it with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
# connect to http://localhost:3002/mcp
```

## Deployment

`Dockerfile` builds a production image that listens on port 3000. `cloudbuild.yaml` builds and pushes `gcr.io/$PROJECT_ID/letterdrop-mcp-server` and deploys the Cloud Run service `letterdrop-mcp-server`:

```bash
gcloud builds submit --substitutions=_IMAGE_TAG=$(git rev-parse --short HEAD),_MCP_PUBLIC_URL=https://<public-host>
```

## License

MIT
