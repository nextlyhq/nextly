/**
 * The order collections deleted together are dropped in.
 *
 * A Builder relationship holds a foreign key to its target's table. SQLite
 * refuses to drop a table while a `RESTRICT` key on another table still has
 * rows pointing at it, and MySQL refuses to drop a table any key on another
 * table points at at all, so a set that is allowed to go together must still
 * be dropped holder first: each collection only once every member whose key
 * points at it has gone.
 *
 * Members that hold keys on each other's tables, in a cycle, have no such
 * order. On SQLite only a table rebuild removes such a key, and the set cannot
 * be dropped as it stands on MySQL either, so the set is refused before
 * anything is removed, on every database alike, naming the keys: removing one
 * of those relationship fields first breaks the cycle. A cycle through fields
 * that hold no key (code-first relationships, nested fields) orders nothing
 * and is no reason to refuse.
 *
 * @module domains/collections/services/collection-drop-order
 */
import { NextlyError } from "../../../errors/nextly-error";
import type { ForeignKeySpec } from "../../schema/pipeline/diff/types";

/** A collection in the set, with its own table and the keys that table holds. */
export interface DropOrderMember {
  readonly slug: string;
  readonly tableName: string;
  readonly keys: readonly ForeignKeySpec[];
}

/** A key that ties one member to another, which the order has to respect. */
interface Tie {
  readonly holder: number;
  readonly target: number;
  readonly key: ForeignKeySpec;
}

/**
 * The members' indexes in the order to drop them: each after every member
 * holding a key to it, otherwise in the order given. Throws, before anything
 * is removed, when members hold keys on each other's tables in a cycle.
 */
export function dropOrder(members: readonly DropOrderMember[]): number[] {
  const byTable = new Map(
    members.map((member, index) => [member.tableName, index])
  );
  const ties: Tie[] = members.flatMap((member, holder) =>
    member.keys.flatMap(key => {
      const target = byTable.get(key.referencesTable);
      // A key on its own table goes with the table.
      return target === undefined || target === holder
        ? []
        : [{ holder, target, key }];
    })
  );

  const order: number[] = [];
  const dropped = new Set<number>();
  while (order.length < members.length) {
    // The first member, in the order given, that no remaining member holds a key to.
    const next = members.findIndex(
      (_, index) =>
        !dropped.has(index) &&
        !ties.some(tie => tie.target === index && !dropped.has(tie.holder))
    );
    if (next === -1) throw cycleRefusal(members, ties, dropped);
    order.push(next);
    dropped.add(next);
  }
  return order;
}

/** The refusal for members whose keys point at each other in a cycle. */
function cycleRefusal(
  members: readonly DropOrderMember[],
  ties: readonly Tie[],
  dropped: ReadonlySet<number>
): NextlyError {
  const left = ties.filter(
    tie => !dropped.has(tie.holder) && !dropped.has(tie.target)
  );
  const slugs = [...new Set(left.flatMap(tie => [tie.holder, tie.target]))].map(
    index => `"${members[index].slug}"`
  );
  const keys = left.map(
    tie => `"${tie.key.name}" on "${members[tie.holder].tableName}"`
  );
  return NextlyError.conflict({
    reason: "state",
    message: `Nothing was deleted, because ${slugs.join(", ")} hold foreign keys to one another's tables (${keys.join(", ")}), so no order drops them. Remove one of those relationship fields, then delete them together.`,
    logContext: {
      reason: "collection-drop-cycle",
      slugs: members.map(member => member.slug),
      keys: left.map(tie => tie.key.name),
    },
  });
}
