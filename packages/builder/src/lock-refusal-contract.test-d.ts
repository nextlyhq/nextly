/**
 * How a consumer of `@nextlyhq/builder/shell` narrows what the editor's lock
 * question answers.
 *
 * `EditorState.lockRefusalFor` answers a union: a slot lock a block declares,
 * or a block locked in Layers. The entry point exports the discriminator and
 * both arms, so a consumer reading `holderType` or `lock` narrows first, and
 * one reading the locked block's `label` narrows the other way. Compiled by the
 * package's type check: an export missing from the entry, or an arm losing a
 * field, fails it. Plain types rather than a test library's, since the
 * package's layering contract keeps test tooling to files the runner runs.
 */
import {
  isLayersLockFacts,
  type EditorState,
  type LayersLockRefusalFacts,
  type LockedRelation,
  type LockedVerb,
  type LockRefusalFacts,
  type SlotLockRefusalFacts,
} from "./shell";

/** True only when `A` and `B` are the same type, not merely assignable. */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/** Compiles only for `true`: each use below states one fact of the contract. */
function holds<Fact extends true>(): Fact | undefined {
  return undefined;
}

declare const editor: EditorState;
const found = editor.lockRefusalFor([]);

holds<Same<typeof found, LockRefusalFacts | undefined>>();
holds<Same<LockRefusalFacts, SlotLockRefusalFacts | LayersLockRefusalFacts>>();

if (found !== undefined) {
  if (isLayersLockFacts(found)) {
    holds<Same<typeof found, LayersLockRefusalFacts>>();
    holds<Same<typeof found.label, string>>();
    holds<Same<typeof found.relation, LockedRelation>>();
    holds<Same<typeof found.verb, LockedVerb>>();
  } else {
    holds<Same<typeof found, SlotLockRefusalFacts>>();
    holds<Same<typeof found.holderType, string>>();
    holds<Same<typeof found.lock, SlotLockRefusalFacts["lock"]>>();
    holds<
      Same<
        typeof found.code,
        "locked-slot-altered" | "locked-slot-content-only"
      >
    >();
  }
}
