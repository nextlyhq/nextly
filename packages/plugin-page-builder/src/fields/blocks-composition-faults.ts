/**
 * How composition faults are found, reported and compared: the field's
 * issue report, the faults a composed tree has against the site's nesting
 * rules, and the fault identities that the stored forms and a component's
 * hosts are measured by.
 *
 * Part of the blocks field's composition checks. `blocks-composition.ts` is
 * the entry, and its header explains the rules.
 *
 * @module fields/blocks-composition-faults
 */
import {
  compositionFaults,
  registryBlockSource,
  registryNestingSource,
  type BlockDocument,
  type ComponentLookup,
  type CompositionFault,
} from "@nextlyhq/blocks-engine";

import type { HeldLibrary } from "../composition-reading";

import type { Issue, CompositionSetup } from "./blocks-composition-setup";

/** Issues addressed to the field, each said once. */
export function issueReport(path: string): {
  issues: Issue[];
  add(code: string, message: string): void;
} {
  const seen = new Set<string>();
  const issues: Issue[] = [];
  return {
    issues,
    add(code: string, message: string): void {
      // The forms a publish judges usually agree; one defect is one issue.
      const key = `${code}\u0000${message}`;
      if (seen.has(key)) return;
      seen.add(key);
      issues.push({ path, code, message });
    },
  };
}

export type Report = ReturnType<typeof issueReport>;

/** A held library as the engine's component lookup. */
export function lookupOf(library: HeldLibrary): ComponentLookup {
  return {
    has: id => library.held.has(id),
    get: id => library.held.get(id) as BlockDocument | undefined,
  };
}

/** The composition faults, against the site's own nesting rules. */
export function faultsIn(
  host: BlockDocument,
  composition: Parameters<typeof compositionFaults>[1],
  setup: CompositionSetup,
  measuredAgainst: {
    baselines?: readonly unknown[];
    storedCompositions?: readonly unknown[];
    storedHosts?: readonly unknown[];
    components?: ComponentLookup;
  } = {}
): readonly CompositionFault[] {
  return compositionFaults(host, composition, {
    ...measuredAgainst,
    limits: setup.limits,
    // Read through to the live registry, as the field's own nesting rule is.
    nesting: registryNestingSource(),
    // The locks the blocks' slots declare hold in the composed page too: a
    // placement's values and slot content land inside the component's nodes,
    // which neither document shows on its own.
    definitions: registryBlockSource(),
  });
}

/** What one host is broken by: a composition fault, or a loop it now closes. */
export interface HostFault {
  readonly code: string;
  readonly instanceId: string;
  readonly message: string;
  /** A placement break's identity, so two of one code are told apart. */
  readonly signature?: string;
}

/**
 * A fault as the before/after comparison knows it: its rule and placement,
 * and, for a lock, the slot and what changed, which its message names. Two
 * locked slots broken at one placement are two faults, so a save that breaks a
 * second is not taken for one leaving the first as it was.
 */
export function faultIdentity(fault: HostFault): string {
  const base = `${fault.code}\u0000${fault.instanceId}`;
  if (LOCK_FAULTS.has(fault.code)) return `${base}\u0000${fault.message}`;
  // A placement break is told apart by where it is, so a new one of the same
  // code under the same placement is not counted as the old one.
  return fault.signature === undefined
    ? base
    : `${base}\u0000${fault.signature}`;
}

/** How many faults of each identity a composition holds. */
export function faultCounts(faults: readonly HostFault[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const fault of faults) {
    const identity = faultIdentity(fault);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return counts;
}

/** The placement rule's faults, measured against the stored forms alone. */
export const PLACEMENT_FAULTS: ReadonlySet<string> = new Set([
  "wrong-parent",
  "not-allowed-in-slot",
  "restricted-at-root",
  "undeclared-slot",
  "holds-no-blocks",
  "phrasing-only",
  "content-model",
]);

/** The faults that are a lock broken in the composed host. */
export const LOCK_FAULTS: ReadonlySet<string> = new Set([
  "locked-slot-altered",
  "locked-slot-content-only",
]);
