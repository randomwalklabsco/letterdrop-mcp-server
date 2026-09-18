import assert from "node:assert/strict";
import test from "node:test";

import {
  MCP_RESOURCE_PATHS,
  SCOPES_SUPPORTED,
  SERVER_NAME,
  mcpResourcePath
} from "../dist/catalog.js";
import { LETTERDROP_ORCHESTRATION_PLAYBOOK } from "../dist/playbook.js";
import { filterToolsForScope } from "../dist/scope.js";
import { tools, toolHandlers, toolSchemas } from "../dist/tools/index.js";

/**
 * This server's listing says it reads competitor monitoring data and writes
 * only the buyer-filter definition. These tests are that claim, written down.
 */

const EXPECTED_TOOL_NAMES = [
  "get_competitor_monitoring_table",
  "get_competitor_monitoring_account_details",
  "get_knowledge_base_buyer_filters",
  "update_knowledge_base_buyer_filters",
  "list_workspaces"
];

const namesOf = (toolList) => toolList.map((tool) => tool.name);

test("the server offers exactly the five listed tools", () => {
  // A sixth appearing here is a change to what the listing says the connector
  // does, so it should fail this test before it reaches a reviewer.
  assert.deepEqual(namesOf(tools), EXPECTED_TOOL_NAMES);
});

test("every tool has a handler and a schema", () => {
  for (const toolName of EXPECTED_TOOL_NAMES) {
    assert.equal(typeof toolHandlers[toolName], "function", toolName);
    assert.ok(toolSchemas[toolName], `${toolName} has no schema`);
  }
  assert.equal(Object.keys(toolHandlers).length, EXPECTED_TOOL_NAMES.length);
  assert.equal(Object.keys(toolSchemas).length, EXPECTED_TOOL_NAMES.length);
});

test("every tool carries the title and hints the directory requires", () => {
  for (const tool of tools) {
    assert.ok(tool.title, `${tool.name} has no title`);
    assert.equal(tool.annotations.title, tool.title);
    assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
    assert.equal(typeof tool.annotations.destructiveHint, "boolean");
    assert.equal(
      tool.annotations.readOnlyHint && tool.annotations.destructiveHint,
      false,
      `${tool.name} is annotated read-only and destructive at once`
    );
  }
});

test("the only write prompts before it runs", () => {
  const writes = tools.filter((tool) => !tool.annotations.readOnlyHint);
  assert.deepEqual(namesOf(writes), ["update_knowledge_base_buyer_filters"]);
  assert.equal(writes[0].annotations.destructiveHint, true);
});

test("a read-only grant is offered every tool except the write", () => {
  assert.deepEqual(
    namesOf(filterToolsForScope(tools, "mcp.read")),
    EXPECTED_TOOL_NAMES.filter(
      (toolName) => toolName !== "update_knowledge_base_buyer_filters"
    )
  );
});

test("the playbook names only tools this server registers", () => {
  const namedTools = new Set(
    LETTERDROP_ORCHESTRATION_PLAYBOOK.match(
      /\b(?:get|list|update|set|create|add|remove|delete|send|estimate|activate|decide)_[a-z_]+\b/g
    ) || []
  );
  for (const toolName of namedTools) {
    assert.ok(
      EXPECTED_TOOL_NAMES.includes(toolName),
      `the playbook points at ${toolName}, which this server does not register`
    );
  }
});

test("the catalog publishes only the neutral channel vocabulary", () => {
  const surface = JSON.stringify({
    tools,
    playbook: LETTERDROP_ORCHESTRATION_PLAYBOOK
  });

  for (const word of surface.match(/recommendedChannels\.[A-Za-z]+/g) || []) {
    assert.ok(
      ["socialNetwork", "email", "call"].includes(word.split(".")[1]),
      `${word} is outside the published channel vocabulary`
    );
  }
});

test("the server publishes its own name and both scopes", () => {
  assert.equal(SERVER_NAME, "letterdrop-mcp-server");
  assert.deepEqual(SCOPES_SUPPORTED, ["mcp.read", "mcp.write"]);
});

test("the auth challenge names the URL the request arrived on", () => {
  // (express baseUrl, express path) -> resource path
  assert.equal(mcpResourcePath("", "/"), "");
  assert.equal(mcpResourcePath("", "/mcp"), "/mcp");
  assert.equal(mcpResourcePath(undefined, undefined), "");
  assert.equal(mcpResourcePath("", undefined), "");
});

test("every challenge path has a protected-resource document behind it", () => {
  // A challenge path outside the registered set points at a 404 and strands
  // the client mid-OAuth.
  const registered = new Set(MCP_RESOURCE_PATHS);
  for (const path of ["/", "/mcp"]) {
    assert.ok(
      registered.has(mcpResourcePath("", path)),
      `no metadata document for ${path}`
    );
  }
});
