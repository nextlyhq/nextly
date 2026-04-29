// F10 PR 5 — pure formatters shared by the notification row + future
// audit-log views. Kept separate so they can be unit-tested without
// pulling React Testing Library's render harness.

import type { JournalScope, JournalSummary } from "@admin/services/journalApi";

/**
 * Render a scope as a human-readable label for the row title.
 *   { kind: "collection", slug: "posts" } → "Posts"
 *   { kind: "single", slug: "site" } → "Site"
 *   { kind: "global" } → "Global"
 *   { kind: "fresh-push" } → "Fresh setup"
 *   null (legacy row) → "Schema"
 *
 * Slug rendering uses Title Case for collection/single because the
 * audience reads them as proper nouns (collection names). Global and
 * fresh-push are typed labels, not slug-driven.
 */
export function formatJournalScope(scope: JournalScope | null): string {
  if (!scope) return "Schema";
  if (scope.kind === "fresh-push") return "Fresh setup";
  if (scope.kind === "global") {
    return scope.slug ? titleCase(scope.slug) : "Global";
  }
  return titleCase(scope.slug);
}

/**
 * Render a summary as a comma-separated phrase suitable for the
 * row's secondary line.
 *   { added: 1, removed: 0, renamed: 0, changed: 0 } → "1 field added"
 *   { added: 0, removed: 0, renamed: 0, changed: 0 } → "no changes"
 *   null → "Schema apply" (generic fallback for legacy rows)
 */
export function formatJournalSummary(summary: JournalSummary | null): string {
  if (!summary) return "Schema apply";
  const parts: string[] = [];
  if (summary.added) {
    parts.push(`${summary.added} ${pluralWord(summary.added, "field")} added`);
  }
  if (summary.renamed) parts.push(`${summary.renamed} renamed`);
  if (summary.changed) parts.push(`${summary.changed} changed`);
  if (summary.removed) parts.push(`${summary.removed} removed`);
  return parts.length > 0 ? parts.join(", ") : "no changes";
}

function pluralWord(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function titleCase(s: string): string {
  if (!s) return s;
  // posts → Posts, blog-posts → Blog posts
  const spaced = s.replace(/[-_]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
