export const LETTERDROP_ORCHESTRATION_PROMPT_NAME =
  "letterdrop_orchestration_playbook";

export const LETTERDROP_ORCHESTRATION_RESOURCE_NAME =
  "letterdrop_orchestration_guide";

export const LETTERDROP_ORCHESTRATION_RESOURCE_URI =
  "letterdrop://guides/orchestration-playbook";

const COMPETITOR_MONITORING_SECTION = `## Competitor monitoring and budgeted outreach

- Use \`get_competitor_monitoring_table\` when the user asks who to contact from competitor signals, what outreach is recommended, or for a table, CSV, spreadsheet, export, or report of those recommendations.
- Keep both \`contacts\` and \`buyingCommittee\` in the response. Each person can carry a \`recommendedAction\` allocated by the workspace's current weekly email, social-network, and call capacity plan.
- Read \`recommendedChannels.socialNetwork\`, \`.email\`, and \`.call\` for machine-readable channel flags. Do not parse the action label when the booleans are available.
- A blank \`recommendedAction\` means the current plan allocated no action to that contact or no current plan is available. Do not invent a recommendation, and do not treat the blank as evidence that the person is unreachable or unqualified.`;

/**
 * The playbook for this server: the competitor monitoring table, the
 * per-account drill-down, the buyer-filter definition behind the buying
 * committee, and the workspace it is all read from.
 *
 * It names only tools this server registers — guidance that points a client at
 * a tool it was never offered is worse than none. A test enforces that.
 */
export const LETTERDROP_ORCHESTRATION_PLAYBOOK = [
  `# Letterdrop Competitor Monitoring Playbook

Use this playbook when answering questions about which accounts are in a competitor's sales cycle, who at those accounts is involved, and what the CRM says about them.

This connector reads. It cannot send messages, connection requests or reactions from a connected account, and it cannot create or run outreach sequences. When a user asks for those, say so plainly and hand back the recommendation instead of attempting it. The one thing it writes is the buyer-filter definition.`,
  `## Core rules

1. Start from the table. \`get_competitor_monitoring_table\` answers almost every question at the account grain; reach for \`get_competitor_monitoring_account_details\` only once you have a company to drill into.
2. Ask only the missing high-impact question. Do not ask for anything a tool call can answer, but do stop to clarify a choice that materially changes the result.
3. Say what is absent. A blank field on these tools usually means a specific thing — no plan allocated, no claim made, no window observed — and inventing a value for it is worse than reporting the blank.`,
  `## Reading the table

- \`include\` decides both the shape and the cost. The default — \`contacts\`, \`custom_columns\`, \`buying_committee\` — is what table, CSV and report questions need. Add \`summary\` for the metric cards above the table, \`summary_details\` for the per-deal and per-meeting rows behind those cards, \`filter_options\` for the values a filter will accept, \`engagements\` for each contact's full engagement history, \`profile_details\` for role text and photos.
- To retrieve the whole table, follow \`pagination.nextOffset\` until \`pagination.hasMore\` is false. Do not guess offsets and do not stop at the first page because it looked complete.
- \`coverage\` reports which contact groups the response actually carries. Check it before concluding that an account has no buying committee.
- Narrow with \`filters\` and \`search_term\` rather than by fetching everything and discarding rows — the filters run server-side, across every page, and your pagination does not.
- \`sort_field\` accepts \`priority\`, \`lastEngaged\` and \`dealDateCreated\`. Any other value is ignored rather than refused, so the result comes back in the default order.
- Call \`filter_options\` before offering a user a filter value you have not seen in the data. It lists the deal statuses, deal owners and tracked competitors this workspace actually has.`,
  `## Drilling into one account

- \`get_competitor_monitoring_account_details\` takes \`company_key\` (from the table, and the most reliable), \`company_domain\`, or \`company_name\`. A company that is not in the table returns \`found: false\` rather than an error.
- Read \`attributionVerdict\` at the top level, never the verdict inside \`crmOutreach.attribution\`. The top-level one is gated for the two cases the product refuses to claim on — an existing customer, and a signal too old to be usable — and the stored one is not.
- A meeting or deal whose attribution label is blank on an account that does have a verdict is gated, not unscored. Do not report it as unattributed.
- \`include\` narrows the response but barely changes the cost: any of \`outreach\`, \`activity\`, \`signals\` or \`opportunities\` runs the same underlying read. Asking for \`buying_committee\` alone is the only cheap call.
- \`activity_limit\` caps the timeline, newest first. \`totalActivities\` always reports the untruncated count, so say when you are looking at a slice.`,
  `## Buyer filters

- \`get_knowledge_base_buyer_filters\` returns the workspace's definition of a buyer: the company filters, the decision-maker titles and the individual-contributor titles. That definition is what decides who appears as a buying-committee member on the table's rows, so read it before explaining why someone is or is not in a committee.
- \`update_knowledge_base_buyer_filters\` rewrites that definition. It is a write and it changes what every future read of the table returns, so confirm the exact titles with the user first and tell them what it will affect.`,
  `## Workspaces

- \`list_workspaces\` names the workspaces this connection can see. The connection is pinned to the one chosen when it was authorized and this connector cannot switch it, so if the user asks about a different workspace, say that reconnecting is what switches it rather than reporting the wrong workspace's numbers.`,
  COMPETITOR_MONITORING_SECTION
].join("\n\n");
