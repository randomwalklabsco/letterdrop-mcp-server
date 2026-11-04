import assert from "node:assert/strict";
import test from "node:test";

import { LetterboxClient } from "../dist/client/letterbox-client.js";
import {
  COMPETITOR_API_V2_METRICS,
  fromCompetitorApiV2Account,
  toCompetitorApiV2AccountsQuery,
  toCompetitorApiV2FilterParams
} from "../dist/client/competitor-monitoring-v2.js";

// The competitor tools read the published API v2, which speaks the
// webhook's vocabulary. These pin the translation both ways and the HTTP calls
// the client makes.

function clientWith(http) {
  const client = new LetterboxClient({
    apiUrl: "http://letterbox.test",
    accessToken: "token"
  });
  client.client = http;
  return client;
}

function recordingHttp(responses) {
  const calls = [];
  const respond = (method, url, config) => {
    calls.push({ method, url, config });
    const path = url.split("?")[0];
    const response = responses[`${method} ${path}`];
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve({ data: response });
  };
  return {
    calls,
    get: (url, config) => respond("GET", url, config)
  };
}

const queryOf = (url) => new URLSearchParams(url.split("?")[1] || "");

const V2_ACCOUNT = {
  account_id: "domain:acme.com",
  company_name: "Acme",
  company_domain: "acme.com",
  company_hq_country: "US",
  account_competitors: "HubSpot, G2",
  account_competitor_cycle_stage: "Early Stage",
  account_priority: "High",
  account_signal_freshness: "Stale",
  account_icp_fit: true,
  crm_account_url: "https://crm/acme",
  crm_has_open_opp: true,
  crm_latest_opp_stage: "Discovery",
  crm_is_customer: false,
  outreach_any_replied: true,
  outreach_before_signal: null,
  crm_custom_fields: { "hubspot:company:Tier": ["A"] },
  account_contact_count: 1,
  contacts: [
    {
      contact_name: "Jane Doe",
      contact_job_title: "CFO",
      contact_network_url: "https://profiles.example.com/in/jane-doe",
      contact_work_email: "jane@acme.com",
      contact_type: "Engaged Contact",
      contact_role: "champion",
      contact_bucket: "strong",
      signal_freshness: "Recent",
      recommended_channels: "Social Network + Call",
      recommended_network: true,
      recommended_call: true,
      recommended_email: false,
      outreach_contacted: true,
      outreach_replied: false,
      contact_first_signal_date: "2026-10-02",
      contact_latest_signal_date: "2026-10-28",
      signals: [
        {
          signal_id: "s1",
          signal_type: "Comment",
          signal_summary: "Commented on a post by an AE at HubSpot",
          signal_freshness: "Recent",
          signal_date: "2026-10-28",
          signal_collected_date: "2026-10-28",
          competitor_name: "HubSpot",
          competitor_rep_title: "AE"
        }
      ]
    }
  ],
  buying_committee: [{ contact_name: "Sam", contact_type: "Buying Committee", signals: [] }]
};

const ACCOUNTS = {
  data: { accounts: [V2_ACCOUNT] },
  pagination: { total: 40, has_more: true, next_cursor: "c" },
  meta: { api_version: "2", data_as_of: "2026-10-30T00:00:00.000Z", cache: "hit" }
};

test("translates the tools' filter vocabulary into v2's parameters and values", () => {
  const pairs = toCompetitorApiV2FilterParams({
    competitors: ["Common Room, Inc."],
    stages: ["early_stage", "previously_aware_of_competitor"],
    priority: ["high", "low"],
    deal_status: ["Discovery"],
    account_owner: ["Ann"],
    outreach_status: ["reached_out", "__no_outreach__", "existing_customer"],
    existing_account: "net_new",
    stale: false,
    best_fit: "best_fit",
    custom_column_values: { "hubspot:company:Tier": ["A", "B"] },
    location: ["United States"],
    last_activity_within_days: 30
  });
  assert.deepEqual(pairs, [
    ["account_competitors", "Common Room, Inc."],
    ["account_competitor_cycle_stage", "Early Stage"],
    ["account_competitor_cycle_stage", "Historical"],
    ["account_priority", "High"],
    ["account_priority", "Nurture"],
    ["crm_latest_opp_stage", "Discovery"],
    ["crm_latest_opp_owner_name", "Ann"],
    ["crm_is_customer", "true"],
    ["outreach_status", "reached_out"],
    ["outreach_status", "not_reached_out"],
    ["crm_has_account", "false"],
    ["account_signal_freshness", "Recent"],
    ["account_signal_freshness", "Historic"],
    ["account_icp_fit", "true"],
    ["crm_custom_fields[hubspot:company:Tier]", "A"],
    ["crm_custom_fields[hubspot:company:Tier]", "B"],
    ["company_hq_country", "United States"],
    ["latest_signal_within_days", "30"]
  ]);
});

