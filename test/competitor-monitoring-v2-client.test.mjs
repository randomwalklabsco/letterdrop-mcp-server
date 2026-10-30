import assert from "node:assert/strict";
import test from "node:test";

import { LetterboxClient } from "../dist/client/letterbox-client.js";
import {
  fromCompetitorApiV2Shape,
  toCompetitorApiV2Filters,
  toCompetitorApiV2SearchBody
} from "../dist/client/competitor-monitoring-v2.js";

// The competitor tools read the published API v2. These pin the
// translation both ways and the HTTP calls the client makes.

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
  const respond = (method, url, bodyOrConfig, config) => {
    calls.push({ method, url, body: bodyOrConfig, config });
    const response = responses[`${method} ${url.split("?")[0]}`];
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve({ data: response });
  };
  return {
    calls,
    post: (url, body, config) => respond("POST", url, body, config),
    get: (url, config) => respond("GET", url, config, config)
  };
}

const SEARCH = {
  data: {
    accounts: [
      {
        account_id: "domain:acme.com",
        company_key: "domain:acme.com",
        company_name: "Acme",
        is_existing_customer: false,
        custom_column_values: { "hubspot:company:Tier": ["A"] },
        contacts: [{ job_title: "CFO", work_email: "cfo@acme.com" }]
      }
    ],
    custom_columns: [{ key: "hubspot:company:Tier" }],
    connected_crm_types: ["hubspot"]
  },
  pagination: { total: 40, has_more: true, next_cursor: "c" },
  meta: {
    api_version: "2",
    data_as_of: "2026-10-30T00:00:00.000Z",
    cache: "hit"
  }
};

test("translates the tools' filter vocabulary into v2's", () => {
  assert.deepEqual(
    toCompetitorApiV2Filters({
      stages: ["previously_aware_of_competitor", "historical", "late_stage"],
      priority: "high",
      account_owner: ["Ann"],
      location: ["United States"],
      last_activity_within_days: 30,
      last_activity_start_date: "2026-01-01",
      deal_status: []
    }),
    {
      stages: ["historical", "late_stage"],
      priority: ["high"],
      deal_owner: ["Ann"],
      location: ["United States"],
      last_activity: { within_days: 30 }
    }
  );
});

test("builds the v2 search body, always asking for contact info", () => {
  assert.deepEqual(
    toCompetitorApiV2SearchBody({
      limit: 50,
      offset: 100,
      searchTerm: "acme",
      include: ["contacts", "summary", "filter_options", "buying_committee"],
      sortField: "dealCloseDate",
      sortOrder: "ASC",
      maxContactsPerAccount: 5,
      filters: { priority: ["high"] }
    }),
    {
      filters: { priority: ["high"] },
      search: "acme",
      sort: { field: "deal_close_date", order: "asc" },
      include: ["contacts", "buying_committee", "contact_info"],
      max_contacts_per_account: 5,
      page_size: 50,
      offset: 100
    }
  );
});

test("camelCases v2 responses but keeps data-keyed maps verbatim", () => {
  assert.deepEqual(
    fromCompetitorApiV2Shape({
      company_name: "Acme",
      custom_column_values: { "hubspot:company:Annual_Revenue": ["1"] },
      attribution_label_counts: {
        meetings: { direct_reply: 1 },
        label_order: ["direct_reply"]
      }
    }),
    {
      companyName: "Acme",
      customColumnValues: { "hubspot:company:Annual_Revenue": ["1"] },
      attributionLabelCounts: {
        meetings: { direct_reply: 1 },
        labelOrder: ["direct_reply"]
      }
    }
  );
});

test("the table read calls v2 search and returns the tools' shape", async () => {
  const http = recordingHttp({
    "POST /api/v2/competitor-monitoring/accounts/search": SEARCH
  });
  const data = await clientWith(http).getCompetitorMonitoringAccounts({
    limit: 25,
    offset: 0,
    include: ["contacts", "custom_columns"],
    priorityMode: "display"
  });

  assert.equal(http.calls.length, 1);
  assert.equal(
    http.calls[0].url,
    "/api/v2/competitor-monitoring/accounts/search"
  );
  assert.equal(data.totalRecords, 40);
  assert.equal(data.accounts[0].companyKey, "domain:acme.com");
  assert.equal(data.accounts[0].contacts[0].workEmail, "cfo@acme.com");
  assert.deepEqual(data.accounts[0].customColumnValues, {
    "hubspot:company:Tier": ["A"]
  });
  assert.equal(data.connectedCrmType, "hubspot");
  assert.equal(data.summary, undefined);
});

