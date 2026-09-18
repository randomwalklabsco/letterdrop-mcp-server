/**
 * Common types for Letterdrop MCP Server
 */

export interface LetterboxConfig {
  apiUrl: string;
  /** @deprecated Use accessToken (OAuth Bearer) from client header instead */
  apiKey?: string;
  /** MCP OAuth access token from client Authorization header; forwarded to Letterbox API */
  accessToken?: string;
}

export interface KnowledgeBaseBuyerFilterGroup {
  jobTitle?: string[];
  excludedJobTitle?: string[];
  seniorities?: Array<string | { name?: string; value?: string }>;
  location?: Array<string | { name?: string; code?: string }>;
  [key: string]: unknown;
}

export interface KnowledgeBaseCompanyFilterGroup {
  companySize?: Array<string | { name?: string; value?: string }>;
  industries?: Array<string | { name?: string; value?: string }>;
  excludedIndustries?: Array<string | { name?: string; value?: string }>;
  hqLocation?: Array<string | { name?: string; code?: string }>;
  isAllCompanySizeChecked?: boolean;
  [key: string]: unknown;
}

export interface KnowledgeBaseBuyerFiltersResponse {
  companyFilters: KnowledgeBaseCompanyFilterGroup;
  decisionMakers: KnowledgeBaseBuyerFilterGroup;
  individualContributors: KnowledgeBaseBuyerFilterGroup;
  activeIndividualFilterTab: "aboveTheLine" | "belowTheLine" | string;
  buyerFilters?: Record<string, unknown>;
}

export interface CompetitorContactedByOwner {
  name?: string;
  email?: string;
}

export interface CompetitorCustomColumn {
  crmType?: string;
  objectType?: string;
  name?: string;
  label?: string;
  fieldType?: string;
  [key: string]: unknown;
}

export interface CompetitorEngagedWith {
  name?: string;
  jobTitle?: string;
  companyName?: string;
  type?: string;
  engagementType?: string;
  direction?: string;
  vanityName?: string;
  profileUrl?: string;
  postUrl?: string;
  postContent?: string;
  postAuthorProfileUrl?: string;
  reactionType?: string;
  commentary?: string;
  [key: string]: unknown;
}

export interface CompetitorRecommendedChannels {
  socialNetwork?: boolean;
  email?: boolean;
  call?: boolean;
  /** Upstream wire keys are folded onto `socialNetwork` before publication. */
  [channel: string]: boolean | undefined;
}

export interface CompetitorMonitoringAccountContact {
  vanityName?: string;
  name?: string;
  profileUrl?: string;
  jobTitle?: string;
  companyName?: string;
  companyDomain?: string;
  /** Suggested outbound channel or channel combination for this person. */
  recommendedAction?: string;
  /** Channel flags derived from recommendedAction; `email` is not an email address. */
  recommendedChannels?: CompetitorRecommendedChannels;
  engagedWith?: CompetitorEngagedWith;
  competitors?: string[];
  /** Always "Engaged Contact" here: this person produced the signal. */
  contactType?: string;
  /** Always true in `contacts`; false only on buyingCommittee entries. */
  hasOwnSignal?: boolean;
  connectedWithDate?: string;
  firstEngaged?: string | null;
  lastEngaged?: string | null;
  lastActivity?: string;
  isHistoricInitialConnection?: boolean;
  /** Seniority classification of this person, NOT membership of buyingCommittee[]. */
  buyingCommitteeRole?: string;
  contacted?: boolean;
  replied?: boolean;
  contactedByOwner?: CompetitorContactedByOwner;
  engagements?: Array<Record<string, unknown>>;
  image?: string;
  aboutSection?: string;
  currentRoleDescription?: string;
  [key: string]: unknown;
}

export interface CompetitorBuyingCommitteeContact {
  vanityName?: string;
  name?: string;
  profileUrl?: string;
  jobTitle?: string;
  companyName?: string;
  companyDomain?: string;
  /** Suggested outbound channel or channel combination for this person. */
  recommendedAction?: string;
  /** Channel flags derived from recommendedAction; `email` is not an email address. */
  recommendedChannels?: CompetitorRecommendedChannels;
  /** Always "Buying Committee" here; the twin of the export's Contact Type column. */
  contactType?: string;
  /** Always false: this person produced no signal of their own. */
  hasOwnSignal?: boolean;
  /**
   * ACCOUNT context, not this person's behaviour. `competitors` is
   * which competitor surfaced the account and `engagedWith` is the context
   * behind the account's own signals; both are repeated here for
   * convenience and neither is something this person did.
   */
  competitors?: string[];
  engagedWith?: CompetitorEngagedWith;
  accountCompetitorContext?: {
    note?: string;
    competitors?: string[];
    competitorRepEngagedByOthersAtAccount?: CompetitorEngagedWith;
  };
  [key: string]: unknown;
}

