/**
 * A site's own robots.txt lines as the SEO settings store them: the box's
 * text, and the person's confirmation that its rules may block pages the
 * sitemap lists, tied to the exact text and the exact pages it confirmed.
 *
 * Parsed with zod where the value is written (the Single's validation) and
 * again where it is read (robots.txt and the problem list), so a value edited
 * past the screen, such as one that keeps every crawler away from the whole
 * site, is never served.
 *
 * @module settings/robots-rules-stored
 */
import { z } from "zod";

import { MAX_OWN_RULE_LINES, readOwnRules } from "./robots-rules";

/** The longest box: every line at its longest. */
const MAX_TEXT = MAX_OWN_RULE_LINES * 501;

/** The own rules as stored. */
export interface StoredRobotsRules {
  text: string;
  /**
   * The rules' text and the blocked pages' key (`blockedPagesKey`) as they
   * stood when the person confirmed blocking those pages.
   */
  confirmed?: { text: string; pages: string };
}

const storedRobotsRules: z.ZodType<StoredRobotsRules> = z
  .object({
    text: z.string().max(MAX_TEXT),
    confirmed: z
      .object({ text: z.string().max(MAX_TEXT), pages: z.string().max(64) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const refusal = readOwnRules(value.text).findings.find(
      finding => finding.level === "refused"
    );
    if (refusal !== undefined) {
      context.addIssue({ code: "custom", message: refusal.message });
    }
  });

/** Why a stored set of own rules is not one; null when it is. */
export function robotsRulesProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed = storedRobotsRules.safeParse(value);
  return parsed.success
    ? null
    : (parsed.error.issues[0]?.message ?? "These rules can't be saved.");
}

/**
 * The stored own rules where they pass their rule; undefined where none
 * are stored, and the reason where they fail it, so they are never served.
 */
export function storedRobotsRulesOf(value: unknown): {
  rules?: StoredRobotsRules;
  problem?: string;
} {
  if (value === null || value === undefined) return {};
  const parsed = storedRobotsRules.safeParse(value);
  return parsed.success
    ? { rules: parsed.data }
    : {
        problem:
          parsed.error.issues[0]?.message ?? "These rules can't be served.",
      };
}

/**
 * A short key for a set of blocked page paths, whatever their order: what a
 * confirmation is tied to, so a rule that comes to block other pages asks
 * again. FNV-1a over the sorted paths; it identifies, it protects nothing.
 */
export function blockedPagesKey(paths: readonly string[]): string {
  const unique = [...new Set(paths)].sort();
  let hash = 0x811c9dc5;
  for (const char of unique.join("\n")) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${unique.length}:${hash.toString(16)}`;
}
