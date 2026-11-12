/**
 * Set Active Workspace Tool
 *
 * Switches the workspace every other tool reads, without reconnecting. The API
 * re-checks that the user can still reach the target workspace, on this call
 * and on every call after it.
 */

import { z } from "zod";
import type { LetterboxClient } from "../client/letterbox-client.js";

export const SetActiveWorkspaceSchema = z.object({
  publication_id: z
    .string()
    .min(1)
    .describe(
      "The workspace id to switch to. Get valid ids from list_workspaces."
    )
});

export type SetActiveWorkspaceInput = z.infer<typeof SetActiveWorkspaceSchema>;

export async function handleSetActiveWorkspace(
  client: LetterboxClient,
  args: SetActiveWorkspaceInput
): Promise<string> {
  try {
    const workspace = await client.setActiveWorkspace(args.publication_id);

    if (!workspace) {
      return "Workspace switch did not return a result. Please try again.";
    }

    return `Active workspace switched to ${workspace.name || "the selected workspace"} (id: \`${workspace.publicationId}\`). Subsequent tools will read this workspace.`;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to switch workspace: ${error.message}`);
    }
    throw error;
  }
}

export const setActiveWorkspaceTool = {
  name: "set_active_workspace",
  description:
    "Switch the active workspace so subsequent tools read a different workspace, without reconnecting. Call list_workspaces first to get valid workspace ids. Fails if the user does not have access to the target workspace.",
  inputSchema: {
    type: "object",
    properties: {
      publication_id: {
        type: "string",
        description:
          "The workspace id to switch to. Get valid ids from list_workspaces."
      }
    },
    required: ["publication_id"]
  }
};
