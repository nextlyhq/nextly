/**
 * Whether a slot's allow-list admits a block type.
 *
 * One reader for a question five call sites were each answering with their own
 * `allowedBlocks.includes(type)`: the drop rules, the write validator, and the
 * repair finder in three places. Five copies of a membership test agree on the
 * day they are written, and the drift is silent because each looks correct on
 * its own — the editor would offer a drop the write path then refuses, or the
 * repair finder would advertise a wrapper that cannot hold what it is offered.
 *
 * The list is not plain membership, which is the other reason it cannot stay
 * inlined. A trailing `*` matches a NAMESPACE, so `core/*` admits every core
 * block, and that syntax is not this package's invention: it is what
 * `@nextlyhq/blocks-engine` declares on its own `SlotSpec.allow`, so a
 * contributed block's slot arrives already written in it. An exact-match test
 * reading `core/*` finds no block named that and refuses everything the slot
 * was declared to accept — an empty container with no stated reason.
 *
 * @module core/slot-allow
 */

/**
 * Whether `childType` may sit in a slot declared with this allow-list.
 *
 * An absent list means "any block": a slot that states nothing is unrestricted
 * rather than closed. Callers pass the spec itself, including when they do not
 * have one, so the "no spec" and "no list" cases cannot be answered differently
 * by different callers.
 */
export function slotAdmits(
  spec: { allowedBlocks?: readonly string[] } | undefined,
  childType: string
): boolean {
  const allow = spec?.allowedBlocks;
  if (!allow) return true;
  return allow.some(pattern => {
    // The wildcard binds to the namespace separator rather than to raw
    // characters: `core/*` matches `core/heading` and never `coreevil/banner`.
    // A bare prefix test would quietly admit any namespace that merely starts
    // with the same letters, which is a wider policy than the declaration reads
    // as.
    if (!pattern.endsWith("/*")) return childType === pattern;
    return childType.startsWith(pattern.slice(0, -1));
  });
}
