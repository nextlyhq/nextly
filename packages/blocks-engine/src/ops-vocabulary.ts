/**
 * The op vocabulary itself: positions, slot addresses, the `BuilderOp` union,
 * the envelope fields an op may set, `OpError`, and how a value is quoted in
 * an error's message. A module of its own so the other parts of ops import it
 * and never each other in a cycle.
 *
 * @module ops-vocabulary
 */
import type { BlockNode, ComponentDocument, DocumentSeo } from "./document";
import { holdsAValue, type NodePatch, type RemovableField } from "./ops-fields";

/**
 * A value rendered for a diagnostic, without ever throwing.
 *
 * `JSON.stringify` is not usable here: a bigint makes it throw, and the branches
 * that need to describe a value are the rejection branches — so building the
 * message about a bad value would itself fail, and the caller would meet a
 * `TypeError` in place of the refusal this module promises.
 */
/**
 * How much of an untrusted value a diagnostic may quote.
 *
 * An op arrives from storage or from an agent, so the values named in these
 * messages are attacker-controlled. Interpolating one whole turns a 5 MB
 * malformed id into a 5 MB `OpError.message` — the memory doubled, and then
 * carried into every log and telemetry sink that records the refusal. The
 * message exists to tell an author which value was wrong, and a hundred
 * characters does that as well as five million.
 */
const MAX_QUOTED_LENGTH = 100;

/**
 * How long a refusal may be, whatever it names.
 *
 * A ceiling on the whole message rather than on each value it quotes. Generous
 * enough that no message this module writes is ever truncated by it — the
 * longest run well under a thousand characters — and low enough that an
 * untrusted value cannot ride out through a site that interpolated it directly.
 */
const MAX_MESSAGE_LENGTH = 2_000;

/**
 * An untrusted string cut to what a message may carry, without quoting it.
 *
 * Separate from {@link describe} so the two places that need a bounded string —
 * a quoted value and a path segment — share one implementation of the cut
 * rather than each carrying its own. A second copy agrees on the day it is
 * written and drifts the moment either limit moves.
 */
export function clipped(value: string): string {
  return value.length > MAX_QUOTED_LENGTH
    ? `${value.slice(0, MAX_QUOTED_LENGTH)}…`
    : value;
}

export function describe(value: unknown): string {
  if (typeof value === "string") {
    return `"${clipped(value)}"`;
  }
  // Numbers included: `BigInt` has no length bound either, and a literal with
  // millions of digits is as long a string as any.
  if (typeof value === "bigint") {
    return `${clipped(String(value))}n`;
  }
  if (typeof value === "object" && value !== null) {
    return Array.isArray(value) ? "an array" : "an object";
  }
  return String(value);
}

/**
 * One edit to the NODE TREE, or to a component's envelope. The four node
 * shapes below are the whole vocabulary for the tree; the fifth, `envelope`,
 * writes only what a component offers its placements (`exposed`, `slots`,
 * `variants`), and deliberately nothing else of the document.
 *
 * `BlockDocument.settings` — page-scoped styles, `customCss` — has no op here:
 * `update` addresses a node by id and `NodePatch` is read off `updateNode`'s
 * signature, which excludes the envelope, and `envelope` names its three
 * fields. So an editor changing page settings has to write them outside this
 * module, and that change is absent from undo, autosave, crash replay and
 * review.
 *
 * Stated rather than quietly true. A further op widens the PERSISTED format,
 * which every later version has to keep reading, so its shape wants its own
 * design pass rather than being appended to whichever change notices the gap.
 */
/**
 * Where an op places a node: at the top level, or inside a named slot.
 *
 * A union rather than three independent optional fields, because the engine's
 * `TreePosition` makes `parentId` and `slot` optional of each other and the two
 * are not independent: naming a parent without a slot does not say where in
 * that parent the node goes, and `applyOp` has always refused it. Left as one
 * loose shape, a caller with a compiler can write `{ parentId: "outer", index:
 * 0 }`, put it in a typed history or a queue, and find out only when the op
 * executes — by which time it is recorded and its inverse is meaningless.
 *
 * Narrowed HERE rather than in the engine. `TreePosition` is the engine's
 * published type and its shape is what every other caller compiles against;
 * this is the op vocabulary's own statement of what an op may say, and it stays
 * assignable to `TreePosition` so the engine's helpers take it unchanged.
 *
 * The runtime checks remain, for the ops that arrive from storage having never
 * met a compiler.
 */
export type OpPosition =
  | {
      readonly parentId?: undefined;
      readonly slot?: undefined;
      readonly index: number;
    }
  | {
      readonly parentId: string;
      readonly slot: string;
      readonly index: number;
    };

