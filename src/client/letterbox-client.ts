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
  COMPETITOR_API_V2_METRICS,
  toCompetitorAccountDetailsResponse,
  toCompetitorAccountsResponse,
  toCompetitorApiV2AccountsQuery,
  toCompetitorApiV2FilterParams,
  toCompetitorDetailReads,
  toQueryString
} from "./competitor-monitoring-v2.js";

// The analytics metrics for one filter set share one cached computation on
// letterbox, so the first is read alone and the rest a few at a time: all of
// them at once would race the computation and burst the per-second limit.
const METRIC_READ_CONCURRENCY = 4;

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
    // v2 always reports priority as the dashboard's buckets which
    // is what "display" asked v1 for. Kept so callers state the contract.
    priorityMode?: "display";
  }): Promise<CompetitorMonitoringAccountsResponse> {
    const include = params.include || [];
    const wantsSummary =
      include.includes("summary") || include.includes("summary_details");
    const wantsFilterOptions = include.includes("filter_options");
    // Column definitions and filter values come from /fields in v2.
    const wantsCustomColumns = include.includes("custom_columns");
    const accountsQuery = toCompetitorApiV2AccountsQuery(params);
    const pageSize = Number(
      accountsQuery.find(([name]) => name === "page_size")?.[1] || 25
    );
    try {
      const [accounts, metrics, filterOptions] = await Promise.all([
        this.client.get(`/api/v2/accounts?${toQueryString(accountsQuery)}`),
        wantsSummary ? this.readCompetitorMetrics(params) : null,
        wantsFilterOptions || wantsCustomColumns
          ? this.client.get("/api/v2/fields", { params: { object: "account" } })
          : null
      ]);
      if (!accounts.data?.data) {
        throw new Error("Empty competitor monitoring accounts response");
      }
      return toCompetitorAccountsResponse({
        accounts: accounts.data,
        metrics,
        filterOptions: filterOptions?.data || null,
        includeCustomColumns: wantsCustomColumns,
        includeFilterOptions: wantsFilterOptions,
        limit: pageSize,
        offset: params.offset || 0
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /** Every /api/v2/analytics metric for one filter set, keyed by metric. */
  private async readCompetitorMetrics(params: {
    searchTerm?: string;
    filters?: Record<string, unknown>;
  }): Promise<Record<string, { data?: Record<string, unknown> } | null>> {
    const filterQuery = toQueryString([
      ...toCompetitorApiV2FilterParams(params.filters),
      ...(params.searchTerm ? ([["search", params.searchTerm]] as Array<[string, string]>) : [])
    ]);
    const read = async (metric: string) => {
      const response = await this.client.get(
        `/api/v2/analytics/${metric}${filterQuery ? `?${filterQuery}` : ""}`
      );
      return [metric, response.data || null] as const;
    };
    const [first, ...rest] = Object.keys(COMPETITOR_API_V2_METRICS);
    const results = [await read(first)];
    for (let index = 0; index < rest.length; index += METRIC_READ_CONCURRENCY) {
      results.push(
        ...(await Promise.all(
          rest.slice(index, index + METRIC_READ_CONCURRENCY).map(read)
        ))
      );
    }
    return Object.fromEntries(results);
  }

  /**
   * Get everything known about one company in the competitor monitoring table:
   * CRM outreach, the classified activity timeline, signals, opportunities and
   * the extended buying committee.
   *
   * v2 addresses an account by id; a domain or name is resolved
   * with the v2 lookup first. Each block is its own v2 read, made only when
   * asked for. An unknown company is still `{ found: false }`.
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
    const reads = toCompetitorDetailReads(params.include);
    // The account itself, with every contact's signals when asked for.
    const accountFields = [
      "company_name",
      "company_domain",
      "crm_account_url",
      ...(reads.signals ? ["contacts.signals"] : [])
    ].join(",");
    const accountQuery = reads.signals
      ? { fields: accountFields, include: "contacts", max_contacts_per_account: 100 }
      : { fields: accountFields, include: "" };
    try {
      let account;
      let accountId = params.companyKey || "";
      if (!accountId) {
        account = await this.client.get("/api/v2/accounts/lookup", {
          params: {
            ...(params.companyDomain
              ? { domain: params.companyDomain }
              : { name: params.companyName }),
            ...accountQuery
          }
        });
        accountId = account.data?.data?.account?.account_id || "";
        if (!accountId) return notFound;
      }
      const path = `/api/v2/accounts/${encodeURIComponent(accountId)}`;
      const [accountResponse, outreach, opportunities, buyingCommittee, jobPostings] =
        await Promise.all([
          account || this.client.get(path, { params: accountQuery }),
          reads.outreach
            ? this.client.get(`${path}/outreach`, {
                params: {
                  include: "contact_info",
                  ...(params.activityLimit !== undefined
                    ? { activity_limit: params.activityLimit }
                    : {})
                }
              })
            : null,
          reads.opportunities ? this.client.get(`${path}/opportunities`) : null,
          // Committee contacts have always carried enriched email / phone here.
          reads.buyingCommittee
            ? this.client.get(`${path}/buying-committee`, {
                params: { include: "contact_info" }
              })
            : null,
          reads.jobPostings ? this.client.get(`${path}/job-postings`) : null
        ]);
      if (!accountResponse.data?.data) {
        throw new Error("Empty competitor monitoring account details response");
      }
      return toCompetitorAccountDetailsResponse({
        account: accountResponse.data,
        outreach: outreach?.data || null,
        opportunities: opportunities?.data || null,
        buyingCommittee: buyingCommittee?.data || null,
        jobPostings: jobPostings?.data || null,
        activityLimit: params.activityLimit
      });
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
