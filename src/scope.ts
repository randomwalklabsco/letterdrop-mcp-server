/**
 * Scope-aware tool catalog.
 *
 * The catalog should describe what a connection can actually do, so a
 * read-only grant is not offered a write tool it will be refused for using.
 *
 * This is not authorization: this server holds no signing secret and cannot
 * verify the bearer token it forwards, so it *asks* the Letterdrop API what the
 * token carries. When that answer does not arrive — the API is slow, the
 * endpoint errors, a deployment is mid-rollout — the catalog falls back to
 * showing everything rather than breaking `tools/list`.
 *
 * **Authorization is the per-route scope gate in the Letterdrop API**, which
 * runs on every mutating endpoint regardless of what this server offered or
 * allowed. That is why this is safe to fail open: it is not the control.
 */

import { readOnlyToolNames } from "./tools/index.js";

export const MCP_SCOPE_READ = "mcp.read";
export const MCP_SCOPE_WRITE = "mcp.write";
export const MCP_FULL_SCOPE = `${MCP_SCOPE_READ} ${MCP_SCOPE_WRITE}`;

const SUPPORTED_SCOPES = [MCP_SCOPE_READ, MCP_SCOPE_WRITE];

/** Tokens minted before the claim took its current shape carry a bare "mcp". */
const LEGACY_FULL_SCOPE = "mcp";

/**
 * Split a scope string into the scopes it actually grants.
 *
 * Whole tokens, never substrings: a claim of "xmcp.readx" grants nothing. This
 * has to agree with the API's reading of a scope string or the catalog will
 * disagree with the gate.
 */
export function parseMcpScope(scope: unknown): Set<string> {
  if (typeof scope !== "string") {
    return new Set();
  }

  const trimmed = scope.trim();
  if (!trimmed) {
    return new Set();
  }

  if (trimmed === LEGACY_FULL_SCOPE) {
    return new Set(SUPPORTED_SCOPES);
  }

  return new Set(
    trimmed.split(/\s+/).filter((token) => SUPPORTED_SCOPES.includes(token))
  );
}

export function hasMcpScope(scope: unknown, required: string): boolean {
  return parseMcpScope(scope).has(required);
}

/** A tool that mutates workspace state. */
export function isWriteTool(toolName: string): boolean {
  return !readOnlyToolNames.has(toolName);
}

/**
 * Is this tool worth offering, and worth starting, for this grant?
 *
 * `null` means the scope could not be determined — see the note at the top of
 * the file. Everything is allowed in that case, and letterbox refuses whatever
 * should be refused.
 */
export function isToolAllowedForScope(
  toolName: string,
  scope: string | null
): boolean {
  if (scope === null || scope === undefined) {
    return true;
  }
  if (!isWriteTool(toolName)) {
    return true;
  }
  return hasMcpScope(scope, MCP_SCOPE_WRITE);
}

/**
 * The catalog a connection with this grant should see.
 *
 * @param toolList every registered tool
 * @param scope the grant, or null when it could not be determined
 */
export function filterToolsForScope<T extends { name: string }>(
  toolList: T[],
  scope: string | null
): T[] {
  if (scope === null || scope === undefined) {
    return toolList;
  }
  if (hasMcpScope(scope, MCP_SCOPE_WRITE)) {
    return toolList;
  }
  return toolList.filter((tool) => !isWriteTool(tool.name));
}

export interface ScopeResolverOptions {
  apiUrl: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** How long an answer is reused. Well under the access token's own lifetime. */
  ttlMs?: number;
  /** Bound on how many tokens are remembered at once. */
  maxEntries?: number;
  /** How long to wait for letterbox before giving up and reporting unknown. */
  timeoutMs?: number;
}

export type ScopeResolver = (
  accessToken: string | null | undefined
) => Promise<string | null>;

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;
// Failing open requires failing FAST first. Node's fetch has no default
// timeout, so a letterbox that accepts the connection and then hangs would hang
// this await with it — and since the same resolver runs at the top of
// tools/call, every tool call behind it, with no catch ever reached. An abort
// throws, so the catch below turns it into the same unknown-scope path as a 500.
// Short on purpose: it gates every call, and the answer is cached for the TTL
// above once it lands.
const SCOPE_FETCH_TIMEOUT_MS = 5000;

/**
 * Ask letterbox what a bearer token is allowed to do, and remember the answer
 * for a few minutes.
 *
 * A token's scope is fixed at issue time — it is a claim inside the signed JWT —
 * so caching cannot serve a stale grant. The TTL is there to bound how long a
 * revoked-workspace token keeps a cache entry alive, and the entry cap is there
 * so a burst of distinct tokens cannot grow the map without limit.
 *
 * Every failure resolves to `null`, which the callers read as "unknown" and
 * treat as unrestricted. That is deliberate: this is the catalog, not the gate.
 *
 * The TTL only bounds the streamable-HTTP path, which re-resolves per request.
 * On SSE the scope is resolved once per session and baked into `createServer`'s
 * registrations, so a session that begins while `token-info` is unreachable
 * keeps the full catalog for its whole life however long the TTL is. That is
 * stale by design and safe for the same reason the fallback is: letterbox is
 * the gate, and it re-checks every call.
 */
export function createScopeResolver(
  options: ScopeResolverOptions
): ScopeResolver {
  const {
    apiUrl,
    fetchImpl,
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    timeoutMs = SCOPE_FETCH_TIMEOUT_MS
  } = options;
  const cache = new Map<string, { scope: string | null; expiresAt: number }>();

  return async function resolveScope(accessToken) {
    if (!accessToken) {
      return null;
    }

    const cached = cache.get(accessToken);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.scope;
    }

    let scope: string | null = null;
    try {
      const doFetch = fetchImpl || fetch;
      const response = await doFetch(`${apiUrl}/api/v1/mcp/token-info`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.ok) {
        const payload: any = await response.json();
        scope = typeof payload?.scope === "string" ? payload.scope : null;
      }
    } catch (error) {
      // Unknown scope, full catalog, letterbox still enforces.
      console.warn(
        `[mcp-scope] could not resolve token scope: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      scope = null;
    }

    if (cache.size >= maxEntries) {
      cache.clear();
    }
    cache.set(accessToken, { scope, expiresAt: Date.now() + ttlMs });
    return scope;
  };
}
