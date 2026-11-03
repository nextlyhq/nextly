/**
 * Judging the blocks values a row holds where no fixed path reaches them.
 *
 * A blocks field inside a repeater has one value per row of the repeater, and
 * none of them has an address a write of one field can name. They can still
 * be READ: the row is searched for every value shaped like a blocks document,
 * and each is handed to the step. One the step would change is reported, never
 * written, and so is a row too large to search to the end, because a value the
 * search never reached is one it cannot vouch for.
 *
 * @module host-rewrite/scan
 */
import { documentRefusal, isPlainRecord } from "@nextlyhq/blocks-engine";

import type { HostStep, StoredForm } from "./contract";

/** How many values one row's search visits before it counts as unreadable. */
const MOST_VALUES_SEARCHED = 50_000;

/** What judging a row's values came to. */
export type ScanOutcome = "unchanged" | "unaddressable" | "unreadable";

/**
 * Hand every blocks value in `row` to `step`. `unaddressable` when the step
 * would change or refuses one; `unreadable` when the row could not be searched
 * to the end.
 *
 * `excluded` names the paths whose values have hosts of their own (the
 * fields the walk reads and writes directly); they are left out, so a value
 * a real run rewrites through its own host is not also reported here as one
 * no path reaches.
 */
export async function scannedOutcomes(
  step: HostStep,
  row: unknown,
  form: StoredForm,
  excluded: readonly (readonly string[])[] = []
): Promise<ScanOutcome> {
  const found = documentsWithin(withoutPaths(row, excluded));
  if (found === null) return "unreadable";
  for (const document of found) {
    const outcome = await step(document, form);
    if (outcome.kind !== "unchanged") return "unaddressable";
  }
  return "unchanged";
}

/**
 * Every blocks document in `row`, or `null` when the search ran past its
 * bound. A document's own nodes are not searched again: what it places is the
 * step's to judge. Any other value is searched through, whatever keys it has.
 */
function documentsWithin(row: unknown): unknown[] | null {
  const found: unknown[] = [];
  const stack: unknown[] = [row];
  let visited = 0;
  while (stack.length > 0) {
    visited += 1;
    if (visited > MOST_VALUES_SEARCHED) return null;
    const value = stack.pop();
    if (value !== row && isBlocksValue(value)) {
      found.push(value);
      continue;
    }
    // One at a time rather than spread: a long list spread into arguments
    // reaches the engine's argument limit before any bound applies.
    const inner = Array.isArray(value)
      ? value
      : isPlainRecord(value)
        ? Object.values(value)
        : [];
    for (const item of inner) stack.push(item);
  }
  return found;
}

/**
 * Whether a value is a blocks document, by the engine's own whole-document
 * check, or claims to be one. A record that merely has a `nodes` array is
 * neither, and is searched through like any other: the blocks value it holds
 * may sit beside that array.
 *
 * A value that names a document's envelope (a `formatVersion` or a `kind`
 * beside its `nodes`) and that the check refuses (a newer format, a missing
 * version) is still handed to the step rather than searched through, so the
 * step refuses it as unreadable: searching its insides would read a document
 * this version cannot read as if it were ordinary data.
 */
function isBlocksValue(value: unknown): boolean {
  const decoded = typeof value === "string" ? parsedOrNull(value) : value;
  if (!isPlainRecord(decoded) || !Array.isArray(decoded.nodes)) return false;
  return (
    documentRefusal(decoded) === undefined ||
    Object.hasOwn(decoded, "formatVersion") ||
    Object.hasOwn(decoded, "kind")
  );
}

/** `row` without the values at these paths; the row itself is not changed. */
function withoutPaths(
  row: unknown,
  paths: readonly (readonly string[])[]
): unknown {
  let out = row;
  for (const path of paths) out = withoutPath(out, path);
  return out;
}

/** A copy of `value` without the value at `path`, copied only along it. */
function withoutPath(value: unknown, path: readonly string[]): unknown {
  const [head, ...rest] = path;
  if (
    head === undefined ||
    !isPlainRecord(value) ||
    !Object.hasOwn(value, head)
  ) {
    return value;
  }
  const copy: Record<string, unknown> = { ...value };
  if (rest.length === 0) delete copy[head];
  else copy[head] = withoutPath(value[head], rest);
  return copy;
}

/** Stored JSON text decoded, or `null` when it is not JSON. */
function parsedOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