test("no opportunity is crm_has_opp=false", () => {
  assert.deepEqual(toCompetitorApiV2FilterParams({ deal_status: ["__no_opportunity__"] }), [
    ["crm_has_opp", "false"]
  ]);
});

test("builds the accounts query, always asking for contact info", () => {
  const pairs = toCompetitorApiV2AccountsQuery({
    limit: 100,
    offset: 200,
    searchTerm: "acme",
    include: ["contacts", "engagements", "buying_committee", "summary"],
    sortField: "dealCloseDate",
    sortOrder: "ASC",
    maxContactsPerAccount: 5
  });
  assert.deepEqual(pairs, [
    ["search", "acme"],
    ["sort", "crm_latest_opp_close_date"],
    ["order", "asc"],
    ["include", "contacts,buying_committee,contact_info"],
    ["max_contacts_per_account", "5"],
    ["page_size", "100"],
    ["offset", "200"]
  ]);
});

test("maps a v2 account back to the row the tools return", () => {
  const row = fromCompetitorApiV2Account(V2_ACCOUNT);
  assert.equal(row.companyKey, "domain:acme.com");
  assert.deepEqual(row.competitors, ["HubSpot", "G2"]);
  assert.equal(row.priority, "high");
  assert.equal(row.isStale, true);
  assert.equal(row.stage, "early_stage");
  assert.equal(row.stageLabel, "Early Stage");
  assert.equal(row.isBestFit, true);
  assert.equal(row.dealStatus, "Discovery");
  assert.equal(row.latestOpportunityIsClosed, false);
  assert.equal(row.existingAccount, true);
  assert.equal(row.hasReply, true);
  assert.equal(row.attribution.priorRecentOutreach, null);
  assert.deepEqual(row.customColumnValues, { "hubspot:company:Tier": ["A"] });
  const [contact] = row.contacts;
  assert.equal(contact.vanityName, "jane-doe");
  assert.equal(contact.workEmail, "jane@acme.com");
  assert.equal(contact.profileUrl, "https://profiles.example.com/in/jane-doe");
  assert.equal(contact.recommendedAction, "Social Network + Call");
  // Channel flags are read by shape: whatever recommended_<channel> carries.
  assert.deepEqual(contact.recommendedChannels, { network: true, call: true, email: false });
  assert.deepEqual(contact.engagedWith, {
    name: "",
    jobTitle: "AE",
    companyName: "HubSpot",
    type: "engagement",
    engagementType: "comment"
  });
  assert.deepEqual(contact.competitors, ["HubSpot"]);
  assert.equal(contact.lastActivity, "Commented on a post by an AE at HubSpot");
  assert.equal(contact.engagements[0].activityId, "s1");
  assert.equal(row.buyingCommittee[0].hasOwnSignal, false);
  assert.deepEqual(row.buyingCommittee[0].competitors, ["HubSpot", "G2"]);
});

test("the table read calls GET /api/v2/accounts and returns the tools' shape", async () => {
  const http = recordingHttp({ "GET /api/v2/accounts": ACCOUNTS });
  const data = await clientWith(http).getCompetitorMonitoringAccounts({
    limit: 25,
    offset: 0,
    include: ["contacts", "buying_committee"],
    priorityMode: "display"
  });

  assert.equal(http.calls.length, 1);
  assert.equal(queryOf(http.calls[0].url).get("include"), "contacts,buying_committee,contact_info");
  assert.equal(data.totalRecords, 40);
  assert.equal(data.accounts[0].companyKey, "domain:acme.com");
  assert.equal(data.accounts[0].contacts[0].workEmail, "jane@acme.com");
  assert.equal(data.summary, undefined);
});

