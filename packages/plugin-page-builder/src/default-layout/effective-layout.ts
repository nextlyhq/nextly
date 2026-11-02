/**
 * The Layout a stored page is drawn inside, read from the site.
 *
 * The RULE is `resolvePageLayout` from the engine, which every reader shares;
 * this only supplies what the rule asks about the site — the default the
 * settings Single names, and which of the Layouts in question are published
 * now — in two reads.
 *
 * It reads and never writes. A published route calls it per visitor request,
 * so a site that lost its default must not turn each of those requests into a
 * write; the repair job's sweep checks the default on every jobs pass instead.
 *
 * @module default-layout/effective-layout
 */
import {
  resolvePageLayout,
  type LayoutResolution,
  type PageLayoutChoice,
} from "@nextlyhq/blocks-engine";

import {
  publishedLayoutIds,
  readLayoutSettings,
  relationId,
  type DefaultLayoutDirectApi,
  type DefaultLayoutSlugs,
} from "./store";

/** What the helper reads through. */
export interface EffectiveLayoutDeps {
  readonly nextly: DefaultLayoutDirectApi;
  /** The RESOLVED slugs; a host may rename the Layouts collection. */
  readonly slugs: DefaultLayoutSlugs;
}

/**
 * The Layout `page` gets, by the shared rule.
 *
 * A page's stored `layout` may arrive populated, so it is read as an id. A
 * `no-default` answer means no regions, with the reason.
 *
 * @experimental May still change before Layouts are marked stable. The page
 * route answers the same question itself, with the same engine rule.
 */
export async function effectiveLayoutFor(
  // The stored page as read: `layout` an id or a populated row.
  page: { layout?: unknown; noHeaderFooter?: boolean | null },
  deps: EffectiveLayoutDeps
): Promise<LayoutResolution> {
  const choice: PageLayoutChoice = {
    layout: relationId(page.layout),
    noHeaderFooter: page.noHeaderFooter ?? null,
  };
  // The switch wins without any read: a page drawn with no regions needs no
  // answer about Layouts.
  if (choice.noHeaderFooter === true) {
    return resolvePageLayout(choice, {
      defaultLayout: null,
      isPublished: () => false,
    });
  }

  const { defaultLayout } = await readLayoutSettings(deps.nextly, deps.slugs);
  const asked = [choice.layout, defaultLayout].filter(
    (id): id is string => typeof id === "string"
  );
  const published = await publishedLayoutIds(deps.nextly, deps.slugs, asked);
  return resolvePageLayout(choice, {
    defaultLayout,
    isPublished: id => published.has(id),
  });
}
