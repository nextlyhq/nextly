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

/**
 * What the author reads when the page names a Layout their own reads do not
 * return: one hidden from them, or one that no longer exists. Nothing is
 * promised about publishing it, since it may not exist.
 */
export const LAYOUT_UNKNOWN_MESSAGE =
  "This page names a Layout you can't view, or one that no longer exists. If it no longer exists, the site's default Layout shows instead.";

/** The same, when the site has no usable default to show. */
export const LAYOUT_UNKNOWN_NO_DEFAULT_MESSAGE =
  "This page names a Layout you can't view, or one that no longer exists. If it no longer exists, the page shows no header or footer.";

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
 * no header or footer, rather than assuming a default exists. A Layout the
 * write cannot read is named as hidden or gone, and nothing is promised
 * about publishing it.
 */
async function adviceFor(
  nextly: Pick<DefaultLayoutDirectApi, "find" | "findSingle">,
  slugs: { layouts: string; settings: string },
  named: string,
  reading: WriteReading
): Promise<string | null> {
  const { defaultLayout } = await readLayoutSettings(nextly, slugs);
  const defaultPublished =
    defaultLayout !== null &&
    (await publishedLayoutIds(nextly, slugs, [defaultLayout])).has(
      defaultLayout
    );
  // Whether it exists, asked with the write's own access: a Layout the
  // writer may not read is not theirs to learn about, so it is told apart
  // from a deleted one by nothing they could not read themselves.
  const row = await namedRow(nextly, slugs.layouts, named, reading);
  const resolution = resolvePageLayout(
    { layout: named, noHeaderFooter: false },
    {
      defaultLayout,
      isPublished: id =>
        id === named ? row?.published === true : defaultPublished,
    }
  );
  if (resolution.kind === "layout" && resolution.source === "page") return null;
  const defaultShows = resolution.kind === "layout";
  if (row === null) {
    return defaultShows
      ? LAYOUT_UNKNOWN_MESSAGE
      : LAYOUT_UNKNOWN_NO_DEFAULT_MESSAGE;
  }
  return defaultShows
    ? LAYOUT_NOT_PUBLISHED_MESSAGE
    : LAYOUT_NOT_PUBLISHED_NO_DEFAULT_MESSAGE;
}

/** Whom the existence read is made as: the write's own identity. */
type WriteReading =
  | { overrideAccess: true; user: undefined; req: undefined }
  | { overrideAccess: false; user: NonNullable<HookContext<unknown>["user"]> };

/**
 * The write's own access: its user's where a user made it, and the system's
 * for a write the system made, which no rule refuses.
 */
function writeReading(context: HookContext<unknown>): WriteReading {
  const user = context.user;
  return user === undefined
    ? { overrideAccess: true, user: undefined, req: undefined }
    : { overrideAccess: false, user };
}

/** The named Layout's row as the write may read it, or null. */
async function namedRow(
  nextly: Pick<DefaultLayoutDirectApi, "find">,
  layouts: string,
  named: string,
  reading: WriteReading
): Promise<{ published: boolean } | null> {
  const found = await nextly.find({
    collection: layouts,
    where: { id: { in: [named] } },
    ...reading,
    status: "all",
    select: { id: true, status: true },
    limit: 1,
    depth: 0,
  });
  const row = found.items[0] as { status?: unknown } | undefined;
  return row === undefined ? null : { published: row.status === "published" };
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
  const message = await adviceFor(
    target.nextly,
    args,
    named,
    writeReading(context)
  );
  if (message === null) return;
  recordAdvisoryNotice({
    phase,
    collection: target.slug,
    code: LAYOUT_NOT_PUBLISHED_CODE,
    message,
    entryId: target.documentId,
  });
}
