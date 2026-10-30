/**
 * The competitor monitoring tools read Letterdrop's published
 * Competitor Monitoring API v2 (/api/v2/competitor-monitoring/*), the same API
 * customers' agents call directly.
 *
 * v2 is cached, rate-limited per workspace and strictly validated; v1 was not.
 * The tools' own contract (their snake_case arguments and the camelCase JSON
 * they return) is unchanged, so this module is the translation between the two:
 *
 *   tool args (v1 filter vocabulary)  ->  v2 request body
 *   v2 response (snake_case)          ->  the v1-shaped camelCase payload
 *
 * Pure functions only; LetterboxClient does the HTTP.
 */

import type {
  CompetitorMonitoringAccountDetailsResponse,
  CompetitorMonitoringAccountsResponse
} from "../types/index.js";

// Row blocks v2 search understands. summary / summary_details / filter_options
// are separate v2 endpoints, fetched alongside when the tool asks for them.
const V2_ROW_INCLUDES = new Set([
  "contacts",
  "engagements",
  "profile_details",
  "custom_columns",
  "buying_committee",
  "job_postings"
]);

const V2_SORT_FIELDS: Record<string, string> = {
  lastEngaged: "last_engaged",
  priority: "priority",
  dealDateCreated: "deal_date_created",
  dealCloseDate: "deal_close_date"
};

// The retired stage spelling the tools still accept.
const STAGE_ALIASES: Record<string, string> = {
  previously_aware_of_competitor: "historical"
};

// Maps keyed by data rather than field names: their keys stay verbatim.
const VERBATIM_MAP_FIELDS = new Set([
  "custom_column_values",
  "custom_column_options",
  "crm_companies"
]);
const VERBATIM_CHILD_MAPS: Record<string, Set<string>> = {
  attribution_label_counts: new Set(["meetings", "accounts"])
};

export function toCamelCaseKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, letter: string) =>
    letter.toUpperCase()
  );
}

/** v2 snake_case payload -> the camelCase shape the tools have always returned. */
export function fromCompetitorApiV2Shape<T = unknown>(
  value: unknown,
  verbatimChildren: Set<string> | null = null
): T {
  if (Array.isArray(value)) {
    return value.map((item) => fromCompetitorApiV2Shape(item)) as T;
  }
  if (!value || typeof value !== "object") return value as T;
  const shaped: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    shaped[toCamelCaseKey(key)] =
      VERBATIM_MAP_FIELDS.has(key) || verbatimChildren?.has(key)
        ? child
        : fromCompetitorApiV2Shape(child, VERBATIM_CHILD_MAPS[key] || null);
  }
  return shaped as T;
}

const nonEmpty = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.length > 0;

/**
 * The tools' `filters` object (snake_case keys from
 * buildCompetitorMonitoringFilters) -> the v2 filter object. Only renames and
 * restructures; v2 validates.
 */
export function toCompetitorApiV2Filters(
  filters: Record<string, unknown> = {}
): Record<string, unknown> {
  const v2: Record<string, unknown> = {};
  const copy = (from: string, to = from) => {
    const value = filters[from];
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value) && !value.length) return;
    v2[to] = value;
  };

  copy("competitors");
  if (nonEmpty(filters.stages)) {
    v2.stages = [
      ...new Set(
        (filters.stages as string[]).map(
          (stage) => STAGE_ALIASES[stage] || stage
        )
      )
    ];
  }
  if (filters.priority !== undefined) {
    const priority = Array.isArray(filters.priority)
      ? filters.priority
      : [filters.priority];
    if (priority.length) v2.priority = priority;
  }
  copy("deal_status");
  // v1's `account_owner` has always matched the DEAL owner's name
  // (normalizeCompetitorMonitoringApiFilters reads it into dealOwner); v2 names
  // it for what it is.
  copy("account_owner", "deal_owner");
  copy("account_owner_email");
  copy("deal_owner_email");
  copy("outreach_status");
  copy("attribution");
  copy("existing_account");
  copy("customer_status");
  copy("stale");
  copy("best_fit");
  if (
    filters.custom_column_values &&
    typeof filters.custom_column_values === "object" &&
    Object.keys(filters.custom_column_values).length
  ) {
    v2.custom_column_values = filters.custom_column_values;
  }
  copy("activity_types");
  copy("company_size");
  copy("location");
  copy("preset");

  // A rolling window wins over explicit bounds, as on the read path.
  const withinDays = Number(filters.last_activity_within_days);
  if (Number.isFinite(withinDays) && withinDays >= 1) {
    v2.last_activity = { within_days: Math.floor(withinDays) };
  } else if (
    filters.last_activity_start_date ||
    filters.last_activity_end_date
  ) {
    v2.last_activity = {
      ...(filters.last_activity_start_date
        ? { start_date: filters.last_activity_start_date }
        : {}),
      ...(filters.last_activity_end_date
        ? { end_date: filters.last_activity_end_date }
        : {})
    };
  }
  return v2;
}

