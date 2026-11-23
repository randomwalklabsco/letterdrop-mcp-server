import { z } from "zod";
import type { LetterboxClient } from "../client/letterbox-client.js";

// The Knowledge Base's company-size choices; letterbox rejects anything else.
export const KNOWLEDGE_BASE_COMPANY_SIZES = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001+"
] as const;

const NamedOptionSchema = z.object({
  name: z.string().min(1),
  value: z.string().optional(),
  code: z.string().optional()
});

const MixedNamedOptionSchema = z.union([z.string().min(1), NamedOptionSchema]);

const LOCATION_DESCRIPTION =
  'Countries, as names ("United States") or ISO 3166-1 alpha-2 codes ("US"). Unrecognized countries are rejected.';

const BuyerFilterGroupSchema = z.object({
  job_titles: z
    .array(z.string().min(1))
    .optional()
    .describe("Keywords in job title to include"),
  excluded_job_titles: z
    .array(z.string().min(1))
    .optional()
    .describe("Keywords in job title to exclude"),
  seniorities: z
    .array(MixedNamedOptionSchema)
    .optional()
    .describe("Seniority filters as strings or {name, value} objects"),
  locations: z
    .array(MixedNamedOptionSchema)
    .optional()
    .describe(LOCATION_DESCRIPTION)
});

const CompanyFilterGroupSchema = z.object({
  company_sizes: z
    .array(z.enum(KNOWLEDGE_BASE_COMPANY_SIZES))
    .optional()
    .describe("Company sizes (employee-count ranges)"),
  industries: z
    .array(MixedNamedOptionSchema)
    .optional()
    .describe("Industry filters"),
  excluded_industries: z
    .array(MixedNamedOptionSchema)
    .optional()
    .describe("Industries to exclude"),
  hq_locations: z
    .array(MixedNamedOptionSchema)
    .optional()
    .describe(`Company HQ locations. ${LOCATION_DESCRIPTION}`),
  is_all_company_size_checked: z
    .boolean()
    .optional()
    .describe("Whether all company-size options should be selected")
});

export const UpdateKnowledgeBaseBuyerFiltersSchema = z
  .object({
    company_filters: CompanyFilterGroupSchema.optional().describe(
      "Company-level filters"
    ),
    decision_makers: BuyerFilterGroupSchema.optional().describe(
      "Decision Makers tab"
    ),
    individual_contributors:
      BuyerFilterGroupSchema.optional().describe("End Users tab"),
    full_buying_committee: BuyerFilterGroupSchema.optional().describe(
      "Full Buying Committee tab"
    ),
    active_tab: z
      .enum(["aboveTheLine", "belowTheLine"])
      .optional()
      .describe(
        "Which knowledge-base tab should remain active after the update"
      )
  })
  .refine(
    (value) =>
      Boolean(
        value.company_filters ||
        value.decision_makers ||
        value.individual_contributors ||
        value.full_buying_committee ||
        value.active_tab
      ),
    {
      message:
        "Provide at least one of company_filters, decision_makers, individual_contributors, full_buying_committee, or active_tab"
    }
  );

export type UpdateKnowledgeBaseBuyerFiltersInput = z.infer<
  typeof UpdateKnowledgeBaseBuyerFiltersSchema
>;

function mapBuyerFilterGroup(
  group?: UpdateKnowledgeBaseBuyerFiltersInput["decision_makers"]
) {
  if (!group) {
    return undefined;
  }

  return {
    ...(group.job_titles ? { jobTitle: group.job_titles } : {}),
    ...(group.excluded_job_titles
      ? { excludedJobTitle: group.excluded_job_titles }
      : {}),
    ...(group.seniorities ? { seniorities: group.seniorities } : {}),
    ...(group.locations ? { location: group.locations } : {})
  };
}

function mapCompanyFilterGroup(
  group?: UpdateKnowledgeBaseBuyerFiltersInput["company_filters"]
) {
  if (!group) {
    return undefined;
  }

  return {
    ...(group.company_sizes ? { companySize: group.company_sizes } : {}),
    ...(group.industries ? { industries: group.industries } : {}),
    ...(group.excluded_industries
      ? { excludedIndustries: group.excluded_industries }
      : {}),
    ...(group.hq_locations ? { hqLocation: group.hq_locations } : {}),
    ...(group.is_all_company_size_checked !== undefined
      ? { isAllCompanySizeChecked: group.is_all_company_size_checked }
      : {})
  };
}