/**
 * A slot an op should remove, IF the op leaves it empty.
 *
 * Placing a node into a slot the destination parent does not have makes the
 * engine create that slot, and removing the node again leaves it behind as an
 * empty array. An undo that restores every node and adds a region the author
 * never made has not undone the edit — the page-builder validator rejects an
 * undeclared empty slot, and no update can delete one, because updates exclude
 * `slots`.
 *
 * Carried on the INVERSE, derived by the store from what the placement actually
 * did rather than declared by a caller. Nothing else in this vocabulary can
 * express "and put the parent back the way it was".
 *
 * **If empty** is the whole of it, and it is what makes the field safe to
 * replay. By the time an undo runs, later edits may have put other nodes in
 * that slot; dropping it then would delete work nobody asked to delete. So this
 * is a request that the store checks rather than a command it obeys, and a slot
 * someone has since filled simply stays.
 */
export interface SlotAddress {
  readonly parentId: string;
  readonly slot: string;
  /**
   * Whether the placement created the parent's `slots` container itself.
   *
   * Removing the last slot is not the same edit as removing the container that
   * held it. A parent that arrived with an explicit `slots: {}` — which the
   * page-builder preserves deliberately for a block whose type it does not
   * recognise — must get that back, not lose the field. Only a placement that
   * created both may take both away.
   */
  readonly containerCreated?: boolean;
}

export type BuilderOp =
  | {
      readonly kind: "insert";
      readonly node: BlockNode;
      readonly at: OpPosition;
    }
  | {
      readonly kind: "remove";
      readonly id: string;
      readonly dropSlotIfEmpty?: SlotAddress;
    }
  | {
      readonly kind: "move";
      readonly id: string;
      readonly to: OpPosition;
      readonly dropSlotIfEmpty?: SlotAddress;
    }
  | {
      readonly kind: "update";
      readonly id: string;
      readonly patch: NodePatch;
      /**
       * Fields to REMOVE, named rather than set to `undefined`.
       *
       * An op is persisted — a crash buffer, a queued agent edit, a replayed
       * history — and `JSON.stringify` drops a key whose value is `undefined`.
       * So an inverse that said `{ customCss: undefined }` arrived back from
       * storage as `{}`, and undoing an edit that ADDED a field left the field
       * in place. A list of names survives the round trip because it is data.
       */
      readonly unset?: readonly RemovableField[];
    }
  | {
      /**
       * An edit to a COMPONENT's envelope: the fields, slots and variants its
       * placements may set, which no node op can reach.
       *
       * A whole field is written at once, never a part of one. An exposure
       * edit renames, adds and prunes across `exposed` and `variants` together
       * (see `exposure-planners`), and one op carrying both is one undo step
       * for what the designer did as one act.
       *
       * Only the SHAPE is judged here: what the fields hold is the envelope
       * check's question, which every save of the definition asks.
       *
       * A fifth member of a published union: code that builds ops or applies
       * them is unaffected, and an exhaustive `switch` over `kind` handles it
       * with a case of its own or a default.
       *
       * @experimental Settles when the component editor ships.
       */
      readonly kind: "envelope";
      readonly patch: EnvelopePatch;
      /** Envelope fields to REMOVE, named for the reason `update`'s are. */
      readonly unset?: readonly EnvelopeField[];
    }
  | {
      /**
       * An edit to what a document states for its page as a whole: its
       * metadata (`settings.seo`), which no node op can reach. Written whole,
       * so one change of the title, the description, the shared title and the
       * image together is one undo step; `null` removes it.
       *
       * Judged as a save judges `settings.seo`, by its shape; whether its
       * bindings fit the schema is the save's question. A `settings` record
       * this edit leaves empty is removed, so undoing the first metadata of a
       * document leaves nothing behind.
       *
       * A sixth member of a published union, as `envelope` is the fifth.
       *
       * @experimental Settles with the template SEO panel.
       */
      readonly kind: "seo";
      readonly seo: DocumentSeo | null;
    };

/**
 * Whether an op edits the document's envelope or settings rather than a
 * block: no Layers lock stands in its way, and no block is its subject.
 */
export function addressesNoNode(
  op: BuilderOp
): op is Extract<BuilderOp, { readonly kind: "envelope" | "seo" }> {
  return op.kind === "envelope" || op.kind === "seo";
}

/**
 * The envelope fields an `envelope` op may write: what a component offers its
 * placements. Its kind, format and settings are not among them.
 */
export const ENVELOPE_FIELDS = ["exposed", "slots", "variants"] as const;

/** One of {@link ENVELOPE_FIELDS}. */
export type EnvelopeField = (typeof ENVELOPE_FIELDS)[number];