test("summary and filter options come from their own v2 endpoints, in parallel", async () => {
  const http = recordingHttp({
    "POST /api/v2/competitor-monitoring/accounts/search": SEARCH,
    "POST /api/v2/competitor-monitoring/summary": {
      data: { total_accounts: 40, summary: { high_confidence_count: 3 } }
    },
    "GET /api/v2/competitor-monitoring/filter-options": {
      data: {
        competitors: ["rival.com"],
        deal_statuses: [{ status: "Open" }],
        deal_owners: ["Ann"],
        custom_column_options: { "hubspot:company:Tier": ["A", "B"] }
      }
    }
  });
  const data = await clientWith(http).getCompetitorMonitoringAccounts({
    include: ["summary_details", "filter_options"],
    filters: { priority: ["high"] }
  });

  assert.deepEqual(
    http.calls.map((call) => `${call.method} ${call.url}`).sort(),
    [
      "GET /api/v2/competitor-monitoring/filter-options",
      "POST /api/v2/competitor-monitoring/accounts/search",
      "POST /api/v2/competitor-monitoring/summary"
    ]
  );
  const summaryCall = http.calls.find((call) => call.url.endsWith("/summary"));
  assert.deepEqual(summaryCall.body, {
    filters: { priority: ["high"] },
    include_details: true
  });
  assert.deepEqual(data.summary, { highConfidenceCount: 3 });
  assert.deepEqual(data.trackedCompetitorDomains, ["rival.com"]);
  assert.deepEqual(data.availableDealOwners, ["Ann"]);
  assert.deepEqual(data.customColumnOptions, {
    "hubspot:company:Tier": ["A", "B"]
  });
});

test("details by domain resolve through v2 lookup, then read the account", async () => {
  const http = recordingHttp({
    "GET /api/v2/competitor-monitoring/accounts/lookup": {
      data: { account: { account_id: "domain:acme.com" } }
    },
    "GET /api/v2/competitor-monitoring/accounts/domain%3Aacme.com/details": {
      data: {
        account: {
          account_id: "domain:acme.com",
          company_key: "domain:acme.com",
          buying_committee: [{ name: "CFO" }]
        }
      }
    }
  });
  const details = await clientWith(http).getCompetitorMonitoringAccountDetails({
    companyDomain: "acme.com",
    include: ["buying_committee"]
  });
  assert.deepEqual(http.calls[0].config.params, {
    domain: "acme.com",
    include: ""
  });
  assert.deepEqual(http.calls[1].config.params, {
    include: "buying_committee,contact_info"
  });
  assert.equal(details.found, true);
  assert.equal(details.companyKey, "domain:acme.com");
  assert.deepEqual(details.buyingCommittee, [{ name: "CFO" }]);
});

test("an unknown company is still found:false, not an error", async () => {
  const notFound = Object.assign(
    new Error("Request failed with status code 404"),
    {
      isAxiosError: true,
      response: {
        status: 404,
        data: { error: { code: "account_not_found", message: "No account" } }
      }
    }
  );
  const http = recordingHttp({
    "GET /api/v2/competitor-monitoring/accounts/lookup": notFound
  });
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
  const limited = Object.assign(
    new Error("Request failed with status code 429"),
    {
      isAxiosError: true,
      response: {
        status: 429,
        headers: { "retry-after": "12" },
        data: { error: { code: "rate_limited", message: "Slow down." } }
      }
    }
  );
  const http = recordingHttp({
    "POST /api/v2/competitor-monitoring/accounts/search": limited
  });
  await assert.rejects(
    clientWith(http).getCompetitorMonitoringAccounts({}),
    /Slow down\. \(Retry-After: 12s\)/
  );
});
