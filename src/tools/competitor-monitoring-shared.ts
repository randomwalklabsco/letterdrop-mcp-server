/**
 * Filter vocabulary shared by the three competitor monitoring tools
 * (accounts, account details, leads). All three accept the same filters over
 * the same backend read path, so the enums live in one place rather than being
 * copied three ways and drifting.
 */

export const COMPETITOR_MONITORING_STAGES = [
  "aware_of_competitor",
  "previously_aware_of_competitor",
  "prospecting",
  "early_stage",
  "late_stage",
  "current_customer"
] as const;

export const COMPETITOR_MONITORING_PRIORITIES = [
  "high",
  "medium",
  "low",
  "nurture"
] as const;

// The four funnel buckets the server resolves, plus the sentinel meaning "we
// have not reached out at all".
export const COMPETITOR_MONITORING_OUTREACH_STATUSES = [
  "reached_out",
  "replied",
  "opportunity_created",
  "existing_customer",
  "__no_outreach__",
  // Signal-relative predicates rather than funnel buckets: they answer "did we
  // act on the signal", and the backend unions them in alongside a bucket
  // match, so they can be combined with the five above.
  "reached_out_after_signal",
  "replied_after_signal",
  "opportunity_created_after_signal"
] as const;

// The Attribution filter's vocabulary. Mirror of
// COMPETITOR_ATTRIBUTION_FILTER_VALUES in letterbox
// (src/utils/competitor-attribution-label.js); the strings must stay
// byte-identical, since the backend drops values it does not recognise rather
// than matching them.
//
// It is a FOLD of the stored taxonomy, not a copy: the two COVERAGE values
// (`pending_analysis` and `none`) collapse into `not_attributed`, because the
// difference between "we have not scored this yet" and "there was nothing to
// score" is a statement about OUR data, not about the account.
export const COMPETITOR_MONITORING_ATTRIBUTION = [
  "direct_reply",
  "driven",
  "assisted",
  "detected",
  "competitive_deal",
  "not_attributed"
] as const;

export const ATTRIBUTION_DESCRIPTION =
  'Optional: filter by the account\'s attribution verdict — WHY its meetings and opportunities happened. Accepted values, strongest claim first: direct_reply (the prospect replied to our outreach and the meeting came off that thread), driven (our outreach started it but they came inbound another way), assisted (the signal did not start the outreach, but somebody reached out after it landed), detected (no outreach followed the signal at all), competitive_deal (the account was already being worked before the signal, so the signal cannot be credited), and "not_attributed" for accounts carrying no claim — either not scored yet, or nothing to attribute';

export const COMPETITOR_MONITORING_ACTIVITY_TYPES = [
  "like",
  "comment",
  "connection"
] as const;

export const COMPETITOR_MONITORING_EXISTING_ACCOUNT = [
  "existing",
  "net_new"
] as const;

// Sorting only takes effect for these three; anything else silently falls back
// to lastEngaged, so the tools do not offer it.
export const COMPETITOR_MONITORING_SORT_FIELDS = [
  "lastEngaged",
  "priority",
  "dealDateCreated"
] as const;

export const COMPETITOR_MONITORING_SORT_ORDERS = ["ASC", "DESC"] as const;

/** Sentinel for "no CRM opportunity" in the deal-status filter. */
export const COMPETITOR_NO_OPPORTUNITY_DEAL_STATUS = "__no_opportunity__";

export const STAGES_DESCRIPTION =
  "Optional: filter by sales-cycle stage: Letterdrop's guess at where the company sits in the competitor's cycle, inferred from observed activity rather than read from the competitor's CRM. Accepted values: aware_of_competitor, previously_aware_of_competitor, prospecting, early_stage, late_stage, current_customer. previously_aware_of_competitor only means the engagement happened at some unknown point in the past, so it is not an in-market or active-cycle stage";

export const PRIORITY_DESCRIPTION =
  "Optional: filter by priority bucket. Accepted values: high, medium, low, nurture";

