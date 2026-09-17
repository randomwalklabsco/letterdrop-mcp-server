/**
 * Tool Registry
 * Exports all available MCP tools
 */

import {
  competitorMonitoringTableTool,
  handleCompetitorMonitoringTable,
  CompetitorMonitoringTableSchema
} from "./competitor-monitoring-table.js";
import {
  competitorMonitoringAccountDetailsTool,
  handleCompetitorMonitoringAccountDetails,
  CompetitorMonitoringAccountDetailsSchema
} from "./competitor-monitoring-account-details.js";
import {
  getKnowledgeBaseBuyerFiltersTool,
  handleGetKnowledgeBaseBuyerFilters,
  GetKnowledgeBaseBuyerFiltersSchema
} from "./knowledge-base-buyer-filters-get.js";
import {
  updateKnowledgeBaseBuyerFiltersTool,
  handleUpdateKnowledgeBaseBuyerFilters,
  UpdateKnowledgeBaseBuyerFiltersSchema
} from "./knowledge-base-buyer-filters-update.js";
import {
  listWorkspacesTool,
  handleListWorkspaces,
  ListWorkspacesSchema
} from "./list-workspaces.js";

/**
 * Tools that only read. Two things key off this set: the safety annotations
 * below, and which tools a read-only grant is offered and allowed to call (see
 * ../scope.ts). Anything not listed here is treated as a write, so a new tool is
 * restrictive by default rather than permissive.
 */
export const readOnlyToolNames = new Set<string>([
  "get_competitor_monitoring_table",
  "get_competitor_monitoring_account_details",
  "get_knowledge_base_buyer_filters",
  "list_workspaces"
]);

/**
 * The human-readable name a client shows for each tool. A `title` is required
 * for connector directory listings, so these are written rather than derived.
 */
const toolTitles: Record<string, string> = {
  get_competitor_monitoring_table: "Get Competitor Monitoring Table",
  get_competitor_monitoring_account_details: "Get Competitor Account Details",
  get_knowledge_base_buyer_filters: "Get Buyer Filters",
  update_knowledge_base_buyer_filters: "Update Buyer Filters",
  list_workspaces: "List Workspaces"
};

/**
 * Writes that change or remove something that already exists.
 *
 * `destructiveHint` decides whether a client prompts before every call, so it
 * has to mean what it says.
 */
const destructiveToolNames = new Set<string>([
  // Replaces the stored filters rather than merging into them.
  "update_knowledge_base_buyer_filters"
]);

function withSafetyAnnotations<
  T extends { name: string; annotations?: Record<string, unknown> }
>(
  tool: T
): T & {
  title: string;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
} {
  const title = toolTitles[tool.name];
  if (!title) {
    throw new Error(
      `[mcp-tools] "${tool.name}" has no title. Every tool needs one to be listed in the connectors directory.`
    );
  }

  const readOnly = readOnlyToolNames.has(tool.name);
  if (readOnly && destructiveToolNames.has(tool.name)) {
    throw new Error(
      `[mcp-tools] "${tool.name}" is classified both read-only and destructive.`
    );
  }

  return {
    ...tool,
    title,
    annotations: {
      ...tool.annotations,
      // Twice on purpose. `Tool.title` is the 2025-06-18 field; before that the
      // human-readable name lived on `ToolAnnotations.title`, which is where
      // directory checks look. We negotiate 2024-11-05, so the annotation is
      // the one that has to be there.
      title,
      readOnlyHint: readOnly,
      destructiveHint: destructiveToolNames.has(tool.name)
    }
  };
}

const baseTools = [
  competitorMonitoringTableTool,
  competitorMonitoringAccountDetailsTool,
  getKnowledgeBaseBuyerFiltersTool,
  updateKnowledgeBaseBuyerFiltersTool,
  listWorkspacesTool
];

// Export all tool definitions
export const tools = baseTools.map((tool) => withSafetyAnnotations(tool));

// Export all tool handlers
export const toolHandlers = {
  get_competitor_monitoring_table: handleCompetitorMonitoringTable,
  get_competitor_monitoring_account_details:
    handleCompetitorMonitoringAccountDetails,
  get_knowledge_base_buyer_filters: handleGetKnowledgeBaseBuyerFilters,
  update_knowledge_base_buyer_filters: handleUpdateKnowledgeBaseBuyerFilters,
  list_workspaces: handleListWorkspaces
};

// Export all schemas
export const toolSchemas = {
  get_competitor_monitoring_table: CompetitorMonitoringTableSchema,
  get_competitor_monitoring_account_details:
    CompetitorMonitoringAccountDetailsSchema,
  get_knowledge_base_buyer_filters: GetKnowledgeBaseBuyerFiltersSchema,
  update_knowledge_base_buyer_filters: UpdateKnowledgeBaseBuyerFiltersSchema,
  list_workspaces: ListWorkspacesSchema
};