/** The values an `envelope` op writes, by field. */
export type EnvelopePatch = Partial<Pick<ComponentDocument, EnvelopeField>>;

export function isEnvelopeField(key: string): key is EnvelopeField {
  return (ENVELOPE_FIELDS as readonly string[]).includes(key);
}

/**
 * A field's value, but only when the record OWNS it.
 *
 * Every decision this module makes about a field is a decision about what will
 * be STORED, and storing goes through `structuredClone` and object spreads —
 * both of which copy own enumerable properties and nothing else. A value
 * resolved through the prototype therefore passes every check and is absent
 * from the result, so the guard and the writer disagree about the same field.
 *
 * `Object.prototype` pollution is the case that makes this reachable, and it is
 * not exotic: one dependency assigning to it gives every plain object in the
 * process the same field. Under `Object.prototype.props = {}`, a node literal
 * with no `props` validates and is stored without one; under an inherited
 * `kind`, an empty object dispatches as a `remove` and serializes as `{}`, so
 * the edit applies and crash recovery cannot replay it.
 *
 * Returns `undefined` for an inherited field, which is what every caller here
 * already treats as absent — so the rule is applied by READING through this
 * rather than by adding a check beside each read.
 */
/**
 * Whether a field resolved through the PROTOTYPE would change what happens.
 *
 * The ownership guards exist because a value reached through the prototype is
 * absent from what `JSON.stringify` writes, so the edit happens and the stored
 * op cannot reproduce it. That argument needs the inherited value to mean
 * something. An inherited `undefined` means exactly what an absent field means:
 * the replayed op resolves it to `undefined` too, so the placement it
 * reproduces IS the placement that happened, and refusing it turns harmless
 * pollution into an editor that cannot place anything at the top level —
 * `Object.prototype.slot = undefined` rejects every insert and move.
 *
 * Read through the DESCRIPTOR rather than the property, because an inherited
 * accessor would otherwise run while this decides whether to refuse the op —
 * document-supplied code executed by a guard, on a path whose whole purpose is
 * to reject before anything happens. An accessor is treated as significant
 * without being invoked: what it would return is unknowable without running it,
 * and a value that cannot be shown to be absent has to be assumed present.
 */
export function inheritedValueWouldBeLost(
  record: Record<string, unknown>,
  field: string
): boolean {
  if (!(field in record) || Object.hasOwn(record, field)) return false;
  for (
    let link: object | null = Object.getPrototypeOf(record) as object | null;
    link !== null;
    link = Object.getPrototypeOf(link) as object | null
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(link, field);
    if (descriptor === undefined) continue;
    return !(holdsAValue(descriptor) && descriptor.value === undefined);
  }
  return false;
}

export function ownValue(
  record: Record<string, unknown>,
  field: string
): unknown {
  return Object.hasOwn(record, field) ? record[field] : undefined;
}

/**
 * Every field the op vocabulary itself defines.
 *
 * Used to tell an op's OWN fields from the extras a newer editor may have
 * written. The two get different treatment on purpose: a known field is judged
 * by the branch that reads it, under that field's own domain rules, while an
 * extra is only ever carried — so the single thing that must be true of it is
 * that it survives being written down.
 */
export const OP_VOCABULARY: Set<string> = new Set([
  "kind",
  "id",
  "node",
  "at",
  "to",
  "patch",
  "unset",
  "dropSlotIfEmpty",
]);

/**
 * An op that could not be applied to the document it was given.
 *
 * Thrown rather than returned as a no-op, because the caller is a history: an op
 * that silently did nothing would still be recorded, and its inverse would then
 * undo an edit that never happened. A stale op is a bug in whoever held it, and
 * the only safe answer is to refuse it loudly.
 */
export class OpError extends Error {
  constructor(message: string) {
    // A backstop on what is STORED, and only that. The values these messages
    // name come from storage or from an agent, so they are
    // attacker-controlled: a 5 MB malformed id produced a 5 MB `message` and
    // carried it into every log and telemetry sink that records the refusal.
    // Every message passes through here, so no site can put an unbounded one
    // into a log.
    //
    // What it cannot bound is the ALLOCATION, because a template literal is
    // fully evaluated before the constructor is entered: a site interpolating a
    // 5 MB id builds the 5 MB string first and this slices a copy of it. That
    // is why the sites render untrusted values through `describe` or `clipped`
    // instead of interpolating them directly — the cut has to happen where the
    // string is composed, and this only catches what escapes that.
    super(
      message.length > MAX_MESSAGE_LENGTH
        ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…`
        : message
    );
    this.name = "OpError";
  }
}
