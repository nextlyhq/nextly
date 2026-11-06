/**
 * How many placements chose one of a component's variants, for the dialog that
 * confirms deleting it.
 *
 * ## Why the documents are read, not the index
 *
 * The component usage index records which documents place a component, not
 * which variant each placement chose. So the index lists the hosts, and each
 * host's stored forms (its live value and its working draft) are read as the
 * system and walked for placements holding the variant's key. A placement the
 * draft and the live value both hold is one placement.
 *
 * ## Why the count may be a floor
 *
 * The index may not cover every document yet, it reads a capped number of rows,
 * a localized field holds a document per language this does not walk, and this
 * reads at most {@link MOST_HOSTS_READ} hosts. Any of those makes the answer a
 * floor, and the dialog says "at least".
 *
 * ## What it tells the caller
 *
 * Numbers only, never which documents: the hosts are read as the system, and
 * the caller may not be allowed to see them. The component itself is read as
 * the caller first, so the route answers nothing about a component they may
 * not read.
 *
 * ## NOT a security boundary
 *
 * Deleting a variant is a save of the component, judged on its own. This only
 * informs the designer before they confirm.
 *
 * @module variant-use-route
 */
import {
  componentPlacementsIn,
  isPlainRecord,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import type { HostFinder, HostRef } from "./fields/blocks-composition";
import {
  componentReadPermission,
  readingAsUser,
  type ComponentStore,
} from "./library-route";
import {
  VARIANT_USE_ROUTE_PATH,
  type VariantUseResponse,
} from "./variant-use-contract";

/** How many hosts one count reads before calling its answer a floor. */
export const MOST_HOSTS_READ = 500;

/** How many hosts are read at once. */
const HOSTS_READ_AT_ONCE = 8;

/** What counting needs, injected so a test can supply each part. */
export interface VariantUseSources {
  /** Whether the caller may read the component. */
  readonly mayRead: (componentId: string) => Promise<boolean>;
  /** Who places the component; absent where the index cannot be reached. */
  readonly hosts: HostFinder | undefined;
  /**
   * One stored form of a host's blocks field, as the system reads it:
   * `undefined` when the document has no such form, a throw when it could not
   * be read.
   */
  readonly readForm: (
    host: HostRef,
    form: "published" | "draft"
  ) => Promise<unknown>;
  /** The caps the renderer draws under, which bound each walk. */
  readonly limits: DocumentLimits;
}

/**
 * Count the placements of `componentId` that chose `variantId`, and the
 * documents holding them.
 */
export async function countVariantUse(
  componentId: string,
  variantId: string,
  sources: VariantUseSources
): Promise<VariantUseResponse> {
  if (!(await sources.mayRead(componentId))) {
    return { placements: 0, documents: 0, complete: true };
  }
  if (sources.hosts === undefined) {
    return { placements: 0, documents: 0, complete: false };
  }
  const whole = await sources.hosts.whole();
  const listed = await sources.hosts.placing([componentId]);
  let complete = whole && listed.complete;
  const hosts = listed.hosts;
  if (hosts.length > MOST_HOSTS_READ) complete = false;

  // A document is counted once however many of its fields hold the variant.
  const documents = new Set<string>();
  let placements = 0;
  const readable = hosts.slice(0, MOST_HOSTS_READ).filter(host => {
    if (host.localized) complete = false;
    return !host.localized;
  });
  // A few hosts at a time, each with both its forms at once: the dialog waits
  // on this, and one host after another is a round trip per form per host.
  for (let at = 0; at < readable.length; at += HOSTS_READ_AT_ONCE) {
    const batch = readable.slice(at, at + HOSTS_READ_AT_ONCE);
    const found = await Promise.all(
      batch.map(host => placementsIn(host, componentId, variantId, sources))
    );
    for (const [i, answer] of found.entries()) {
      if (answer === null || !answer.complete) complete = false;
      if (answer === null || answer.ids.size === 0) continue;
      const host = batch[i];
      placements += answer.ids.size;
      documents.add(`${host.slug}\u0000${host.id}`);
    }
  }
  return { placements, documents: documents.size, complete };
}

/**
 * The ids of a host field's placements that chose the variant, over its live
 * value and its draft; `null` when a form could not be read.
 */
async function placementsIn(
  host: HostRef,
  componentId: string,
  variantId: string,
  sources: VariantUseSources
): Promise<{ ids: Set<string>; complete: boolean } | null> {
  let forms: unknown[];
  try {
    forms = await Promise.all(
      (["published", "draft"] as const).map(form =>
        sources.readForm(host, form)
      )
    );
  } catch {
    return null;
  }
  const ids = new Set<string>();
  let complete = true;
  for (const value of forms) {
    if (value === undefined) continue;
    const walked = choosing(value, componentId, variantId, sources.limits);
    if (!walked.complete) complete = false;
    for (const id of walked.ids) ids.add(id);
  }
  return { ids, complete };
}

/** The ids of one stored form's placements of the component that chose it. */
function choosing(
  value: unknown,
  componentId: string,
  variantId: string,
  limits: DocumentLimits
): { ids: string[]; complete: boolean } {
  const found = componentPlacementsIn(value, limits.maxNodes);
  const ids: string[] = [];
  for (const { target, node } of found.placements) {
    if (target !== componentId || !isPlainRecord(node)) continue;
    const props = node.props;
    if (!isPlainRecord(props) || props.variant !== variantId) continue;
    if (typeof node.id === "string") ids.push(node.id);
  }
  return { ids, complete: found.complete };
}

/** The request body, parsed at the boundary and bounded. */
const VARIANT_USE_BODY = z.object({
  componentId: z.string().trim().min(1).max(256),
  variantId: z.string().min(1).max(256),
});

/** The parsed body, or the validation error naming what is wrong. */
async function variantUseBody(req: Request): Promise<{
  readonly componentId: string;
  readonly variantId: string;
}> {
  const body: unknown = await req.json().catch(() => undefined);
  const parsed = VARIANT_USE_BODY.safeParse(body);
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: parsed.error.issues.map(issue => ({
        path: issue.path.join("."),
        code: "INVALID",
        message: "Name the component and the variant to count.",
      })),
    });
  }
  return parsed.data;
}

