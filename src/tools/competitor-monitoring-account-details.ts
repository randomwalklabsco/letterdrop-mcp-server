/**
 * Competitor Monitoring Account Details Tool
 *
 * One company in depth: the CRM outreach rollup, the per-contact outreach
 * records, the classified activity timeline, the signals we surfaced, live CRM
 * opportunities, and the extended buying committee.
 *
 * Deliberately a separate tool from get_competitor_monitoring_table. All of
 * this is per-company work (a CRM activity read plus a live opportunity
 * lookup), so folding it into the table would make every page far more
 * expensive for data that is only interesting one account at a time.
 */

import { z } from "zod";
import type { LetterboxClient } from "../client/letterbox-client.js";
import {
  ATTRIBUTION_NOTE,
  BUYING_COMMITTEE_ABSENCE_NOTE,
  BUYING_COMMITTEE_NOTE,
  HISTORIC_CONNECTION_NOTE,
  normalizeCompetitorMonitoringResponse
} from "./competitor-monitoring-shared.js";

const DETAIL_INCLUDES = [
  "outreach",
  "activity",
  "signals",
  "opportunities",
  "buying_committee"
] as const;

export const CompetitorMonitoringAccountDetailsSchema = z
  .object({
    company_key: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The account's companyKey, as returned by get_competitor_monitoring_table. The most reliable identifier."
      ),
    company_domain: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The company's domain or website URL. Used when you do not have a companyKey."
      ),
    company_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The company's name. The least precise identifier — prefer company_key or company_domain."
      ),
    include: z
      .array(z.enum(DETAIL_INCLUDES))
      .optional()
      .describe(
        'Optional: which blocks to return. Defaults to all of them. "outreach" = the CRM rollup and per-contact outreach records; "activity" = the recent activity timeline with reply classification; "signals" = the competitor signals we surfaced; "opportunities" = live CRM deals; "buying_committee" = decision-makers found at the account beyond the people the signals came from.'
      ),
    activity_limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Optional: how many timeline entries to return, newest first (default 50, max 200). totalActivities always reports the untruncated count."
      )
  })
  .refine(
    (args) =>
      Boolean(args.company_key || args.company_domain || args.company_name),
    {
      message: "One of company_key, company_domain or company_name is required"
    }
  );

export type CompetitorMonitoringAccountDetailsInput = z.infer<
  typeof CompetitorMonitoringAccountDetailsSchema
>;

export async function handleCompetitorMonitoringAccountDetails(
  client: LetterboxClient,
  args: CompetitorMonitoringAccountDetailsInput
): Promise<string> {
  try {
    const data = await client.getCompetitorMonitoringAccountDetails({
      ...(args.company_key ? { companyKey: args.company_key } : {}),
      ...(args.company_domain ? { companyDomain: args.company_domain } : {}),
      ...(args.company_name ? { companyName: args.company_name } : {}),
      ...(args.include ? { include: [...args.include] } : {}),
      ...(args.activity_limit !== undefined
        ? { activityLimit: args.activity_limit }
        : {})
    });

    return JSON.stringify(normalizeCompetitorMonitoringResponse(data), null, 2);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to fetch competitor monitoring account details: ${error.message}`
      );
    }
    throw error;
  }
}

export const competitorMonitoringAccountDetailsTool = {
  name: "get_competitor_monitoring_account_details",
  description:
    "Fetch everything known about one company in the competitor monitoring table: the CRM outreach rollup (whether outreach started, whether they replied, the in-market verdict and summary), per-contact outreach records, the recent CRM activity timeline with each entry's reply classification and sentiment, the competitor signals we surfaced and when, live CRM opportunities, and the buying committee — decision-makers at the account beyond the people the signals came from. Identify the company with company_key (from get_competitor_monitoring_table), company_domain, or company_name; one that is not in the table returns found: false rather than an error. Use `include` to fetch only the blocks you need and activity_limit to cap the timeline. " +
    ATTRIBUTION_NOTE +
    " On this tool the verdict is `attributionVerdict` at the top level, with `attributionVerdictReasoning` explaining it. Read THOSE: the `crmOutreach.attribution` rollup deliberately withholds its stored verdict, which is written before the two read-time gates (an existing customer, or a signal window too old to use) and would over-claim on exactly the accounts the product refuses to claim. Each opportunity carries its own attributionLabel, and each MEETING in the activity timeline carries activityDetails.attribution.label — a meeting row with a blank label on an account that has a verdict is gated, not unscored. " +
    HISTORIC_CONNECTION_NOTE +
    " In the signals block the same distinction is carried as isHistoric: a signal with isHistoric: true marks when a pre-existing record was first imported, not a moment the person did anything, so never use it to time the signal relative to your outreach. " +
    BUYING_COMMITTEE_NOTE +
    " " +
    BUYING_COMMITTEE_ABSENCE_NOTE,
  inputSchema: {
    type: "object",
    properties: {
      company_key: {
        type: "string",
        description:
          "The account's companyKey, as returned by get_competitor_monitoring_table. The most reliable identifier."
      },
      company_domain: {
        type: "string",
        description:
          "The company's domain or website URL. Used when you do not have a companyKey."
      },
      company_name: {
        type: "string",
        description:
          "The company's name. The least precise identifier — prefer company_key or company_domain."
      },
      include: {
        type: "array",
        items: { type: "string", enum: [...DETAIL_INCLUDES] },
        description:
          'Optional: which blocks to return. Defaults to all of them. "outreach" = the CRM rollup and per-contact outreach records; "activity" = the recent activity timeline with reply classification; "signals" = the competitor signals we surfaced; "opportunities" = live CRM deals; "buying_committee" = decision-makers found at the account beyond the people the signals came from.'
      },
      activity_limit: {
        type: "number",
        description:
          "Optional: how many timeline entries to return, newest first (default 50, max 200). totalActivities always reports the untruncated count."
      }
    },
    required: []
  }
};