export const DEAL_STATUS_DESCRIPTION =
  'Optional: filter by CRM deal status / stage label. Use "__no_opportunity__" for accounts with no CRM opportunity at all';

export const OUTREACH_STATUS_DESCRIPTION =
  'Optional: filter by outreach status. Funnel buckets (mutually exclusive per account): reached_out, replied, opportunity_created, existing_customer, and "__no_outreach__" for accounts nobody has contacted yet. Signal-relative predicates, which only count activity that happened after the competitor signal: reached_out_after_signal, replied_after_signal, opportunity_created_after_signal. Values from both groups can be combined; an account matching any of the selected values is returned';

export const EXISTING_ACCOUNT_DESCRIPTION =
  'Optional: "existing" (already in your CRM when we found them) or "net_new"';

export const ACTIVITY_TYPES_DESCRIPTION =
  "Optional: filter by the kind of signal shown on each contact's row. Accepted values: like, comment, connection";

export const ACCOUNT_OWNER_EMAIL_DESCRIPTION =
  "Optional: filter by the CRM account owner's email — the accountOwnerEmail each row reports. Use deal_owner_email for the owner of the CRM opportunity, which is often a different person";

export const DEAL_OWNER_EMAIL_DESCRIPTION =
  "Optional: filter by the CRM opportunity owner's email — the dealOwnerEmail each row reports. This is not the account owner; use account_owner_email for that";

export const SORT_FIELD_DESCRIPTION =
  "Optional: sort field. Accepted values: lastEngaged (default), priority, dealDateCreated";

/**
 * The stage is an inference, and previously_aware_of_competitor is
 * the one value that says nothing about a live cycle. Without this, a reader
 * takes any non-empty stage as evidence of an active opportunity and counts a
 * years-old, dateless relationship as in-market — the stage-level twin of the
 * mistake HISTORIC_CONNECTION_NOTE prevents at the contact level.
 */
export const GUESSED_STAGE_NOTE =
  "The sales-cycle stage (`stage` / `stageLabel`) is a GUESS: where we think the company sits in the competitor's sales cycle based on the activity we observed, not a fact from the competitor's CRM, since we cannot see their pipeline. `previously_aware_of_competitor` (\"Previously Aware of Competitor\") is the one stage that only tells you the contact and company engaged the competitor at some point in the past and we do not know when; it is where accounts whose every connection was found by a backfill scan land. Never count those as potentially in-market or as an active opportunity, and never state the stage as fact about the competitor's pipeline. The same is true of `subStage` and `activeCycle`, which are derived from that same guess: `activeCycle: true` is our inference that a cycle looks live, not a competitor pipeline record.";

/**
 * The past-vs-new caveat, stated once and appended to all three
 * tool descriptions.
 *
 * A "historic initial connection" is a relationship that already existed before
 * monitoring started; a one-time backfill scan found it. Its only timestamp is
 * the scan's, which is often TODAY, so a reader that sees a date treats a
 * years-old relationship as a brand-new signal — the exact mistake this note
 * exists to prevent. The app draws the distinction visually ("Past", "Collected
 * on <date>"); a tool result has nothing but field names, so it has to be said.
 */
export const HISTORIC_CONNECTION_NOTE =
  "PAST vs NEW connections — read this before drawing any conclusion about recency: a contact with isHistoricInitialConnection: true (or an account with hasOnlyHistoricInitialConnections: true) is a PAST connection. That person was already connected to the competitor before monitoring began, and a one-time backfill scan simply discovered the existing relationship. It is NOT new activity and must never be counted as a recent signal, as evidence of a live sales cycle, or as a reason the account is in market now. For those rows the engagement dates (lastEngaged, firstEngaged, connectionTimestamp) are deliberately null, because no engagement was ever observed; collectedDate is only when Letterdrop's scan recorded the connection and says nothing about when it was made, so never present it as an engagement, connection or activity date. Rows with isHistoricInitialConnection: false are genuine signals observed while monitoring, and there collectedDate matches lastEngaged.";