export interface CompetitorMonitoringAccount {
  companyKey?: string;
  companyName?: string;
  companyDomain?: string;
  companyLogo?: string;
  companyDescription?: string;
  companySize?: string;
  companyIndustry?: string;
  companyLocation?: string;
  companyLocationCountry?: string;
  competitors?: string[];
  competitorConnectionCount?: number;
  priority?: string;
  priorityScore?: number;
  /** The export's "Stale": the account's signal aged past the
   *  measured sales-cycle window. `priority` keeps its scored value, so read
   *  the two together. Always false for a current customer. */
  isStale?: boolean;
  stage?: string;
  stageLabel?: string;
  subStage?: string;
  activeCycle?: boolean;
  reasoning?: string;
  estimatedRenewalDate?: string | null;
  optimalOutreachDate?: string | null;
  evaluatingVendorsConfirmation?: Record<string, unknown> | null;
  foundAt?: string | null;
  firstEngaged?: string | null;
  lastEngaged?: string | null;
  signalDate?: string | null;
  signalDateApproximate?: boolean;
  lastActivity?: string;
  hasOnlyHistoricInitialConnections?: boolean;
  dealStatus?: string;
  dealStage?: string;
  dealPipeline?: string;
  dealDateCreated?: string | null;
  /** The export's "Our Deal Close Date": the representative
   *  opportunity's expected close date. Null while the CRM has none. */
  dealCloseDate?: string | null;
  dealAmount?: number | null;
  dealOwner?: string;
  dealOwnerEmail?: string;
  latestOpportunityId?: string;
  latestOpportunityIsClosed?: boolean | null;
  opportunityCount?: number;
  accountOwner?: string;
  accountOwnerEmail?: string;
  /** null means the CRM lookup was unavailable, not "net new". */
  existingAccount?: boolean | null;
  isExistingCustomer?: boolean;
  outreachStatus?: string;
  outreachStarted?: boolean;
  hasReply?: boolean;
  crmSummary?: string;
  lastOutreachAt?: string | null;
  lastOutreachBeforeSignalAt?: string | null;
  firstOutreachAfterSignalAt?: string | null;
  meetingBookedAt?: string | null;
  customColumnValues?: Record<string, unknown>;
  customColumnsSyncedConfigAt?: string | null;
  contactCount?: number;
  contacts?: CompetitorMonitoringAccountContact[];
  buyingCommittee?: CompetitorBuyingCommitteeContact[];
  [key: string]: unknown;
}

export interface CompetitorMonitoringAccountsResponse {
  totalRecords: number;
  limit: number;
  offset: number;
  accounts: CompetitorMonitoringAccount[];
  summary?: Record<string, unknown>;
  customColumns?: CompetitorCustomColumn[];
  customColumnsUpdatedAt?: string | null;
  connectedCrmType?: string;
  connectedCrmTypes?: string[];
  availableDealStatuses?: Array<{ status?: string; pipeline?: string }>;
  availableDealOwners?: string[];
  trackedCompetitorDomains?: string[];
  pagination?: {
    hasMore: boolean;
    nextOffset: number | null;
  };
  coverage?: {
    engagedContactsIncluded: boolean;
    buyingCommitteeIncluded: boolean;
    maxContactsPerAccount: number;
  };
}

export interface CompetitorMonitoringAccountDetailsResponse {
  found: boolean;
  companyKey?: string;
  companyName?: string;
  companyDomain?: string;
  crmOutreach?: Record<string, unknown>;
  contactActivity?: Array<Record<string, unknown>>;
  activities?: Array<Record<string, unknown>>;
  activityLimit?: number;
  totalActivities?: number;
  signals?: Array<Record<string, unknown>>;
  opportunities?: Array<Record<string, unknown>>;
  buyingCommittee?: CompetitorBuyingCommitteeContact[];
}

export interface LetterboxResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface LetterboxError {
  success: false;
  message: string;
  error?: string;
}

export interface McpWorkspace {
  publicationId: string;
  name: string | null;
  domain: string | null;
  isActive: boolean;
}

export interface ListWorkspacesResponse {
  workspaces: McpWorkspace[];
}