/**
 * The route declaration. Gated on reading the component store, the same
 * permission the component library asks; the count itself reads as the system
 * and answers numbers only.
 *
 * A POST although it changes nothing: it is the dry run of a delete, asked when
 * the dialog opens, and the admin's route writer is the client that can ask it
 * then.
 */
export function variantUseRoute(args: {
  store: ComponentStore;
  hosts: () => HostFinder | undefined;
  readForm: (host: HostRef, form: "published" | "draft") => Promise<unknown>;
  limits: DocumentLimits;
}): {
  method: "POST";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: VARIANT_USE_ROUTE_PATH,
    requiredPermission: componentReadPermission(args.store),
    handler: async (req, ctx) => {
      const { componentId, variantId } = await variantUseBody(req);
      const slug =
        args.store.collection ??
        ctx.self.collections[COMPONENTS_SLUG] ??
        COMPONENTS_SLUG;
      return Response.json(
        await countVariantUse(componentId, variantId, {
          mayRead: callerMayRead(ctx, slug),
          hosts: args.hosts(),
          readForm: args.readForm,
          limits: args.limits,
        })
      );
    },
  };
}

/** Whether the caller may read the component, asked as the caller. */
function callerMayRead(
  ctx: Pick<PluginRouteContext, "caller">,
  slug: string
): (id: string) => Promise<boolean> {
  return async id => {
    try {
      const row = await requireNextly().findByID({
        collection: slug,
        id,
        ...(await readingAsUser(ctx)),
        status: "all",
        depth: 0,
      });
      return row !== null && row !== undefined;
    } catch (error) {
      if (NextlyError.isNotFound(error) || NextlyError.isForbidden(error)) {
        return false;
      }
      throw error;
    }
  };
}
