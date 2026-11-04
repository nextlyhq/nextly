/**
 * A block's link as the inspector edits it: which props make it up, what is
 * stored in them, and what each pick, switch and flag writes back.
 *
 * A link is one thing to an author and several props to a block: where it
 * goes (`href` or `link`), how it opens (`target`), what it says about the
 * page it points at (`rel`) and, on a button, the entry it points at
 * (`entryCollection` and `entryId`). Drawn one row per prop, the panel showed
 * "Open link in" and "Link relationship" on a heading with no link at all, and
 * asked for a collection's slug and an entry's id by hand. The group lets the
 * inspector draw them as one control instead, while the block schemas stay as
 * they are.
 *
 * The group is found by prop NAME and type, never by type alone: an image's
 * `src` and a form's `action` are `url` props too, and neither is a link.
 *
 * Pure, so each rule is tested without a panel.
 *
 * @module link-group
 */
import { propIsSet, type EditableProp } from "./inspector";

/** The props of one block's link, by the names the block declares them under. */
export interface LinkGroup {
  /** Where the link goes: `href` or `link`. */
  readonly link: string;
  /** How it opens, when the block declares a target that can be `_blank`. */
  readonly target?: string;
  /** Its `rel` tokens, when the block declares them. */
  readonly rel?: string;
  /**
   * The entry it points at, when the block declares both halves of the
   * reference. An entry beats a typed address where the block renders: it
   * survives the entry being renamed.
   */
  readonly entry?: { readonly collection: string; readonly id: string };
  /** Every prop drawn inside the group, the link's own included. */
  readonly drawn: ReadonlySet<string>;
}

/** The names a link's own prop is declared under, in the order they are tried. */
const LINK_NAMES = ["href", "link"] as const;

/**
 * Whether a `target` prop is exactly "this tab or a new tab": a select whose
 * options are `_self` and `_blank` and nothing else, in either order. Only
 * then does a switch say all it can hold; a target offering `_parent` or a
 * named frame keeps its own menu, since a switch would hide those choices.
 */
function isNewTabTarget(schema: EditableProp["schema"] | undefined): boolean {
  if (schema?.type !== "select" || !Array.isArray(schema.options)) return false;
  const options = new Set(schema.options);
  return (
    schema.options.length === 2 &&
    options.size === 2 &&
    options.has("_self") &&
    options.has("_blank")
  );
}

/**
 * The link group of a block's props, or `undefined` when it declares no link.
 *
 * Each sibling joins only with the type its control writes: a `target` that
 * is not exactly this tab or a new tab is not one a switch can stand for
 * (see {@link isNewTabTarget}), and an entry
 * reference missing either half is not one a pick can complete. A sibling
 * that does not join keeps its own row.
 */
export function linkGroupOf(
  props: ReadonlyArray<Pick<EditableProp, "name" | "schema">>
): LinkGroup | undefined {
  const schemas = new Map(props.map(prop => [prop.name, prop.schema]));
  const link = LINK_NAMES.find(name => schemas.get(name)?.type === "url");
  if (link === undefined) return undefined;
  const target = isNewTabTarget(schemas.get("target")) ? "target" : undefined;
  const rel = schemas.get("rel")?.type === "text" ? "rel" : undefined;
  const entry =
    schemas.get("entryCollection")?.type === "text" &&
    schemas.get("entryId")?.type === "text"
      ? { collection: "entryCollection", id: "entryId" }
      : undefined;
  const drawn = new Set<string>([link]);
  if (target !== undefined) drawn.add(target);
  if (rel !== undefined) drawn.add(rel);
  if (entry !== undefined) {
    drawn.add(entry.collection);
    drawn.add(entry.id);
  }
  return {
    link,
    ...(target === undefined ? {} : { target }),
    ...(rel === undefined ? {} : { rel }),
    ...(entry === undefined ? {} : { entry }),
    drawn,
  };
}

/**
 * A stored string the inspector counts as set, trimmed, or `undefined`.
 *
 * Asked through `propIsSet`, the one rule the inspector's `onlyWithout` and
 * the renderer read: for the link prop that is the engine's URL policy, so a
 * stored `javascript:` address the page would never follow reads as no link
 * here too, rather than as a link the block does not render.
 */
