/**
 * Site tokens as a DTCG file, and back.
 *
 * The Design Tokens Community Group format is what Figma, Style Dictionary and
 * Tokens Studio read and write, so this is the door a site's tokens leave and
 * arrive through. The token KINDS were chosen as a subset of DTCG's `$type`
 * vocabulary for exactly this reason: the mapping is a projection rather than a
 * translation.
 *
 * ## A dot-path name is a PATH, not a name
 *
 * DTCG reserves the period: "the following characters MUST NOT be used anywhere
 * in a token or group name: `{`, `}`, `.`". So `color.primary` is not a DTCG
 * name at all — it is the token `primary` inside the group `color`. Export
 * nests, import flattens, and because the spec forbids a period inside a name
 * the two directions cannot disagree about where a path divides.
 *
 * ## Most DTCG values are objects now
 *
 * A dimension is `{"value": 16, "unit": "px"}` and only `px` or `rem` are
 * allowed; a duration is the same shape; a colour is
 * `{"colorSpace", "components", "alpha?", "hex?"}` and a bare hex string is no
 * longer valid on its own. That has a consequence worth stating plainly rather
 * than discovering later: a token holding `1.5em`, `100%`, `clamp(...)` or a
 * `var()` reference **cannot be written as a conformant DTCG value at all**.
 *
 * So the export carries two things for every token it can: the native DTCG
 * value, for the tools this exists to talk to, and the exact CSS under this
 * vendor's `$extensions` key. Import prefers the extension when it is there,
 * which makes a Nextly-to-Nextly round trip exact, and falls back to converting
 * the native value, which makes a file from Figma import correctly.
 *
 * ## A value the format cannot type still leaves in the file
 *
 * Dropping it would lose most of a site's spacing: a custom value has no
 * `$type`, and a shadow kept as CSS, an `em` size, a percentage or a `var()`
 * family has no conformant `$value`. Inventing a type of this system's own
 * would make other tools refuse the file. So such a variable is written under
 * this vendor's key in the document's own `$extensions`, as `variables`, keyed
 * by name: other tools ignore it, as the format requires them to, and the file
 * stays valid; this importer reads it back exactly.
 *
 * A fluid size is the one exception with a useful native value: a `clamp()`
 * whose largest value is in `px` or `rem` is written as that largest value in
 * `px`, which is what a design tool can draw, with the `clamp()` kept in the
 * extension and named in `$description`.
 *
 * Foreign extension data is carried in both directions untouched, because the
 * format requires it: "Tools that process design token files MUST preserve any
 * extension data they do not themselves understand."
 *
 * ## A token's identity travels in the extension, because DTCG has none
 *
 * The format knows a token by its path and nothing else — there is no id, and
 * an alias `{color.primary}` resolves by name. A `SiteToken`'s identity is
 * therefore not expressible in the format's own vocabulary, and inventing a
 * `$id` for it would take a prefix the spec reserves for itself. So it rides in
 * `$extensions` beside the exact CSS, which is both the conformant place for it
 * and a preserved one.
 *
 * That leaves the two directions asymmetric, deliberately. A file this wrote
 * comes back with the identity it left with. A file from anywhere else has no
 * identity to read, and gets none invented for it: its tokens arrive with their
 * names as identities, which is what a token with no id means everywhere else.
 *
 * ## The complexity suppressions in this module's parts
 *
 * Six functions in its parts carry `fallow-ignore-next-line complexity`:
 * `readToken` and `read` in `dtcg-read`, `colorFromDtcg` in `dtcg-values`,
 * `followAlias` and `aliasTarget` in `dtcg-aliases`, and `splitFamilyList` in
 * `dtcg-css-text`. They moved there unchanged, apart from an `export`, when
 * this module was split into parts, and their scores were inherited, so
 * ungated, while they sat here. The audit calls them new only because their
 * files are new, and the health baseline is generated from `main`, never from
 * a branch. Suppressed inline, one by one, as the engine's earlier splits do:
 * a new complex function added to any part still gets caught.
 *
 * @module style/dtcg
 */
