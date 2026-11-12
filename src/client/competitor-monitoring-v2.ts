/**
 * The competitor monitoring tools read Letterdrop's published
 * Competitor Monitoring API v2 (/api/v2/accounts, /contacts, /analytics/…),
 * the same API customers' agents call directly.
 *
 * v2 speaks the vocabulary of the New Competitor Deal webhook (account_*,
 * contact_*, signal_*, crm_* … with Title-Case values). The tools' own
 * contract (their snake_case arguments and the camelCase JSON they return) is
 * unchanged, so this module is the translation between the two:
 *
 *   tool args (v1 filter vocabulary)  ->  v2 query parameters
 *   v2 response                       ->  the camelCase payload the tools return
 *
 * Pure functions only; LetterboxClient does the HTTP.
 */

import type {
  CompetitorMonitoringAccountDetailsResponse,
  CompetitorMonitoringAccountsResponse
} from "../types/index.js";

type Row = Record<string, unknown>;
export type QueryPairs = Array<[string, string]>;

// ── Requests ─────────────────────────────────────────────────────────────────

// Stage codes the tools take -> v2's labels. The legacy buckets read as the
// stages they were split into; the retired spelling as its rename.
const STAGE_LABELS: Record<string, string> = {
  aware_of_competitor: "Aware of Competitor",
  historical: "Historical",
  previously_aware_of_competitor: "Historical",
  prospecting: "Prospecting",
  early_stage: "Early Stage",
  possible_active_sales_cycle: "Early Stage",
  late_stage: "Late Stage",
  active_sales_cycle: "Late Stage",
  current_customer: "Competitor Customer"
};
const STAGE_CODES: Record<string, string> = {
  "Aware of Competitor": "aware_of_competitor",
  Historical: "historical",
  Prospecting: "prospecting",
  "Early Stage": "early_stage",
  "Late Stage": "late_stage",
  "Competitor Customer": "current_customer"
};

// The dashboard has no Low; a stored low is shown as Nurture.
const PRIORITY_LABELS: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Nurture",
  nurture: "Nurture"
};

const SORT_FIELDS: Record<string, string> = {
  lastEngaged: "latest_signal_date",
  priority: "account_priority",
  dealDateCreated: "crm_latest_opp_created_date",
  dealCloseDate: "crm_latest_opp_close_date"
};

const NO_OPPORTUNITY = "__no_opportunity__";
const NO_OUTREACH = "__no_outreach__";

const asList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
    .map((item) => String(item))
    .filter(Boolean);

const unique = (values: string[]) => [...new Set(values)];

/**
 * The tools' `filters` object (snake_case keys from
 * buildCompetitorMonitoringFilters) -> v2 query parameters, a list filter as
 * one pair per value.
 */
export function toCompetitorApiV2FilterParams(
  filters: Record<string, unknown> = {}
): QueryPairs {
  const pairs: QueryPairs = [];
  const add = (name: string, values: string[]) =>
    values.forEach((value) => pairs.push([name, value]));

  add("account_competitors", asList(filters.competitors));
  add(
    "account_competitor_cycle_stage",
    unique(asList(filters.stages).map((stage) => STAGE_LABELS[stage] || stage))
  );
  add(
    "account_priority",
    unique(asList(filters.priority).map((priority) => PRIORITY_LABELS[priority] || priority))
  );

  // v1 matched "no opportunity" alongside stages; v2 says it with crm_has_opp
  // and cannot OR it with stages, so a mixed list keeps the stages.
  const dealStatuses = asList(filters.deal_status);
  const stages = dealStatuses.filter((status) => status !== NO_OPPORTUNITY);
  if (stages.length) add("crm_latest_opp_stage", stages);
  else if (dealStatuses.includes(NO_OPPORTUNITY)) add("crm_has_opp", ["false"]);

  // v1's `account_owner` has always matched the DEAL owner's name.
  add("crm_account_owner_name", asList(filters.account_owner));
  add("crm_latest_opp_owner_email", asList(filters.deal_owner_email));
  add("crm_account_owner_email", asList(filters.account_owner_email));

  // existing_customer / not_existing_customer were outreach options in v1;
  // v2 asks crm_is_customer.
  const outreach = asList(filters.outreach_status);
  const customer =
    filters.customer_status ||
    (outreach.includes("existing_customer")
      ? "existing_customer"
      : outreach.includes("not_existing_customer")
        ? "not_existing_customer"
        : "");
  if (customer) add("crm_is_customer", [String(customer === "existing_customer")]);
  add(
    "outreach_status",
    outreach
      .filter((status) => status !== "existing_customer" && status !== "not_existing_customer")
      .map((status) => (status === NO_OUTREACH ? "not_reached_out" : status))
  );
  add("outreach_attribution", asList(filters.attribution));
  if (filters.existing_account) {
    add("crm_has_account", [String(filters.existing_account === "existing")]);
  }
  if (typeof filters.stale === "boolean") {
    add("account_signal_freshness", filters.stale ? ["Stale"] : ["Recent", "Historic"]);
  }
  if (filters.best_fit) {
    add("account_icp_fit", [String(filters.best_fit === "best_fit")]);
  }
  if (filters.custom_column_values && typeof filters.custom_column_values === "object") {
    Object.entries(filters.custom_column_values as Record<string, unknown>).forEach(
      ([key, values]) => add(`crm_custom_fields[${key}]`, asList(values))
    );
  }
  add("company_size", asList(filters.company_size));
  add("company_hq_country", asList(filters.location));
  if (filters.preset) add("preset", [String(filters.preset)]);

  // A rolling window wins over explicit bounds, as on the read path.
  const withinDays = Number(filters.last_activity_within_days);
  if (Number.isFinite(withinDays) && withinDays >= 1) {
    add("latest_signal_within_days", [String(Math.floor(withinDays))]);
  } else {
    if (filters.last_activity_start_date) {
      add("latest_signal_after", [String(filters.last_activity_start_date)]);
    }
    if (filters.last_activity_end_date) {
      add("latest_signal_before", [String(filters.last_activity_end_date)]);
    }
  }
  return pairs;
}

