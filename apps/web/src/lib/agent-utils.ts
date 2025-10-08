/**
 * Agent utility functions
 */

import type { SearchQueryMeta } from "@/types/agent";

/**
 * Wait until a condition is met or timeout occurs
 * Used for strict mode thinking completion
 */
export async function waitUntil(
  condition: () => boolean,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();

  while (!condition()) {
    if (Date.now() - start >= timeoutMs) {
      return false; // Timeout
    }
    // Poll every 50ms
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return true; // Condition met
}

const QUOTE_PAIRS: Array<{ open: string; close: string }> = [
  { open: "\"", close: "\"" },
  { open: "'", close: "'" },
  { open: "“", close: "”" },
  { open: "‘", close: "’" },
];

/**
 * Normalize a TwelveLabs search query for consistent downstream handling.
 * Trims whitespace, strips a single layer of wrapping quotes, and tracks
 * whether the user intentionally provided quotation marks so summaries can
 * re-introduce them when needed.
 */
export function normalizeSearchQuery(
  raw: string | null | undefined
): SearchQueryMeta {
  const value = typeof raw === "string" ? raw : "";
  const trimmed = value.trim();
  if (trimmed.length <= 1) {
    return {
      raw: trimmed,
      text: trimmed,
      wasQuoted: false,
    };
  }

  for (const pair of QUOTE_PAIRS) {
    if (
      trimmed.startsWith(pair.open) &&
      trimmed.endsWith(pair.close) &&
      trimmed.length >= pair.open.length + pair.close.length
    ) {
      const inner = trimmed.slice(pair.open.length, trimmed.length - pair.close.length).trim();
      return {
        raw: trimmed,
        text: inner,
        wasQuoted: true,
        quoteChars: pair,
      };
    }
  }

  return {
    raw: trimmed,
    text: trimmed,
    wasQuoted: false,
  };
}

/**
 * Format a normalized query for user-facing text, re-applying the user's
 * preferred quotation marks only when they originally supplied them.
 */
export function formatSearchQuery(meta?: SearchQueryMeta | null): string {
  if (!meta) return "";
  const base = meta.text.trim();
  if (!base) return "";
  if (meta.wasQuoted && meta.quoteChars) {
    return `${meta.quoteChars.open}${base}${meta.quoteChars.close}`;
  }
  return base;
}
