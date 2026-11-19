/**
 * Reading a DTCG file's groups and tokens: names and reserved keys, a
 * token's
 * fields a reader leaves unread, and one token read into a Nextly token.
 *
 * @module style/dtcg-read
 */
import type { ValidationIssue } from "../validation";

import type { TokenKind } from "./catalog-types";
import {
  DTCG_TYPE,
  type DtcgNode,
  isPlainObject,
  issue,
  KIND_BY_TYPE,
  NEXTLY_EXTENSION,
  statedDescription,
  statedExtensions,
  statedType,
} from "./dtcg-format";
import {
  authoredDescription,
  kindRefusal,
  reportOverridden,
  reportUnreadMembers,
  statedLabelOf,
  unreadIn,
} from "./dtcg-report";
import { fromDtcgValue, isKind, isWritableValue } from "./dtcg-values";
import {
  isAuthorableTokenName,
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_NAME_SEGMENTS,
  type SiteToken,
  tokenNamingProblem,
} from "./site-tokens";

/**
 * What a DTCG name may not contain: "the following characters MUST NOT be used
 * anywhere in a token or group name: `{`, `}`, `.`".
 */
const DTCG_NAME_FORBIDDEN = /[.{}]/;

/**
 * Whether a key is one of the format's own rather than a name. The format
 * reserves the `$` prefix for its fields and for `$root`, so the walk reads no
 * such key as a token or a group.
 */
export function isReservedKey(key: string): boolean {
  return key.startsWith("$");
}

/**
 * A token's group and fluid sizes from this system's own extension: each
 * taken in the shape a site stores, and named and left out otherwise.
 */
function statedShown(
  own: unknown,
  name: string,
  issues: ValidationIssue[]
): Pick<SiteToken, "group" | "fluid"> {
  if (!isPlainObject(own)) return {};
  const group = takenOrSaid(
    own.group,
    isGroupName,
    `"${name}" has a group that is not a name, so it was ignored.`,
    issues
  );
  const fluid = takenOrSaid(
    own.fluid,
    isFluidSizes,
    `"${name}" has fluid sizes that are not two sizes in px, so they were ignored.`,
    issues
  );
  return {
    ...(group === undefined ? {} : { group }),
    ...(fluid === undefined
      ? {}
      : { fluid: { small: fluid.small, large: fluid.large } }),
  };
}

/** A stated field in the shape it must take, or nothing, said when it isn't. */
function takenOrSaid<T>(
  value: unknown,
  shaped: (value: unknown) => value is T,
  said: string,
  issues: ValidationIssue[]
): T | undefined {
  if (value === undefined) return undefined;
  if (shaped(value)) return value;
  issues.push(issue(said));
  return undefined;
}