// ── Analytics period ─────────────────────────────────────────────────────────

// The table's own window when nothing names a period: its rows cover the last
// 180 days of signals.
export const DEFAULT_SUMMARY_PERIOD_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

const calendarDateOf = (value: unknown) => text(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "";
const daysBefore = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) - days * DAY_MS).toISOString().slice(0, 10);

/**
 * The period the analytics metrics report on. The API takes explicit dates and
 * never a rolling window, so the tool always sends two: the summary dates the
 * caller gave; else the last-activity filter's range (a day count ends today);
 * else the table's default window, the last 180 days. Both dates are
 * inclusive, so an N-day window starts N - 1 days before its end.
 */
export function toCompetitorAnalyticsPeriod(
  params: {
    summaryStartDate?: string;
    summaryEndDate?: string;
    filters?: Record<string, unknown>;
  },
  today: string = new Date().toISOString().slice(0, 10)
): { start_date: string; end_date: string } {
  const filters = params.filters || {};
  const withinDays = Number(filters.last_activity_within_days);
  const rolling = Number.isFinite(withinDays) && withinDays >= 1;
  const endDate =
    calendarDateOf(params.summaryEndDate) ||
    (rolling ? "" : calendarDateOf(filters.last_activity_end_date)) ||
    today;
  const startDate =
    calendarDateOf(params.summaryStartDate) ||
    (rolling
      ? daysBefore(today, Math.floor(withinDays) - 1)
      : calendarDateOf(filters.last_activity_start_date)) ||
    daysBefore(endDate, DEFAULT_SUMMARY_PERIOD_DAYS - 1);
  return { start_date: startDate, end_date: endDate };
}

/**
 * The /api/v2/analytics query: the table's filters, minus the rolling window
 * the period replaces, plus the period.
 */