/**
 * The engaged-vs-committee caveat, the second thing a reader of
 * these results gets wrong.
 *
 * A buying-committee entry is shaped almost exactly like an engaged contact and
 * carries `competitors` and `engagedWith` naming a real competitor rep — because
 * those describe the ACCOUNT, not the person. Handed one entry, a
 * model read `engagedWith` as an action and drafted "you're listed alongside
 * HubSpot's Jonathan Sobo" into a cold email about someone who had done nothing.
 * The API now stamps every entry with contactType/hasOwnSignal; this note tells
 * the reader what those mean and what the lookalike fields do not.
 */
export const BUYING_COMMITTEE_NOTE =
  "ENGAGED CONTACTS vs BUYING COMMITTEE — the second distinction that changes what you may claim about a person. Every person in these results carries contactType and hasOwnSignal. contactType: 'Engaged Contact' (hasOwnSignal: true) means that person personally did something — liked, commented on, followed or connected with a competitor's rep — and that action is the signal. contactType: 'Buying Committee' (hasOwnSignal: false) means the OPPOSITE: that person engaged nobody. We found them by searching for decision-makers at an account that had signals from other people. Committee entries still carry `competitors` and an `engagedWith` object naming a real competitor rep, and this is the trap: those fields describe the ACCOUNT — which competitor surfaced it, and which rep the account's ENGAGED contacts interacted with — and are repeated onto the committee entry as context (the same values are spelled out under accountCompetitorContext). Never say or imply that a Buying Committee person engaged, connected with, interacted with, was contacted by, or is known to the competitor or the rep named on their entry, and never use them as evidence of intent; they are a person worth reaching out to at an account that has signals, nothing more. Committee entries have no engagement dates at all, so they can never be ranked by recency.";

/**
 * Absence of committee data is not absence of a committee. The
 * block only ships when `include` asks for it, and the discovery job may simply
 * not have run for an account, so an empty array is "we have not returned any",
 * never "this company has no decision-makers".
 */
export const BUYING_COMMITTEE_ABSENCE_NOTE =
  "An empty or missing buyingCommittee means none was RETURNED — either because `include` did not request it, or because we have not discovered the account's decision-makers yet. It never means the company has none, so do not report a company as having no buying committee or no decision-makers on this basis.";

/**
 * The attribution vocabulary.
 *
 * The table answers two different questions and they are easy to conflate: WHEN
 * a meeting happened (the dates) and WHY it happened (the verdict). A reader
 * with only the dates infers causation from ordering — a meeting after a signal
 * looks caused by it — which is exactly the inference `competitive_deal` exists
 * to block. So the terms have to be defined, not just returned.
 *
 * The blank is part of the vocabulary: an empty verdict means no claim is being
 * made, and a reader who takes it for "no attribution was found" has turned an
 * absence of judgment into a negative finding.
 */
export const ATTRIBUTION_NOTE =
  "ATTRIBUTION — every account carries an `attribution` block answering WHY its meetings and opportunities happened, which is NOT recoverable from the dates around them. `attribution.verdict` is one of: direct_reply (Letterdrop started the outreach, the prospect replied, and the meeting came off that thread); driven (Letterdrop started the outreach but the prospect came inbound on their own rather than replying — they saw it and came in, or forwarded it to a colleague who booked another way, so another channel may hold the last touch); assisted (the signal did not start the outreach, but somebody reached out after it landed — help, not cause); detected (no outreach followed the signal at all; the prospect surfaced by themselves); competitive_deal (the account was ALREADY being actively worked when the signal landed, so the meeting would most likely have happened anyway and the signal cannot be credited); pending_analysis (a qualifying conversion we have not scored yet — a statement about our coverage, not about the account). An EMPTY verdict means no claim is being made, either because there was nothing to attribute or because the account is outside the taxonomy entirely (an existing customer, or signals too old to use) — never read a blank as 'no attribution was found'. Only direct_reply and driven credit Letterdrop with causing the meeting; never report assisted or detected as sourced pipeline. `attribution.priorRecentOutreach` is TRI-STATE: true/false when we observed the 30 days before the signal, and NULL when we could not look at all — null is not false, and treating it as false is what turns an already-worked account into a claimed one.";

