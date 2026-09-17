import assert from "node:assert/strict";
import test from "node:test";

import {
  MCP_FULL_SCOPE,
  createScopeResolver,
  filterToolsForScope,
  hasMcpScope,
  isToolAllowedForScope,
  isWriteTool,
  parseMcpScope
} from "../dist/scope.js";
import { tools, readOnlyToolNames } from "../dist/tools/index.js";

/**
 * A read-only grant must be neither offered nor allowed to call a tool that
 * writes.
 */

const WRITE_TOOLS = ["update_knowledge_base_buyer_filters"];

test("parses whole scope tokens, not substrings", () => {
  assert.equal(parseMcpScope("xmcp.readx").size, 0);
  assert.equal(parseMcpScope("not.mcp.write").size, 0);
  assert.equal(parseMcpScope("mcp.read").size, 1);
  assert.equal(parseMcpScope("mcp.read mcp.write").size, 2);
  assert.equal(parseMcpScope("mcp").size, 2); // legacy claim, still live
  assert.equal(parseMcpScope(undefined).size, 0);
});

test("hasMcpScope answers for the scope actually granted", () => {
  assert.equal(hasMcpScope("mcp.read", "mcp.write"), false);
  assert.equal(hasMcpScope(MCP_FULL_SCOPE, "mcp.write"), true);
  assert.equal(hasMcpScope("mcp", "mcp.write"), true);
});

test("every write tool is classified as a write", () => {
  // If one of these ever lands in readOnlyToolNames it stops being filtered and
  // a read-only grant can rewrite workspace state.
  for (const name of WRITE_TOOLS) {
    assert.equal(isWriteTool(name), true, `${name} must be a write tool`);
    assert.equal(readOnlyToolNames.has(name), false);
  }
});

test("a tool absent from the read-only list is treated as a write", () => {
  // Restrictive by default: a newly added tool is filtered until someone says
  // otherwise, rather than being offered to every grant.
  assert.equal(isWriteTool("some_tool_added_next_quarter"), true);
});

test("a read-only grant is offered no write tools", () => {
  const filtered = filterToolsForScope(tools, "mcp.read");

  assert.ok(filtered.length > 0, "read tools should survive");
  assert.ok(filtered.length < tools.length, "write tools should be dropped");
  for (const tool of filtered) {
    assert.equal(readOnlyToolNames.has(tool.name), true);
  }
  for (const name of WRITE_TOOLS) {
    assert.equal(
      filtered.some((tool) => tool.name === name),
      false
    );
  }
});

test("a full-scope grant is offered the whole catalog", () => {
  assert.equal(filterToolsForScope(tools, MCP_FULL_SCOPE).length, tools.length);
  assert.equal(filterToolsForScope(tools, "mcp").length, tools.length);
});

test("an unknown scope is offered the whole catalog", () => {
  // The catalog fails open on purpose: it is not the authorization control, and
  // a letterbox blip must not empty tools/list. Letterbox refuses the writes.
  assert.equal(filterToolsForScope(tools, null).length, tools.length);
});

test("a malformed scope is treated as read-only, not as full access", () => {
  const filtered = filterToolsForScope(tools, "xmcp.writex");

  assert.ok(filtered.length < tools.length);
  for (const name of WRITE_TOOLS) {
    assert.equal(
      filtered.some((tool) => tool.name === name),
      false
    );
  }
});

test("the handler entry check mirrors the catalog", () => {
  assert.equal(
    isToolAllowedForScope("update_knowledge_base_buyer_filters", "mcp.read"),
    false
  );
  assert.equal(
    isToolAllowedForScope(
      "update_knowledge_base_buyer_filters",
      MCP_FULL_SCOPE
    ),
    true
  );
  assert.equal(
    isToolAllowedForScope("update_knowledge_base_buyer_filters", null),
    true
  );
  assert.equal(
    isToolAllowedForScope("get_competitor_monitoring_table", "mcp.read"),
    true
  );
});