export function toCompetitorAnalyticsQuery(
  params: {
    searchTerm?: string;
    summaryStartDate?: string;
    summaryEndDate?: string;
    filters?: Record<string, unknown>;
  },
  today?: string
): QueryPairs {
  const period = toCompetitorAnalyticsPeriod(params, today);
  return [
    ["start_date", period.start_date],
    ["end_date", period.end_date],
    ...toCompetitorApiV2FilterParams(params.filters).filter(
      ([name]) => name !== "latest_signal_within_days"
    ),
    ...(params.searchTerm ? ([["search", params.searchTerm]] as QueryPairs) : [])
  ];
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

const ACCOUNT_INCLUDES = new Set(["contacts", "buying_committee", "job_postings"]);

/** The tools' table request -> the GET /api/v2/accounts query. */
export function toCompetitorApiV2AccountsQuery(params: CompetitorAccountsRequest): QueryPairs {
  const pairs = toCompetitorApiV2FilterParams(params.filters);
  if (params.searchTerm) pairs.push(["search", params.searchTerm]);
  const sort = params.sortField ? SORT_FIELDS[params.sortField] : undefined;
  if (sort) {
    pairs.push(["sort", sort]);
    pairs.push([
      "order",
      String(params.sortOrder || "DESC").toUpperCase() === "ASC" ? "asc" : "desc"
    ]);
  }
  // The tools have always returned each person's enriched email / phone; v2
  // makes that opt-in, so ask for it.
  const include = (params.include || []).filter((token) => ACCOUNT_INCLUDES.has(token));
  pairs.push(["include", [...include, "contact_info"].join(",")]);
  if (params.maxContactsPerAccount !== undefined) {
    pairs.push(["max_contacts_per_account", String(params.maxContactsPerAccount)]);
  }
  if (params.limit !== undefined) pairs.push(["page_size", String(params.limit)]);
  if (params.offset) pairs.push(["offset", String(params.offset)]);
  return pairs;
}

export function toQueryString(pairs: QueryPairs): string {
  const search = new URLSearchParams();
  pairs.forEach(([name, value]) => search.append(name, value));
  return search.toString();
}

// The dashboard cards, one v2 endpoint each, and the published name -> the
// summary key the tools have always returned.
export const COMPETITOR_API_V2_METRICS: Record<string, Record<string, string>> = {
  "deals-and-meetings": {
    deals_after_signal_count: "dealsAfterSignalCount",
    deals_after_signal_pipeline: "dealsAfterSignalPipeline",
    deals_after_signal_account_count: "dealsAfterSignalAccountCount",
    deals_created_count: "dealsCreatedCount",
    deals_created_pipeline: "dealsCreatedPipeline",
    meetings_after_signal_count: "meetingsAfterSignalCount",
    meetings_created_count: "meetingsCreatedCount",
    attribution_label_counts: "attributionLabelCounts"
  },
  // A dotted name nests: the coverage fields rebuild one object.
  "pipeline-coverage": {
    total_open_opportunities: "competitorOpportunityCoverage.totalOpenOpportunities",
    total_accounts_with_open_opportunities:
      "competitorOpportunityCoverage.totalAccountsWithOpenOpportunities",
    opportunity_count: "competitorOpportunityCoverage.opportunityCount",
    opportunity_percent: "competitorOpportunityCoverage.opportunityPercent",
    account_count: "competitorOpportunityCoverage.accountCount",
    account_percent: "competitorOpportunityCoverage.accountPercent"
  },
  "priority-breakdown": {
    total_companies: "totalCompanies",
    total_in_market_companies: "totalInMarketCompanies",
    potentially_in_market_companies: "potentiallyInMarketCompanies",
    high_priority_count: "highConfidenceCount",
    medium_priority_count: "mediumConfidenceCount",
    nurture_priority_count: "nurtureCount"
  },
  "estimated-opportunities": {
    expected_interceptable_high: "expectedInterceptableHigh",
    expected_interceptable_all: "expectedInterceptableAll",
    total_opps_high: "totalOppsHigh",
    total_opps_all: "totalOppsAll",
    booked_opps_high: "bookedOppsHigh",
    booked_opps_all: "bookedOppsAll",
    interceptable_accounts_high: "interceptableAccountsHigh",
    interceptable_accounts_all: "interceptableAccountsAll"
  },
  "deal-overlap": {
    deal_overlap_count: "dealOverlapCount",
    net_new_accounts_count: "netNewAccountsCount"
  },
  "confirmed-evaluations": {
    confirmed_evaluations_count: "confirmedEvaluationsCount"
  },
  outreach: {
    outreached_count: "outreachedCount",
    replied_count: "repliedCount",
    outreached_after_signal_count: "outreachedAfterSignalCount",
    replied_after_signal_count: "repliedAfterSignalCount"
  },
  "win-rate": {
    win_rate_with_signal: "winRateWithSignal",
    win_rate_without_signal: "winRateWithoutSignal",
    closed_won_with_signal_count: "closedWonWithSignalCount",
    closed_lost_with_signal_count: "closedLostWithSignalCount",
    closed_won_without_signal_count: "closedWonWithoutSignalCount",
    closed_lost_without_signal_count: "closedLostWithoutSignalCount",
    closed_won_with_signal_amount: "closedWonWithSignalAmount"
  }
};

// ── Responses ────────────────────────────────────────────────────────────────

export function toCamelCaseKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

/** snake_case -> camelCase, deeply; data-keyed maps keep their keys. */
export function toCamelCaseDeep(value: unknown, keepKeys = false): unknown {
  if (Array.isArray(value)) return value.map((item) => toCamelCaseDeep(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Row).map(([key, child]) => [
      keepKeys ? key : toCamelCaseKey(key),
      toCamelCaseDeep(child, key === "meetings" || key === "accounts")
    ])
  );
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const dateOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);
// The profile handle: the /in/ path segment, "" for any other URL shape.
const vanityFromUrl = (url: unknown) => text(url).match(/\/in\/([^/?#]+)/)?.[1] || "";

// A contact's profile URL and its per-channel recommendation flags carry the
// channel in their field names. They are read by shape, so this repo names
// no channel: the contact_<network>_url field, and every boolean
// recommended_<channel> flag (normalizeRecommendedChannels folds the
// non-email, non-call ones into socialNetwork). v2 only adds fields, so the
// shapes skip the Contact fields known not to be a profile or a channel, and
// keys are read in sorted order so a new match cannot reorder the old ones.
const NON_PROFILE_URL_KEY_PATTERN = /^contact_(work|phone)_/;
const NON_CHANNEL_RECOMMENDED_KEYS = new Set(["recommended_channels"]);

/** The Contact keys read as its profile URL, sorted. */
export function profileUrlKeysOf(contact: Row): string[] {
  return Object.keys(contact)
    .filter((key) => /^contact_[a-z]+_url$/.test(key) && !NON_PROFILE_URL_KEY_PATTERN.test(key))
    .sort();
}

/** The Contact keys read as recommended-channel flags, sorted. */
export function recommendedChannelKeysOf(contact: Row): string[] {
  return Object.keys(contact)
    .filter(
      (key) =>
        key.startsWith("recommended_") &&
        !NON_CHANNEL_RECOMMENDED_KEYS.has(key) &&
        typeof contact[key] === "boolean"
    )
    .sort();
}

// A profile URL is the one with a handle; else the first non-empty one.
const profileUrlOf = (contact: Row) => {
  const urls = profileUrlKeysOf(contact).map((key) => text(contact[key]));
  return urls.find((url) => vanityFromUrl(url)) || urls.find(Boolean) || "";
};

const recommendedChannelsOf = (contact: Row) =>
  Object.fromEntries(
    recommendedChannelKeysOf(contact).map((key) => [
      key.slice("recommended_".length),
      contact[key]
    ])
  );

// Historic is read from the row, never from signal_freshness alone: letterbox
// reports Stale ahead of Historic, and a signal or contact inherits its
// account's Stale, so a historic connection on a stale account would read as
// dated and its scan stamp as a real connection date. A historic signal is
// the one row with a collected date but no signal_date.
export function isHistoricV2Signal(signal: Row): boolean {
  return (
    signal.signal_freshness === "Historic" ||
    (!text(signal.signal_date) && Boolean(text(signal.signal_recorded_date)))
  );
}

const BUYING_COMMITTEE_CONTACT_TYPE = "Buying Committee";
const SIGNAL_CONTACT_TYPE = "Signal Contact";
const ENGAGED_CONTACT_TYPE = "Engaged Contact";

// An engaged contact whose every signal is historic, and whose latest signal
// date letterbox therefore blanked.
export function isHistoricV2Contact(contact: Row): boolean {
  if (contact.contact_type === BUYING_COMMITTEE_CONTACT_TYPE) return false;
  if (contact.signal_freshness === "Historic") return true;
  const signals = Array.isArray(contact.signals) ? (contact.signals as Row[]) : [];
  return !text(contact.contact_latest_signal_date) && signals.every(isHistoricV2Signal);
}

// The account flag: Historic freshness, or (a stale account, whose freshness
// hides it) engaged contacts that are all historic.
function hasOnlyHistoricV2Contacts(account: Row): boolean {
  if (account.account_signal_freshness === "Historic") return true;
  const engagedContacts = Array.isArray(account.contacts)
    ? (account.contacts as Row[]).filter(
        (contact) => contact.contact_type !== BUYING_COMMITTEE_CONTACT_TYPE
      )
    : [];
  return engagedContacts.length > 0 && engagedContacts.every(isHistoricV2Contact);
}

// signal_type -> the engagedWith type / engagementType v1 reported.
function toEngagementKind(signalType: string): { type: string; engagementType: string } {
  switch (signalType) {
    case "Like":
      return { type: "engagement", engagementType: "reaction" };
    case "Comment":
      return { type: "engagement", engagementType: "comment" };
    case "Follow":
      return { type: "follower", engagementType: "" };
    default:
      return { type: "connection", engagementType: "" };
  }
}

function fromSignal(signal: Row): Row {
  const kind = toEngagementKind(text(signal.signal_type));
  return {
    activityId: text(signal.signal_id),
    jobTitle: text(signal.competitor_rep_title),
    companyName: text(signal.competitor_name),
    ...kind,
    postUrl: text(signal.signal_content_source_url),
    activityOn: dateOrNull(signal.signal_date) || dateOrNull(signal.signal_recorded_date),
    isHistoric: isHistoricV2Signal(signal),
    summary: text(signal.signal_summary)
  };
}

function fromContact(contact: Row, account: Row): Row {
  const signals = Array.isArray(contact.signals) ? (contact.signals as Row[]) : [];
  const latest = signals[0];
  const isEngaged = contact.contact_type !== BUYING_COMMITTEE_CONTACT_TYPE;
  const profileUrl = profileUrlOf(contact);
  return {
    vanityName: vanityFromUrl(profileUrl),
    name: text(contact.contact_name),
    profileUrl,
    jobTitle: text(contact.contact_job_title),
    contactRole: contact.contact_role ?? null,
    contactBucket: contact.contact_bucket ?? null,
    companyName: text(account.company_name),
    companyDomain: text(account.company_domain),
    workEmail: text(contact.contact_work_email),
    personalEmails: [],
    phone: text(contact.contact_phone_number),
    recommendedAction: text(contact.recommended_channels),
    recommendedChannels: recommendedChannelsOf(contact),
    // The API's "Signal Contact" is this tool's "Engaged Contact".
    contactType:
      contact.contact_type === SIGNAL_CONTACT_TYPE ? ENGAGED_CONTACT_TYPE : text(contact.contact_type),
    hasOwnSignal: isEngaged,
    engagedWith: latest
      ? {
          name: "",
          jobTitle: text(latest.competitor_rep_title),
          companyName: text(latest.competitor_name),
          ...toEngagementKind(text(latest.signal_type))
        }
      : { name: "", jobTitle: "", companyName: "" },
    competitors: isEngaged
      ? unique(signals.map((signal) => text(signal.competitor_name)).filter(Boolean))
      : splitCompetitors(account.account_competitors),
    firstEngaged: dateOrNull(contact.contact_first_signal_date),
    lastEngaged: dateOrNull(contact.contact_latest_signal_date),
    lastActivity: latest ? text(latest.signal_summary) : "",
    isHistoricInitialConnection: isHistoricV2Contact(contact),
    buyingCommitteeRole: text(contact.contact_buying_committee_role),
    contacted: contact.outreach_contacted === true,
    replied: contact.outreach_replied === true,
    contactedByOwner: {
      name: text(contact.outreach_contacted_by_name),
      email: text(contact.outreach_contacted_by_email)
    },
    engagements: signals.map(fromSignal)
  };
}

// account_competitors is comma-joined, as the webhook sends it.
function splitCompetitors(value: unknown): string[] {
  return text(value)
    .split(", ")
    .map((name) => name.trim())
    .filter(Boolean);
}

function fromJobPostingsRollup(rollup: Row): Row {
  return {
    status: text(rollup.job_postings_status),
    postingCount: rollup.job_postings_count ?? 0,
    latestPostedAt: dateOrNull(rollup.job_postings_latest_date),
    competitorsMentioned: rollup.competitors_mentioned || [],
    systemsInUse: rollup.systems_in_use || [],
    relevantInitiatives: rollup.initiatives || []
  };
}

/** One v2 Account -> the account row the tools have always returned. */
export function fromCompetitorApiV2Account(account: Row): Row {
  const freshness = text(account.account_signal_freshness);
  const stageLabel = text(account.account_competitor_cycle_stage);
  const hasOpenOpp = account.crm_has_open_opp;
  return {
    companyKey: text(account.account_id),
    companyName: text(account.company_name),
    companyDomain: text(account.company_domain),
    companyLogo: text(account.company_logo_url),
    companyDescription: text(account.company_description),
    companySize: text(account.company_size),
    companyIndustry: text(account.company_industry),
    companyLocation: text(account.company_hq_location),
    companyLocationCountry: text(account.company_hq_country),
    crmCompanies: account.crm_account_url
      ? [{ primary: true, url: text(account.crm_account_url) }]
      : [],
    competitors: splitCompetitors(account.account_competitors),
    priority: text(account.account_priority).toLowerCase(),
    isStale: freshness === "Stale",
    isBestFit: account.account_icp_fit === true,
    bestFitReasoning: text(account.account_icp_fit_reason),
    confirmedCompetitor: text(account.account_confirmed_competitor) || null,
    confirmedProject: text(account.account_confirmed_project) || null,
    stage: STAGE_CODES[stageLabel] || "",
    stageLabel,
    reasoning: text(account.account_competitor_cycle_reason),
    estimatedRenewalDate: dateOrNull(account.account_estimated_renewal_date),
    optimalOutreachDate: dateOrNull(account.account_optimal_outreach_date),
    evaluatingVendorsConfirmation:
      account.account_evaluating_vendors_confirmed === true ? { confirmed: true } : null,
    firstEngaged: dateOrNull(account.first_signal_date),
    lastEngaged: dateOrNull(account.latest_signal_date),
    signalDateApproximate: account.first_signal_date_approximate === true,
    lastActivity: text(account.latest_signal_summary),
    hasOnlyHistoricInitialConnections: hasOnlyHistoricV2Contacts(account),
    dealStatus: text(account.crm_latest_opp_stage),
    dealStage: text(account.crm_latest_opp_stage),
    dealPipeline: text(account.crm_latest_opp_pipeline),
    dealDateCreated: dateOrNull(account.crm_latest_opp_created_date),
    dealCloseDate: dateOrNull(account.crm_latest_opp_close_date),
    dealAmount: account.crm_latest_opp_amount ?? null,
    dealOwner: text(account.crm_latest_opp_owner_name),
    dealOwnerEmail: text(account.crm_latest_opp_owner_email),
    latestOpportunityId: text(account.crm_latest_opp_id),
    latestOpportunityIsClosed: hasOpenOpp === true ? false : hasOpenOpp === null ? true : null,
    dealIsRenewal: account.crm_latest_opp_is_renewal === true,
    opportunityCount: account.crm_opp_count ?? 0,
    accountOwner: text(account.crm_account_owner_name),
    accountOwnerEmail: text(account.crm_account_owner_email),
    existingAccount: Boolean(account.crm_account_url),
    isExistingCustomer: account.crm_is_customer === true,
    attribution: {
      verdict: text(account.outreach_attribution),
      reasoning: text(account.outreach_attribution_reason),
      priorRecentOutreach: account.outreach_before_signal ?? null,
      leadSource: text(account.outreach_lead_source)
    },
    outreachStatus: text(account.outreach_status),
    outreachStarted: account.outreach_started === true,
    hasReply: account.outreach_any_replied === true,
    crmSummary: text(account.outreach_summary),
    lastOutreachAt: dateOrNull(account.outreach_last_date),
    lastOutreachBeforeSignalAt: dateOrNull(account.outreach_last_before_signal_date),
    firstOutreachAfterSignalAt: dateOrNull(account.outreach_first_after_signal_date),
    meetingBookedAt: dateOrNull(account.outreach_meeting_booked_date),
    customColumnValues: account.crm_custom_fields || {},
    ...(Array.isArray(account.contacts)
      ? {
          contactCount: account.account_contact_count ?? (account.contacts as Row[]).length,
          contacts: (account.contacts as Row[]).map((contact) => fromContact(contact, account))
        }
      : {}),
    ...(Array.isArray(account.buying_committee)
      ? {
          buyingCommittee: (account.buying_committee as Row[]).map((member) =>
            fromContact(member, account)
          )
        }
      : {}),
    ...(account.job_postings && typeof account.job_postings === "object"
      ? { jobPostings: fromJobPostingsRollup(account.job_postings as Row) }
      : {})
  };
}

interface V2Envelope {
  data?: Row;
  pagination?: { total?: number; has_more?: boolean; next_cursor?: string };
  meta?: Row;
}

/** The analytics metrics, merged back into the summary object the tools return. */
export function toCompetitorSummary(metrics: Record<string, V2Envelope | null>): Row {
  const summary: Row = {};
  Object.entries(metrics).forEach(([path, envelope]) => {
    const names = COMPETITOR_API_V2_METRICS[path] || {};
    const data = envelope?.data || {};
    if (data.period && !summary.period) summary.period = toCamelCaseDeep(data.period);
    Object.entries(data).forEach(([published, value]) => {
      const name = names[published];
      if (!name) return;
      const [parent, child] = name.split(".");
      if (!child) {
        summary[parent] = toCamelCaseDeep(value);
        return;
      }
      const nested = (summary[parent] as Row) || {};
      nested[child] = toCamelCaseDeep(value);
      summary[parent] = nested;
    });
  });
  return summary;
}

// GET /api/v2/fields?object=account: every key with its values, the
// workspace's own (competitors, stages, owners, custom CRM fields) included.
function fromFieldDirectory(data: Row): Row {
  const keys = Array.isArray(data.keys) ? (data.keys as Row[]) : [];
  const valuesOf = (key: string): unknown[] => {
    const found = keys.find((entry) => entry.key === key);
    return Array.isArray(found?.values) ? (found.values as unknown[]) : [];
  };
  const customFieldsKey = keys.find((entry) => entry.key === "crm_custom_fields");
  const customFields = Array.isArray(customFieldsKey?.custom_fields)
    ? (customFieldsKey.custom_fields as Row[])
    : [];
  return {
    availableDealStatuses: valuesOf("crm_latest_opp_stage").map((status) => ({ status })),
    availableDealOwners: valuesOf("crm_account_owner_name"),
    trackedCompetitorDomains: valuesOf("account_competitors"),
    customColumnOptions: Object.fromEntries(
      customFields.map((field) => [text(field.key), field.values || []])
    ),
    customColumns: customFields.map((field) => ({
      crmType: text(field.crm_type),
      objectType: text(field.object_type),
      name: text(field.name),
      label: text(field.label),
      fieldType: text(field.field_type)
    })),
    connectedCrmTypes: data.connected_crms || []
  };
}

/**
 * Reassemble the accounts payload the tools return from v2's /accounts plus
 * the optional analytics and /fields responses.
 */
export function toCompetitorAccountsResponse({
  accounts,
  metrics,
  filterOptions,
  includeCustomColumns,
  includeFilterOptions,
  limit,
  offset
}: {
  accounts: V2Envelope;
  metrics?: Record<string, V2Envelope | null> | null;
  filterOptions?: V2Envelope | null;
  includeCustomColumns: boolean;
  includeFilterOptions: boolean;
  limit: number;
  offset: number;
}): CompetitorMonitoringAccountsResponse {
  const rows = Array.isArray(accounts.data?.accounts) ? (accounts.data?.accounts as Row[]) : [];
  const options = filterOptions?.data ? fromFieldDirectory(filterOptions.data) : null;
  const connectedCrmTypes = (options?.connectedCrmTypes || []) as string[];
  return {
    totalRecords: accounts.pagination?.total ?? 0,
    limit,
    offset,
    accounts: rows.map(fromCompetitorApiV2Account) as CompetitorMonitoringAccountsResponse["accounts"],
    ...(includeCustomColumns && options
      ? {
          customColumns: options.customColumns as CompetitorMonitoringAccountsResponse["customColumns"],
          customColumnsUpdatedAt: null,
          connectedCrmType: connectedCrmTypes[0] || "",
          connectedCrmTypes
        }
      : {}),
    ...(metrics ? { summary: toCompetitorSummary(metrics) } : {}),
    ...(includeFilterOptions && options
      ? {
          availableDealStatuses:
            options.availableDealStatuses as CompetitorMonitoringAccountsResponse["availableDealStatuses"],
          availableDealOwners: options.availableDealOwners as string[],
          trackedCompetitorDomains: options.trackedCompetitorDomains as string[],
          customColumnOptions: options.customColumnOptions
        }
      : {}),
    ...(accounts.meta?.data_as_of ? { dataAsOf: accounts.meta.data_as_of as string } : {})
  } as CompetitorMonitoringAccountsResponse;
}

// ── Account details: one v2 sub-resource per block ───────────────────────────

export const DETAIL_INCLUDES = [
  "outreach",
  "activity",
  "signals",
  "opportunities",
  "buying_committee",
  "job_postings"
];

/** Which v2 reads a details request needs. */
export function toCompetitorDetailReads(include?: string[]): {
  outreach: boolean;
  opportunities: boolean;
  buyingCommittee: boolean;
  jobPostings: boolean;
  signals: boolean;
} {
  const blocks = new Set(include?.length ? include : DETAIL_INCLUDES);
  return {
    outreach: blocks.has("outreach") || blocks.has("activity"),
    opportunities: blocks.has("opportunities"),
    buyingCommittee: blocks.has("buying_committee"),
    jobPostings: blocks.has("job_postings"),
    signals: blocks.has("signals")
  };
}

function fromOutreach(data: Row): Row {
  const timeline = (data.outreach_timeline || {}) as Row;
  return {
    crmOutreach: {
      outreachStarted: data.outreach_started === true,
      replied: data.outreach_any_replied === true,
      inMarket: data.outreach_in_market === true,
      inMarketSummary: text(data.outreach_in_market_reason),
      summary: text(data.outreach_summary),
      leadSource: { category: text(data.outreach_lead_source) },
      signalCounts: toCamelCaseDeep(data.outreach_counts || {})
    },
    attributionVerdict: text(data.outreach_attribution),
    attributionVerdictReasoning: text(data.outreach_attribution_reason),
    outreachTimeline: {
      signalAt: dateOrNull(timeline.signal_date),
      firstOutreachAfterSignalAt: dateOrNull(timeline.first_outreach_after_signal_date),
      lastOutreachAt: dateOrNull(timeline.last_outreach_date),
      meetingBookedAt: dateOrNull(timeline.meeting_booked_date),
      opportunityCreatedAt: dateOrNull(timeline.opportunity_created_date)
    },
    contactActivity: ((data.contact_activity || []) as Row[]).map((contact) => ({
      name: text(contact.contact_name),
      jobTitle: text(contact.contact_job_title),
      email: text(contact.contact_work_email),
      crmSource: text(contact.crm_source),
      contacted: contact.outreach_contacted === true,
      replied: contact.outreach_replied === true,
      contactedByOwner: {
        name: text(contact.outreach_contacted_by_name),
        email: text(contact.outreach_contacted_by_email)
      },
      lastOutboundAt: dateOrNull(contact.outreach_last_outbound_at),
      lastReplyAt: dateOrNull(contact.outreach_last_reply_at),
      replyClassification: text(contact.outreach_reply_classification)
    })),
    activities: ((data.activities || []) as Row[]).map((activity) => ({
      activityType: text(activity.activity_type),
      activityAt: dateOrNull(activity.activity_at),
      crmSource: text(activity.crm_source),
      direction: text(activity.direction),
      subject: text(activity.subject),
      snippet: text(activity.snippet),
      ownerName: text(activity.owner_name),
      contactName: text(activity.contact_name),
      contactEmail: text(activity.contact_work_email),
      activityDetails: {
        attribution: {
          label: text(activity.outreach_attribution),
          reasoning: text(activity.outreach_attribution_reason)
        }
      }
    })),
    totalActivities: data.activity_total ?? 0
  };
}

/**
 * Reassemble the details payload the tools return from the v2 account and
 * its sub-resources.
 */
export function toCompetitorAccountDetailsResponse({
  account,
  outreach,
  opportunities,
  buyingCommittee,
  jobPostings,
  activityLimit
}: {
  account: V2Envelope;
  outreach?: V2Envelope | null;
  opportunities?: V2Envelope | null;
  buyingCommittee?: V2Envelope | null;
  jobPostings?: V2Envelope | null;
  activityLimit?: number;
}): CompetitorMonitoringAccountDetailsResponse {
  const row = (account.data?.account || {}) as Row;
  const signals = Array.isArray(row.contacts)
    ? (row.contacts as Row[]).flatMap((contact) =>
        Array.isArray(contact.signals) ? (contact.signals as Row[]) : []
      )
    : null;
  const postings = jobPostings?.data || null;
  return {
    found: true,
    companyKey: text(row.account_id),
    companyName: text(row.company_name),
    companyDomain: text(row.company_domain),
    crmCompanies: row.crm_account_url ? [{ primary: true, url: text(row.crm_account_url) }] : [],
    ...(outreach?.data
      ? { ...fromOutreach(outreach.data), ...(activityLimit ? { activityLimit } : {}) }
      : {}),
    ...(signals
      ? {
          signals: signals.map((signal) => {
            const kind = toEngagementKind(text(signal.signal_type));
            return {
              signalType: kind.type,
              engagementType: kind.engagementType,
              activityOn:
                dateOrNull(signal.signal_date) || dateOrNull(signal.signal_recorded_date),
              isHistoric: isHistoricV2Signal(signal)
            };
          })
        }
      : {}),
    ...(opportunities?.data
      ? {
          opportunities: ((opportunities.data.opportunities || []) as Row[]).map(
            (opportunity) => ({
              dealId: text(opportunity.crm_opp_id),
              name: text(opportunity.crm_opp_name),
              stage: text(opportunity.crm_opp_stage),
              amount: opportunity.crm_opp_amount ?? null,
              pipeline: text(opportunity.crm_opp_pipeline),
              createdOn: dateOrNull(opportunity.crm_opp_created_date),
              closeOn: dateOrNull(opportunity.crm_opp_close_date),
              isClosed: opportunity.crm_opp_is_closed ?? null,
              attributionLabel: text(opportunity.outreach_attribution),
              attributionReasoning: text(opportunity.outreach_attribution_reason)
            })
          )
        }
      : {}),
    ...(buyingCommittee?.data
      ? {
          buyingCommittee: ((buyingCommittee.data.buying_committee || []) as Row[]).map(
            (member) => fromContact(member, row)
          ) as CompetitorMonitoringAccountDetailsResponse["buyingCommittee"]
        }
      : {}),
    ...(postings
      ? {
          jobPostingsSummary: fromJobPostingsRollup(postings),
          jobPostings: ((postings.job_postings || []) as Row[]).map((posting) => ({
            title: text(posting.job_title),
            url: text(posting.job_url),
            datePosted: dateOrNull(posting.job_posted_date),
            competitorsMentioned: posting.competitors_mentioned || [],
            systemsInUse: posting.systems_in_use || [],
            initiatives: posting.initiatives || []
          }))
        }
      : {})
  } as CompetitorMonitoringAccountDetailsResponse;
}