/** A colour's group: a name with something in it. */
function isGroupName(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** A fluid size's two sizes: positive, finite numbers of px. */
function isFluidSizes(
  value: unknown
): value is { small: number; large: number } {
  return (
    isPlainObject(value) &&
    [value.small, value.large].every(
      size => typeof size === "number" && Number.isFinite(size) && size > 0
    )
  );
}

/**
 * Whether a string names a token or a group: not blank, not reserved, and free
 * of what a name may not contain.
 *
 * Built from the two rules the walk holds a key to — the reserved prefix and the
 * forbidden characters — so a reference cannot accept a segment the walk would
 * never have read as a group.
 */
export function isDtcgName(segment: string): boolean {
  return (
    segment.trim() !== "" &&
    !isReservedKey(segment) &&
    !DTCG_NAME_FORBIDDEN.test(segment)
  );
}

/**
 * Whether a node is a token: an object carrying `$value`.
 *
 * The walk reads a child as a token by this, and the report calls a group's
 * `$root` a skipped token by this, so the two cannot disagree about what a
 * token is — a `$root` holding a number is malformed input, not a token.
 */
export function isTokenNode(value: unknown): value is DtcgNode {
  return isPlainObject(value) && "$value" in value;
}

/** Walk a group, carrying the `$type` its children inherit. */
// RELOCATED, not written here — see the docblock of `dtcg.ts`.
// fallow-ignore-next-line complexity
export function read(
  node: DtcgNode,
  path: string[],
  inherited: string | undefined,
  tokens: SiteToken[],
  issues: ValidationIssue[]
): void {
  const groupType = statedType(node) ?? inherited;

  for (const [key, child] of Object.entries(node)) {
    const here = [...path, key];
    // A reserved key is the format's own, never a name. Each is either a field
    // a group is read for or said to be skipped, here, where the decision to
    // pass over it is made.
    if (isReservedKey(key)) {
      const unread = unreadGroupField(key, node, here.join("."));
      if (unread !== undefined) issues.push(issue(unread));
      continue;
    }
    if (!isPlainObject(child)) {
      issues.push(
        issue(
          `"${here.join(".")}" is neither a token nor a group of them, so it was skipped.`
        )
      );
      continue;
    }

    if (isTokenNode(child)) {
      const token = readToken(child, here, groupType, issues);
      if (token !== undefined) tokens.push(token);
      continue;
    }
    // Bounded BEFORE descending. A group path becomes a token's dot-separated
    // name, so the depth rule is the same one — but applying it at the leaf is
    // too late: this walk reaches the leaf by recursing, so a document nested
    // deeply enough exhausts the stack before any leaf is read. A file arrives
    // from outside this package, so that is untrusted input deciding how deep
    // this recursion goes.
    if (here.length > MAX_TOKEN_NAME_SEGMENTS) {
      issues.push(
        issue(
          `"${here.slice(0, 4).join(".")}..." is nested more than ${MAX_TOKEN_NAME_SEGMENTS} groups deep, so it and everything under it was skipped.`
        )
      );
      continue;
    }
    read(child, here, groupType, tokens, issues);
  }
}

/**
 * Why one of a GROUP's own `$` fields is not kept, or `undefined` when it is.
 *
 * An ALLOWLIST, for this function and {@link unreadTokenField} alike: each
 * branch names a field the reader takes, in the shape it takes it, and every
 * other `$` key is reported. The opposite question — which fields are lost —
 * cannot be finished, because the format keeps adding fields and each one this
 * reader has not learned would be dropped without a word. Asked this way, a
 * field the reader does take but nobody listed costs a visible line instead.
 *
 * A group is read for its `$type` alone, which its tokens inherit. Its own
 * description and extensions have nowhere to go: this site keeps tokens.
 */
function unreadGroupField(
  key: string,
  node: DtcgNode,
  at: string
): string | undefined {
  if (key === "$type") {
    return statedType(node) === undefined ? unusableType(at) : undefined;
  }
  if (key === "$description" || key === "$extensions") {
    return `"${at}" belongs to a group rather than to a token, and this site keeps only tokens, so it was skipped.`;
  }
  return unreadReservedField(key, node[key], at, "group");
}

/**
 * What a TOKEN holds that the reader will not keep, one line per part.
 *
 * Its named children as well as its fields: the reader stops at a token and
 * moves to the next sibling, so a token written inside another is never
 * reached — the loss least visible from outside, because the child looks
 * perfectly importable.
 */
function unreadTokenParts(node: DtcgNode, at: string): string[] {
  const unread: string[] = [];
  for (const key of Object.keys(node)) {
    const said = isReservedKey(key)
      ? unreadTokenField(key, node, `${at}.${key}`)
      : `"${at}.${key}" is written inside a token, where this site's reader does not look, so it was skipped.`;
    if (said !== undefined) unread.push(said);
  }
  return unread;
}

/**
 * Why one of a token's own `$` fields is not kept, or `undefined` when it is.
 *
 * Asked through the same accessors {@link readToken} reads with, and said before
 * the token is judged, so each line states only what is true whatever becomes
 * of the token: the field was ignored. Whether the token then arrived is the
 * refusal's or the import's to say.
 *
 * `$type` is the exception, answered by {@link typeUnread} where the kind is
 * chosen, because what stood in for an unusable type depends on that choice.
 */
function unreadTokenField(
  key: string,
  node: DtcgNode,
  at: string
): string | undefined {
  if (key === "$value" || key === "$type") return undefined;
  if (key === "$description") {
    return statedDescription(node) === undefined
      ? `"${at}" is not a string, so it was ignored.`
      : undefined;
  }
  if (key === "$extensions") {
    return statedExtensions(node) === undefined
      ? `"${at}" is not an object, so it was ignored.`
      : undefined;
  }
  return unreadReservedField(key, node[key], at, "token");
}

/**
 * The line for a `$` key no node is read for.
 *
 * The format's own fields are named for what they meant, because "a field this
 * site does not read" undersells two of them. `$extends` brings in another
 * group's tokens, so skipping it loses tokens rather than a note; `$root` is
 * not a field at all but a group's own token under a reserved name.
 *
 * Both of those meanings exist only on a GROUP. On a token neither inherits
 * nor holds anything, so there they are what any unknown key is, and saying
 * otherwise would describe a loss the file could not have had.
 */
function unreadReservedField(
  key: string,
  value: unknown,
  at: string,
  on: "group" | "token"
): string {
  if (on === "group" && key === "$root" && isTokenNode(value)) {
    return `"${at}" is a group's own token, which this site cannot read yet, so it was skipped.`;
  }
  if (on === "group" && key === "$extends" && isReference(value)) {
    return `"${at}" inherits from another group, which this site cannot follow yet, so nothing it would bring in was read.`;
  }
  if (key === "$deprecated") return deprecationUnread(value, at);
  return `"${at}" is a design-token field this site does not read, so it was skipped.`;
}

/**
 * The line for a `$type` that is not a name, naming the group type that stood in
 * for it only when one did.
 */
function unusableType(at: string, groupType?: string): string {
  const ignored = `"${at}" is not a usable type — a type is written as a name, such as "color" — so it was ignored`;
  return groupType === undefined
    ? `${ignored}.`
    : `${ignored} and the group's type "${groupType}" was used instead.`;
}

/**
 * The line for a token's own `$type` the reader could not use, or `undefined`.
 *
 * Asked where the kind is chosen, with the group type ONLY when that choice
 * fell back to it. This system's stored kind makes the type irrelevant, and a
 * token at the root has no group to fall back to, so crediting the group there
 * would describe a substitution that never happened.
 */
function typeUnread(
  node: DtcgNode,
  name: string,
  groupType?: string
): string | undefined {
  if (node.$type === undefined || statedType(node) !== undefined) {
    return undefined;
  }
  return unusableType(`${name}.$type`, groupType);
}

/**
 * The line for `$deprecated`, worded by what the value states.
 *
 * `true` or a reason marks the node deprecated; `false` explicitly clears a
 * deprecation it would inherit. Reporting either as the other tells an author
 * the opposite of what the file says.
 */
function deprecationUnread(value: unknown, at: string): string {
  if (value === true || typeof value === "string") {
    return `"${at}" marks it deprecated, which this site does not record, so the mark was skipped.`;
  }
  if (value === false) {
    return `"${at}" clears a deprecation, which this site does not record, so it was ignored.`;
  }
  return `"${at}" is not a usable deprecation — it is written as true, false or a reason — so it was ignored.`;
}

/**
 * Why this system's own stored values were passed over for `$value`, or
 * `undefined` when the extension states none.
 *
 * Asked only on the `$value` path, which is reached exactly when the stored
 * CSS was not taken. An extension carrying neither `css` nor `kind` states no
 * values — an id alone is what a rename travels as — so nothing was lost.
 */
function storedValuesUnread(own: unknown, name: string): string | undefined {
  if (!isPlainObject(own)) return undefined;
  if (own.css === undefined && own.kind === undefined) return undefined;
  return `"${name}.$extensions.${NEXTLY_EXTENSION}" does not state values this site can read — a light value as a string, and a kind the format has a type for — so its own values were skipped and the token was read from "$value" instead.`;
}

/** Why a stored dark value was not taken, or `undefined` when it was. */
function darkUnread(dark: unknown, name: string): string | undefined {
  return dark === undefined || typeof dark === "string"
    ? undefined
    : `"${name}.$extensions.${NEXTLY_EXTENSION}.css.dark" is not a string, so only its light value was read.`;
}

/**
 * Whether an `$extends` value references a group: `{group.path}`, a path of one
 * or more names. Any other value names no group, so there is no inheritance to
 * have lost.
 */
function isReference(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (!value.startsWith("{") || !value.endsWith("}")) return false;
  // Each segment is held to the rule the walk reads a group's name by, so
  // `{}`, `{a..b}` and `{base.$private}` name nothing it could have read.
  return value.slice(1, -1).split(".").every(isDtcgName);
}

/**
 * Why the type a file gives a token was not used, or `undefined` when it was.
 *
 * Asked where this system's stored kind is chosen over the file's type. The
 * next export writes the token's type from that kind, so a file stating a
 * different one — on the token or on a group around it — loses it silently
 * unless it is said here. Silent when the two agree, which every file this
 * system writes does.
 */
function typeOverriddenBy(
  kind: TokenKind,
  node: DtcgNode,
  name: string,
  inherited: string | undefined
): string | undefined {
  const stated = statedType(node) ?? inherited;
  if (stated === undefined || stated === DTCG_TYPE[kind]) return undefined;
  return `"${name}" is read as the kind "${kind}" this system stored, so the type "${stated}" the file gives it is not used.`;
}

/** One token, preferring this vendor's exact CSS over a conversion. */
// RELOCATED, not written here — see the docblock of `dtcg.ts`.
// fallow-ignore-next-line complexity
export function readToken(
  node: DtcgNode,
  path: string[],
  inherited: string | undefined,
  issues: ValidationIssue[]
): SiteToken | undefined {
  const name = path.join(".");
  // Said before anything decides whether the token is kept, because none of it
  // turns on that: a field in a shape the reader cannot take is lost either way.
  for (const unread of unreadTokenParts(node, name)) {
    issues.push(issue(unread));
  }
  // Every refusal below goes through here. An unusable `$type` is ignored
  // whatever else refuses the token, so it is named first, crediting no group;
  // a refusal with an exit of its own would leave that second problem unsaid.
  const refuse = (...reasons: ValidationIssue[]): undefined => {
    const ignored = typeUnread(node, name);
    if (ignored !== undefined) issues.push(issue(ignored));
    issues.push(...reasons);
    return undefined;
  };

  // Each segment on its own first. The format forbids `.` in a name, so a key
  // spelled `"color.primary"` is malformed — joined into the dot path it is
  // indistinguishable from the nested `color` -> `primary` it would collide
  // with, and the next export would rewrite it into exactly those groups.
  const malformed = path.find(segment => DTCG_NAME_FORBIDDEN.test(segment));
  if (malformed !== undefined) {
    return refuse(
      issue(
        `"${malformed}" is not a usable name in a design-token file: a name may not contain ".", "{" or "}". It was skipped.`
      )
    );
  }
  // The grammar only, here. Whether this name is also the string the token is
  // WRITTEN under depends on the id below, which has not been read yet — and a
  // file may legitimately carry a long label for a token whose stated id is
  // short. The cap is applied once the identity is known.
  if (!isAuthorableTokenName(name)) {
    return refuse(
      issue(`"${name}" is not a usable token name, so it was skipped.`)
    );
  }

  const declared = statedExtensions(node);
  const extensions = declared === undefined ? {} : { ...declared };
  const own = extensions[NEXTLY_EXTENSION];
  if (own !== undefined && !isPlainObject(own)) {
    // Deleted below with nothing read from it, so what it held is gone and the
    // next export writes a generated object in its place.
    issues.push(
      issue(
        `"${name}.$extensions.${NEXTLY_EXTENSION}" is not an object, so this site could not read it and did not keep it.`
      )
    );
  }
  // Carried, not consumed: everything except this vendor's own key goes back
  // out with the token, which is what the format requires of any tool.
  delete extensions[NEXTLY_EXTENSION];
  // Its own key is PARTITIONED instead: the fields below are read into the
  // model, and whatever else it holds is kept beside them so the export can
  // write it back.
  const unread = unreadIn(own);
  reportUnreadMembers(own, name, issues);

  const description = authoredDescription(node, own, name, issues);
  const carried = Object.keys(extensions).length > 0 ? extensions : undefined;

  // Read ahead of the branch below, because identity does not depend on which
  // value path is taken: an extension whose `css` is unreadable still says
  // which token this is, and the native `$value` beside it is that same token's
  // value. A file from Figma carries no such key and arrives with no id, which
  // is the same thing as arriving with its name for an identity.
  const stated = isPlainObject(own) ? own.id : undefined;
  if (
    stated !== undefined &&
    !(typeof stated === "string" && isAuthorableTokenName(stated))
  ) {
    return refuse(
      issue(
        `"${name}" carries an id that is not a usable token name, so it was skipped. Importing it without the id would give it a different identity from the one the file states, and every reference written against that identity would stop resolving.`
      )
    );
  }
  // A stated id equal to the name says exactly what an absent one says, so it
  // is normalised away — `id === undefined` then means one thing everywhere in
  // the model rather than two spellings of it.
  const id = stated === name ? undefined : stated;

  const label = statedLabelOf(own, name, issues);
  const shown = statedShown(own, name, issues);

  // The cap, now that the identity is settled. Held here rather than on either
  // field alone because the identity is what a stylesheet is written under: a
  // token whose stated id is short imports normally however long its label, and
  // one with no id is capped by that label because the label IS the identity.
  const naming = tokenNamingProblem({ name, id });
  if (naming !== undefined) {
    return refuse(
      issue(
        naming.reason === "depth"
          ? `"${name}" is nested too deeply, so it was skipped. A token name holds at most ${MAX_TOKEN_NAME_SEGMENTS} dot-separated parts.`
          : naming.reason === "length"
            ? `"${name}" is written under more than ${MAX_TOKEN_NAME_LENGTH} characters, so it was skipped. The ${naming.field} a token is written under is at most ${MAX_TOKEN_NAME_LENGTH} characters.`
            : `"${name}" has a ${naming.field} that is not a usable token name, so it was skipped.`
      )
    );
  }

  // Both value paths below finish identically — same identity, same label, same
  // description, same carried extensions — and differ only in the kind and
  // values they arrived at. Assembled once so the two cannot drift into
  // disagreeing about what a token read from a file IS, which is a
  // disagreement with no symptom: whichever path a given file happens to take
  // is the only one anyone sees.
  const assemble = (
    kind: TokenKind,
    values: { light: string; dark?: string },
    groupType: string | undefined,
    decided: readonly (string | undefined)[]
  ): SiteToken | undefined => {
    // The guard lives here rather than at each call, so the shorter extension
    // path cannot be the one that skips it: its CSS is arbitrary JSON from a
    // file exactly as `$value` is, and is trusted no further.
    const refusals: ValidationIssue[] = [];
    if (!isWritableValue(values, name, refusals)) return refuse(...refusals);
    // A loss belonging to the path taken is said only once that path has made
    // a token, so a token refused afterwards never reports how it was read.
    for (const line of [typeUnread(node, name, groupType), ...decided])
      if (line !== undefined) issues.push(issue(line));
    return {
      ...(id !== undefined ? { id } : {}),
      name,
      ...(label !== undefined ? { label } : {}),
      kind,
      values,
      ...(description !== undefined ? { description } : {}),
      ...shown,
      ...(carried !== undefined ? { extensions: carried } : {}),
      ...(unread !== undefined ? { unreadExtension: unread } : {}),
    };
  };

  // The exact CSS this system wrote, when the file came from here. Read field
  // by field rather than asserted: the extension is arbitrary JSON from a file,
  // and a cast would be this function agreeing to whatever shape it found.
  if (isPlainObject(own)) {
    const css = own.css;
    const kind = own.kind;
    if (isPlainObject(css) && typeof css.light === "string" && isKind(kind)) {
      const dark = css.dark;
      const values =
        typeof dark === "string"
          ? { light: css.light, dark }
          : { light: css.light };
      // Reported HERE, at the moment the choice between the two is made. This
      // is the only place that knows both what the file stated and what was
      // taken instead, so anywhere else would be guessing at that decision.
      reportOverridden(node.$value, css.light, kind, name, issues);
      return assemble(kind, values, undefined, [
        typeOverriddenBy(kind, node, name, inherited),
        darkUnread(dark, name),
      ]);
    }
  }

  const type = statedType(node) ?? inherited;
  const kind = type === undefined ? undefined : KIND_BY_TYPE.get(type);
  const unkind = kindRefusal(type, kind, extensions, name);
  if (unkind !== undefined || kind === undefined) {
    return refuse(issue(unkind ?? ""));
  }

  const light = fromDtcgValue(node.$value, kind);
  if (light === undefined) {
    return refuse(
      issue(`"${name}" has a value that could not be read, so it was skipped.`)
    );
  }

  return assemble(kind, { light }, inherited, [storedValuesUnread(own, name)]);
}
