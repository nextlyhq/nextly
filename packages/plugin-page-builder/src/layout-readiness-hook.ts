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
import { layoutRelationId } from "@nextlyhq/blocks-engine";
import type { HookContext } from "nextly";
import { recordAdvisoryNotice } from "nextly";

import { leavesDocumentPublished } from "./component-readiness-hook";
import {
  publishedLayoutIds,
  type DefaultLayoutDirectApi,
} from "./default-layout/store";
import { requestContextFor, writeTargetOf } from "./write-target";

/** The canonical code a consumer branches on. */
export const LAYOUT_NOT_PUBLISHED_CODE = "LAYOUT_NOT_PUBLISHED";

/** What the author reads. */
export const LAYOUT_NOT_PUBLISHED_MESSAGE =
  "This page names a Layout that is not published, so it is shown inside the site's default Layout until that Layout is published.";

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

async function report(
  args: Parameters<typeof registerLayoutReadinessNotice>[0],
  context: HookContext<unknown>,
  phase: string
): Promise<void> {
  const target = writeTargetOf<Pick<DefaultLayoutDirectApi, "find">>(context);
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
  const published = await publishedLayoutIds(
    target.nextly,
    { layouts: args.layouts, settings: args.settings },
    [named]
  );
  if (published.has(named)) return;
  recordAdvisoryNotice({
    phase,
    collection: target.slug,
    code: LAYOUT_NOT_PUBLISHED_CODE,
    message: LAYOUT_NOT_PUBLISHED_MESSAGE,
    entryId: target.documentId,
  });
}
