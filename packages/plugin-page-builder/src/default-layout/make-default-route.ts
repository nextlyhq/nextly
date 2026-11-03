/**
 * `POST /layouts/:id/make-default`: the one way to choose the site's default
 * Layout.
 *
 * ## What it checks, in order, before it writes
 *
 * 1. The declared permission, `manage-page-builder-site`, enforced by core
 *    before this handler runs.
 * 2. That the caller may update AND publish Layouts. The default wraps every
 *    page that names no Layout, so choosing it is a site-wide publish, and a
 *    role that cannot publish a Layout must not be able to put one live this
 *    way instead.
 * 3. That the Layout exists and its main row is published now. A published
 *    Layout holding an unpublished edit keeps its main row published and is
 *    accepted: what pages draw is the published form.
 *
 * Only then is the settings Single written, as the system and with the marker
 * its guard admits.
 *
 * ## After it writes
 *
 * An unpublish can race the write: it checks the default before this commits,
 * finds another Layout there, and goes ahead. So the Layout is read once more
 * after the write; if it is no longer published, the call is refused, and the
 * previous default is written back unless a newer make-default has replaced
 * this one's write in the meantime (that later request owns the default).
 *
 * Two make-default calls at once each write one reference to one Single, so
 * the later write wins and the default is exactly one of the two.
 *
 * @module default-layout/make-default-route
 */
