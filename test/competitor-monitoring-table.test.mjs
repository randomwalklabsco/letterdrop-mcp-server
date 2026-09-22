import assert from "node:assert/strict";
import test from "node:test";

import {
  handleCompetitorMonitoringTable,
  competitorMonitoringTableTool
} from "../dist/tools/competitor-monitoring-table.js";
import { competitorMonitoringAccountDetailsTool } from "../dist/tools/competitor-monitoring-account-details.js";
import { tools, toolHandlers, toolSchemas } from "../dist/tools/index.js";
import { LETTERDROP_ORCHESTRATION_PLAYBOOK } from "../dist/playbook.js";

function createClient(response) {
  const calls = [];
  return {
    calls,
    client: {
      async getCompetitorMonitoringAccounts(params) {
        calls.push(params);
        return response;
      }
    }
  };
}

test("registers one canonical competitor monitoring table tool", () => {
  const names = tools.map((tool) => tool.name);

  assert.equal(
    competitorMonitoringTableTool.name,
    "get_competitor_monitoring_table"
  );
  assert.equal(names.includes("get_competitor_monitoring_table"), true);
  assert.equal(names.includes("get_competitor_monitoring_accounts"), false);
  assert.equal(names.includes("get_competitor_monitoring_leads"), false);
  assert.equal(typeof toolHandlers.get_competitor_monitoring_table, "function");
  assert.ok(toolSchemas.get_competitor_monitoring_table);
});

test("keeps MCP tool discovery and orchestration guidance platform-neutral", () => {
  const publicMcpSurface = JSON.stringify({
    tools,
    orchestrationPlaybook: LETTERDROP_ORCHESTRATION_PLAYBOOK
  });

  // The published channel vocabulary is exactly these three. Asserting the
  // positive keeps this test from having to name what it excludes.
  assert.match(publicMcpSurface, /recommendedChannels\.socialNetwork/);
  const channelWords = publicMcpSurface.match(
    /recommendedChannels\.[A-Za-z]+/g
  );
  for (const word of channelWords) {
    assert.ok(
      ["socialNetwork", "email", "call"].includes(word.split(".")[1]),
      `${word} is outside the published channel vocabulary`
    );
  }
});

test("includes the full contact roster by default and exposes pagination", async () => {
  const { client, calls } = createClient({
    totalRecords: 3,
    limit: 2,
    offset: 0,
    accounts: [
      {
        companyKey: "one",
        contacts: [
          {
            recommendedAction: "Upstream Label + Call",
            recommendedChannels: {
              upstreamChannelKey: true,
              email: false,
              call: true
            }
          }
        ],
        buyingCommittee: [
          {
            recommendedAction: "Email",
            recommendedChannels: {
              upstreamChannelKey: false,
              email: true,
              call: false
            }
          }
        ]
      },
      { companyKey: "two" }
    ]
  });

  const result = JSON.parse(
    await handleCompetitorMonitoringTable(client, { limit: 2 })
  );

  assert.deepEqual(calls, [
    {
      limit: 2,
      include: ["contacts", "custom_columns", "buying_committee"],
      maxContactsPerAccount: 100
    }
  ]);
  assert.deepEqual(result.pagination, { hasMore: true, nextOffset: 2 });
  assert.deepEqual(result.coverage, {
    engagedContactsIncluded: true,
    buyingCommitteeIncluded: true,
    maxContactsPerAccount: 100
  });
  assert.deepEqual(result.accounts[0].contacts[0].recommendedChannels, {
    email: false,
    call: true,
    socialNetwork: true
  });
  assert.equal(
    result.accounts[0].contacts[0].recommendedAction,
    "Social Network + Call"
  );
  assert.deepEqual(result.accounts[0].buyingCommittee[0].recommendedChannels, {
    email: true,
    call: false,
    socialNetwork: false
  });
  assert.equal(
    result.accounts[0].buyingCommittee[0].recommendedAction,
    "Email"
  );
  // Neither the upstream key nor the upstream label survives into the payload:
  // the key is folded onto socialNetwork and the label is rebuilt from the
  // booleans rather than rewritten, so an unrecognised label cannot pass
  // through intact.
  const payload = JSON.stringify(result);
  assert.doesNotMatch(payload, /upstreamChannelKey/);
  assert.doesNotMatch(payload, /Upstream Label/);
});

test("documents the current weekly budget semantics for recommended outreach", () => {
  assert.match(competitorMonitoringTableTool.description, /weekly.*capacity/i);
  assert.match(
    competitorMonitoringTableTool.description,
    /empty `recommendedAction` means no action was allocated/i
  );
  assert.match(
    LETTERDROP_ORCHESTRATION_PLAYBOOK,
    /get_competitor_monitoring_table.*outreach is recommended/s
  );
  assert.match(
    LETTERDROP_ORCHESTRATION_PLAYBOOK,
    /recommendedChannels\.socialNetwork.*\.email.*\.call/s
  );
});

