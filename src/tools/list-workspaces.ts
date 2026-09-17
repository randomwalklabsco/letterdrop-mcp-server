/**
 * List Workspaces Tool
 *
 * Lists every workspace the connected user can see and flags the one this
 * connection is pinned to. The connection cannot switch workspaces; the user
 * reconnects and picks a different workspace to do that.
 */

import { z } from "zod";
import type { LetterboxClient } from "../client/letterbox-client.js";

export const ListWorkspacesSchema = z.object({});

export type ListWorkspacesInput = z.infer<typeof ListWorkspacesSchema>;

export async function handleListWorkspaces(
  client: LetterboxClient,
  _args: ListWorkspacesInput
): Promise<string> {
  try {
    const workspaces = await client.listWorkspaces();

    if (!workspaces?.length) {
      return "No workspaces are available for this connection.";
    }

    const lines = workspaces.map((workspace, index) => {
      const activeMarker = workspace.isActive ? " (active)" : "";
      const domain = workspace.domain ? ` — ${workspace.domain}` : "";
      return `${index + 1}. ${workspace.name || "Untitled workspace"}${domain} (id: \`${workspace.publicationId}\`)${activeMarker}`;
    });

    return `Workspaces you can see:\n\n${lines.join("\n")}\n\nThis connection reads the active workspace. To query a different one, reconnect and choose it during authorization.`;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to list workspaces: ${error.message}`);
    }
    throw error;
  }
}

export const listWorkspacesTool = {
  name: "list_workspaces",
  description:
    "List the workspaces the connected user can see and show which one this connection is reading. The connection cannot switch workspaces; if the user asks about a different workspace, tell them to reconnect and choose it.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};