import {
  getCachedNextly,
  NextlyError,
  respondMutation,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { LAYOUTS_SLUG } from "../collections/layouts";
import { MANAGE_SITE_PERMISSION } from "../site-settings";

import { PAGE_BUILDER_SETTINGS_SLUG } from "./settings-single";
import {
  layoutExists,
  publishedLayoutIds,
  readLayoutSettings,
  writeLayoutSettings,
  type DefaultLayoutDirectApi,
  type DefaultLayoutSlugs,
} from "./store";

/** Where the route answers, under the plugin's namespace. */
const MAKE_DEFAULT_ROUTE_PATH = "/layouts/:id/make-default";

/**
 * The request body. `dryRun` answers what would change and writes nothing, so
 * an admin screen can show the consequence before the author confirms. Unknown
 * keys are refused rather than dropped: the body has one option, and a typo of
 * it silently ignored would perform the write the caller meant to preview.
 */
const MakeDefaultBody = z.strictObject({ dryRun: z.boolean().optional() });

/** The capabilities this route uses, named rather than imported whole. */
export interface MakeDefaultRouteContext {
  self: {
    collections: Record<string, string | undefined>;
    singles: Record<string, string | undefined>;
  };
  user: { id: string } | null;
  caller: { can(action: string, resource: string): Promise<boolean> } | null;
  params: Record<string, string>;
  logger: { warn(message: string, meta?: Record<string, unknown>): void };
}

/** What the route answers with, inside the mutation envelope's `item`. */
interface MakeDefaultResult {
  defaultLayout: string;
  previousDefaultLayout: string | null;
  dryRun: boolean;
}

/**
 * Make one Layout the site's default, as the module docblock describes.
 *
 * `nextly` is a parameter so the route resolves the Direct API per call,
 * through the SDK, rather than holding one from before boot finished.
 */
async function makeDefault(
  req: Request,
  ctx: MakeDefaultRouteContext,
  nextly: DefaultLayoutDirectApi
): Promise<Response> {
  const slugs = slugsOf(ctx);
  // Preconditions first, whatever they cost: nothing below runs for a caller
  // who may not publish a Layout.
  const userId = await requireLayoutPublisher(ctx, slugs);

  const body = await readBody(req);
  const id = ctx.params.id ?? "";
  await requirePublishedLayout(nextly, slugs, id);
  // Both read BEFORE this request writes, so a refusal below can put back the
  // previous default together with whoever chose it, rather than leaving the
  // refused caller named as the author of a default they did not set.
  const before = await readLayoutSettings(nextly, slugs);
  const previous = before.defaultLayout;

  if (body.dryRun === true) {
    return respondMutation<MakeDefaultResult>(
      previous === id
        ? "This Layout is already the default."
        : "This Layout would become the default.",
      { defaultLayout: id, previousDefaultLayout: previous, dryRun: true }
    );
  }

  await writeLayoutSettings(nextly, slugs, {
    defaultLayout: id,
    defaultLayoutChangedBy: userId,
  });
  await restoreIfUnpublished(nextly, slugs, ctx, {
    id,
    previous,
    previousChangedBy: before.defaultLayoutChangedBy,
  });

  return respondMutation<MakeDefaultResult>("The default Layout was changed.", {
    defaultLayout: id,
    previousDefaultLayout: previous,
    dryRun: false,
  });
}

/** The RESOLVED slugs: a host may rename the Layouts collection or the Single. */
function slugsOf(ctx: MakeDefaultRouteContext): DefaultLayoutSlugs {
  return {
    layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
    settings:
      ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ??
      PAGE_BUILDER_SETTINGS_SLUG,
  };
}

/**
 * The caller's user id, once they are shown to be allowed to update AND
 * publish Layouts; otherwise the refusal.
 */
async function requireLayoutPublisher(
  ctx: MakeDefaultRouteContext,
  slugs: DefaultLayoutSlugs
): Promise<string> {
  const { user, caller } = ctx;
  if (
    user !== null &&
    caller !== null &&
    (await caller.can("update", slugs.layouts)) &&
    (await caller.can("publish", slugs.layouts))
  ) {
    return user.id;
  }
  throw NextlyError.forbidden({
    logContext: { reason: "make-default-needs-layout-publish" },
  });
}

/**
 * The post-write check described in the module docblock: when the Layout
 * stopped being published while it was being made the default, refuse, and
 * write the previous default back if the default is still this request's,
 * together with whoever chose it: the refused caller made no default.
 *
 * The settings are read again first, and the previous default is restored only
 * while they still name `id`. A newer make-default that landed after this
 * write owns the default, and restoring over it would undo that request. This
 * narrows the window rather than closing it: the read and the restore are two
 * statements, not a compare-and-set, so a make-default landing between them
 * can still be overwritten. The repair sweep then finds whatever is left
 * unusable.
 */
async function restoreIfUnpublished(
  nextly: DefaultLayoutDirectApi,
  slugs: DefaultLayoutSlugs,
  ctx: MakeDefaultRouteContext,
  change: {
    id: string;
    previous: string | null;
    /** Who chose `previous`, restored with it. */
    previousChangedBy: string | null;
  }
): Promise<void> {
  const { id, previous, previousChangedBy } = change;
  if ((await publishedLayoutIds(nextly, slugs, [id])).has(id)) return;
  const stillOurs =
    (await readLayoutSettings(nextly, slugs)).defaultLayout === id;
  if (stillOurs) {
    await writeLayoutSettings(nextly, slugs, {
      defaultLayout: previous,
      defaultLayoutChangedBy: previousChangedBy,
    });
  }
  ctx.logger.warn(
    stillOurs
      ? "[page-builder] a Layout was unpublished while it was being made the default; the previous default was restored"
      : "[page-builder] a Layout was unpublished while it was being made the default; a newer choice of default was kept",
    { layoutId: id, previous }
  );
  throw NextlyError.conflict({
    reason: "state",
    message:
      "That Layout stopped being published, so the default was left as it was.",
    logContext: { reason: "make-default-raced-unpublish", layoutId: id },
  });
}

/** Refuse unless `id` names a Layout whose main row is published now. */
async function requirePublishedLayout(
  nextly: DefaultLayoutDirectApi,
  slugs: DefaultLayoutSlugs,
  id: string
): Promise<void> {
  if (id === "") throw NextlyError.notFound();
  if ((await publishedLayoutIds(nextly, slugs, [id])).has(id)) return;
  if (!(await layoutExists(nextly, slugs, id))) throw NextlyError.notFound();
  throw NextlyError.conflict({
    reason: "state",
    message: "Only a published Layout can be the default. Publish it first.",
    logContext: { reason: "make-default-unpublished", layoutId: id },
  });
}

/** The body, parsed at the boundary. An empty body is no options. */
async function readBody(
  req: Request
): Promise<z.infer<typeof MakeDefaultBody>> {
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim() !== "") {
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      raw = undefined;
    }
  }
  const parsed = MakeDefaultBody.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw NextlyError.validation({
    errors: [
      {
        path: "body",
        code: "INVALID_TYPE",
        message: "The request is not a make-default request.",
      },
    ],
  });
}

/**
 * The route declaration. The Direct API is resolved per call through the
 * SDK's `getCachedNextly`, the booted instance a plugin is promised, rather
 * than through core's runtime entry.
 */
export function makeDefaultRoute(): {
  method: "POST";
  path: string;
  requiredPermission: string;
  handler: (req: Request, ctx: MakeDefaultRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: MAKE_DEFAULT_ROUTE_PATH,
    requiredPermission: MANAGE_SITE_PERMISSION,
    handler: async (req, ctx) => makeDefault(req, ctx, await getCachedNextly()),
  };
}