function storedString(
  schema: { readonly type: string } | undefined,
  value: unknown
): string | undefined {
  if (typeof value !== "string" || !propIsSet(schema, value)) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The link prop's type, which decides what counts as a link that is set. */
const URL_PROP = { type: "url" } as const;

/** What a block's link holds now. */
export type LinkValue =
  | { readonly kind: "none" }
  | { readonly kind: "address"; readonly href: string }
  | {
      readonly kind: "entry";
      readonly collection: string;
      readonly id: string;
    };

/**
 * What the group's props hold, read the way the block renders them: an entry
 * reference with both halves set wins over an address, as `core/button`
 * resolves it first.
 */
export function linkValueOf(
  group: LinkGroup,
  values: Readonly<Record<string, unknown>>
): LinkValue {
  if (group.entry !== undefined) {
    const collection = storedString(undefined, values[group.entry.collection]);
    const id = storedString(undefined, values[group.entry.id]);
    if (collection !== undefined && id !== undefined) {
      return { kind: "entry", collection, id };
    }
  }
  const href = storedString(URL_PROP, values[group.link]);
  return href === undefined ? { kind: "none" } : { kind: "address", href };
}

/** What kind of address a link is, which decides its icon. */
export type LinkKind = "web" | "path" | "mail" | "phone" | "anchor";

/**
 * The kind of address `value` reads as, or `undefined` when it is not one
 * the control recognises as an address by its shape: a web address
 * (`https://`, or `//host`), a path on this site (`/pricing`), an email
 * (`mailto:`), a phone number (`tel:`) or a place on the page (`#faq`).
 *
 * Recognised text is offered as an address first while searching, since
 * nobody titles a page `https://…`.
 */
export function linkKindOf(value: string): LinkKind | undefined {
  const typed = value.trim();
  if (/^https?:\/\/\S/i.test(typed) || /^\/\/\S/.test(typed)) return "web";
  if (/^mailto:\S/i.test(typed)) return "mail";
  if (/^tel:\S/i.test(typed)) return "phone";
  if (/^#\S/.test(typed)) return "anchor";
  if (typed.startsWith("/")) return "path";
  return undefined;
}

/** A host name with no scheme before it: `example.com`, `www.example.com/x`. */
const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i;

/**
 * What "Use as a URL" stores for typed text, or `undefined` when nothing
 * should be offered: empty text, or an address the page could never follow
 * (`javascript:` and the other schemes the engine refuses, which the block
 * would render as no link at all).
 *
 * A bare host name gains `https://`. Stored as typed it would be a path on
 * this site, `/example.com`, which is never what someone typing a domain
 * meant.
 */
export function addressFor(typed: string): string | undefined {
  const trimmed = typed.trim();
  if (trimmed === "") return undefined;
  const address =
    linkKindOf(trimmed) === undefined && BARE_HOST.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;
  return propIsSet(URL_PROP, address) ? address : undefined;
}

/**
 * The `rel` flags offered as checkboxes, in the order they are listed:
 * Nofollow first, as the one most asked for.
 */
export const REL_FLAGS: ReadonlyArray<{
  readonly token: string;
  readonly label: string;
}> = [
  { token: "nofollow", label: "Nofollow" },
  { token: "sponsored", label: "Sponsored" },
  { token: "ugc", label: "User-generated" },
];

/** A stored `rel` as its tokens, in their stored order, each once. */
export function relTokens(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const seen = new Set<string>();
  return value.split(/\s+/).filter(token => {
    const key = token.toLowerCase();
    if (token === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Whether `value` holds `token`. Compared as HTML does: ignoring case. */
export function relHas(value: unknown, token: string): boolean {
  const wanted = token.toLowerCase();
  return relTokens(value).some(each => each.toLowerCase() === wanted);
}

/**
 * The stored tokens that are none of the checkboxes', such as a `me` an API
 * write stored: kept by every change here, and shown so they can be removed.
 */
export function relOthers(value: unknown): string[] {
  const flags = new Set(REL_FLAGS.map(flag => flag.token));
  return relTokens(value).filter(token => !flags.has(token.toLowerCase()));
}

/**
 * `value` with `token` added or taken out, every other token kept in its
 * place. `undefined` when no token is left, so the prop is removed rather
 * than stored empty.
 */
export function relWith(
  value: unknown,
  token: string,
  on: boolean
): string | undefined {
  const wanted = token.toLowerCase();
  const kept = relTokens(value).filter(each => each.toLowerCase() !== wanted);
  const next = on ? [...kept, wanted] : kept;
  return next.length === 0 ? undefined : next.join(" ");
}

/** What one change to the group writes: a value per prop, `undefined` to remove it. */
export type LinkChanges = Readonly<Record<string, unknown>>;

/** Where a pick in the link control goes. */
export type LinkPick =
  | { readonly kind: "address"; readonly href: string }
  | {
      readonly kind: "entry";
      readonly collection: string;
      readonly id: string;
    };

/**
 * What a pick writes.
 *
 * An address (a page's path, or a typed URL) is stored in the link prop and
 * clears an entry reference, which would otherwise win where the block
 * renders and the pick would seem to do nothing. An entry is stored as its
 * reference and clears the address, so the block holds one destination.
 * `undefined` for an entry pick on a block with no entry reference to hold it.
 */
export function pickChanges(
  group: LinkGroup,
  pick: LinkPick
): LinkChanges | undefined {
  if (pick.kind === "entry") {
    if (group.entry === undefined) return undefined;
    return {
      [group.entry.collection]: pick.collection,
      [group.entry.id]: pick.id,
      [group.link]: undefined,
    };
  }
  return {
    [group.link]: pick.href,
    ...(group.entry === undefined
      ? {}
      : { [group.entry.collection]: undefined, [group.entry.id]: undefined }),
  };
}

/**
 * What clearing the link writes: every prop in the group removed. The target
 * and the `rel` go with it, because they mean nothing without a link and are
 * shown only while one is set: left behind, a new link would arrive opening
 * in a new tab, marked sponsored, with nothing on screen saying so.
 */
export function clearChanges(group: LinkGroup): LinkChanges {
  return Object.fromEntries([...group.drawn].map(name => [name, undefined]));
}

/**
 * The props `changes` leaves, applied over `props`: a value replaces, and
 * `undefined` removes. One write for several props, so a pick that sets an
 * entry and clears an address is one step to undo.
 */
export function withChanges(
  props: Readonly<Record<string, unknown>>,
  changes: LinkChanges
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...props };
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) delete next[name];
    else next[name] = value;
  }
  return next;
}