import type { ValidationIssue } from "../validation";

import { resolveAliases } from "./dtcg-aliases";
import {
  type DtcgNode,
  isPlainObject,
  issue,
  NEXTLY_EXTENSION,
  type NextlyExtension,
  statedExtensions,
} from "./dtcg-format";
import { read, readToken } from "./dtcg-read";
import { unreadIn } from "./dtcg-report";
import {
  fluidNoteFor,
  isKind,
  typedValue,
  type TypedValue,
  withFluidNote,
} from "./dtcg-values";
import {
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_NAME_SEGMENTS,
  type SiteToken,
  type SiteTokenSet,
  tokenNamingProblem,
} from "./site-tokens";

export { NEXTLY_EXTENSION } from "./dtcg-format";
export type { DtcgNode } from "./dtcg-format";
export {
  GENERIC_FONT_FAMILIES,
  familyPartKind,
  readFamilyList,
  splitFamilyList,
} from "./dtcg-css-text";
export type {
  FamilyListKind,
  FamilyListReading,
  FamilyPart,
  FamilyPartKind,
  ReadFamilyPart,
} from "./dtcg-css-text";
export { isKind, largestPixels, nativeReading } from "./dtcg-values";
export { resolveAliases } from "./dtcg-aliases";

/* ------------------------------------------------------------------ export */

/**
 * A site's tokens as a DTCG document, with what could not be represented.
 *
 * Reported rather than dropped in silence: a designer handed a file with three
 * tokens missing has no way to know, and the ones that go missing are the
 * interesting ones — the `clamp()` that took an afternoon to get right.
 */
export function tokensToDtcg(set: SiteTokenSet): {
  document: DtcgNode;
  issues: ValidationIssue[];
} {
  const document: DtcgNode = {};
  const issues: ValidationIssue[] = [];
  const carried: DtcgNode = {};

  for (const token of set.tokens) {
    const naming = exportNamingRefusal(token, "it was not exported");
    if (naming !== undefined) {
      // One rule, phrased for this gate. The identity carries the cap and the
      // display name carries only the grammar, so a renamed token with a long
      // label exports normally. The id is covered by the same answer: written,
      // it would make a file this module's own importer refuses.
      issues.push(issue(naming));
      continue;
    }
    const typed = typedValue(token);
    if (typed === undefined) {
      // Keyed by the whole name: this is extension data, not a token tree, so
      // the format's ban on a period inside a name does not reach it.
      if (Object.hasOwn(carried, token.name)) {
        issues.push(issue(`"${token.name}" is exported more than once.`));
        continue;
      }
      carried[token.name] = entryFor(token, undefined);
      continue;
    }
    place(document, token.name.split("."), entryFor(token, typed), issues);
  }

  if (Object.keys(carried).length > 0) {
    document.$extensions = { [NEXTLY_EXTENSION]: { [CARRIED]: carried } };
  }
  return { document, issues };
}

/** Where the document's own extension holds the variables the format cannot type. */
const CARRIED = "variables";

/**
 * Why a token's name or id keeps it out of an exported file, in words, or
 * nothing when both can be written. `outcome` says what happened to it ("it
 * was not exported"), so every exporter phrases the one verdict alike.
 */
export function exportNamingRefusal(
  token: SiteToken,
  outcome: string
): string | undefined {
  const naming = tokenNamingProblem(token);
  if (naming === undefined) return undefined;
  if (naming.reason === "depth") {
    return `"${String(token.name)}" is nested too deeply, so ${outcome}. A token name holds at most ${MAX_TOKEN_NAME_SEGMENTS} dot-separated parts.`;
  }
  if (naming.reason === "length") {
    return `"${String(token.name)}" is written under more than ${MAX_TOKEN_NAME_LENGTH} characters, so ${outcome}. The ${naming.field} a token is written under is at most ${MAX_TOKEN_NAME_LENGTH} characters.`;
  }
  return naming.field === "name"
    ? `"${String(token.name)}" is not a token name, so ${outcome}.`
    : `"${String(token.name)}" has an id that is not a token name, so ${outcome}. Its value is still here in Nextly.`;
}

