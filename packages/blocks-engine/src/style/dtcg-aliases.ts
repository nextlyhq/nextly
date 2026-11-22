/**
 * Aliases in a DTCG file: collecting its tokens, following a reference to
 * the token it names, and the value a chain of references resolves to.
 *
 * @module style/dtcg-aliases
 */
import type { ValidationIssue } from "../validation";

import { type DtcgNode, isPlainObject, issue, statedType } from "./dtcg-format";
import { isDtcgName, isReservedKey, isTokenNode } from "./dtcg-read";
import { MAX_TOKEN_NAME_SEGMENTS } from "./site-tokens";

/* ----------------------------------------------------------------- aliases */

/** One token found by the alias pass: its node and the type it is read as. */
interface FoundToken {
  node: DtcgNode;
  type: string | undefined;
}

/**
 * The document with every alias replaced by the value it points at.
 *
 * DTCG lets a token's `$value` be another token: `"{color.blue}"`, or
 * `{ "$ref": "#/color/blue/$value" }` in the JSON-pointer form. This system
 * stores values, not references, so an alias is resolved once on import. A
 * chain is followed to its end, and an alias with no `$type` of its own takes
 * its target's.
 *
 * An alias that cannot be resolved (a loop, a missing target, or a stated type
 * that disagrees with the target's) is left out of the returned document and
 * named, so the rest of the file still imports.
 *
 * Returns a copy: the document handed in is not changed.
 */
export function resolveAliases(document: DtcgNode): {
  document: DtcgNode;
  issues: ValidationIssue[];
} {
  const found = new Map<string, FoundToken>();
  collectTokens(document, [], undefined, found);
  const issues: ValidationIssue[] = [];
  const settled = new Map<string, FoundToken | string>();
  for (const [path, entry] of found) {
    if (aliasTarget(entry.node.$value) === undefined) continue;
    const outcome = followAlias(path, found, settled, []);
    if (typeof outcome === "string") issues.push(issue(outcome));
  }
  // A shadow layer's colour may be an alias too (a composite's part may
  // reference a token of its type): each one resolving to a colour is
  // written as that colour's value.
  const layered = new Map<string, unknown>();
  for (const [path, entry] of found) {
    // A whole alias to a shadow takes that shadow's value, resolved alike.
    const to = settled.get(path);
    const end = to === undefined || typeof to === "string" ? entry : to;
    if (end.type !== "shadow") continue;
    const value = withLayerColours(end.node.$value, found, settled);
    if (value !== end.node.$value) layered.set(path, value);
  }
  return { document: substituted(document, [], settled, layered), issues };
}

/**
 * A shadow's value with each layer's colour alias written as the colour it
 * resolves to; the same value where none does.
 */
function withLayerColours(
  value: unknown,
  found: ReadonlyMap<string, FoundToken>,
  settled: Map<string, FoundToken | string>
): unknown {
  const layers: unknown[] = Array.isArray(value) ? value : [value];
  let changed = false;
  const read = layers.map(layer => {
    if (!isPlainObject(layer)) return layer;
    const target = aliasTarget(layer.color);
    if (target === undefined) return layer;
    const end = followAlias(target, found, settled, []);
    if (typeof end === "string" || end.type !== "color") return layer;
    changed = true;
    return { ...layer, color: end.node.$value };
  });
  if (!changed) return value;
  return Array.isArray(value) ? read : read[0];
}

/**
 * The path an alias value points at, or `undefined` when it is a value.
 *
 * A whole-token reference only: `"{a.b}"` exactly, or a `$ref` pointer into
 * the same document. A `$ref` ending in `/$value` names the token by its
 * value, which is the same token.
 */
