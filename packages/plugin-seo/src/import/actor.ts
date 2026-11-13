/**
 * Who an import is made as, for the import engine (`import/plan`): the
 * person asking, from the admin's import panel, or the site itself, from a
 * command run on the server. Every read, write and access question the
 * engine asks goes through one of these, so the engine itself holds no
 * request, and the panel and a command share one path.
 *
 * @module import/actor
 */
import {
  NextlyError,
  type PluginContext,
  type PluginRouteContext,
  type ServiceOpts,
} from "@nextlyhq/plugin-sdk";

import { asCaller, writablePages } from "../bulk/route";
import {
  SINGLE_AS_STORED,
  singleAccessOf,
  type SingleAccess,
} from "../bulk/singles";
import { pageTypeOf } from "../problems/page-types";

/** Who an import reads and writes as, and what they may do. */
export interface ImportActor {
  /** How a collection's pages are read and written as them. */
  as: ServiceOpts;
  /** How a Single's page is read and written as them. */
  single: SingleAccess;
  /** Whether they may read the content type `key` (`single:<slug>` too). */
  mayRead(key: string): Promise<boolean>;
  /** Which of `ids`, pages of `type`, they may change the SEO of. */
  writable(
    type: string,
    ids: readonly string[],
    locale: string | undefined
  ): Promise<Set<string>>;
  /** Whether they may read the media library, where share images are found. */
  mayReadMedia: boolean;
  /** Who a redirect the import adds is recorded as added by; none for the site. */
  userId: string | null;
}

/**
 * The person asking a plugin route: their own access decides which types
 * are read, which pages change, and whether images are looked up.
 */
export async function callerActor(
  ctx: PluginRouteContext,
  options: { pagePermissions: boolean }
): Promise<ImportActor> {
  const caller = ctx.caller;
  if (caller === null) throw NextlyError.authRequired();
  return {
    as: asCaller(ctx),
    single: await singleAccessOf(ctx),
    mayRead: key => caller.can("read", pageTypeOf(key).slug),
    // Each version is written as its own save, a working draft included.
    writable: (type, ids, locale) =>
      writablePages(ctx, type, ids, {
        locale,
        pagePermissions: options.pagePermissions,
        versions: true,
      }),
    mayReadMedia: await caller.can("read", "media"),
    userId: ctx.user?.id ?? null,
  };
}

/**
 * The site itself, for a command run on the server by whoever runs it: it
 * reads every type and changes every version of every page.
 */
export function siteActor(_ctx: PluginContext): ImportActor {
  return {
    as: { as: "system" },
    single: SINGLE_AS_STORED,
    mayRead: () => Promise.resolve(true),
    writable: (_type, ids) => Promise.resolve(new Set(ids)),
    mayReadMedia: true,
    userId: null,
  };
}