/**
 * The node for a token whose name can be written: a DTCG token when it is
 * typed, or, with no `typed`, the same fields without `$type` or `$value` for
 * the document's extension, read back through the same reader.
 */
function entryFor(token: SiteToken, typed: TypedValue | undefined): DtcgNode {
  // A fluid size names its `clamp()` for tools that read only the native value,
  // and the extension records the author's own description beside it.
  const fluidNote =
    typed?.fluid === true ? fluidNoteFor(token.values.light) : undefined;
  const extension: NextlyExtension = {
    css:
      token.values.dark === undefined
        ? { light: token.values.light }
        : { light: token.values.light, dark: token.values.dark },
    kind: token.kind,
    // Written only when the token carries one. Exporting `id: name` for every
    // token that never moved would make the field say nothing about identity
    // and everything about which version of this exporter ran.
    ...(token.id === undefined ? {} : { id: token.id }),
    ...(token.label === undefined ? {} : { label: token.label }),
    ...(fluidNote === undefined
      ? {}
      : { description: token.description ?? null }),
  };
  const entry: DtcgNode = {
    ...(typed === undefined ? {} : { $type: typed.type, $value: typed.value }),
    $extensions: {
      ...(token.extensions ?? {}),
      // `unreadIn` is what keeps the two halves apart, HERE as much as on the
      // way in: a token stored while a field was unread still carries a copy of
      // it, and once this build learns to read that field the stored copy is a
      // stale statement of a value the site may since have changed. The filter
      // drops it, so the model is the only thing that can state it.
      //
      // Spread order says the same thing a second way and cannot be observed
      // while the filter holds, since no key survives it that the fields below
      // could collide with.
      [NEXTLY_EXTENSION]: { ...unreadIn(token.unreadExtension), ...extension },
    },
  };
  const description =
    fluidNote === undefined
      ? token.description
      : withFluidNote(token.description, fluidNote);
  if (description !== undefined) entry.$description = description;
  return entry;
}

/**
 * Put a token at its path, creating the groups it passes through.
 *
 * Every lookup asks for an OWN key. A document node is an ordinary object, so
 * reading a segment directly finds whatever `Object.prototype` supplies:
 * `node["constructor"]` is a function rather than `undefined`, and a token
 * named `constructor` — which `isTokenName` accepts, because it is a perfectly
 * ordinary name — was refused as though the site already held it. The document
 * came back `{}` with "exported more than once" beside it, so the token could
 * not leave this system at all. `toString`, `valueOf` and the rest of the
 * prototype behaved the same way, at a leaf or at any segment on the way down.
 *
 * `__proto__` is the one name that would also corrupt the ASSIGNMENT rather
 * than only the lookup, and it cannot arrive here: `tokensToDtcg` refuses a
 * name `isTokenName` rejects, and that regex requires a letter first.
 */
function place(
  root: DtcgNode,
  path: string[],
  entry: DtcgNode,
  issues: ValidationIssue[]
): void {
  let node = root;
  for (let index = 0; index < path.length - 1; index++) {
    const segment = path[index] ?? "";
    const existing = Object.hasOwn(node, segment) ? node[segment] : undefined;
    if (existing === undefined) {
      const group: DtcgNode = {};
      node[segment] = group;
      node = group;
      continue;
    }
    if (!isPlainObject(existing) || "$value" in existing) {
      // A token and a group cannot share a path: `color.primary` and
      // `color.primary.hover` ask for `primary` to be both.
      issues.push(
        issue(
          `"${path.join(".")}" cannot be exported, because "${path.slice(0, index + 1).join(".")}" is already a token.`
        )
      );
      return;
    }
    node = existing;
  }
  const leaf = path[path.length - 1] ?? "";
  if (Object.hasOwn(node, leaf)) {
    issues.push(issue(`"${path.join(".")}" is exported more than once.`));
    return;
  }
  node[leaf] = entry;
}

