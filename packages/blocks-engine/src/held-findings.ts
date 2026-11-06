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
}

/** What makes two findings the same problem on the same block. */
function signature(finding: HeldFinding): string {
  return `${finding.nodeId}\u0000${finding.code}\u0000${finding.message}`;
}

/**
 * Each finding with its severity: a warning when a stored form held the same
 * problem on the same block, else an error. `walk` finds the problems of a
 * forest, and is asked of each stored form's nodes.
 */
export function withHeldSeverity<Finding extends HeldFinding>(
  findings: readonly Finding[],
  stored: readonly unknown[] | undefined,
  walk: (nodes: readonly unknown[]) => readonly Finding[]
): (Pick<Finding, keyof HeldFinding> & {
  readonly severity: "error" | "warning";
})[] {
  if (findings.length === 0) return [];
  const held = new Set(
    (stored ?? []).flatMap(form =>
      isPlainRecord(form) && Array.isArray(form.nodes)
        ? walk(form.nodes).map(signature)
        : []
    )
  );
  return findings.map(finding => ({
    path: finding.path,
    nodeId: finding.nodeId,
    code: finding.code,
    message: finding.message,
    severity: held.has(signature(finding)) ? "warning" : "error",
  }));
}
