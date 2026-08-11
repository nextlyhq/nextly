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

/**
 * Looks up whatever a block declared about drawing nothing.
 *
 * Narrowed to the one member this asks about, so a caller holding richer
 * definitions can pass them without this module knowing what a block is.
 */
export type NoMarkupDefinitionSource = (type: string) =>
  | {
      /** Whether these props guarantee the block draws nothing. */
      rendersNothing?: (props: never) => boolean;
    }
  | undefined;

/**
 * Whether a block says these props make it draw nothing.
 *
 * The second reason a node can be absent from the page, beside a visibility
 * condition, and it lives here for the same reason that one does: the renderer,
 * the style compiler and SEO derivation each ask it about the same node, and a
 * second copy of the rule is a second answer that can drift.
 *
 * The safe direction is the OPPOSITE of {@link isConditionGated}, and the
 * asymmetry is deliberate. A condition an implementation cannot read is an
 * author restricting a node, so an unreadable shape must resolve to gated or a
 * hidden node leaks. Here the block itself is answering a question about its own
 * props, and reading a broken answer as "draws nothing" removes a node that IS
 * on the page from the stylesheet compiled for it, from its SEO contribution,
 * and from anything else derived about it. So anything short of `true` — no
 * declaration, a non-boolean, a throw — counts as drawing.
 */
export function declaresNoMarkup(
  node: BlockNode,
  definitions: NoMarkupDefinitionSource
): boolean {
  let answer: unknown;
  let deferred = false;
  try {
    // The LOOKUP is inside the guard, not just the call. `definitions` is a
    // caller's function and `rendersNothing` is a property read on an object a
    // plugin author wrote, so either can throw — an accessor, a proxy, a getter
    // that assumes a field that is missing. This runs while the page decides its
    // stylesheet, before any block boundary exists to contain a failure, so one
    // malformed definition throwing here would lose the whole page rather than
    // the block that owns it.
    const predicate = definitions(node.type)?.rendersNothing;
    if (typeof predicate !== "function") return false;
    answer = predicate(node.props as never);
    // Read inside the guard: a throwing `then` getter would otherwise escape
    // the containment on its way to being caught.
    deferred =
      typeof (answer as { then?: unknown } | undefined)?.then === "function";
  } catch {
    return false;
  }
  // A block mistakenly declared `async rendersNothing` returns a pending
  // promise, so the `try` above finishes before any rejection happens and its
  // `catch` never sees one. Node reports that as an unhandled rejection and can
  // end the process — the whole page lost because a block was asked about
  // itself.
  if (deferred) {
    void Promise.resolve(answer).catch(() => undefined);
    return false;
  }
  return answer === true;
}
