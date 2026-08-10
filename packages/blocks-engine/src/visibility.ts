/**
 * Whether a node's own visibility conditions gate it.
 *
 * ONE definition, because two components ask this question about the same node and their answers
 * have to be the same answer. The renderer asks it to decide whether the node reaches the markup;
 * the style compiler asks it to decide whether the node's rules leave the main sheet. When those
 * disagreed, both directions were reachable and both were bugs:
 *
 * - the compiler gating what the renderer served published a node with its styling silently
 *   missing, and
 * - the compiler NOT gating what the renderer withheld left that node's rules — and any
 *   `url(...)` inside them — in a stylesheet served to everyone, for a block deliberately hidden.
 *
 * The second is the leak gating exists to prevent, so a shape this cannot read must resolve to
 * GATED. That is the same direction the renderer already fails, and it is the one that is
 * recoverable: content missing from a page is visible and reportable, while content shown to the
 * wrong reader cannot be taken back.
 *
 * Read defensively throughout. A document reaches both callers whether or not anything validated
 * it, so every branch below is a shape that can arrive from storage.
 *
 * @module visibility
 */
import type { BlockNode } from "./document";

/**
 * True when a node's entry-field conditions gate it.
 *
 * `devices` is NOT this question and must never be folded into it: per-breakpoint hiding is
 * presentation decided by CSS on a node that is always served, while a condition decides whether
 * the node is served at all. Conflating them would hold back rules a reader always needs.
 *
 * Two shapes are deliberately NOT gates. No groups at all is no restriction, and neither is a
 * group with no predicates: storage is an OR of ANDs, and an AND of nothing is satisfied, so one
 * empty group satisfies the whole OR whatever the other groups hold. That is why the last line
 * tests whether SOME group is empty rather than whether ALL are — `[[], [predicate]]` restricts
 * nobody, exactly as `[[]]` does.
 */
export function isConditionGated(node: BlockNode): boolean {
  const envelope: unknown = node.visibility;
  // No envelope is no gate. This is the ordinary node, and it must stay the cheapest path.
  if (envelope === undefined || envelope === null) return false;
  // The envelope has to be readable before the field inside it means anything. `visibility:
  // "hidden"` and `visibility: ["tier"]` both answer `undefined` to a property read, and reading
  // that as "no gate" is the leak: an author wrote a restriction this cannot parse.
  if (typeof envelope !== "object" || Array.isArray(envelope)) return true;

  const groups: unknown = (envelope as { conditions?: unknown }).conditions;
  if (groups === undefined || groups === null) return false;
  // A malformed value — a flat list of predicates from an older writer, an object, a string — is
  // still an author saying this node is restricted.
  if (!Array.isArray(groups)) return true;
  if (groups.length === 0) return false;
  return !groups.some(group => Array.isArray(group) && group.length === 0);
}
