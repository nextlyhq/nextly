/**
 * A read of the saved entry, compared with what the editor already holds.
 *
 * Saving or publishing hands the editor's document to the form, and the form
 * then takes the entry in again from the save's answer and from the read of
 * the entry after it: each arrives as a new object, parsed from the server's
 * reply, holding the same document. Handed to the editor as they come, each
 * one is a new opening value and a new stored copy, so the editor plans its
 * lock repair again (a walk of the whole page) and redraws around a page that
 * did not change, once per arrival.
 *
 * So an arriving value is compared with the one the editor holds and with the
 * document it last handed the form, and where it holds the same document the
 * object already held is kept. A value that differs (another author's save,
 * or a document the server stored differently) is taken as it comes, once.
 *
 * @module admin/editor/read-back
 */
import { useCallback, useRef } from "react";

/**
 * How deep a value may nest before it counts as different. Deeper than any
 * document the engine accepts; past it the value is taken as it comes, which
 * costs one redraw and never shows a stale page.
 */
const MAX_COMPARED_DEPTH = 256;

/**
 * Whether two values hold the same JSON data: the same strings, numbers,
 * booleans and nulls, in arrays of the same order and records with the same
 * keys. Stops at the first difference, and builds nothing.
 *
 * Keys whose value is `undefined` are absent from what a save writes, so a
 * record holding one matches the record without it, as their stored forms do.
 */
export function sameJsonValue(a: unknown, b: unknown): boolean {
  return same(a, b, 0);
}

function same(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (!isObject(a) || !isObject(b) || depth > MAX_COMPARED_DEPTH) return false;
  const arrays = Number(Array.isArray(a)) + Number(Array.isArray(b));
  if (arrays === 1) return false;
  return arrays === 2
    ? sameArray(a as unknown[], b as unknown[], depth)
    : sameRecord(
        a as Record<string, unknown>,
        b as Record<string, unknown>,
        depth
      );
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function sameArray(a: unknown[], b: unknown[], depth: number): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, at) => same(item, b[at], depth + 1));
}

/** The keys a save writes: those whose value is not `undefined`. */
function writtenKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter(key => record[key] !== undefined);
}

function sameRecord(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  depth: number
): boolean {
  const keys = writtenKeys(a);
  if (keys.length !== writtenKeys(b).length) return false;
  return keys.every(
    key => Object.hasOwn(b, key) && same(a[key], b[key], depth + 1)
  );
}

/**
 * The editor's side of a read-back: what it handed the form, and each value
 * the form gives it back, kept as the object it already holds when they hold
 * the same document.
 */
export interface ReadBack<T> {
  /** Hand the form a document, as the editor's own hand-over does. */
  handOver: (value: T) => void;
  /**
   * `value` as the editor should hold it: the object it already held, or the
   * one it last handed the form, when `value` holds the same data; `value`
   * itself otherwise. `slot` names the value, since the opening value and the
   * stored copy are kept apart.
   */
  kept: (slot: "opened" | "stored", value: unknown) => unknown;
}

/**
 * Keep the editor's inputs steady across a read of the saved entry, with
 * `onCommit` the editor's hand-over to the form. `kept` is called during
 * render: the answer for one value is the same until the value changes, so a
 * render repeated for any other reason asks nothing new.
 */
export function useReadBack<T>(onCommit: (value: T) => void): ReadBack<T> {
  const handed = useRef<unknown>(undefined);
  const held = useRef<
    Record<"opened" | "stored", { from: unknown; is: unknown }>
  >({
    opened: { from: NOT_SEEN, is: NOT_SEEN },
    stored: { from: NOT_SEEN, is: NOT_SEEN },
  });
  // Recorded before the form is told, so a read that answers with it is
  // known whenever it comes.
  const handOver = useCallback(
    (value: T) => {
      handed.current = value;
      onCommit(value);
    },
    [onCommit]
  );
  const kept = useCallback((slot: "opened" | "stored", value: unknown) => {
    const was = held.current[slot];
    // The same arrival again: the answer already given.
    if (was.from === value) return was.is;
    const is = keptAs(value, was.is, handed.current);
    held.current[slot] = { from: value, is };
    return is;
  }, []);
  return { handOver, kept };
}

/** Nothing has arrived for this slot yet. */
const NOT_SEEN: unique symbol = Symbol("not seen");

/**
 * The object to hold for an arriving `value`: the one held already, then the
 * one last handed over, when either holds the same data; else `value`.
 */
function keptAs(value: unknown, held: unknown, handed: unknown): unknown {
  if (held !== NOT_SEEN && sameJsonValue(value, held)) return held;
  if (handed !== undefined && sameJsonValue(value, handed)) return handed;
  return value;
}