/**
 * `isStale` mirrors the export's "Stale" column, so an agent can tell an aged
 * signal from a fresh one.
 *
 * The trap it creates is specific: staleness deliberately does NOT downgrade
 * `priority` (which keeps the scored history intact), so a stale account
 * still reads `priority: "high"`. A reader that ranks on priority alone will
 * put a months-old signal at the top of an outreach list.
 */
export const STALE_ACCOUNT_NOTE =
  "STALENESS — isStale: true means the account's competitor signal has aged past the workspace's measured sales-cycle window, so the cycle it pointed at has most likely already resolved. Crucially, going stale does NOT change `priority`: a stale account still reports the priority it scored when the signal landed, usually 'high'. Read the two together and treat isStale: true as a reason to deprioritise, verify before acting, or exclude from a 'who should we reach out to now' list — never rank on priority alone. Current customers are never marked stale.";

/**
 * Explain that the contact recommendation is an allocation from
 * the current weekly capacity plan, rather than another fit or intent score.
 */
export const BUDGETED_RECOMMENDATION_NOTE =
  "BUDGETED OUTREACH — `recommendedAction` is the outbound channel or channel combination allocated to this contact by the workspace's current weekly email, social-network, and call capacity plan. Use `recommendedChannels.socialNetwork`, `.email`, and `.call` when you need machine-readable booleans instead of parsing the label. An empty `recommendedAction` means no action was allocated to that contact in the current plan (or no current plan is available); never invent an action or interpret the blank as evidence that the person is unreachable or unqualified.";

/**
 * JSON Schema fragments for the filters every competitor monitoring tool
 * accepts. The MCP tool definitions hand-write their JSON Schema to mirror the
 * Zod schema, so sharing the common half keeps the two in step.
 */
/**
 * The difference between "your CRM has no value here" and
 * "a background job has not fetched it yet".
 *
 * Custom column values are fetched by a background job, not at save time, so for
 * a while after someone adds a column every cell is blank. The in-app table says
 * "Syncing…" for exactly this reason; a model reading the same blank over the
 * API will otherwise report it as an empty CRM field, confidently and wrongly.
 * Both stamps are already in the response — this is what tells a reader to
 * compare them.
 */
export const CUSTOM_COLUMN_SYNC_NOTE =
  "Custom CRM columns are populated by a background sync, not when the column is added, so a column a user configured recently can be legitimately blank on every account for a few hours. Before reporting a blank customColumnValues entry as \"no value in the CRM\", compare the response's top-level customColumnsUpdatedAt (when the column set was last saved) with that account's customColumnsSyncedConfigAt (the stamp the sync job wrote). If the account's stamp is missing or older than the config stamp, the value is still being fetched — say that rather than reporting an empty field. Both come from one server clock, so equal means synced. After about six hours, treat a blank as genuinely blank: the job has either finished or will never reach that account.";

export const COMPETITOR_MONITORING_BEST_FIT = [
  "best_fit",
  "not_best_fit"
] as const;

export const BEST_FIT_DESCRIPTION =
  'Optional: "best_fit" returns only accounts our ICP assessment marked a fit, "not_best_fit" only those it did not. Omit for both. Each account carries isBestFit and, when true, bestFitReasoning explaining the call.';

export const CUSTOM_COLUMN_VALUES_DESCRIPTION =
  'Optional: filter on the workspace\'s custom CRM columns. An object of column key to the values to match, e.g. {"salesforce:Account:Industry__c": ["Fintech"]}. Column keys are the same keys that appear in each account\'s customColumnValues; ask for include ["filter_options"] to see the configured columns and the values each one holds. A column that is no longer configured is ignored.';

