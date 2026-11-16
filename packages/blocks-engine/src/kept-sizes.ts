/**
 * The serialized size of every part of a document, kept against the part.
 *
 * Documents are immutable values in the editor: an edit returns a new document
 * that shares every part it did not change with the one before. So the size of
 * a part, once measured, holds for as long as the part exists, and it is kept
 * in a `WeakMap` against the object itself. After an edit only the objects on
 * the path from the changed node to the root are new, and only they are
 * measured; garbage collection drops the entries with the documents.
 *
 * Plain JSON data only, by design: strings, finite numbers other than `-0`,
 * booleans, `null`, and ordinary arrays and records of them. A part that is
 * anything else (a value the writer refuses or rewrites, `undefined`, a
 * function, a cycle, a class instance, an accessor, a `toJSON`, an array hole,
 * a symbol key) has no kept size, and the caller falls back to the full
 * measurement in `measure-bytes`, which knows how to report each of those. So
 * the answer here is always the full measurement's, and the per-object safety
 * probe runs only where it is needed: on a document that is not plain data, and
 * wherever a document enters from outside.
 *
 * @module kept-sizes
 */
import { countMeasuredObject } from "./document-walks";
import { utf8ByteLength } from "./measure-bytes";

/** A kept size, or `NOT_PLAIN` for a part that has none. */
const KEPT = new WeakMap<object, number>();
const NOT_PLAIN = -1;

/**
 * How deep a part may nest before it is left to the full measurement, which
 * walks iteratively. This measures by recursion, and a document deeper than any
 * the engine accepts must not exhaust the stack here.
 */
const MAX_KEPT_DEPTH = 512;

/**
 * The bytes `JSON.stringify` writes for `value`, UTF-8 encoded, or nothing when
 * the value is not plain JSON data.
 *
 * Exactly the full measurement's count for every value it answers, which is
 * what lets a cap check use it in place of one.
 */
export function keptJsonBytes(value: unknown): number | undefined {
  // A value that throws while being read (a Proxy's trap) has no kept size;
  // the full measurement reports it without throwing.
  try {
    return bytesOf(value, 0, new Set<object>());
  } catch {
    return undefined;
  }
}

function bytesOf(
  value: unknown,
  depth: number,
  open: Set<object>
): number | undefined {
  switch (typeof value) {
    case "string":
      return 2 + utf8ByteLength(value, Number.POSITIVE_INFINITY);
    case "number":
      // `NaN`, the infinities and `-0` are rewritten by the writer, which the
      // full measurement reports; only a number written as itself is counted.
      return Number.isFinite(value) && !Object.is(value, -0)
        ? String(value).length
        : undefined;
    case "boolean":
      return value ? 4 : 5;
    case "object":
      return value === null ? 4 : objectBytes(value, depth, open);
    default:
      // `undefined`, a function, a symbol or a BigInt: written differently or
      // refused, so the full measurement answers.
      return undefined;
  }
}

function objectBytes(
  value: object,
  depth: number,
  open: Set<object>
): number | undefined {
  const kept = KEPT.get(value);
  if (kept !== undefined) return kept === NOT_PLAIN ? undefined : kept;
  // Too deep for this recursion, or its own ancestor: the full measurement
  // answers. Neither is kept, because depth belongs to where a part sits.
  if (depth > MAX_KEPT_DEPTH || open.has(value)) return undefined;
  open.add(value);
  const bytes = Array.isArray(value)
    ? arrayBytes(value, depth, open)
    : recordBytes(value, depth, open);
  open.delete(value);
  countMeasuredObject();
  KEPT.set(value, bytes ?? NOT_PLAIN);
  return bytes;
}

/** `[a,b]`: brackets, each element, and the commas between them. */
function arrayBytes(
  array: unknown[],
  depth: number,
  open: Set<object>
): number | undefined {
  // An ordinary array with no holes and nothing but its indices: anything else
  // is written differently from how it reads, and the full measurement says so.
  if (
    Object.getPrototypeOf(array) !== Array.prototype ||
    Object.getOwnPropertySymbols(array).length > 0 ||
    Object.keys(array).length !== array.length
  ) {
    return undefined;
  }
  let total = 2 + Math.max(0, array.length - 1);
  for (let index = 0; index < array.length; index++) {
    const held = Object.getOwnPropertyDescriptor(array, index);
    if (held === undefined || !("value" in held)) return undefined;
    const element = bytesOf(held.value, depth + 1, open);
    if (element === undefined) return undefined;
    total += element;
  }
  return total;
}

