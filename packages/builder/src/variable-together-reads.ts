/**
 * How widely some variables are used together, as one count: a font's
 * variables, or a type size and its line height. A page naming two of them
 * is one place, not two, so where the host can count the documents each
 * once ({@link VariablesAccess.usageTogether}), a group's documents are its
 * count; elsewhere, they are the variables' added up, as before.
 *
 * A group is read once each of its variables is, and read again whenever
 * any of them is: two reads can say the same numbers of two variables while
 * the pages they share have changed. The host's count stands only for the
 * reads it was made from. Until it is read for them, and where it fails,
 * the group is added up, which says rightly whether anything uses it, so a
 * removal is never offered for a group in use while its count is read.
 *
 * @module variable-together-reads
 */
import * as React from "react";

import { idsKey, idsOf } from "./usage-reads";
import {
  combinedReach,
  reachTogether,
  type VariableReach,
  type VariablesAccess,
  type VariablesTogether,
} from "./variable-usage";

/** The most groups, and the most variables they name in all, one read asks about. */
const TOGETHER_READ_SIZE = 50;

/** A group as it is asked about: its variables once each, in one order. */
function groupOf(identities: readonly string[]): string[] {
  return [...new Set(identities)].sort();
}

/**
 * The groups in reads of at most {@link TOGETHER_READ_SIZE} groups naming
 * at most as many variables in all. A group larger than a read is left out:
 * its documents stay added up.
 */
export function togetherBatches(
  groups: readonly (readonly string[])[]
): string[][][] {
  const batches: string[][][] = [];
  let batch: string[][] = [];
  let named = new Set<string>();
  for (const group of groups) {
    if (group.length > TOGETHER_READ_SIZE) continue;
    const joined = new Set([...named, ...group]);
    if (
      batch.length === TOGETHER_READ_SIZE ||
      joined.size > TOGETHER_READ_SIZE
    ) {
      batches.push(batch);
      batch = [];
      named = new Set(group);
    } else {
      named = joined;
    }
    batch.push([...group]);
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** What a group's read kept: the variables' usage it was read under, and its answer. */
interface Kept {
  readonly stamp: string;
  readonly value: VariablesTogether | "failed";
}

/** Each read's answer for a variable, numbered as first seen. */
const answerNumbers = new WeakMap<VariableReach, number>();
let answersSeen = 0;

/**
 * Which read a variable's usage came from: each read answers with its own
 * object, so two reads saying the same numbers are told apart.
 */
function answerNumber(reach: VariableReach): number {
  const known = answerNumbers.get(reach);
  if (known !== undefined) return known;
  answersSeen += 1;
  answerNumbers.set(reach, answersSeen);
  return answersSeen;
}

/** The reads a group's variables' usage came from, as one value. */
function stampOf(
  group: readonly string[],
  values: ReadonlyMap<string, VariableReach>
): string {
  return JSON.stringify(
    group.map(id => {
      const reach = values.get(id);
      return reach === undefined ? null : answerNumber(reach);
    })
  );
}

/** Every group's answer, read a batch at a time; a batch that fails, failed. */
async function readGroups(
  read: NonNullable<VariablesAccess["usageTogether"]>,
  due: readonly (readonly [string[], string])[],
  signal: AbortSignal
): Promise<Map<string, Kept>> {
  const stamps = new Map(due.map(([group, stamp]) => [idsKey(group), stamp]));
  const kept = new Map<string, Kept>();
  for (const batch of togetherBatches(due.map(([group]) => group))) {
    const answers = await read(batch, signal).catch(() => undefined);
    batch.forEach((group, at) => {
      const key = idsKey(group);
      kept.set(key, {
        stamp: stamps.get(key) ?? "",
        value: answers?.[at] ?? "failed",
      });
    });
  }
  return kept;
}

/**
 * The groups due a read, with the usage of their variables each is read
 * under: those whose variables are all read and whose last read, if any,
 * was under other usage.
 */
function dueGroups(
  groups: readonly string[][],
  values: ReadonlyMap<string, VariableReach>,
  kept: ReadonlyMap<string, Kept>
): (readonly [string[], string])[] {
  return groups.flatMap(group => {
    if (!group.every(id => values.has(id))) return [];
    const stamp = stampOf(group, values);
    return kept.get(idsKey(group))?.stamp === stamp
      ? []
      : [[group, stamp] as const];
  });
}

/**
 * How widely some variables are used together, for the groups a screen
 * shows: answers a group's reach from its variables' `values`, with the
 * host's count of their documents together where it has one for the reads
 * in hand. Otherwise, and for a group not asked about here, it is added up.
 * A single variable is its own reach.
 *
 * @param access - The host's usage reads; none reads nothing
 * @param groups - The groups the screen shows, each the variables in it
 * @param values - Each variable's usage, as read by identity
 */
export function useReachTogether(
  access: VariablesAccess | undefined,
  groups: readonly (readonly string[])[],
  values: ReadonlyMap<string, VariableReach>
): (identities: readonly string[]) => VariableReach | undefined {
  const read = access?.usageTogether;
  const wantedKey = idsKey(
    [
      ...new Set(
        groups
          .map(groupOf)
          // One variable is its own count; more than a read holds, added up.
          .filter(
            group => group.length > 1 && group.length <= TOGETHER_READ_SIZE
          )
          .map(idsKey)
      ),
    ].sort()
  );
  const wanted = React.useMemo(() => new Set(idsOf(wantedKey)), [wantedKey]);
  const [kept, setKept] = React.useState<ReadonlyMap<string, Kept>>(
    () => new Map()
  );
  const due = dueGroups([...wanted].map(idsOf), values, kept);
  // One string, so the read follows what is due and nothing else.
  const dueKey = JSON.stringify(due);
  React.useEffect(() => {
    if (read === undefined) return;
    const asked = JSON.parse(dueKey) as [string[], string][];
    if (asked.length === 0) return;
    const controller = new AbortController();
    void readGroups(read, asked, controller.signal).then(answers => {
      if (!controller.signal.aborted) {
        setKept(current => new Map([...current, ...answers]));
      }
    });
    return () => controller.abort();
  }, [read, dueKey]);
  return React.useCallback(
    (identities: readonly string[]): VariableReach | undefined => {
      const group = groupOf(identities);
      const reaches = group.map(id => values.get(id));
      const key = idsKey(group);
      if (read === undefined || !wanted.has(key)) {
        return combinedReach(reaches);
      }
      // The host's count only for the reads it was made from.
      const held = kept.get(key);
      const current =
        held !== undefined &&
        held.value !== "failed" &&
        held.stamp === stampOf(group, values);
      return current
        ? reachTogether(reaches, held.value)
        : combinedReach(reaches);
    },
    [read, wanted, kept, values]
  );
}