export async function handleUpdateKnowledgeBaseBuyerFilters(
  client: LetterboxClient,
  args: UpdateKnowledgeBaseBuyerFiltersInput
): Promise<string> {
  try {
    const data = await client.updateKnowledgeBaseBuyerFilters({
      ...(args.company_filters
        ? { companyFilters: mapCompanyFilterGroup(args.company_filters) }
        : {}),
      ...(args.decision_makers
        ? { decisionMakers: mapBuyerFilterGroup(args.decision_makers) }
        : {}),
      ...(args.individual_contributors
        ? {
            individualContributors: mapBuyerFilterGroup(
              args.individual_contributors
            )
          }
        : {}),
      ...(args.full_buying_committee
        ? {
            fullBuyingCommittee: mapBuyerFilterGroup(args.full_buying_committee)
          }
        : {}),
      ...(args.active_tab ? { activeIndividualFilterTab: args.active_tab } : {})
    });

    return JSON.stringify(
      {
        success: true,
        message: "Knowledge base buyer filters updated successfully.",
        activeTab: data.activeIndividualFilterTab,
        companyFilters: data.companyFilters,
        decisionMakers: data.decisionMakers,
        individualContributors: data.individualContributors,
        fullBuyingCommittee: data.fullBuyingCommittee
      },
      null,
      2
    );
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to update knowledge base buyer filters: ${error.message}`
      );
    }
    throw error;
  }
}

const namedOptionJsonSchema = (valueKey: "value" | "code") => ({
  anyOf: [
    { type: "string" },
    {
      type: "object",
      properties: {
        name: { type: "string" },
        [valueKey]: { type: "string" }
      },
      required: ["name"]
    }
  ]
});

const buyerFilterGroupJsonSchema = (description: string) => ({
  type: "object",
  description,
  properties: {
    job_titles: {
      type: "array",
      description: "Keywords in job title to include",
      items: { type: "string" }
    },
    excluded_job_titles: {
      type: "array",
      description: "Keywords in job title to exclude",
      items: { type: "string" }
    },
    seniorities: {
      type: "array",
      items: namedOptionJsonSchema("value")
    },
    locations: {
      type: "array",
      description: LOCATION_DESCRIPTION,
      items: namedOptionJsonSchema("code")
    }
  }
});

export const updateKnowledgeBaseBuyerFiltersTool = {
  name: "update_knowledge_base_buyer_filters",
  description:
    "Update the knowledge-base buyer filters: company size, industries and HQ locations, plus each tab's keywords in job title, excluded keywords, seniorities and locations (tabs: decision_makers, individual_contributors = End Users, full_buying_committee). Within a group you send, each list you include replaces the stored list and lists you leave out are kept, so to add a keyword, read the current list with get_knowledge_base_buyer_filters and send it back with the addition. These filters drive who outreach and contact-finding workflows target: confirm the exact change with the user before calling.",
  inputSchema: {
    type: "object",
    properties: {
      company_filters: {
        type: "object",
        description: "Company-level knowledge-base filters",
        properties: {
          company_sizes: {
            type: "array",
            description: "Company sizes (employee-count ranges)",
            items: { type: "string", enum: [...KNOWLEDGE_BASE_COMPANY_SIZES] }
          },
          industries: {
            type: "array",
            items: namedOptionJsonSchema("value")
          },
          excluded_industries: {
            type: "array",
            items: namedOptionJsonSchema("value")
          },
          hq_locations: {
            type: "array",
            description: `Company HQ locations. ${LOCATION_DESCRIPTION}`,
            items: namedOptionJsonSchema("code")
          },
          is_all_company_size_checked: {
            type: "boolean"
          }
        }
      },
      decision_makers: buyerFilterGroupJsonSchema("Decision Makers tab"),
      individual_contributors: buyerFilterGroupJsonSchema("End Users tab"),
      full_buying_committee: buyerFilterGroupJsonSchema(
        "Full Buying Committee tab"
      ),
      active_tab: {
        type: "string",
        enum: ["aboveTheLine", "belowTheLine"],
        description: "Which knowledge-base tab should remain active"
      }
    }
  }
};