/** `{"k":v}`: braces, each written member, and the commas between them. */
function recordBytes(
  record: object,
  depth: number,
  open: Set<object>
): number | undefined {
  const prototype = Object.getPrototypeOf(record);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(record).length > 0
  ) {
    return undefined;
  }
  let total = 2;
  let written = 0;
  for (const key of Object.keys(record)) {
    // The descriptor, never the value through `[[Get]]`: an accessor would run
    // code the document supplies, and a `toJSON` changes what is written.
    const held = Object.getOwnPropertyDescriptor(record, key);
    if (held === undefined || !("value" in held) || key === "toJSON") {
      return undefined;
    }
    const member = bytesOf(held.value, depth + 1, open);
    if (member === undefined) return undefined;
    total += 2 + utf8ByteLength(key, Number.POSITIVE_INFINITY) + 1 + member;
    written += 1;
  }
  return total + Math.max(0, written - 1);
}

/** A node's subtree: how many nodes it holds, itself included, and how tall. */
interface Shape {
  count: number;
  height: number;
}

/** Kept shapes, `null` for a node that has none. */
const SHAPES = new WeakMap<object, Shape | null>();

/**
 * How many nodes a forest holds and how deep it nests, from the shape kept for
 * each node, or nothing when a node is not plain data.
 *
 * The same answers `countNodes` and `treeDepth` give for a forest of plain
 * nodes, whose `slots` is a record of plain lists. Anything else (a node that
 * is not a record, an accessor, a cycle) has no kept shape, and those functions walk it instead.
 */
export function keptForestShape(
  nodes: unknown,
  maxEntries: number = Number.POSITIVE_INFINITY
): { count: number; depth: number } | undefined {
  // Bounded like the walk it stands in for: past `maxEntries` fresh entries it
  // stops and leaves the forest to the walk, which refuses it. A value that
  // throws while being read has no kept shape either.
  const budget: Budget = { left: maxEntries, spent: false };
  try {
    const shape = listShape(nodes, 0, new Set<object>(), budget);
    return shape === undefined || shape.count > maxEntries
      ? undefined
      : { count: shape.count, depth: shape.height };
  } catch {
    return undefined;
  }
}

/**
 * How many more fresh entries a shape may measure, and whether it ran out. A
 * walk that ran out keeps nothing: what it did not reach is not "not plain".
 */
interface Budget {
  left: number;
  spent: boolean;
}

/** A list's total count and its tallest entry; an empty list is height 0. */
function listShape(
  list: unknown,
  depth: number,
  open: Set<object>,
  budget: Budget
): Shape | undefined {
  // An ordinary array, read by index as the walk reads it: an own iterator or
  // a hole would make `for...of` see a different list.
  if (
    !Array.isArray(list) ||
    Object.getPrototypeOf(list) !== Array.prototype ||
    Object.getOwnPropertySymbols(list).length > 0 ||
    Object.keys(list).length !== list.length
  ) {
    return undefined;
  }
  let count = 0;
  let height = 0;
  for (let index = 0; index < list.length; index++) {
    const shape = nodeShape(list[index], depth, open, budget);
    if (shape === undefined) return undefined;
    count += shape.count;
    height = Math.max(height, shape.height);
  }
  return { count, height };
}

function nodeShape(
  node: unknown,
  depth: number,
  open: Set<object>,
  budget: Budget
): Shape | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const kept = SHAPES.get(node);
  if (kept !== undefined) return kept ?? undefined;
  if (depth > MAX_KEPT_DEPTH || open.has(node)) return undefined;
  if ((budget.left -= 1) < 0) {
    budget.spent = true;
    return undefined;
  }
  open.add(node);
  const shape = freshShape(node, depth, open, budget);
  open.delete(node);
  countMeasuredObject();
  if (!budget.spent) SHAPES.set(node, shape ?? null);
  return shape;
}

function freshShape(
  node: object,
  depth: number,
  open: Set<object>,
  budget: Budget
): Shape | undefined {
  const slots = plainSlotsOf(node);
  if (slots === undefined) return undefined;
  let count = 1;
  let height = 1;
  for (const list of slots) {
    const children = listShape(list, depth + 1, open, budget);
    if (children === undefined) return undefined;
    count += children.count;
    height = Math.max(height, 1 + children.height);
  }
  return { count, height };
}

/**
 * A plain node's slot lists (none for a node whose `slots` is falsy, as the
 * forest walk reads it), or nothing for a node that is not plain data: read
 * through descriptors, so no getter the document supplies runs.
 */
function plainSlotsOf(node: object): unknown[] | undefined {
  const prototype = Object.getPrototypeOf(node);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const held = Object.getOwnPropertyDescriptor(node, "slots");
  if (held !== undefined && !("value" in held)) return undefined;
  const slots: unknown = held?.value;
  if (!slots) return [];
  if (
    typeof slots !== "object" ||
    Array.isArray(slots) ||
    Object.getPrototypeOf(slots) !== Object.prototype
  ) {
    return undefined;
  }
  const lists: unknown[] = [];
  for (const name of Object.keys(slots)) {
    const list = Object.getOwnPropertyDescriptor(slots, name);
    if (list === undefined || !("value" in list)) return undefined;
    lists.push(list.value);
  }
  return lists;
}
