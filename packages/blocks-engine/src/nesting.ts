/**
 * Where a block may sit: the CHILD's half of a nesting rule.
 *
 * A block definition's `parent` names the only block types an instance may be a
 * direct child of. That is not the same statement as a slot's `allow`, and
 * neither is derivable from the other — a slot naming a type does not confine
 * that type to it, and a block meaningless outside one container has to say so
 * itself, because no container can speak for a block it has never heard of. So
 * the two rules are checked separately and a placement needs both to agree.
 *
 * This module answers only the child's half, and it is the ONE implementation of
 * it. A canvas deciding whether to accept a drag and a validator deciding
 * whether a stored document is well-formed are asking the same question at
 * different moments; computing it twice means the editor and the validator
 * disagree the first time either is edited, and disagree silently, because a
 * drag that is refused writes nothing to compare against.
 */

/**
 * How a caller answers for a block's declared parents.
 *
 * Deliberately NOT a block registry. Resolving a type to its definition differs
 * per caller — one reads a live registry, another falls back to structure it
 * declares locally for types whose renderer it must not import — and a
 * one-method source lets each supply its own resolution while sharing the rule
 * applied to the result.
 *
 * `undefined` means the block declares no restriction and may sit anywhere. It
 * is NOT "this type is unknown": a source that cannot resolve a type answers
 * `undefined` and the block is permitted, because refusing every unresolvable
 * type would make an unknown block unplaceable rather than merely unstyled. A
 * caller that must reject unknown types checks that separately, which is why
 * this reports on the rule rather than on the lookup.
 */
export interface NestingSource {
  /**
   * The block types this type may be a direct child of, or undefined when it
   * declares no restriction.
   */
  parentsOf(type: string): readonly string[] | undefined;
  /**
   * The block names a parent's named slot admits, or undefined when the slot
   * declares no restriction.
   *
   * The PARENT's half of the nesting rule, and the counterpart to
   * {@link NestingSource.parentsOf} rather than a restatement of it. A slot's
   * allow-list is the container saying what it will hold; `parent` is the child
   * saying where it makes sense. `block.ts` is explicit that neither implies the
   * other, so a document satisfying one can violate the other and only asking
   * both settles a placement.
   *
   * Optional so an existing caller that supplies only `parentsOf` keeps
   * compiling. A source omitting it answers "no restriction" for every slot,
   * which is the behaviour those callers already had — the alternative, treating
   * an absent method as a refusal, would make every placement invalid for a
   * caller that simply predates the field.
   */
  slotAllowOf?(parentType: string, slot: string): readonly string[] | undefined;
}

/**
 * Which rule refused a placement.
 *
 * Two members rather than one, because the two are not the same fact about the
 * document and an author cannot act on them identically. `wrong-parent` names a
 * container the block will not go in, and the remedy is to aim at a different
 * container. `restricted-at-root` is a block that restricts its parents sitting
 * where there is no parent at all, and no container on screen would satisfy it —
 * the remedy is to put it inside something. Collapsing them would have the
 * second answer with a sentence about choosing another container, which is
 * advice that cannot be followed.
 */
export type NestingRefusal =
  | "wrong-parent"
  | "restricted-at-root"
  | "not-allowed-in-slot";

/**
 * A refusal carries its reason by construction.
 *
 * Two members rather than one shape with an optional field: an optional `reason`
 * makes `{ allowed: false }` type-check on its own, so a refusal with nothing to
 * say about itself becomes expressible and every caller wanting the reason has
 * to handle an absence no code path produces.
 *
 * The reason travels because the caller is the only place it is still known. A
 * canvas has to tell an author WHICH rule stopped a drop, and a boolean throws
 * that away at exactly the point where recovering it means classifying the
 * placement a second time.
 */
export type NestingVerdict =
  | { allowed: true; reason?: undefined; permitted?: undefined }
  | {
      allowed: false;
      reason: NestingRefusal;
      /**
       * The restriction that produced this refusal, carried rather than left to
       * be looked up again.
       *
       * A caller explaining the refusal needs the permitted set, and asking the
       * source a second time is a second answer: `NestingSource` is
       * caller-supplied and nothing requires it to be idempotent, so a stateful
       * or lazily-resolved one can name a different set from the one that
       * actually decided the verdict. Non-empty by construction, because an
       * empty restriction is what `restrictionFor` reads as no restriction at
       * all and no refusal can come from it.
       */
      permitted: readonly string[];
    };

const ALLOWED: NestingVerdict = { allowed: true };

/**
 * The declared restriction, or undefined when there is none to apply.
 *
 * An empty array is treated as no restriction rather than as "nowhere". Block
 * registration already refuses an empty `parent`, so reaching here with one
 * means the definition bypassed registration — and reading it literally would
 * make every placement of that block fail with a rule the author cannot satisfy
 * from any position. The source is also caller-supplied and may hand back
 * anything, so the array shape is checked rather than trusted.
 */
function restrictionFor(
  type: string,
  source: NestingSource
): readonly string[] | undefined {
  const declared = source.parentsOf(type);
  if (!Array.isArray(declared) || declared.length === 0) return undefined;
  return declared;
}

