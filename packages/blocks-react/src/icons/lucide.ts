/**
 * The Lucide icon set, resolved by id on the server.
 *
 * Its own entry (`@nextlyhq/blocks-react/icons/lucide`) rather than part of the
 * blocks library, because the data is large and only a SERVER render needs
 * it whole: the editor's canvas renders the same blocks in the browser, and
 * importing the set from a block would put every icon in the editor's bundle.
 * A block asks `PageContext.resolveIcon`, and the host decides where the
 * answer comes from — the published page's route supplies this resolver.
 *
 * The data is vendored from a pinned Lucide release by
 * `scripts/update-lucide.mjs`, rather than read through `lucide-react`, so a
 * site's own `lucide-react` version can never rename an icon on a published
 * page. Lucide is ISC-licensed; the licence ships in `third-party/lucide`.
 *
 * @module icons/lucide
 */
import type { ResolvedIcon } from "../context";

import type * as LucideSet from "./lucide-data";

/*
 * The set itself, loaded on first use and kept for the life of the process.
 * Imported statically, every server render and every cold start would parse
 * the whole set, on a site that never draws an icon as much as on one that
 * does.
 */
let loaded: Promise<typeof LucideSet> | undefined;
const lucideSet = (): Promise<typeof LucideSet> =>
  (loaded ??= import("./lucide-data"));

/** The set prefix every Lucide id carries: `lucide:star`. */
export const LUCIDE_PREFIX = "lucide";

/** The box every Lucide icon is drawn in. */
const VIEW_BOX = "0 0 24 24";

/**
 * An icon id's set and name, or `null` when it is not one: a set, a colon and
 * a name, each lower-case letters, digits and hyphens.
 */
export function parseIconId(
  id: string
): { readonly set: string; readonly name: string } | null {
  const match = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(id);
  return match === null ? null : { set: match[1] ?? "", name: match[2] ?? "" };
}

/**
 * A Lucide icon by id, or `null` for an id this set does not draw. A name
 * Lucide has renamed resolves to the icon it now is, so an id stored before a
 * rename keeps drawing; the answer names the current icon.
 */
export async function resolveLucideIcon(
  id: string
): Promise<ResolvedIcon | null> {
  const parsed = parseIconId(id);
  if (parsed === null || parsed.set !== LUCIDE_PREFIX) return null;
  const { LUCIDE_ALIASES, LUCIDE_ICONS } = await lucideSet();
  const name = Object.hasOwn(LUCIDE_ICONS, parsed.name)
    ? parsed.name
    : Object.hasOwn(LUCIDE_ALIASES, parsed.name)
      ? LUCIDE_ALIASES[parsed.name]
      : undefined;
  const body = name === undefined ? undefined : LUCIDE_ICONS[name];
  if (name === undefined || body === undefined) return null;
  return {
    id: `${LUCIDE_PREFIX}:${name}`,
    name,
    body,
    viewBox: VIEW_BOX,
    stroked: true,
  };
}

/** The words an icon is found by, for a picker's search. */
export async function lucideTagsOf(name: string): Promise<readonly string[]> {
  const { LUCIDE_TAGS } = await lucideSet();
  return Object.hasOwn(LUCIDE_TAGS, name) ? (LUCIDE_TAGS[name] ?? []) : [];
}

/** The Lucide release the set was taken from. */
export async function lucideVersion(): Promise<string> {
  return (await lucideSet()).LUCIDE_VERSION;
}
