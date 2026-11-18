/**
 * Settings' calls for the site's code: the read of the policy the site sends,
 * the check, and the save; and the site's CSS, read and saved.
 *
 * @module admin/site-code-client
 * @experimental
 */
import { readPluginRoute, writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_CODE_ROUTE_PATH,
  SITE_CSS_ROUTE_PATH,
  type SiteCodeChecked,
  type SiteCodeRequest,
  type SiteCodeSaved,
  type SiteCssRead,
  type SiteCssRequest,
  type SiteCssSaved,
} from "../library-contract";

/** The policy a page of the site is served with, as a check is sent it. */
export type LivePolicy = NonNullable<SiteCodeRequest["livePolicy"]>;

/** The longest policy the route reads; a longer one is left unchecked. */
const LIVE_POLICY_MAX = 16_384;

/** The app's base path, which Next.js sets for its client code. */
function basePath(): string {
  return typeof process === "undefined"
    ? ""
    : (process.env.__NEXT_ROUTER_BASEPATH ?? "");
}

/**
 * The Content Security Policy the site's home page is served with: the
 * enforced one, else a Report-Only one; `undefined` where it sends none or
 * the page can't be read. Read same-origin with no cookies, as a visitor
 * gets it, so a policy set only for signed-in staff isn't taken for the
 * site's. Advice beside the declared policy, never a gate.
 */
export async function readLivePolicy(): Promise<LivePolicy | undefined> {
  try {
    const response = await fetch(`${basePath()}/`, {
      credentials: "omit",
      cache: "no-store",
    });
    // Only the headers are wanted; the page itself is let go.
    void response.body?.cancel();
    const enforced = response.headers.get("content-security-policy");
    const reported = response.headers.get(
      "content-security-policy-report-only"
    );
    const policy = enforced ?? reported;
    if (policy === null || policy.trim() === "") return undefined;
    if (policy.length > LIVE_POLICY_MAX) return undefined;
    return { policy, reportOnly: enforced === null };
  } catch {
    return undefined;
  }
}

/** A mutation route's answer: its message and the item it carries. */
interface Envelope<T> {
  readonly message: string;
  readonly item: T;
}

/** The item of an answer, or a refusal when the route answered none. */
function itemOf<T>(answer: Envelope<T> | undefined): T {
  if (answer === undefined) {
    throw new Error("The site did not answer. Try again.");
  }
  return answer.item;
}

/** The code as written for each place, and the live policy read with it. */
export interface SiteCodeDraft {
  readonly head: string;
  readonly body: string;
  readonly livePolicy?: LivePolicy;
  /** Checked as one page's own code rather than the site's. */
  readonly scope?: "page";
}

/** Check the code, saving nothing: what it would store, and what it blocks. */
export async function checkSiteCode(
  draft: SiteCodeDraft
): Promise<SiteCodeChecked> {
  return itemOf(
    await writePluginRoute<Envelope<SiteCodeChecked>>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: SITE_CODE_ROUTE_PATH,
      body: { ...draft, dryRun: true } satisfies SiteCodeRequest,
    })
  );
}

/**
 * Save the code, read at `version`. `acknowledgeCsp` is the check's key,
 * given once the person has seen what the policy would block.
 */
export async function saveSiteCode(
  draft: SiteCodeDraft,
  version: string | null,
  acknowledgeCsp: string | null
): Promise<SiteCodeSaved> {
  return itemOf(
    await writePluginRoute<Envelope<SiteCodeSaved>>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: SITE_CODE_ROUTE_PATH,
      body: {
        ...draft,
        ...(version === null ? {} : { version }),
        ...(acknowledgeCsp === null ? {} : { acknowledgeCsp }),
      } satisfies SiteCodeRequest,
    })
  );
}

/**
 * The site's CSS as saved, its hash, and who changed it last and when: what
 * the CSS box opens with, and what its save hands back.
 */
export async function readSiteCss(signal?: AbortSignal): Promise<SiteCssRead> {
  const read = await readPluginRoute<SiteCssRead>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_CSS_ROUTE_PATH,
    ...(signal === undefined ? {} : { signal }),
  });
  if (read === undefined) {
    throw new Error("The site did not answer. Try again.");
  }
  return read;
}

/**
 * Save the site's CSS, made from the read whose hash is `sha256`. Refused,
 * saving nothing, when someone saved it since that read ("Someone changed
 * the site CSS; reload to see it") and for each line the checker refuses.
 */
export async function saveSiteCss(
  css: string,
  sha256: string
): Promise<SiteCssSaved> {
  return itemOf(
    await writePluginRoute<Envelope<SiteCssSaved>>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: SITE_CSS_ROUTE_PATH,
      body: { css, sha256 } satisfies SiteCssRequest,
    })
  );
}