/**
 * Whether `childType` may sit as a DIRECT child of `parentType`.
 *
 * Direct is the whole rule: `parent` restricts the immediate container, so a
 * block permitted under `core/columns` is not permitted two levels beneath one.
 */
export function canNest(
  childType: string,
  parentType: string,
  source: NestingSource
): NestingVerdict {
  const parents = restrictionFor(childType, source);
  if (parents === undefined) return ALLOWED;
  if (parents.includes(parentType)) return ALLOWED;
  return { allowed: false, reason: "wrong-parent", permitted: parents };
}

/**
 * Whether a parent's named SLOT admits `childType`.
 *
 * The parent's half of the rule. `canNest` asks the child where it belongs;
 * this asks the container what it holds, and a placement needs both — a slot
 * naming a type does not confine that type to it, and a child that restricts
 * its parents says nothing about which of that parent's slots may hold it.
 *
 * An entry ending `/*` matches a namespace, so `core/*` admits every core
 * block. The wildcard binds to the `/`, which is what stops `core/*` admitting
 * `coreevil/banner` — a prefix test without the separator would, and the
 * failure is silent because the name looks close enough to read past.
 */
export function canNestInSlot(
  childType: string,
  parentType: string,
  slot: string,
  source: NestingSource
): NestingVerdict {
  const allow = source.slotAllowOf?.(parentType, slot);
  // Absent OR empty is no restriction, matching `restrictionFor`. An empty
  // array reaching here as a refusal would make a slot declared `allow: []`
  // admit nothing at all, which is a slot no document can fill rather than one
  // that accepts anything — and registration does not reject it.
  if (!Array.isArray(allow) || allow.length === 0) return ALLOWED;
  const admitted = allow.some(entry =>
    entry.endsWith("/*")
      ? childType.startsWith(entry.slice(0, -1))
      : entry === childType
  );
  if (admitted) return ALLOWED;
  return { allowed: false, reason: "not-allowed-in-slot", permitted: allow };
}

/**
 * Whether `childType` may sit at the top level of a document.
 *
 * A separate function rather than `canNest(child, undefined, source)`. The two
 * are different questions, and a nullable parent parameter answers the root
 * question for any caller whose parent variable is accidentally undefined —
 * turning a lookup that failed into a confident verdict about a position the
 * node is not in.
 *
 * A block that restricts its parents has none here, which is a refusal rather
 * than a rule that does not apply: top level is a position, not an exemption
 * from being positioned.
 */
export function canBeRoot(
  childType: string,
  source: NestingSource
): NestingVerdict {
  const parents = restrictionFor(childType, source);
  if (parents === undefined) return ALLOWED;
  return { allowed: false, reason: "restricted-at-root", permitted: parents };
}

/**
 * Where a placement is being judged: the document's roots, or a named slot.
 *
 * The root case is NOT a special case of the slot case — one asks whether a
 * block may stand alone, the other asks two questions about a container — so
 * the target says which to ask rather than passing an optional parent that
 * means both. An optional parent turns a lookup that failed into a confident
 * verdict about the root.
 */
export type PlacementTarget =
  | { readonly kind: "root" }
  | {
      readonly kind: "slot";
      readonly parentType: string;
      readonly slot: string;
    };

/**
 * Whether every one of these block types may sit at a target.
 *
 * **The one implementation of that question, for every caller and every
 * destination.** A planner asks it of a pattern's roots before it plans, a
 * palette asks it of a row before offering it, and a canvas asks it of a block
 * being dropped. Asking it more than one way is how a palette comes to offer a
 * placement the insert refuses — the author is handed something, clicks it, and
 * is told no.
 *
 * TYPES rather than nodes, because the three callers hold different things: a
 * planner has a forest, a palette has a catalogue row, a drag has a name. The
 * rule only ever reads the type, so taking the narrowest input is what lets all
 * three reach the same implementation instead of two of them wrapping it.
 *
 * The FIRST refusal is the answer, and its reason travels: a verdict naming one
 * restriction and the set that produced it tells an author where the thing they
 * picked can go, where a summary of three refusals names none of them.
 *
 * An empty list is allowed. Nothing is being placed, so nothing can refuse it —
 * and a caller that has nothing to place has a different question to ask.
 */
export function placementVerdict(
  types: readonly string[],
  where: PlacementTarget,
  nesting: NestingSource
): NestingVerdict {
  for (const type of types) {
    const verdict =
      where.kind === "root"
        ? canBeRoot(type, nesting)
        : bothHalves(type, where.parentType, where.slot, nesting);
    if (!verdict.allowed) return verdict;
  }
  return ALLOWED;
}

/**
 * Both halves of the nesting rule, in the order that reports the more
 * actionable refusal first.
 *
 * The child naming its permitted parents is the sharper answer — it names
 * somewhere the block CAN go — where a slot's allow-list only says this one
 * will not have it. Both are asked because a placement needs both to agree and
 * neither is derivable from the other.
 */
function bothHalves(
  childType: string,
  parentType: string,
  slot: string,
  nesting: NestingSource
): NestingVerdict {
  const child = canNest(childType, parentType, nesting);
  return child.allowed
    ? canNestInSlot(childType, parentType, slot, nesting)
    : child;
}
