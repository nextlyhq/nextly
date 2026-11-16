/**
 * A participant keeping its record in memory, for tests of the question core
 * asks: what a real participant does with a table and a unique key, it does
 * with a map, including ranges and judging a batch as if applied.
 */
import type {
  AddressHolder,
  HeldAddress,
  HeldAddressUpdate,
  ParticipantRunner,
} from "../participants";

/** A recorded holding: the address and who holds it. */
export interface Holding {
  address: HeldAddress;
  holder: AddressHolder;
}

const same = (a: AddressHolder, b: AddressHolder) =>
  a.collection === b.collection && a.id === b.id;

/** Whether `held` overlaps `asked`: equal, or one a range covering the other. */
function overlaps(held: HeldAddress, asked: HeldAddress): boolean {
  if (held.locale !== asked.locale) return false;
  if (held.path === asked.path) return true;
  const under = (path: string, range: string) =>
    path.startsWith(range === "/" ? "/" : `${range}/`);
  return (
    (held.range === true && under(asked.path, held.path)) ||
    (asked.range === true && under(held.path, asked.path))
  );
}

export function memoryParticipant(seed: Holding[] = []) {
  let holdings: Holding[] = [...seed];
  const calls = { holderOf: 0, record: 0 };
  const runner: ParticipantRunner = {
    async holderOf(address, asker, batch) {
      calls.holderOf += 1;
      // The batch's holders are judged by what they will hold.
      const moving = batch.map(update => update.holder);
      const effective = [
        ...holdings.filter(h => !moving.some(m => same(m, h.holder))),
        ...batch.flatMap(update =>
          update.holds.map(held => ({ address: held, holder: update.holder }))
        ),
      ];
      const found = effective.find(
        h => !same(h.holder, asker) && overlaps(h.address, address)
      );
      return found?.holder ?? null;
    },
    async record(batch: readonly HeldAddressUpdate[]) {
      calls.record += 1;
      for (const update of batch) {
        holdings = holdings.filter(h => !same(h.holder, update.holder));
      }
      for (const update of batch) {
        for (const address of update.holds) {
          holdings.push({ address, holder: update.holder });
        }
      }
    },
  };
  return {
    runner,
    calls,
    /** What the record holds now, as `locale|path` → `collection:id`. */
    held: () =>
      Object.fromEntries(
        holdings.map(h => [
          `${h.address.locale}|${h.address.path}`,
          `${h.holder.collection}:${h.holder.id}`,
        ])
      ),
  };
}
