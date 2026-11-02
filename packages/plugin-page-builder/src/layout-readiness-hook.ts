/**
 * Say so when a page is published naming a Layout that is not.
 *
 * Such a page is served inside the site's default Layout until its own is
 * published, which an author publishing it may not expect. The full offer
 * ("Publish page only" or "Publish both", before the publish) needs the
 * editor's warn-and-offer flow; until that exists this is the after-commit
 * advisory the API writer and the form both receive, as the component
 * readiness notice is.
 *
 * Never blocks and never throws: the publish succeeded, and the page is
 * served correctly by the rule; the notice only tells the author what that
 * rule will show.
 *
 * @module layout-readiness-hook
 */
import { layoutRelationId, resolvePageLayout } from "@nextlyhq/blocks-engine";
import type { HookContext } from "nextly";
import { recordAdvisoryNotice } from "nextly";

import { leavesDocumentPublished } from "./component-readiness-hook";
import {
  publishedLayoutIds,
  readLayoutSettings,
  type DefaultLayoutDirectApi,
} from "./default-layout/store";
import { requestContextFor, writeTargetOf } from "./write-target";

/** The canonical code a consumer branches on. */
export const LAYOUT_NOT_PUBLISHED_CODE = "LAYOUT_NOT_PUBLISHED";

/** What the author reads when the site's default Layout shows meanwhile. */
export const LAYOUT_NOT_PUBLISHED_MESSAGE =
  "This page names a Layout that is not published, so it is shown inside the site's default Layout until that Layout is published.";

/** What the author reads when the site has no usable default to show. */
export const LAYOUT_NOT_PUBLISHED_NO_DEFAULT_MESSAGE =
  "This page names a Layout that is not published, so it is shown with no header or footer until that Layout is published.";

/** The publishing phases a page's write passes through. */
const PUBLISHING_PHASES = ["afterCreate", "afterUpdate"] as const;

/** What the hook needs from the plugin context. */
export interface LayoutReadinessContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: HookContext<unknown>) => unknown
    ): void;
  };
  services: {
    collections: {
      getCollection(name: string, context: unknown): Promise<unknown>;
    };
  };
}

/** Wire the advisory to the pages collection's publishing writes. */
export function registerLayoutReadinessNotice(args: {
  ctx: LayoutReadinessContext;
  /** The RESOLVED slugs: a host may rename either collection. */
  pages: string;
  layouts: string;
  settings: string;
}): void {
  for (const phase of PUBLISHING_PHASES) {
    args.ctx.hooks.on(phase, args.pages, async context => {
      try {
        await report(args, context, phase);
      } catch {
        // Deliberately silent: an advisory that cannot be composed is not
        // shown, and turning that into an error would report a clean publish
        // as a broken one.
      }
    });
  }
}

/**
 * What a published page naming `named` is told, or null when its Layout is
 * the one it gets.
 *
 * Asked of the rule the published route uses, so the notice says what a
 * visitor gets: the site's default Layout where one is usable, and otherwise
 * no header or footer, rather than assuming a default exists.
 */
async function adviceFor(
  nextly: Pick<DefaultLayoutDirectApi, "find" | "findSingle">,
  slugs: { layouts: string; settings: string },
  named: string
): Promise<string | null> {
  const { defaultLayout } = await readLayoutSettings(nextly, slugs);
  const published = await publishedLayoutIds(
    nextly,
    slugs,
    defaultLayout === null ? [named] : [named, defaultLayout]
  );
  const resolution = resolvePageLayout(
    { layout: named, noHeaderFooter: false },
    { defaultLayout, isPublished: id => published.has(id) }
  );
  if (resolution.kind === "none")
    return LAYOUT_NOT_PUBLISHED_NO_DEFAULT_MESSAGE;
  return resolution.source === "page" ? null : LAYOUT_NOT_PUBLISHED_MESSAGE;
}

async function report(
  args: Parameters<typeof registerLayoutReadinessNotice>[0],
  context: HookContext<unknown>,
  phase: string
): Promise<void> {
  const target =
    writeTargetOf<Pick<DefaultLayoutDirectApi, "find" | "findSingle">>(context);
  if (target === null) return;
  const collection = await args.ctx.services.collections.getCollection(
    target.slug,
    requestContextFor(context)
  );
  // Only a write that leaves the page published: a draft is not served.
  if (!leavesDocumentPublished(context, collection)) return;
  const data = (context as unknown as { data?: Record<string, unknown> }).data;
  // The switch wins: a page with no header or footer names nothing it shows.
  if (data?.noHeaderFooter === true) return;
  const named = layoutRelationId(data?.layout);
  if (named === null) return;
  const message = await adviceFor(target.nextly, args, named);
  if (message === null) return;
  recordAdvisoryNotice({
    phase,
    collection: target.slug,
    code: LAYOUT_NOT_PUBLISHED_CODE,
    message,
    entryId: target.documentId,
  });
}