export const COMPETITOR_MONITORING_FILTER_JSON_SCHEMA = {
  search_term: {
    type: "string",
    description:
      "Optional: free-text search across company name, domain, stage, reasoning, competitors and contacts"
  },
  competitors: {
    type: "array",
    items: { type: "string" },
    description: "Optional: filter by the competitor(s) the account engaged"
  },
  stages: {
    type: "array",
    items: { type: "string", enum: [...COMPETITOR_MONITORING_STAGES] },
    description: STAGES_DESCRIPTION
  },
  priority: {
    type: "array",
    items: { type: "string", enum: [...COMPETITOR_MONITORING_PRIORITIES] },
    description: PRIORITY_DESCRIPTION
  },
  deal_status: {
    type: "array",
    items: { type: "string" },
    description: DEAL_STATUS_DESCRIPTION
  },
  account_owner: {
    type: "array",
    items: { type: "string" },
    description: "Optional: filter by account owner name"
  },
  account_owner_email: {
    type: "array",
    items: { type: "string" },
    description: ACCOUNT_OWNER_EMAIL_DESCRIPTION
  },
  deal_owner_email: {
    type: "array",
    items: { type: "string" },
    description: DEAL_OWNER_EMAIL_DESCRIPTION
  },
  outreach_status: {
    type: "array",
    items: {
      type: "string",
      enum: [...COMPETITOR_MONITORING_OUTREACH_STATUSES]
    },
    description: OUTREACH_STATUS_DESCRIPTION
  },
  attribution: {
    type: "array",
    items: { type: "string", enum: [...COMPETITOR_MONITORING_ATTRIBUTION] },
    description: ATTRIBUTION_DESCRIPTION
  },
  existing_account: {
    type: "string",
    enum: [...COMPETITOR_MONITORING_EXISTING_ACCOUNT],
    description: EXISTING_ACCOUNT_DESCRIPTION
  },
  best_fit: {
    type: "string",
    enum: [...COMPETITOR_MONITORING_BEST_FIT],
    description: BEST_FIT_DESCRIPTION
  },
  custom_column_values: {
    type: "object",
    additionalProperties: { type: "array", items: { type: "string" } },
    description: CUSTOM_COLUMN_VALUES_DESCRIPTION
  },
  activity_types: {
    type: "array",
    items: { type: "string", enum: [...COMPETITOR_MONITORING_ACTIVITY_TYPES] },
    description: ACTIVITY_TYPES_DESCRIPTION
  },
  company_size: {
    type: "array",
    items: { type: "string" },
    description: "Optional: filter by company size bucket"
  },
  location: {
    type: "array",
    items: { type: "string" },
    description: "Optional: filter by company country"
  },
  last_activity_within_days: {
    type: "number",
    description:
      "Optional: only accounts whose last activity falls within this many days"
  },
  last_activity_start_date: {
    type: "string",
    description: "Optional: ISO datetime lower bound for last activity"
  },
  last_activity_end_date: {
    type: "string",
    description: "Optional: ISO datetime upper bound for last activity"
  },
  sort_field: {
    type: "string",
    enum: [...COMPETITOR_MONITORING_SORT_FIELDS],
    description: SORT_FIELD_DESCRIPTION
  },
  sort_order: {
    type: "string",
    enum: [...COMPETITOR_MONITORING_SORT_ORDERS],
    description: "Optional: ASC or DESC (default DESC)"
  }
} as const;

