import assert from "node:assert/strict";
import test from "node:test";

import { LETTERDROP_ORCHESTRATION_PLAYBOOK } from "../dist/playbook.js";
import {
  UpdateKnowledgeBaseBuyerFiltersSchema,
  updateKnowledgeBaseBuyerFiltersTool
} from "../dist/tools/knowledge-base-buyer-filters-update.js";

test("company sizes read back from the get tool can be sent back as they are", () => {
  // letterbox returns every size as a named option.
  const readBack = [{ name: "51-200", value: "51-200" }];

  const parsed = UpdateKnowledgeBaseBuyerFiltersSchema.parse({
    company_filters: { company_sizes: [...readBack, "1001-5000"] }
  });

  assert.deepEqual(parsed.company_filters.company_sizes, [
    { name: "51-200", value: "51-200" },
    "1001-5000"
  ]);
});

test("a company size the model writes as a string must be one of the options", () => {
  assert.throws(() =>
    UpdateKnowledgeBaseBuyerFiltersSchema.parse({
      company_filters: { company_sizes: ["50-100"] }
    })
  );
});

test("the published JSON schema accepts both shapes for company sizes", () => {
  const items =
    updateKnowledgeBaseBuyerFiltersTool.inputSchema.properties.company_filters
      .properties.company_sizes.items;
  assert.deepEqual(
    items.anyOf.map((shape) => shape.type),
    ["string", "object"]
  );
});

test("the playbook describes per-list edits and the Full Buying Committee", () => {
  assert.match(LETTERDROP_ORCHESTRATION_PLAYBOOK, /list by list/);
  assert.match(LETTERDROP_ORCHESTRATION_PLAYBOOK, /Full Buying Committee/);
  assert.doesNotMatch(
    LETTERDROP_ORCHESTRATION_PLAYBOOK,
    /rewrites that definition/
  );
});
