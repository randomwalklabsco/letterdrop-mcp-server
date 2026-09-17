import { z } from "zod";
import type { LetterboxClient } from "../client/letterbox-client.js";

const NamedOptionSchema = z.object({
  name: z.string().min(1),
  value: z.string().optional(),
  code: z.string().optional()
});

const MixedNamedOptionSchema = z.union([z.string().min(1), NamedOptionSchema]);

const BuyerFilterGroupSchema = z.object({
  job_titles: z
    .array(z.string().min(1))
    .optional()
    .describe("Decision-maker or IC job titles to include"),
  excluded_job_titles: z
    .array(z.string().min(1))
    .optional()
    .describe("Job titles to exclude"),
  seniorities: z
    .array(MixedNamedOptionSchema)
    .optional()
    .describe("Seniority filters as strings or {name, value} objects"),
  locations: z
    .array(MixedNamedOptionSchema)
    .optional()
    .describe("Location filters as country names or {name, code} objects")
});

const CompanyFilterGroupSchema = z.object({
  company_sizes: z
    .array(MixedNamedOptionSchema)
    .optional()
    .describe("Company size filters"),
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
    .describe("HQ location filters"),
  is_all_company_size_checked: z
    .boolean()
    .optional()
    .describe("Whether all company-size options should be selected")
});

export const UpdateKnowledgeBaseBuyerFiltersSchema = z
  .object({
    company_filters: CompanyFilterGroupSchema.optional().describe(
      "Replacement values for company-level filters in knowledge base"
    ),
    decision_makers: BuyerFilterGroupSchema.optional().describe(
      "Replacement values for the knowledge-base decision-maker filters"
    ),
    individual_contributors: BuyerFilterGroupSchema.optional().describe(
      "Replacement values for the knowledge-base individual-contributor filters"
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
        value.active_tab
      ),
    {
      message:
        "Provide at least one of company_filters, decision_makers, individual_contributors, or active_tab"
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
      ...(args.active_tab ? { activeIndividualFilterTab: args.active_tab } : {})
    });

    return JSON.stringify(
      {
        success: true,
        message:
          "Knowledge base decision-maker and IC filters updated successfully.",
        activeTab: data.activeIndividualFilterTab,
        companyFilters: data.companyFilters,
        decisionMakers: data.decisionMakers,
        individualContributors: data.individualContributors
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

export const updateKnowledgeBaseBuyerFiltersTool = {
  name: "update_knowledge_base_buyer_filters",
  description:
    "Update the knowledge-base buyer filters used for decision makers and individual contributors. Use this to edit the default titles, exclusions, seniorities, and locations used across outreach and contact-finding workflows.",
  inputSchema: {
    type: "object",
    properties: {
      company_filters: {
        type: "object",
        description:
          "Replacement values for company-level knowledge-base filters",
        properties: {
          company_sizes: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    value: { type: "string" }
                  },
                  required: ["name"]
                }
              ]
            }
          },
          industries: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    value: { type: "string" }
                  },
                  required: ["name"]
                }
              ]
            }
          },
          excluded_industries: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    value: { type: "string" }
                  },
                  required: ["name"]
                }
              ]
            }
          },
          hq_locations: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    code: { type: "string" }
                  },
                  required: ["name"]
                }
              ]
            }
          },
          is_all_company_size_checked: {
            type: "boolean"
          }
        }
      },
      decision_makers: {
        type: "object",
        description:
          "Replacement values for the decision-maker tab in knowledge base",
        properties: {
          job_titles: {
            type: "array",
            items: { type: "string" }
          },
          excluded_job_titles: {
            type: "array",
            items: { type: "string" }
          },
          seniorities: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    value: { type: "string" }
                  },
                  required: ["name"]
                }
              ]
            }
          },
          locations: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    code: { type: "string" }
                  },
                  required: ["name"]
                }
              ]
            }
          }
        }
      },
      individual_contributors: {
        type: "object",
        description:
          "Replacement values for the individual-contributor tab in knowledge base",
        properties: {
          job_titles: {
            type: "array",
            items: { type: "string" }
          },
          excluded_job_titles: {
            type: "array",
            items: { type: "string" }
          },
          seniorities: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    value: { type: "string" }
                  },
                  required: ["name"]
                }
              ]
            }
          },
          locations: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    code: { type: "string" }
                  },
                  required: ["name"]
                }
              ]
            }
          }
        }
      },
      active_tab: {
        type: "string",
        enum: ["aboveTheLine", "belowTheLine"],
        description: "Which knowledge-base tab should remain active"
      }
    }
  }
};
