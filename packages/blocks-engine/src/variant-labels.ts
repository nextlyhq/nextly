/**
 * A component's variant names, which must be unique.
 *
 * A picker lists variants by name, so two called "Featured" are one choice
 * drawn twice, and an author cannot tell which one a placement holds. Names
 * are compared trimmed and without case, the way an author reads them.
 *
 * A save that NEWLY creates a clash is refused. A clash the stored definition
 * already holds, from before names had to be unique, is only warned about:
 * refusing it would refuse every unrelated edit to that component until
 * someone renamed a variant they may not know about.
 *
 * @module variant-labels
 */
import { pointer } from "./issue-text";
import { MAX_ENVELOPE_ENTRIES } from "./limits";
import { isPlainRecord } from "./plain-record";
import { boundedOwnKeys, ownEntry } from "./safe-record";
import type { ValidationIssue } from "./validation";

/**
 * A label as names are compared: normalized, trimmed and folded to one case,
 * so "Featured", " featured " and "FEATURED" are one name.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function variantLabelKey(label: string): string {
  return label.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

/**
 * The names two or more variants share, each with the keys holding it, in
 * stored order. Read defensively: a variant that is not a record, or has no
 * usable label, takes no name, and the envelope check reports it.
 */
function sharedNames(variants: unknown): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  if (!isPlainRecord(variants)) return byName;
  for (const key of boundedOwnKeys(variants, MAX_ENVELOPE_ENTRIES) ?? []) {
    const name = nameOf(ownEntry(variants, key));
    if (name !== undefined)
      byName.set(name, [...(byName.get(name) ?? []), key]);
  }
  return new Map([...byName].filter(([, keys]) => keys.length > 1));
}

/** A stored variant's name as compared, or nothing when it has no usable one. */
function nameOf(variant: unknown): string | undefined {
  if (!isPlainRecord(variant) || typeof variant.label !== "string") {
    return undefined;
  }
  const name = variantLabelKey(variant.label);
  return name === "" ? undefined : name;
}

/**
 * One issue per variant whose name an earlier variant already has.
 *
 * An `error` for a clash the save creates, and a `warning` for a variant that
 * already shared that name in a stored form of the definition. Judged per
 * variant, not per name, so a stored clash grandfathers only the variants
 * that were part of it: a third variant given the same name is new. Without
 * stored forms (a create, or a value judged on its own) every clash is new.
 */
export function variantLabelIssues(
  variants: unknown,
  stored: readonly unknown[] | undefined
): ValidationIssue[] {
  const shared = sharedNames(variants);
  if (shared.size === 0) return [];
  const old = storedClashes(stored);

  const issues: ValidationIssue[] = [];
  const record = variants as Record<string, { label: string }>;
  for (const [name, keys] of shared) {
    // Compared with a variant that already held the name where one did, so
    // every newcomer is named as one wherever the save placed it.
    const anchor = keys.find(key => old.has(clashKey(name, key))) ?? keys[0];
    const first = ownEntry(record, anchor)?.label.trim() ?? name;
    for (const key of keys) {
      if (key === anchor) continue;
      const label = ownEntry(record, key)?.label.trim() ?? name;
      issues.push({
        path: pointer(pointer("/variants", key), "label"),
        code: "variant-label-clash",
        severity: old.has(clashKey(name, key)) ? "warning" : "error",
        message: `Variant "${label}" has the same name as variant "${first}". Variant names must differ, ignoring case and spaces.`,
        suggestion: "Rename one of them.",
      });
    }
  }
  return issues;
}

/** Every variant that shared its name with another in a stored form. */
function storedClashes(stored: readonly unknown[] | undefined): Set<string> {
  const old = new Set<string>();
  for (const form of stored ?? []) {
    if (!isPlainRecord(form)) continue;
    for (const [name, keys] of sharedNames(form.variants)) {
      for (const key of keys) old.add(clashKey(name, key));
    }
  }
  return old;
}

/** One variant under one name, as stored clashes are keyed. */
function clashKey(name: string, key: string): string {
  return `${name}\u0000${key}`;
}
