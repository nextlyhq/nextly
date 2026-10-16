/**
 * The children an insert of each block type starts its slots with.
 *
 * A module of its own because it expands, and expanding reads the registry's
 * slot-name rule: kept beside the lock rules, it would close an import cycle
 * through the registry, which reads those rules at registration.
 *
 * @module starting-children
 */
import type { BlockNode } from "./document";
import type { NestingSource } from "./nesting";
import { defineEntry, ownEntry } from "./safe-record";
import { expandSlotDefaults } from "./tree";
import type { SlotDefaultSource } from "./tree";

/**
 * The children an insert of a block type starts each of its slots with, read
 * once per type.
 *
 * Asked of `expandSlotDefaults` itself rather than read off the declaration,
 * so the children a save requires are the children an insert creates. An
 * entry the expander drops (an unregistered type, one the nesting rules
 * refuse, one that would seed itself) is not required either: a second reading
 * of the declaration would require children no insert could ever have made.
 */
export function startingChildrenSource(
  definitions: SlotDefaultSource,
  nesting: NestingSource | undefined
): (type: string, slot: string) => readonly BlockNode[] {
  const byType = new Map<string, Record<string, readonly BlockNode[]>>();
  return (type, slot) => {
    let bySlot = byType.get(type);
    if (bySlot === undefined) {
      bySlot = {};
      const expanded = expandSlotDefaults(type, definitions, nesting);
      for (const [name, children] of Object.entries(expanded ?? {})) {
        defineEntry(bySlot, name, children);
      }
      byType.set(type, bySlot);
    }
    return ownEntry(bySlot, slot) ?? [];
  };
}