test("summary reads every analytics metric, the first alone, and merges them", async () => {
  const metricResponses = Object.fromEntries(
    Object.keys(COMPETITOR_API_V2_METRICS).map((metric) => [
      `GET /api/v2/analytics/${metric}`,
      { data: {} }
    ])
  );
  metricResponses["GET /api/v2/analytics/priority-breakdown"] = {
    data: { high_priority_count: 3, nurture_priority_count: 9 }
  };
  metricResponses["GET /api/v2/analytics/deals-and-meetings"] = {
    data: {
      attribution_label_counts: {
        meetings: { direct_reply: 2 },
        label_order: ["direct_reply"]
      }
    }
  };
  const http = recordingHttp({
    "GET /api/v2/accounts": ACCOUNTS,
    "GET /api/v2/fields": {
      data: {
        object: "account",
        keys: [
          { key: "account_competitors", values: ["HubSpot"] },
          { key: "crm_latest_opp_stage", values: ["Discovery"] },
          { key: "crm_latest_opp_owner_name", values: ["Ann"] },
          {
            key: "crm_custom_fields",
            custom_fields: [
              {
                key: "hubspot:company:Tier",
                crm_type: "hubspot",
                object_type: "company",
                name: "Tier",
                label: "Tier",
                values: ["A", "B"]
              }
            ]
          }
        ],
        connected_crms: ["hubspot"]
      }
    },
    ...metricResponses
  });
  const data = await clientWith(http).getCompetitorMonitoringAccounts({
    include: ["summary", "filter_options", "custom_columns"],
    filters: { priority: ["high"] }
  });

  const fieldsCall = http.calls.find((call) => call.url === "/api/v2/fields");
  assert.deepEqual(fieldsCall.config.params, { object: "account" });
  const metricCalls = http.calls.filter((call) => call.url.startsWith("/api/v2/analytics/"));
  assert.equal(metricCalls.length, Object.keys(COMPETITOR_API_V2_METRICS).length);
  metricCalls.forEach((call) => assert.equal(queryOf(call.url).get("account_priority"), "High"));
  assert.deepEqual(data.summary, {
    attributionLabelCounts: { meetings: { direct_reply: 2 }, labelOrder: ["direct_reply"] },
    highConfidenceCount: 3,
    nurtureCount: 9
  });
  assert.deepEqual(data.trackedCompetitorDomains, ["HubSpot"]);
  assert.deepEqual(data.availableDealStatuses, [{ status: "Discovery" }]);
  assert.deepEqual(data.availableDealOwners, ["Ann"]);
  assert.deepEqual(data.customColumnOptions, { "hubspot:company:Tier": ["A", "B"] });
  assert.equal(data.customColumns[0].crmType, "hubspot");
  assert.equal(data.connectedCrmType, "hubspot");
});

test("details by domain resolve through v2 lookup, then read only the asked-for blocks", async () => {
  const http = recordingHttp({
    "GET /api/v2/accounts/lookup": {
      data: { account: { account_id: "domain:acme.com", company_name: "Acme" } }
    },
    "GET /api/v2/accounts/domain%3Aacme.com/buying-committee": {
      data: {
        account_id: "domain:acme.com",
        buying_committee: [{ contact_name: "CFO", contact_type: "Buying Committee" }]
      }
    }
  });
  const details = await clientWith(http).getCompetitorMonitoringAccountDetails({
    companyDomain: "acme.com",
    include: ["buying_committee"]
  });
  assert.deepEqual(
    http.calls.map((call) => call.url),
    ["/api/v2/accounts/lookup", "/api/v2/accounts/domain%3Aacme.com/buying-committee"]
  );
  assert.deepEqual(http.calls[0].config.params, {
    domain: "acme.com",
    fields: "company_name,company_domain,crm_account_url",
    include: ""
  });
  assert.deepEqual(http.calls[1].config.params, { include: "contact_info" });
  assert.equal(details.found, true);
  assert.equal(details.companyKey, "domain:acme.com");
  assert.equal(details.companyName, "Acme");
  assert.equal(details.buyingCommittee[0].name, "CFO");
});

