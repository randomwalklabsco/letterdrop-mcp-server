import { z } from "zod";
import type { LetterboxClient } from "../client/letterbox-client.js";

export const GetKnowledgeBaseBuyerFiltersSchema = z.object({}).strict();

export type GetKnowledgeBaseBuyerFiltersInput = z.infer<
  typeof GetKnowledgeBaseBuyerFiltersSchema
>;

export async function handleGetKnowledgeBaseBuyerFilters(
  client: LetterboxClient,
  _args: GetKnowledgeBaseBuyerFiltersInput
): Promise<string> {
  try {
    const data = await client.getKnowledgeBaseBuyerFilters();

    return JSON.stringify(
      {
        success: true,
        message: "Knowledge base buyer filters fetched successfully.",
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
        `Failed to fetch knowledge base buyer filters: ${error.message}`
      );
    }
    throw error;
  }
}

export const getKnowledgeBaseBuyerFiltersTool = {
  name: "get_knowledge_base_buyer_filters",
  description:
    "Fetch the current knowledge-base buyer filters for decision makers and individual contributors.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false
  }
};
