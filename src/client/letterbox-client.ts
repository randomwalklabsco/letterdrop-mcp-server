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
   */
  async getCompetitorMonitoringAccounts(params: {
    limit?: number;
    offset?: number;
    searchTerm?: string;
    filters?: Record<string, unknown>;
    include?: string[];
    sortField?: string;
    sortOrder?: string;
    startDate?: string;
    endDate?: string;
    maxContactsPerAccount?: number;
  }): Promise<CompetitorMonitoringAccountsResponse> {
    try {
      const response = await this.client.post<
        LetterboxResponse<CompetitorMonitoringAccountsResponse>
      >("/api/v1/social-network/competitor-monitoring-accounts", {
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.offset !== undefined ? { offset: params.offset } : {}),
        ...(params.searchTerm ? { searchTerm: params.searchTerm } : {}),
        ...(params.filters ? { filters: params.filters } : {}),
        ...(params.include ? { include: params.include } : {}),
        ...(params.sortField ? { sortField: params.sortField } : {}),
        ...(params.sortOrder ? { sortOrder: params.sortOrder } : {}),
        ...(params.startDate ? { startDate: params.startDate } : {}),
        ...(params.endDate ? { endDate: params.endDate } : {}),
        ...(params.maxContactsPerAccount !== undefined
          ? { maxContactsPerAccount: params.maxContactsPerAccount }
          : {})
      });
      if (!response.data?.data) {
        throw new Error("Empty competitor monitoring accounts response");
      }
      return response.data.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get everything known about one company in the competitor monitoring table:
   * CRM outreach, the classified activity timeline, signals, opportunities and
   * the extended buying committee.
   */
  async getCompetitorMonitoringAccountDetails(params: {
    companyKey?: string;
    companyDomain?: string;
    companyName?: string;
    include?: string[];
    activityLimit?: number;
  }): Promise<CompetitorMonitoringAccountDetailsResponse> {
    try {
      const response = await this.client.post<
        LetterboxResponse<CompetitorMonitoringAccountDetailsResponse>
      >("/api/v1/social-network/competitor-monitoring-account-details", {
        ...(params.companyKey ? { companyKey: params.companyKey } : {}),
        ...(params.companyDomain
          ? { companyDomain: params.companyDomain }
          : {}),
        ...(params.companyName ? { companyName: params.companyName } : {}),
        ...(params.include ? { include: params.include } : {}),
        ...(params.activityLimit !== undefined
          ? { activityLimit: params.activityLimit }
          : {})
      });
      if (!response.data?.data) {
        throw new Error("Empty competitor monitoring account details response");
      }
      return response.data.data;
    } catch (error) {
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
