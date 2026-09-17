/**
 * Competitor Monitoring Table Tool
 *
 * The account-grouped view of the competitor monitoring table — one row per
 * company, mirroring what the in-app table renders. This is the tool to reach
 * for when the question is about a company: which competitors it engaged, how
 * urgent it is, what stage we think its cycle is in and why, what the CRM says
 * about the deal and our outreach, and who at the account produced the signal.
 *
 * This is the one canonical MCP entry point for the full table. Keeping a
 * separate, incomplete per-lead tool caused models to select the wrong view for
 * CSV/report prompts and then conclude that the extended buying committee was
 * unavailable.
 */

import { z } from "zod";
import type { LetterboxClient } from "../client/letterbox-client.js";
import {
  ACCOUNT_OWNER_EMAIL_DESCRIPTION,
  ACTIVITY_TYPES_DESCRIPTION,
  COMPETITOR_MONITORING_ACTIVITY_TYPES,
  COMPETITOR_MONITORING_BEST_FIT,
  COMPETITOR_MONITORING_EXISTING_ACCOUNT,
  COMPETITOR_MONITORING_FILTER_JSON_SCHEMA,
  COMPETITOR_MONITORING_OUTREACH_STATUSES,
  COMPETITOR_MONITORING_PRIORITIES,
  COMPETITOR_MONITORING_SORT_FIELDS,
  CUSTOM_COLUMN_SYNC_NOTE,
  COMPETITOR_MONITORING_SORT_ORDERS,
  COMPETITOR_MONITORING_STAGES,
  DEAL_OWNER_EMAIL_DESCRIPTION,
  DEAL_STATUS_DESCRIPTION,
  ATTRIBUTION_DESCRIPTION,
  ATTRIBUTION_NOTE,
  COMPETITOR_MONITORING_ATTRIBUTION,
  BUYING_COMMITTEE_ABSENCE_NOTE,
  BUYING_COMMITTEE_NOTE,
  BUDGETED_RECOMMENDATION_NOTE,
  BEST_FIT_DESCRIPTION,
  CUSTOM_COLUMN_VALUES_DESCRIPTION,
  EXISTING_ACCOUNT_DESCRIPTION,
  GUESSED_STAGE_NOTE,
  HISTORIC_CONNECTION_NOTE,
  OUTREACH_STATUS_DESCRIPTION,
  PRIORITY_DESCRIPTION,
  SORT_FIELD_DESCRIPTION,
  STAGES_DESCRIPTION,
  STALE_ACCOUNT_NOTE,
  buildCompetitorMonitoringFilters,
  normalizeCompetitorMonitoringResponse
} from "./competitor-monitoring-shared.js";

const ACCOUNT_INCLUDES = [
  "contacts",
  "engagements",
  "profile_details",
  "custom_columns",
  "summary",
  "summary_details",
  "filter_options",
  "buying_committee"
] as const;

const DEFAULT_TABLE_INCLUDES = [
  "contacts",
  "custom_columns",
  "buying_committee"
] as const;

const DEFAULT_MAX_CONTACTS_PER_ACCOUNT = 100;

const INCLUDE_DESCRIPTION =
  'Optional: blocks to return. Defaults to the complete contact roster needed for table/CSV/report work: ["contacts","custom_columns","buying_committee"]. "engagements" adds each engaged contact\'s full engagement history and post bodies; "profile_details" adds about/role text and photos; "summary" adds the table\'s metric cards (add "summary_details" for the per-deal rows behind them); "filter_options" lists the available deal statuses, account owners and tracked competitors, plus customColumnOptions \u2014 the values each configured custom CRM column actually holds, keyed the same way as the custom_column_values filter. Keep "buying_committee" for any request involving all contacts, decision-makers, the full table, a CSV, or a report.';

export const CompetitorMonitoringTableSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Optional: max number of accounts to return (default 25, max 100)"
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Optional: pagination offset (default 0)"),
  search_term: z
    .string()
    .optional()
    .describe(
      "Optional: free-text search across company name, domain, stage, reasoning, competitors and contacts"
    ),
  competitors: z
    .array(z.string().min(1))
    .optional()
    .describe("Optional: filter by the competitor(s) the account engaged"),
  stages: z
    .array(z.enum(COMPETITOR_MONITORING_STAGES))
    .optional()
    .describe(STAGES_DESCRIPTION),
  priority: z
    .array(z.enum(COMPETITOR_MONITORING_PRIORITIES))
    .optional()
    .describe(PRIORITY_DESCRIPTION),
  deal_status: z
    .array(z.string().min(1))
    .optional()
    .describe(DEAL_STATUS_DESCRIPTION),
  account_owner: z
    .array(z.string().min(1))
    .optional()
    .describe("Optional: filter by account owner name"),
  account_owner_email: z
    .array(z.string().min(1))
    .optional()
    .describe(ACCOUNT_OWNER_EMAIL_DESCRIPTION),
  deal_owner_email: z
    .array(z.string().min(1))
    .optional()
    .describe(DEAL_OWNER_EMAIL_DESCRIPTION),
  outreach_status: z
    .array(z.enum(COMPETITOR_MONITORING_OUTREACH_STATUSES))
    .optional()
    .describe(OUTREACH_STATUS_DESCRIPTION),
  attribution: z
    .array(z.enum(COMPETITOR_MONITORING_ATTRIBUTION))
    .optional()
    .describe(ATTRIBUTION_DESCRIPTION),
  existing_account: z
    .enum(COMPETITOR_MONITORING_EXISTING_ACCOUNT)
    .optional()
    .describe(EXISTING_ACCOUNT_DESCRIPTION),
  best_fit: z
    .enum(COMPETITOR_MONITORING_BEST_FIT)
    .optional()
    .describe(BEST_FIT_DESCRIPTION),
  custom_column_values: z
    .record(z.array(z.string().min(1)))
    .optional()
    .describe(CUSTOM_COLUMN_VALUES_DESCRIPTION),
  activity_types: z
    .array(z.enum(COMPETITOR_MONITORING_ACTIVITY_TYPES))
    .optional()
    .describe(ACTIVITY_TYPES_DESCRIPTION),
  company_size: z
    .array(z.string().min(1))
    .optional()
    .describe("Optional: filter by company size bucket"),
  location: z
    .array(z.string().min(1))
    .optional()
    .describe("Optional: filter by company country"),
  last_activity_within_days: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Optional: only accounts whose last activity falls within this many days"
    ),
  last_activity_start_date: z
    .string()
    .optional()
    .describe("Optional: ISO datetime lower bound for last activity"),
  last_activity_end_date: z
    .string()
    .optional()
    .describe("Optional: ISO datetime upper bound for last activity"),
  sort_field: z
    .enum(COMPETITOR_MONITORING_SORT_FIELDS)
    .optional()
    .describe(SORT_FIELD_DESCRIPTION),
  sort_order: z
    .enum(COMPETITOR_MONITORING_SORT_ORDERS)
    .optional()
    .describe("Optional: ASC or DESC (default DESC)"),
  include: z
    .array(z.enum(ACCOUNT_INCLUDES))
    .optional()
    .describe(INCLUDE_DESCRIPTION),
  max_contacts_per_account: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe(
      "Optional: cap the engaged contacts returned per account (default 100, max 100, 0 to omit them). contactCount always reports the true total."
    )
});

export type CompetitorMonitoringTableInput = z.infer<
  typeof CompetitorMonitoringTableSchema
>;