export interface CompetitorAccountsRequest {
  limit?: number;
  offset?: number;
  searchTerm?: string;
  filters?: Record<string, unknown>;
  include?: string[];
  sortField?: string;
  sortOrder?: string;
  maxContactsPerAccount?: number;
}

export function toCompetitorApiV2SearchBody(
  params: CompetitorAccountsRequest
): Record<string, unknown> {
  const filters = toCompetitorApiV2Filters(params.filters);
  const rowIncludes = (params.include || []).filter((token) =>
    V2_ROW_INCLUDES.has(token)
  );
  const sortField = params.sortField
    ? V2_SORT_FIELDS[params.sortField]
    : undefined;
  return {
    ...(Object.keys(filters).length ? { filters } : {}),
    ...(params.searchTerm ? { search: params.searchTerm } : {}),
    ...(sortField
      ? {
          sort: {
            field: sortField,
            order:
              String(params.sortOrder || "DESC").toUpperCase() === "ASC"
                ? "asc"
                : "desc"
          }
        }
      : {}),
    // The tools have always returned each person's enriched email / phone;
    // v2 makes that opt-in, so ask for it.
    include: [...rowIncludes, "contact_info"],
    ...(params.maxContactsPerAccount !== undefined
      ? { max_contacts_per_account: params.maxContactsPerAccount }
      : {}),
    ...(params.limit !== undefined ? { page_size: params.limit } : {}),
    ...(params.offset ? { offset: params.offset } : {})
  };
}

interface V2Envelope {
  data?: Record<string, unknown>;
  pagination?: { total?: number; has_more?: boolean; next_cursor?: string };
  meta?: Record<string, unknown>;
}

/**
 * Reassemble the v1-shaped accounts payload from v2's search response plus
 * the optional summary / filter-options responses.
 */
export function toCompetitorAccountsResponse({
  search,
  summary,
  filterOptions,
  limit,
  offset
}: {
  search: V2Envelope;
  summary?: V2Envelope | null;
  filterOptions?: V2Envelope | null;
  limit: number;
  offset: number;
}): CompetitorMonitoringAccountsResponse {
  const data = fromCompetitorApiV2Shape<Record<string, unknown>>(
    search.data || {}
  );
  const connectedCrmTypes = Array.isArray(data.connectedCrmTypes)
    ? (data.connectedCrmTypes as string[])
    : undefined;
  const options = filterOptions
    ? fromCompetitorApiV2Shape<Record<string, unknown>>(
        filterOptions.data || {}
      )
    : null;
  const summaryData = summary
    ? fromCompetitorApiV2Shape<Record<string, unknown>>(summary.data || {})
    : null;

  return {
    totalRecords: search.pagination?.total ?? 0,
    limit,
    offset,
    accounts: (data.accounts ||
      []) as CompetitorMonitoringAccountsResponse["accounts"],
    ...(data.customColumns !== undefined
      ? {
          customColumns:
            data.customColumns as CompetitorMonitoringAccountsResponse["customColumns"],
          customColumnsUpdatedAt: (data.customColumnsUpdatedAt ?? null) as
            | string
            | null,
          connectedCrmType: connectedCrmTypes?.[0] || "",
          connectedCrmTypes: connectedCrmTypes || []
        }
      : {}),
    ...(summaryData
      ? { summary: (summaryData.summary || {}) as Record<string, unknown> }
      : {}),
    ...(options
      ? {
          availableDealStatuses: (options.dealStatuses ||
            []) as CompetitorMonitoringAccountsResponse["availableDealStatuses"],
          availableDealOwners: (options.dealOwners || []) as string[],
          trackedCompetitorDomains: (options.competitors || []) as string[],
          customColumnOptions: options.customColumnOptions || {}
        }
      : {}),
    ...(search.meta?.data_as_of
      ? { dataAsOf: search.meta.data_as_of as string }
      : {})
  } as CompetitorMonitoringAccountsResponse;
}

export function toCompetitorAccountDetailsResponse(
  details: V2Envelope
): CompetitorMonitoringAccountDetailsResponse {
  const data = fromCompetitorApiV2Shape<Record<string, unknown>>(
    details.data || {}
  );
  return {
    found: true,
    ...((data.account || {}) as Record<string, unknown>)
  } as CompetitorMonitoringAccountDetailsResponse;
}

export function toCompetitorApiV2DetailsQuery(params: {
  include?: string[];
  activityLimit?: number;
}): Record<string, string | number> {
  // Committee contacts have always carried enriched email / phone here.
  const include = params.include
    ? [...params.include, "contact_info"]
    : [
        "outreach",
        "activity",
        "signals",
        "opportunities",
        "buying_committee",
        "job_postings",
        "contact_info"
      ];
  return {
    include: include.join(","),
    ...(params.activityLimit !== undefined
      ? { activity_limit: params.activityLimit }
      : {})
  };
}
