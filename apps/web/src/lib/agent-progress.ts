"use client";

import {
  useAgentUIStore,
  type ChatIcon,
  type AgentProgressStatus,
} from "@/stores/agent-ui-store";

export type AgentProgressStatus = "pending" | "complete" | "error";

type MessageEntry = {
  id: string;
  baseText: string;
};

const STATUS_ICON: Record<AgentProgressStatus, ChatIcon> = {
  pending: "badge-check",
  complete: "badge-check",
  error: "message-circle-x",
};

export function formatAgentProgressContent(
  _status: AgentProgressStatus,
  text: string
): string {
  return text;
}

/**
 * Lightweight helper for posting status messages to the agent chat thread.
 * Keeps per-key message IDs so we can flip from pending to complete/error.
 */
export class AgentProgressReporter {
  private readonly entries = new Map<string, MessageEntry>();

  /**
   * Begin tracking a status message.
   * Updating an existing key will reset the base text.
   */
  begin(key: string, text: string): void {
    const store = useAgentUIStore.getState();
    const existing = this.entries.get(key);
    const content = formatAgentProgressContent("pending", text);

    if (existing) {
      this.entries.set(key, { ...existing, baseText: text });
      store.updateMessageById(existing.id, {
        content,
        icon: STATUS_ICON.pending,
        status: "pending",
      });
      return;
    }

    const id = store.addLogMessage(content, STATUS_ICON.pending, "pending");
    this.entries.set(key, { id, baseText: text });
  }

  /**
   * Mark a status as complete. Optionally override the text that will be shown.
   */
  complete(key: string, text?: string): void {
    this.updateStatus(key, "complete", text);
  }

  /**
   * Mark a status as failed with a provided message.
   */
  fail(key: string, text: string): void {
    this.updateStatus(key, "error", text);
  }

  private updateStatus(
    key: string,
    status: Extract<AgentProgressStatus, "complete" | "error">,
    text?: string
  ): void {
    const store = useAgentUIStore.getState();
    const entry = this.entries.get(key);
    if (!entry) {
      // Create entry on the fly if missing so failures still surface
      const fallback = formatAgentProgressContent(
        status,
        text ?? "Status update unavailable."
      );
      const id = store.addLogMessage(fallback, STATUS_ICON[status], status);
      this.entries.set(key, {
        id,
        baseText: text ?? "Status update unavailable.",
      });
      return;
    }

    const finalText = text ?? entry.baseText;
    store.updateMessageById(entry.id, {
      content: formatAgentProgressContent(status, finalText),
      icon: STATUS_ICON[status],
      status,
    });

    // Keep baseText up to date in case we need to re-use it
    this.entries.set(key, { ...entry, baseText: finalText });
  }
}
