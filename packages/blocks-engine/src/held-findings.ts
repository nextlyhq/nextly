/**
 * Which save-time findings a stored form already held.
 *
 * A problem the stored document already had on the same block is a warning
 * rather than an error: a page stored before a field was removed or hidden
 * must not become unsavable for a change nobody made to it. Lists and
 * visibility conditions both judge this way, so the rule lives once.
 *
 * @module held-findings
 */
import { isPlainRecord } from "./plain-record";

/** A finding as both judgements write one. */
interface HeldFinding {
  readonly path: string;
  readonly nodeId: string;
  readonly code: string;
  readonly message: string;
  /**
   * What the problem is about, apart from where it sits or how its message
   * reads, when a message carries a place that can change without the
   * problem changing; the message stands in when absent.
   */
  readonly identity?: string;
}

/** What makes two findings the same problem on the same block. */
function signature(finding: HeldFinding): string {
  return `${finding.nodeId}\u0000${finding.code}\u0000${finding.identity ?? finding.message}`;
}

/**
 * How many times each problem appears in the stored forms: the most any one
 * form holds, since the published and the draft forms are the same page.
 */
function heldCounts<Finding extends HeldFinding>(
  stored: readonly unknown[] | undefined,
  walk: (nodes: readonly unknown[]) => readonly Finding[]
): Map<string, number> {
  const held = new Map<string, number>();
  for (const form of stored ?? []) {
    if (!isPlainRecord(form) || !Array.isArray(form.nodes)) continue;
    const counts = new Map<string, number>();
    for (const finding of walk(form.nodes)) {
      const key = signature(finding);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      held.set(key, Math.max(held.get(key) ?? 0, count));
    }
  }
  return held;
}

/**
 * Each finding with its severity: a warning when a stored form held the same
 * problem on the same block, else an error. `walk` finds the problems of a
 * forest, and is asked of each stored form's nodes.
 *
 * Each stored problem holds one current problem only, so a second copy of a
 * held problem added beside it is a new problem and an error.
 */
export function withHeldSeverity<Finding extends HeldFinding>(
  findings: readonly Finding[],
  stored: readonly unknown[] | undefined,
  walk: (nodes: readonly unknown[]) => readonly Finding[]
): (Pick<Finding, keyof HeldFinding> & {
  readonly severity: "error" | "warning";
})[] {
  if (findings.length === 0) return [];
  const held = heldCounts(stored, walk);
  return findings.map(finding => {
    const key = signature(finding);
    const left = held.get(key) ?? 0;
    if (left > 0) held.set(key, left - 1);
    return {
      path: finding.path,
      nodeId: finding.nodeId,
      code: finding.code,
      message: finding.message,
      severity: left > 0 ? "warning" : "error",
    };
  });
}