test("honors an explicit lightweight include selection", async () => {
  const { client, calls } = createClient({
    totalRecords: 1,
    limit: 1,
    offset: 0,
    accounts: [{ companyKey: "one" }]
  });

  const result = JSON.parse(
    await handleCompetitorMonitoringTable(client, {
      include: ["contacts"],
      max_contacts_per_account: 5
    })
  );

  assert.deepEqual(calls, [
    {
      include: ["contacts"],
      maxContactsPerAccount: 5
    }
  ]);
  assert.deepEqual(result.pagination, { hasMore: false, nextOffset: null });
  assert.deepEqual(result.coverage, {
    engagedContactsIncluded: true,
    buyingCommitteeIncluded: false,
    maxContactsPerAccount: 5
  });
});

// The attribution vocabulary. The table answers two
// different questions that are easy to conflate: WHEN a meeting happened (the
// dates) and WHY (the verdict). A reader with only the dates infers causation
// from ordering, which is exactly the inference `competitive_deal` exists to
// block — so the terms have to be defined in the tool description, not merely
// returned in the payload.
test("defines every attribution term the table can return", () => {
  const description = competitorMonitoringTableTool.description;

  for (const term of [
    "direct_reply",
    "driven",
    "assisted",
    "detected",
    "competitive_deal",
    "pending_analysis"
  ]) {
    assert.ok(
      description.includes(term),
      `tool description never defines "${term}"`
    );
  }

  // The blank is part of the vocabulary: a reader who takes it for "no
  // attribution was found" has turned an absence of judgment into a finding.
  assert.match(description, /EMPTY verdict means no claim is being made/);
  // Only two labels credit us; the other three must never be read as sourced.
  assert.match(
    description,
    /never report assisted or detected as sourced pipeline/i
  );
  // priorRecentOutreach is tri-state, and null is the trap.
  assert.match(description, /NULL when we could not look at all/);
});

test("offers the attribution filter with the folded vocabulary", () => {
  const properties = competitorMonitoringTableTool.inputSchema.properties;

  assert.ok(properties.attribution, "attribution filter is not offered");
  assert.deepEqual(properties.attribution.items.enum, [
    "direct_reply",
    "driven",
    "assisted",
    "detected",
    "competitive_deal",
    // The two COVERAGE values fold into one selectable bucket — the difference
    // between "not scored yet" and "nothing to score" is about OUR data.
    "not_attributed"
  ]);
  // pending_analysis is a real stored label but NOT a filter value.
  assert.equal(
    properties.attribution.items.enum.includes("pending_analysis"),
    false
  );
});

test("forwards the attribution filter to the backend", async () => {
  const { calls, client } = createClient({
    success: true,
    data: { accounts: [], totalRecords: 0, limit: 25, offset: 0 }
  });

  await handleCompetitorMonitoringTable(client, {
    attribution: ["direct_reply", "not_attributed"]
  });

  assert.deepEqual(calls[0].filters.attribution, [
    "direct_reply",
    "not_attributed"
  ]);
});

// The details tool returned the UNGATED stored verdict inside
// crmOutreach while dropping the gated one. Both are now correct in letterbox;
// the description has to point a reader at the right field, or they will read
// the one that over-claims.
test("points the details tool at the gated verdict, not the stored one", async () => {
  const { competitorMonitoringAccountDetailsTool } =
    await import("../dist/tools/competitor-monitoring-account-details.js");
  const description = competitorMonitoringAccountDetailsTool.description;

  assert.match(description, /attributionVerdict/);
  assert.match(description, /attributionVerdictReasoning/);
  assert.match(description, /deliberately withholds its stored verdict/);
  // A blank meeting label on a scored account is gated, not unscored.
  assert.match(description, /is gated, not unscored/);
});

// GET-10596 — the rows carry the lead's own email and phone. Both tools have to
// say so, or a caller goes off to enrich someone Letterdrop already found, and
// has to keep them apart from the two other "email" fields on the same row.
test("tells callers the lead's email and phone are on every person", () => {
  for (const tool of [
    competitorMonitoringTableTool,
    competitorMonitoringAccountDetailsTool
  ]) {
    assert.match(tool.description, /`workEmail`, `personalEmails`/);
    assert.match(tool.description, /instead of enriching the person again/);
    assert.match(tool.description, /nothing has been found yet/);
  }
});