test("every registered tool agrees between catalog and entry check", () => {
  // Hiding a tool the handler would then run, or offering one it would refuse,
  // are both bugs the client sees. Assert they cannot diverge.
  const offered = new Set(
    filterToolsForScope(tools, "mcp.read").map((tool) => tool.name)
  );
  for (const tool of tools) {
    assert.equal(
      offered.has(tool.name),
      isToolAllowedForScope(tool.name, "mcp.read"),
      `${tool.name} disagrees between tools/list and tools/call`
    );
  }
});

test("the scope resolver asks letterbox once and reuses the answer", async () => {
  const calls = [];
  const resolve = createScopeResolver({
    apiUrl: "https://api.example.com",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ scope: "mcp.read" }) };
    }
  });

  assert.equal(await resolve("token-a"), "mcp.read");
  assert.equal(await resolve("token-a"), "mcp.read");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.com/api/v1/mcp/token-info");
  assert.equal(calls[0].options.headers.Authorization, "Bearer token-a");
});

test("the scope resolver keeps tokens apart", async () => {
  const resolve = createScopeResolver({
    apiUrl: "https://api.example.com",
    fetchImpl: async (_url, options) => ({
      ok: true,
      json: async () => ({
        scope:
          options.headers.Authorization === "Bearer read-token"
            ? "mcp.read"
            : MCP_FULL_SCOPE
      })
    })
  });

  assert.equal(await resolve("read-token"), "mcp.read");
  assert.equal(await resolve("full-token"), MCP_FULL_SCOPE);
});

test("the scope resolver reports unknown rather than throwing", async () => {
  const failing = createScopeResolver({
    apiUrl: "https://api.example.com",
    fetchImpl: async () => {
      throw new Error("connection refused");
    }
  });
  const rejecting = createScopeResolver({
    apiUrl: "https://api.example.com",
    fetchImpl: async () => ({ ok: false, json: async () => ({}) })
  });

  assert.equal(await failing("token-a"), null);
  assert.equal(await rejecting("token-a"), null);
  assert.equal(await failing(null), null);
});

test("the scope resolver gives up on a hung letterbox instead of hanging", async () => {
  // The failure mode the fail-open design is written for but did not cover:
  // letterbox accepts the connection and then never answers. Node's fetch has
  // no default timeout, so this await never settled and no catch was ever
  // reached — and since the same resolver runs at the top of tools/call, every
  // tool call behind it blocked too. Failing open requires failing fast first.
  //
  // The stub honours the abort signal the way a real fetch does; without the
  // signal being passed at all, this test hangs forever rather than failing.
  let sawSignal = false;
  const resolve = createScopeResolver({
    apiUrl: "https://api.example.com",
    timeoutMs: 10,
    fetchImpl: (_url, options) =>
      new Promise((_resolve, reject) => {
        sawSignal = Boolean(options.signal);
        options.signal?.addEventListener("abort", () =>
          reject(options.signal.reason)
        );
      })
  });

  // AbortSignal.timeout's own timer is unref'd, so it cannot by itself hold the
  // loop open. The real server always has one (its listener); this test has to
  // supply one or node --test resolves the loop out from under the abort.
  const keepEventLoopAlive = setTimeout(() => {}, 1000);
  const resolved = await resolve("token-a");
  clearTimeout(keepEventLoopAlive);

  assert.equal(resolved, null);
  assert.ok(sawSignal, "the token-info fetch must carry an abort signal");
});

test("a cached answer expires", async () => {
  let scope = "mcp.read";
  const resolve = createScopeResolver({
    apiUrl: "https://api.example.com",
    ttlMs: 0,
    fetchImpl: async () => ({ ok: true, json: async () => ({ scope }) })
  });

  assert.equal(await resolve("token-a"), "mcp.read");
  scope = MCP_FULL_SCOPE;
  assert.equal(await resolve("token-a"), MCP_FULL_SCOPE);
});