export interface CompetitorMonitoringFilterArgs {
  competitors?: string[];
  stages?: readonly string[];
  priority?: readonly string[];
  confidence?: string;
  deal_status?: string[];
  account_owner?: string[];
  account_owner_email?: string[];
  deal_owner_email?: string[];
  outreach_status?: readonly string[];
  attribution?: readonly string[];
  existing_account?: string;
  best_fit?: string;
  custom_column_values?: Record<string, string[]>;
  activity_types?: readonly string[];
  company_size?: string[];
  location?: string[];
  last_activity_within_days?: number;
  last_activity_start_date?: string;
  last_activity_end_date?: string;
}

/**
 * Turn the tool's snake_case arguments into the `filters` object the API takes.
 * The backend accepts either casing, but sending snake_case keeps the wire
 * format matching what the tool schema advertises.
 */
export function buildCompetitorMonitoringFilters(
  args: CompetitorMonitoringFilterArgs
): Record<string, unknown> {
  return {
    ...(args.competitors?.length ? { competitors: args.competitors } : {}),
    ...(args.stages?.length ? { stages: args.stages } : {}),
    // `confidence` is the deprecated spelling of `priority`; the backend still
    // accepts it, so pass whichever the caller used.
    ...(args.priority?.length
      ? { priority: args.priority }
      : args.confidence
        ? { priority: args.confidence }
        : {}),
    ...(args.deal_status?.length ? { deal_status: args.deal_status } : {}),
    ...(args.account_owner?.length
      ? { account_owner: args.account_owner }
      : {}),
    ...(args.account_owner_email?.length
      ? { account_owner_email: args.account_owner_email }
      : {}),
    ...(args.deal_owner_email?.length
      ? { deal_owner_email: args.deal_owner_email }
      : {}),
    ...(args.outreach_status?.length
      ? { outreach_status: args.outreach_status }
      : {}),
    ...(args.attribution?.length ? { attribution: args.attribution } : {}),
    ...(args.existing_account
      ? { existing_account: args.existing_account }
      : {}),
    ...(args.best_fit ? { best_fit: args.best_fit } : {}),
    ...(args.custom_column_values &&
    Object.keys(args.custom_column_values).length
      ? { custom_column_values: args.custom_column_values }
      : {}),
    ...(args.activity_types?.length
      ? { activity_types: args.activity_types }
      : {}),
    ...(args.company_size?.length ? { company_size: args.company_size } : {}),
    ...(args.location?.length ? { location: args.location } : {}),
    ...(args.last_activity_within_days !== undefined
      ? { last_activity_within_days: args.last_activity_within_days }
      : {}),
    ...(args.last_activity_start_date
      ? { last_activity_start_date: args.last_activity_start_date }
      : {}),
    ...(args.last_activity_end_date
      ? { last_activity_end_date: args.last_activity_end_date }
      : {})
  };
}

/**
 * Keep the competitor-monitoring response aligned with the platform-neutral
 * MCP vocabulary while preserving every other field returned by the API.
 */
export function normalizeCompetitorMonitoringResponse<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) =>
      normalizeCompetitorMonitoringResponse(item)
    ) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const normalized: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "recommendedAction" && typeof nestedValue === "string") {
      // The backend/export use the provider-specific UI label. MCP keeps its
      // authored and returned vocabulary platform-neutral, matching the
      // recommendedChannels.socialNetwork key below.
      normalized[key] = nestedValue.replace(/\bLinkedIn\b/gi, "Social Network");
      continue;
    }

    if (
      key === "recommendedChannels" &&
      nestedValue &&
      typeof nestedValue === "object" &&
      !Array.isArray(nestedValue)
    ) {
      const channels = nestedValue as Record<string, unknown>;
      const { linkedin: legacySocialNetwork, ...otherChannels } = channels;
      normalized[key] = {
        ...normalizeCompetitorMonitoringResponse(otherChannels),
        ...(legacySocialNetwork !== undefined &&
        otherChannels.socialNetwork === undefined
          ? { socialNetwork: legacySocialNetwork }
          : {})
      };
      continue;
    }

    normalized[key] = normalizeCompetitorMonitoringResponse(nestedValue);
  }

  return normalized as T;
}
