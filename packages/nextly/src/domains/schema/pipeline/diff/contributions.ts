/**
 * The one canonical form of a contributions record.
 *
 * Contributions are written to an app snapshot file and hashed into a plugin
 * module's checksum. Both need them in a fixed order, and two normalisers —
 * one per consumer — would agree until an element kind was added to one and
 * not the other, after which the same contributions would serialise two ways.
 *
 * @module domains/schema/pipeline/diff/contributions
 */
import type { ContributedElements } from "./types";

/** Tables in name order, and each kind's element names sorted. */
export function normalizeContributions(
  contributions: Readonly<Record<string, ContributedElements>>
): Record<string, ContributedElements> {
  const out: Record<string, ContributedElements> = {};
  for (const table of Object.keys(contributions).sort()) {
    const elements = contributions[table];
    out[table] = {
      columns: [...elements.columns].sort(),
      indexes: [...elements.indexes].sort(),
      foreignKeys: [...elements.foreignKeys].sort(),
      checks: [...elements.checks].sort(),
    };
  }
  return out;
}
