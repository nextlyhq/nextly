/**
 * The check behind "Found on the live home page": each production address's
 * home page read as Google reads it, by the same fetch Inspect uses, and each
 * saved verification tag looked for in it with the saved code.
 *
 * Only the site's own production addresses are fetched, each hop held to
 * Inspect's rules (`fetch`), and the tags looked for are the ones stored, not
 * any the caller names, so the route can be made to fetch nothing else. It is
 * for someone holding `manage-seo`, who edits the codes.
 *
 * @module received/verification-check
 */
import {
  NextlyError,
  type PluginContext,
  type PluginRoute,
} from "@nextlyhq/plugin-sdk";

import type { ReadVerificationTags } from "../outputs/verification";
import { MANAGE_SEO_PERMISSION } from "../permissions";
import {
  VERIFICATION_CHECK_ROUTE_PATH,
  type CheckedHomePage,
  type VerificationCheckBody,
} from "../settings/verification";

import { CRAWLERS } from "./contract";
import { fetchAs, type FetchOptions } from "./fetch";
import { namedMetaTags } from "./head";
import { originsOf, signedIn, type ReceivedSetup } from "./route";

/** What the check reads the site with. */
export interface VerificationCheckSetup
  extends Pick<ReceivedSetup, "readRules"> {
  /** The origin the plugin was configured with, where it was. */
  baseUrl?: string | undefined;
  /** The saved tags, as the home page's head reads them. */
  readTags: (ctx: PluginContext) => ReturnType<ReadVerificationTags>;
  /** How pages are fetched; the network itself unless a test says else. */
  fetch?: Pick<FetchOptions, "resolve" | "transport" | "limits">;
}

/** The most production addresses one check reads. */
const MAX_HOME_PAGES = 5;
/** The most checks at once: a screen a person opens needs few. */
const MAX_RUNNING = 2;
let running = 0;

const GOOGLEBOT =
  CRAWLERS.find(crawler => crawler.key === "googlebot")?.userAgent ??
  "Googlebot/2.1";

/** One home page: whether it was read, and the tags it carries. */
async function readHomePage(
  origin: string,
  origins: readonly string[],
  setup: VerificationCheckSetup
): Promise<{ page: CheckedHomePage; tags: Map<string, string[]> }> {
  const fetched = await fetchAs(new URL("/", origin), GOOGLEBOT, {
    ...setup.fetch,
    origins,
  });
  const tags = new Map<string, string[]>();
  if (fetched.kind === "failed") {
    return {
      page: { address: origin, read: false, message: fetched.message },
      tags,
    };
  }
  if (fetched.status < 200 || fetched.status >= 300) {
    return {
      page: {
        address: origin,
        read: false,
        message: `The home page answered ${fetched.status}.`,
      },
      tags,
    };
  }
  for (const tag of namedMetaTags(fetched.html)) {
    tags.set(tag.name, [...(tags.get(tag.name) ?? []), tag.content]);
  }
  return { page: { address: origin, read: true }, tags };
}

/** Reads each production address's home page and looks for each saved tag. */
export async function checkVerification(
  ctx: PluginContext,
  setup: VerificationCheckSetup
): Promise<VerificationCheckBody> {
  const saved = Object.entries(await setup.readTags(ctx));
  const origins = await originsOf(ctx, setup);
  const checkedAt = new Date().toISOString();
  if (saved.length === 0 || origins.length === 0) {
    return { checkedAt, homePages: [], tags: [] };
  }
  const read = await Promise.all(
    origins
      .slice(0, MAX_HOME_PAGES)
      .map(origin => readHomePage(origin, origins, setup))
  );
  return {
    checkedAt,
    homePages: read.map(each => each.page),
    tags: saved.map(([name, code]) => ({
      name: name.toLowerCase(),
      foundAt: read
        .filter(each => each.tags.get(name.toLowerCase())?.includes(code))
        .map(each => each.page.address),
    })),
  };
}

/** The check's route, for someone holding `manage-seo`. */
export function verificationCheckRoute(
  setup: VerificationCheckSetup
): PluginRoute {
  return {
    method: "POST",
    path: VERIFICATION_CHECK_ROUTE_PATH,
    requiredPermission: MANAGE_SEO_PERMISSION,
    handler: async (_req, ctx) => {
      signedIn(ctx);
      if (running >= MAX_RUNNING) {
        throw NextlyError.rateLimited({
          retryAfterSeconds: 10,
          logContext: { reason: "seo-verification-check-busy" },
        });
      }
      running++;
      try {
        return Response.json(await checkVerification(ctx, setup));
      } finally {
        running--;
      }
    },
  };
}