test("details rebuild outreach, opportunities, signals and job postings", async () => {
  const http = recordingHttp({
    "GET /api/v2/accounts/domain%3Aacme.com": {
      data: { account: { ...V2_ACCOUNT, buying_committee: undefined } }
    },
    "GET /api/v2/accounts/domain%3Aacme.com/outreach": {
      data: {
        account_id: "domain:acme.com",
        outreach_started: true,
        outreach_any_replied: true,
        outreach_attribution: "direct_reply",
        outreach_counts: { outbound_emails: 2 },
        outreach_timeline: { signal_date: "2026-10-20" },
        contact_activity: [{ contact_name: "Jane", contact_work_email: "jane@acme.com" }],
        activities: [{ activity_type: "meeting", outreach_attribution: "direct_reply" }],
        activity_total: 3
      }
    },
    "GET /api/v2/accounts/domain%3Aacme.com/opportunities": {
      data: { opportunities: [{ crm_opp_id: "1", crm_opp_amount: 24000 }] }
    },
    "GET /api/v2/accounts/domain%3Aacme.com/buying-committee": {
      data: { buying_committee: [] }
    },
    "GET /api/v2/accounts/domain%3Aacme.com/job-postings": {
      data: {
        job_postings_status: "complete",
        job_postings_count: 1,
        job_postings: [{ job_title: "RevOps", job_url: "https://jobs/1" }]
      }
    }
  });
  const details = await clientWith(http).getCompetitorMonitoringAccountDetails({
    companyKey: "domain:acme.com",
    activityLimit: 20
  });
  assert.equal(details.crmOutreach.replied, true);
  assert.deepEqual(details.crmOutreach.signalCounts, { outboundEmails: 2 });
  assert.equal(details.attributionVerdict, "direct_reply");
  assert.equal(details.outreachTimeline.signalAt, "2026-10-20");
  assert.equal(details.contactActivity[0].email, "jane@acme.com");
  assert.equal(details.activities[0].activityDetails.attribution.label, "direct_reply");
  assert.equal(details.totalActivities, 3);
  assert.equal(details.activityLimit, 20);
  assert.deepEqual(details.signals, [
    {
      signalType: "engagement",
      engagementType: "comment",
      activityOn: "2026-10-28",
      isHistoric: false
    }
  ]);
  assert.deepEqual(details.opportunities[0], {
    dealId: "1",
    name: "",
    stage: "",
    amount: 24000,
    pipeline: "",
    createdOn: null,
    closeOn: null,
    isClosed: null,
    attributionLabel: "",
    attributionReasoning: ""
  });
  assert.equal(details.jobPostingsSummary.postingCount, 1);
  assert.equal(details.jobPostings[0].title, "RevOps");
  const accountCall = http.calls.find((call) => call.url === "/api/v2/accounts/domain%3Aacme.com");
  assert.equal(accountCall.config.params.fields, "company_name,company_domain,crm_account_url,contacts.signals");
});

test("an unknown company is still found:false, not an error", async () => {
  const notFound = Object.assign(new Error("Request failed with status code 404"), {
    isAxiosError: true,
    response: {
      status: 404,
      data: { error: { code: "account_not_found", message: "No account" } }
    }
  });
  const http = recordingHttp({ "GET /api/v2/accounts/lookup": notFound });
  const details = await clientWith(http).getCompetitorMonitoringAccountDetails({
    companyName: "Nobody Inc"
  });
  assert.deepEqual(details, {
    found: false,
    companyKey: "",
    companyName: "Nobody Inc",
    companyDomain: ""
  });
});

test("a v2 rate limit surfaces its message and Retry-After", async () => {
  const limited = Object.assign(new Error("Request failed with status code 429"), {
    isAxiosError: true,
    response: {
      status: 429,
      headers: { "retry-after": "12" },
      data: { error: { code: "rate_limited", message: "Slow down." } }
    }
  });
  const http = recordingHttp({ "GET /api/v2/accounts": limited });
  await assert.rejects(
    clientWith(http).getCompetitorMonitoringAccounts({}),
    /Slow down\. \(Retry-After: 12s\)/
  );
});