export async function handleCompetitorMonitoringTable(
  client: LetterboxClient,
  args: CompetitorMonitoringTableInput
): Promise<string> {
  try {
    const filters = buildCompetitorMonitoringFilters(args);
    const include = args.include
      ? [...args.include]
      : [...DEFAULT_TABLE_INCLUDES];
    const data = await client.getCompetitorMonitoringAccounts({
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.offset !== undefined ? { offset: args.offset } : {}),
      ...(args.search_term ? { searchTerm: args.search_term } : {}),
      ...(Object.keys(filters).length ? { filters } : {}),
      include,
      ...(args.sort_field ? { sortField: args.sort_field } : {}),
      ...(args.sort_order ? { sortOrder: args.sort_order } : {}),
      maxContactsPerAccount:
        args.max_contacts_per_account ?? DEFAULT_MAX_CONTACTS_PER_ACCOUNT
    });

    const returnedAccounts = Array.isArray(data.accounts)
      ? data.accounts.length
      : 0;
    const nextOffset = data.offset + returnedAccounts;
    const hasMore = nextOffset < data.totalRecords;

    return JSON.stringify(
      normalizeCompetitorMonitoringResponse({
        ...data,
        pagination: {
          hasMore,
          nextOffset: hasMore ? nextOffset : null
        },
        coverage: {
          engagedContactsIncluded: include.includes("contacts"),
          buyingCommitteeIncluded: include.includes("buying_committee"),
          maxContactsPerAccount:
            args.max_contacts_per_account ?? DEFAULT_MAX_CONTACTS_PER_ACCOUNT
        }
      }),
      null,
      2
    );
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to fetch the competitor monitoring table: ${error.message}`
      );
    }
    throw error;
  }
}

export const competitorMonitoringTableTool = {
  name: "get_competitor_monitoring_table",
  description:
    "Fetch the full competitor monitoring table: the single account-grained read behind every competitor-table, all-leads, decision-maker, CSV, export and recommended-outreach question. One row per company, with both contact groups by default — `contacts` are people who personally produced a competitor signal, `buyingCommittee` the extended decision-makers at the same account. There is no separate per-lead or 'Show buying committee' tool; the committee is part of this response unless `include` drops `buying_committee`. Each person carries `recommendedAction` and `recommendedChannels`, outreach guidance from the workspace's weekly capacity plan rather than an email address or a named sequence. Each account also carries the competitors it engaged, priority (high/medium/low/nurture), staleness, guessed stage and reasoning, CRM deal status / stage / amount / owner / open and close dates, outreach status and CRM summary, custom CRM columns, signal dates, and contacted/replied state. Supports free-text search, filters, sorting and limit-offset pagination: follow `pagination.hasMore` and `pagination.nextOffset` for the whole dataset, but start at limit 25 and narrow with filters rather than paging deeply, since each page is a full table read. `existingAccount` is null when the CRM lookup was unavailable, which is NOT the same as net-new. " +
    BUDGETED_RECOMMENDATION_NOTE +
    " " +
    GUESSED_STAGE_NOTE +
    " " +
    STALE_ACCOUNT_NOTE +
    " " +
    ATTRIBUTION_NOTE +
    " " +
    HISTORIC_CONNECTION_NOTE +
    " The same rule applies at the account level: an account with hasOnlyHistoricInitialConnections: true reports lastEngaged / firstEngaged as null and carries only collectedDate. " +
    BUYING_COMMITTEE_NOTE +
    " Here the two groups arrive in separate arrays: `contacts` holds the engaged contacts, and `buyingCommittee` (only when `include` asks for it) holds the committee. " +
    BUYING_COMMITTEE_ABSENCE_NOTE +
    " The `coverage` block states whether both contact groups were included. " +
    CUSTOM_COLUMN_SYNC_NOTE +
    " " +
    "For one company's outreach timeline, classified replies and live CRM opportunities, use get_competitor_monitoring_account_details.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description:
          "Optional: max number of accounts to return (default 25, max 100)"
      },
      offset: {
        type: "number",
        description: "Optional: pagination offset (default 0)"
      },
      ...COMPETITOR_MONITORING_FILTER_JSON_SCHEMA,
      include: {
        type: "array",
        items: { type: "string", enum: [...ACCOUNT_INCLUDES] },
        description: INCLUDE_DESCRIPTION
      },
      max_contacts_per_account: {
        type: "number",
        description:
          "Optional: cap the engaged contacts returned per account (default 100, max 100, 0 to omit them). contactCount always reports the true total."
      }
    },
    required: []
  }
};
