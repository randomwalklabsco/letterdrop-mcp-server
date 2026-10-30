/**
 * Letterbox API Client
 * Handles all HTTP communication with the Letterbox backend
 */

import axios, { AxiosInstance, AxiosError } from "axios";
import type {
  LetterboxConfig,
  LetterboxResponse,
  CompetitorMonitoringAccountDetailsResponse,
  CompetitorMonitoringAccountsResponse,
  KnowledgeBaseBuyerFilterGroup,
  KnowledgeBaseBuyerFiltersResponse,
  McpWorkspace
} from "../types/index.js";
import {
  toCompetitorAccountDetailsResponse,
  toCompetitorAccountsResponse,
  toCompetitorApiV2DetailsQuery,
  toCompetitorApiV2SearchBody
} from "./competitor-monitoring-v2.js";

export class LetterboxClient {
  private client: AxiosInstance;

  constructor(config: LetterboxConfig) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (config.accessToken) {
      headers["Authorization"] = `Bearer ${config.accessToken}`;
    } else if (config.apiKey) {
      headers["api-key"] = config.apiKey;
    } else if (process.env.NODE_ENV === "development") {
      headers["api-key"] = process.env.LETTERBOX_API_KEY || "";
    }
    this.client = axios.create({
      baseURL: config.apiUrl,
      headers,
      timeout: 30000 // 30 second timeout
    });
  }

  /**
   * Handle API errors and format them consistently
   */
  private handleError(error: unknown): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<LetterboxResponse>;
      if (axiosError.response?.data?.message) {
        throw new Error(axiosError.response.data.message);
      }
      // API v2 answers errors as { error: { code, message } }.
      const v2Error = (
        axiosError.response?.data as
          | { error?: { code?: string; message?: string } }
          | undefined
      )?.error;
      if (v2Error?.message) {
        const retryAfter = axiosError.response?.headers?.["retry-after"];
        throw new Error(
          axiosError.response?.status === 429 && retryAfter
            ? `${v2Error.message} (Retry-After: ${retryAfter}s)`
            : v2Error.message
        );
      }
      throw new Error(axiosError.message || "Unknown API error");
    }
    throw error;
  }

  /**
   * List the workspaces this connector can see.
   */
  async listWorkspaces(): Promise<McpWorkspace[]> {
    try {
      const response = await this.client.get<
        LetterboxResponse<{ workspaces: McpWorkspace[] }>
      >("/api/v1/social-network/workspaces");
      return response.data.data?.workspaces || [];
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get the account-grouped view of the competitor monitoring table — one row
   * per company, mirroring the in-app table.
   *
   * Reads the published Competitor Monitoring API v2 (cached,
   * rate-limited per workspace) and returns the same payload shape the tools
   * have always returned. Summary and filter options are their own v2
   * endpoints, fetched in parallel only when `include` asks for them.
   */
  async getCompetitorMonitoringAccounts(params: {
    limit?: number;
    offset?: number;
    searchTerm?: string;
    filters?: Record<string, unknown>;
    include?: string[];
    sortField?: string;
    sortOrder?: string;
    maxContactsPerAccount?: number;
    // v2 always reports priority as the dashboard's buckets, which
    // is what "display" asked v1 for. Kept so callers state the contract.
    priorityMode?: "display";
  }): Promise<CompetitorMonitoringAccountsResponse> {
    const include = params.include || [];
    const wantsSummary =
      include.includes("summary") || include.includes("summary_details");
    const wantsFilterOptions = include.includes("filter_options");
    const searchBody = toCompetitorApiV2SearchBody(params);
    try {
      const [search, summary, filterOptions] = await Promise.all([
        this.client.post(
          "/api/v2/competitor-monitoring/accounts/search",
          searchBody
        ),
        wantsSummary
          ? this.client.post("/api/v2/competitor-monitoring/summary", {
              ...(searchBody.filters ? { filters: searchBody.filters } : {}),
              ...(searchBody.search ? { search: searchBody.search } : {}),
              ...(include.includes("summary_details")
                ? { include_details: true }
                : {})
            })
          : null,
        wantsFilterOptions
          ? this.client.get("/api/v2/competitor-monitoring/filter-options")
          : null
      ]);
      if (!search.data?.data) {
        throw new Error("Empty competitor monitoring accounts response");
      }
      return toCompetitorAccountsResponse({
        search: search.data,
        summary: summary?.data || null,
        filterOptions: filterOptions?.data || null,
        limit: Number(searchBody.page_size) || 25,
        offset: params.offset || 0
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get everything known about one company in the competitor monitoring table:
   * CRM outreach, the classified activity timeline, signals, opportunities and
   * the extended buying committee.
   *
   * v2 addresses an account by id; a domain or name is resolved
   * with the v2 lookup first. An unknown company is still `{ found: false }`.
   */
  async getCompetitorMonitoringAccountDetails(params: {
    companyKey?: string;
    companyDomain?: string;
    companyName?: string;
    include?: string[];
    activityLimit?: number;
  }): Promise<CompetitorMonitoringAccountDetailsResponse> {
    const notFound: CompetitorMonitoringAccountDetailsResponse = {
      found: false,
      companyKey: params.companyKey || "",
      companyName: params.companyName || "",
      companyDomain: params.companyDomain || ""
    };
    try {
      let accountId = params.companyKey || "";
      if (!accountId) {
        const lookup = await this.client.get(
          "/api/v2/competitor-monitoring/accounts/lookup",
          {
            params: {
              ...(params.companyDomain
                ? { domain: params.companyDomain }
                : { name: params.companyName }),
              // Only the id is needed here; skip the row's blocks.
              include: ""
            }
          }
        );
        accountId = lookup.data?.data?.account?.account_id || "";
        if (!accountId) return notFound;
      }
      const response = await this.client.get(
        `/api/v2/competitor-monitoring/accounts/${encodeURIComponent(accountId)}/details`,
        {
          params: toCompetitorApiV2DetailsQuery(params)
        }
      );
      if (!response.data?.data) {
        throw new Error("Empty competitor monitoring account details response");
      }
      return toCompetitorAccountDetailsResponse(response.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return notFound;
      }
      this.handleError(error);
    }
  }

  /**
   * Fetch knowledge base decision-maker and individual-contributor filters.
   */
  async getKnowledgeBaseBuyerFilters(): Promise<KnowledgeBaseBuyerFiltersResponse> {
    try {
      const response = await this.client.get<
        LetterboxResponse<KnowledgeBaseBuyerFiltersResponse>
      >("/api/v1/knowledge-base/buyer-filters");
      if (!response.data?.data) {
        throw new Error("Knowledge base buyer filters response is empty");
      }
      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update knowledge base decision-maker and individual-contributor filters.
   */
  async updateKnowledgeBaseBuyerFilters(params: {
    companyFilters?: {
      companySize?: Array<string | { name?: string; value?: string }>;
      industries?: Array<string | { name?: string; value?: string }>;
      excludedIndustries?: Array<string | { name?: string; value?: string }>;
      hqLocation?: Array<string | { name?: string; code?: string }>;
      isAllCompanySizeChecked?: boolean;
    };
    decisionMakers?: KnowledgeBaseBuyerFilterGroup;
    individualContributors?: KnowledgeBaseBuyerFilterGroup;
    activeIndividualFilterTab?: "aboveTheLine" | "belowTheLine";
  }): Promise<KnowledgeBaseBuyerFiltersResponse> {
    try {
      const response = await this.client.put<
        LetterboxResponse<KnowledgeBaseBuyerFiltersResponse>
      >("/api/v1/knowledge-base/buyer-filters", {
        ...(params.companyFilters
          ? { companyFilters: params.companyFilters }
          : {}),
        ...(params.decisionMakers
          ? { decisionMakers: params.decisionMakers }
          : {}),
        ...(params.individualContributors
          ? { individualContributors: params.individualContributors }
          : {}),
        ...(params.activeIndividualFilterTab
          ? { activeIndividualFilterTab: params.activeIndividualFilterTab }
          : {})
      });
      if (!response.data?.data) {
        throw new Error("Knowledge base buyer filters response is empty");
      }
      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }
}