// RELOCATED, not written here — see the docblock of `dtcg.ts`.
// fallow-ignore-next-line complexity
function aliasTarget(value: unknown): string | undefined {
  if (typeof value === "string") {
    if (!value.startsWith("{") || !value.endsWith("}")) return undefined;
    const path = value.slice(1, -1).split(".");
    return path.every(isDtcgName) ? path.join(".") : undefined;
  }
  if (!isPlainObject(value) || typeof value.$ref !== "string") return undefined;
  const ref = value.$ref;
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref
    .slice(2)
    .split("/")
    .map(part => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (parts.at(-1) === "$value") parts.pop();
  return parts.length > 0 && parts.every(isDtcgName)
    ? parts.join(".")
    : undefined;
}

/**
 * Every token in the document by dot path, with the type it inherits.
 *
 * Bounded at the same depth the reader stops at, so a file nested deeply
 * enough to exhaust the stack is left for the reader to refuse and report.
 */
function collectTokens(
  node: DtcgNode,
  path: string[],
  inherited: string | undefined,
  found: Map<string, FoundToken>
): void {
  const groupType = statedType(node) ?? inherited;
  for (const [key, child] of Object.entries(node)) {
    if (isReservedKey(key) || !isPlainObject(child)) continue;
    const here = [...path, key];
    if (isTokenNode(child)) {
      found.set(here.join("."), {
        node: child,
        type: statedType(child) ?? groupType,
      });
    } else if (here.length <= MAX_TOKEN_NAME_SEGMENTS) {
      collectTokens(child, here, groupType, found);
    }
  }
}

/**
 * The concrete token an alias ends at, or why it cannot be resolved.
 *
 * Memoised in `settled`, so a long chain shared by many aliases is walked
 * once; `trail` is the chain so far, which is how a loop is recognised.
 */
// RELOCATED, not written here — see the docblock of `dtcg.ts`.
// fallow-ignore-next-line complexity
function followAlias(
  path: string,
  found: ReadonlyMap<string, FoundToken>,
  settled: Map<string, FoundToken | string>,
  trail: readonly string[]
): FoundToken | string {
  const known = settled.get(path);
  if (known !== undefined) return known;
  const entry = found.get(path);
  const head = trail[0] ?? path;
  if (entry === undefined) {
    return `"${head}" points at "${path}", which is no token in this file, so it was skipped.`;
  }
  const target = aliasTarget(entry.node.$value);
  if (target === undefined) return entry;
  if (trail.includes(path) || target === path) {
    const loop = `"${path}" is part of a loop of aliases that never reaches a value, so it was skipped.`;
    settled.set(path, loop);
    return loop;
  }
  const end = followAlias(target, found, settled, [...trail, path]);
  let outcome: FoundToken | string = end;
  if (typeof end !== "string") {
    if (entry.type !== undefined && end.type !== entry.type) {
      outcome = `"${path}" is a ${entry.type} but points at "${target}", a ${end.type ?? "token with no type"}, so it was skipped.`;
    } else if (end.type === undefined) {
      outcome = `"${path}" points at "${target}", which has no type, so it was skipped.`;
    }
  } else if (trail.length === 0 && !end.startsWith(`"${path}"`)) {
    // A failure further down the chain is said once, about the token the
    // author would look for: the first alias in it.
    outcome = end.replace(/^"[^"]*"/, `"${path}"`);
  }
  settled.set(path, outcome);
  return outcome;
}

/**
 * A copy of the document with each settled alias written as its value, and
 * each unresolvable one left out.
 *
 * Built with `Object.fromEntries` rather than by assignment: the keys come from
 * a file, and assigning `__proto__` would set the copy's prototype instead of
 * keeping the key for the reader to report.
 */
function substituted(
  node: DtcgNode,
  path: string[],
  settled: ReadonlyMap<string, FoundToken | string>,
  /** Shadow values whose layer colours were resolved, by path. */
  layered: ReadonlyMap<string, unknown>
): DtcgNode {
  const entries: [string, unknown][] = [];
  for (const [key, child] of Object.entries(node)) {
    const here = [...path, key];
    const outcome = settled.get(here.join("."));
    if (isReservedKey(key) || !isPlainObject(child)) {
      entries.push([key, child]);
    } else if (outcome === undefined) {
      const resolved = layered.get(here.join("."));
      entries.push([
        key,
        resolved !== undefined
          ? { ...child, $value: resolved }
          : isTokenNode(child) || here.length > MAX_TOKEN_NAME_SEGMENTS
            ? child
            : substituted(child, here, settled, layered),
      ]);
    } else if (typeof outcome !== "string") {
      entries.push([
        key,
        {
          ...child,
          $type: outcome.type,
          $value: layered.get(here.join(".")) ?? outcome.node.$value,
        },
      ]);
    }
  }
  return Object.fromEntries(entries);
}