/* ------------------------------------------------------------------ import */

/**
 * The tokens a DTCG document describes.
 *
 * Everything it cannot read is reported rather than guessed at, because a token
 * imported with the wrong value is worse than one that did not arrive: the site
 * renders, and nobody looks again.
 */
export function dtcgToTokens(input: unknown): {
  tokens: SiteToken[];
  issues: ValidationIssue[];
} {
  const tokens: SiteToken[] = [];
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(input)) {
    return {
      tokens,
      issues: [issue("The file is not a design-token document.")],
    };
  }
  const { tree, carried } = takeCarried(input, issues);
  const resolved = resolveAliases(tree);
  issues.push(...resolved.issues);
  read(resolved.document, [], undefined, tokens, issues);
  // The variables the format could not type, read by the same reader as every
  // token, so the rules a token is held to cannot differ by where it was kept.
  const named = new Set(tokens.map(token => token.name));
  for (const [name, entry] of Object.entries(carried)) {
    if (named.has(name)) {
      issues.push(
        issue(
          `"${name}" is described twice in the file, as a token and in ${NEXTLY_EXTENSION}, so the second was skipped.`
        )
      );
      continue;
    }
    if (!isPlainObject(entry)) {
      issues.push(
        issue(
          `"${name}" in ${NEXTLY_EXTENSION} is not a variable this site can read, so it was skipped.`
        )
      );
      continue;
    }
    if (!holdsStoredValue(entry)) {
      issues.push(
        issue(
          `"${name}" in ${NEXTLY_EXTENSION} holds stored data that could not be read, so it was skipped.`
        )
      );
      continue;
    }
    const token = readToken(entry, name.split("."), undefined, issues);
    if (token !== undefined) {
      named.add(name);
      tokens.push(token);
    }
  }
  return { tokens, issues };
}

/**
 * Whether a carried entry states its stored CSS and kind, the only way one can
 * be read: it has no `$type` or `$value` to fall back on.
 */
function holdsStoredValue(entry: DtcgNode): boolean {
  const own = statedExtensions(entry)?.[NEXTLY_EXTENSION];
  return (
    isPlainObject(own) &&
    isPlainObject(own.css) &&
    typeof own.css.light === "string" &&
    isKind(own.kind)
  );
}

/**
 * The document without the variables this system carried in its own root
 * extension, and those variables by name.
 *
 * Taken out before the tree is walked, so the walk reports what is left of the
 * root's extensions as it always did, and never this system's own data.
 */
function takeCarried(
  input: DtcgNode,
  issues: ValidationIssue[]
): { tree: DtcgNode; carried: DtcgNode } {
  const extensions = statedExtensions(input);
  const own = extensions?.[NEXTLY_EXTENSION];
  if (extensions === undefined || !isPlainObject(own) || !(CARRIED in own)) {
    return { tree: input, carried: {} };
  }
  const { [CARRIED]: variables, ...ownRest } = own;
  const { [NEXTLY_EXTENSION]: _own, ...otherVendors } = extensions;
  const rest: DtcgNode =
    Object.keys(ownRest).length === 0
      ? otherVendors
      : { ...otherVendors, [NEXTLY_EXTENSION]: ownRest };
  const { $extensions: _all, ...tree } = input;
  if (!isPlainObject(variables)) {
    issues.push(
      issue(
        `The file's ${NEXTLY_EXTENSION} "${CARRIED}" is not a list of variables, so none of it was read.`
      )
    );
  }
  return {
    tree:
      Object.keys(rest).length === 0 ? tree : { ...tree, $extensions: rest },
    carried: isPlainObject(variables) ? variables : {},
  };
}
