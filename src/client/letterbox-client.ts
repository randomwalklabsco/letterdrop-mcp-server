/**
 * Letterbox API Client
 * Handles all HTTP communication with the Letterbox backend
 */

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from "axios";
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
  toCompetitorAnalyticsQuery,
  toCompetitorDetailReads,
  toQueryString
} from "./competitor-monitoring-v2.js";

// The analytics metrics for one filter set share one cached computation on
// letterbox, so the first is read alone and the rest a few at a time: all of
// them at once would race the computation and burst the per-second limit.
const METRIC_READ_CONCURRENCY = 4;

// The competitor reads cost per workspace, not per page, and a cold read of a
// large workspace outlasts the 30s default. This service runs with Cloud Run
// `--timeout 300` (cloudbuild.yaml); sitting just under it surfaces an overrun
// as this client's error rather than an opaque 504.
export const COMPETITOR_MONITORING_TIMEOUT_MS = 290_000;

// API v2 answers a spent budget with 429 + Retry-After. One account details
// call fans out to several v2 reads, so a burst can trip the workspace's
// per-minute compute budget part-way through; a short wait is retried once
// instead of failing the whole tool call. A longer wait still surfaces as the
// error, with its Retry-After.
export const API_V2_RATE_LIMIT_MAX_RETRY_SECONDS = 30;

/** Seconds to wait before retrying a v2 429 once, or null to not retry. */
export function toApiV2RetryDelaySeconds(error: unknown): number | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 429) return null;
  const config = error.config as (InternalAxiosRequestConfig & { apiV2Retried?: boolean }) | undefined;
  if (!config || config.apiV2Retried || !String(config.url || "").startsWith("/api/v2/")) {
    return null;
  }
  const retryAfterSeconds = Number(error.response?.headers?.["retry-after"]);
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) return null;
  return retryAfterSeconds <= API_V2_RATE_LIMIT_MAX_RETRY_SECONDS ? retryAfterSeconds : null;
}

/** API v2's 404 for a company that is not in the workspace's table. */
export function isAccountNotFoundError(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 404) return false;
  const data = error.response.data as { error?: { code?: string } } | undefined;
  return data?.error?.code === "account_not_found";
}

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
    this.client.interceptors.response.use(undefined, async (error: unknown) => {
      const retryDelaySeconds = toApiV2RetryDelaySeconds(error);
      if (retryDelaySeconds === null || !axios.isAxiosError(error) || !error.config) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelaySeconds * 1000));
      return this.client.request({ ...error.config, apiV2Retried: true } as InternalAxiosRequestConfig);
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
    // The period the summary metrics cover, YYYY-MM-DD; see
    // toCompetitorAnalyticsPeriod for what fills in a missing one.
    summaryStartDate?: string;
    summaryEndDate?: string;
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
    const timeout = COMPETITOR_MONITORING_TIMEOUT_MS;
    const pageSize = Number(
      accountsQuery.find(([name]) => name === "page_size")?.[1] || 25
    );
    try {
      const [accounts, metrics, filterOptions] = await Promise.all([
        this.client.get(`/api/v2/accounts?${toQueryString(accountsQuery)}`, { timeout }),
        wantsSummary ? this.readCompetitorMetrics(params) : null,
        wantsFilterOptions || wantsCustomColumns
          ? this.client.get("/api/v2/fields", { params: { object: "account" }, timeout })
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

  /** Every /api/v2/analytics metric for one filter set and period, keyed by metric. */
  private async readCompetitorMetrics(params: {
    searchTerm?: string;
    summaryStartDate?: string;
    summaryEndDate?: string;
    filters?: Record<string, unknown>;
  }): Promise<Record<string, { data?: Record<string, unknown> } | null>> {
    const filterQuery = toQueryString(toCompetitorAnalyticsQuery(params));
    const read = async (metric: string) => {
      const response = await this.client.get(
        `/api/v2/analytics/${metric}${filterQuery ? `?${filterQuery}` : ""}`,
        { timeout: COMPETITOR_MONITORING_TIMEOUT_MS }
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
    const timeout = COMPETITOR_MONITORING_TIMEOUT_MS;
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
          },
          timeout
        });
        accountId = account.data?.data?.account?.account_id || "";
        if (!accountId) return notFound;
      }
      const path = `/api/v2/accounts/${encodeURIComponent(accountId)}`;
      const [accountResponse, outreach, opportunities, buyingCommittee, jobPostings] =
        await Promise.all([
          account || this.client.get(path, { params: accountQuery, timeout }),
          reads.outreach
            ? this.client.get(`${path}/outreach`, {
                params: {
                  include: "contact_info",
                  ...(params.activityLimit !== undefined
                    ? { activity_limit: params.activityLimit }
                    : {})
                },
                timeout
              })
            : null,
          reads.opportunities ? this.client.get(`${path}/opportunities`, { timeout }) : null,
          // Committee contacts have always carried enriched email / phone here.
          reads.buyingCommittee
            ? this.client.get(`${path}/buying-committee`, {
                params: { include: "contact_info" },
                timeout
              })
            : null,
          reads.jobPostings ? this.client.get(`${path}/job-postings`, { timeout }) : null
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
      // Only the account's own 404: the router's not_found (an unknown route,
      // or /api/v2 not deployed yet) must not read as "not in the table".
      if (isAccountNotFoundError(error)) {
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
