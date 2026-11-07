/**
 * `<SiteCode>`: the code people who may change the site's settings add to
 * every published page, rendered from what the site code route stored.
 *
 * Put one in the public site's layout for each place, `slot="head"` and
 * `slot="body"` (at the end of the body), never in a root layout the admin
 * shares. It guards itself all the same (`site-code/bootstrap`): nothing at
 * all under draft mode, which the preview pane uses, and the code that runs
 * or styles the page is started by a loader that refuses the admin, the
 * canvas and any page framed by the site itself.
 *
 * Every stored entry is judged again by the rules before it is rendered, so
 * a row edited in the database can't break out of its place either: one that
 * fails is left out, and the server log says so.
 *
 * A server component, read through Nextly's cache and tagged with the site
 * code Single, so a save refreshes every page and pages stay static.
 *
 * Under Cache Components the read must go through the app's own `"use cache"`
 * function (`src/nextly/cached-read.ts`), imported by the layout that renders
 * `<SiteCode>`. Without it the read falls back to `unstable_cache`, whose miss
 * is a query still pending when a prerender stops, so a build fails now and
 * then; `<SiteCode>` refuses that read and names the fix instead.
 *
 * @module site
 * @experimental
 */
import { draftMode } from "next/headers";
import type { JSX } from "react";

import {
  isGatedSiteCode,
  SITE_CODE_BOOTSTRAP,
  SITE_CODE_DATA_ATTRIBUTE,
} from "../site-code/bootstrap";
import {
  siteCodeScriptKind,
  type SiteCodeAttrs,
  type SiteCodeEntry,
  type SiteCodeSlot,
} from "../site-code/rules";
import { SITE_CODE_SLUG, storedSiteCodeEntries } from "../site-code/storage";

/** What `<SiteCode>` is given. */
export interface SiteCodeProps {
  /** The place on the page: the head, or the end of the body. */
  readonly slot: SiteCodeSlot;
  /**
   * The site's per-request nonce, where its policy uses one: the loader
   * carries it and passes it to what it starts. Reading it makes the page
   * dynamic, which a nonce-based policy already does.
   */
  readonly nonce?: string;
  /**
   * The paths site code never runs under, as the app names them (without its
   * base path). Defaults to `["/admin"]`.
   */
  readonly skip?: readonly string[];
  /**
   * The app's base path, which every path a visitor's browser shows begins
   * with. Read from the app's Next.js config when not given.
   */
  readonly basePath?: string;
  /** The site code Single's slug, where the site renamed it. */
  readonly slug?: string;
  /** How the stored code is read; Nextly's cached Direct API by default. */
  readonly read?: (slug: string) => Promise<unknown>;
}

/** The paths site code never runs under unless told otherwise. */
const DEFAULT_SKIP: readonly string[] = ["/admin"];

/**
 * The skipped paths as the browser shows them: under the app's base path
 * (`basePath: "/site"` serves the admin at `/site/admin`), which Next.js
 * builds into every bundle as `process.env.__NEXT_ROUTER_BASEPATH`.
 */
function skippedPaths(props: SiteCodeProps): string[] {
  const base = (
    props.basePath ??
    process.env.__NEXT_ROUTER_BASEPATH ??
    ""
  ).replace(/\/+$/, "");
  return (props.skip ?? DEFAULT_SKIP).map(path => `${base}${path}`);
}

/** Where the site code page says how to mount `<SiteCode>` under Cache Components. */
const CACHE_COMPONENTS_DOCS_URL =
  "https://nextlyhq.com/docs/page-builder/site-code#with-cache-components";

/**
 * What `<SiteCode>` says when it would read under Cache Components with no
 * `"use cache"` read function registered: the file to add and the line that
 * imports it, so the person reading a failed build can fix it from here.
 */
const UNREGISTERED_READ_MESSAGE =
  "<SiteCode> can't read the site code: Cache Components is on, and this app " +
  'has registered no "use cache" read function, so the read would go through ' +
  "unstable_cache and can fail the prerender. Add src/nextly/cached-read.ts " +
  "(its Cache Components version), then import it from the layout that " +
  'renders <SiteCode>: import "@/nextly/cached-read"; (or a relative path ' +
  `where the app has no "@/" alias). How: ${CACHE_COMPONENTS_DOCS_URL}`;

/**
 * The stored site code, read through Nextly's cache, tagged by its Single.
 *
 * Under Cache Components with no `"use cache"` read function registered it
 * throws rather than read: registration is a side effect of whichever modules
 * import the app's `cached-read.ts`, so a route that imports none of them
 * (`/_not-found` among them) would read through `unstable_cache` and fail its
 * prerender only some of the time. A plain `Error`, since its message is the
 * fix and the build prints it as is.
 */
async function readStoredSiteCode(slug: string): Promise<unknown> {
  const [
    { getCachedNextly },
    {
      cacheComponentsEnabled,
      cachedFind,
      cachedReadRegistered,
      nextlySingleTags,
    },
  ] = await Promise.all([
    import("@nextlyhq/plugin-sdk"),
    import("nextly/runtime"),
  ]);
  // Whether this app builds with Cache Components on, read here, in code the
  // app bundles, because Next.js inlines `process.env.__NEXT_CACHE_COMPONENTS`
  // only into that; nextly, loaded as a server external, cannot see it.
  if (
    cacheComponentsEnabled(process.env.__NEXT_CACHE_COMPONENTS) &&
    !cachedReadRegistered()
  ) {
    throw new Error(UNREGISTERED_READ_MESSAGE);
  }
  return cachedFind(
    async () => {
      const nextly = await getCachedNextly();
      // No identity: what this answers is cached for every visitor.
      return nextly.findSingle({
        slug,
        depth: 0,
        overrideAccess: true,
        createIfMissing: false,
        user: undefined,
        req: undefined,
      });
    },
    {
      tags: nextlySingleTags(slug),
      keyParts: ["page-builder", "site-code", slug],
    }
  );
}

/** The React names of the attributes HTML spells otherwise. */
const REACT_NAMES: Readonly<Record<string, string>> = {
  crossorigin: "crossOrigin",
  referrerpolicy: "referrerPolicy",
  fetchpriority: "fetchPriority",
  hreflang: "hrefLang",
  itemprop: "itemProp",
};

/** An entry's attributes as React props. */
function propsOf(attrs: SiteCodeAttrs): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attrs).map(([name, value]) => [
      REACT_NAMES[name] ?? name,
      value,
    ])
  );
}

/** An attribute value written into HTML. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** A no-script pixel's one element, as the HTML a browser without script reads. */
function fallbackHtml(
  child: Extract<SiteCodeEntry, { tag: "noscript" }>["child"]
): string {
  const attrs = Object.entries(child.attrs)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  return child.tag === "iframe" ? `<iframe${attrs}></iframe>` : `<img${attrs}>`;
}

/**
 * An entry written as is: a meta tag, a link that is not a stylesheet,
 * structured data, or a no-script pixel. None runs anything in a page with
 * scripting, the admin's included.
 */
function DirectEntry({ entry }: { entry: SiteCodeEntry }): JSX.Element | null {
  switch (entry.tag) {
    case "meta":
      return <meta {...propsOf(entry.attrs)} />;
    case "link":
      return <link {...propsOf(entry.attrs)} />;
    case "script":
      // Structured data only: every script that runs goes through the loader.
      return siteCodeScriptKind(entry.attrs.type) === "data" ? (
        <script
          {...propsOf(entry.attrs)}
          dangerouslySetInnerHTML={{ __html: entry.text ?? "" }}
        />
      ) : null;
    case "noscript":
      return (
        <noscript
          dangerouslySetInnerHTML={{ __html: fallbackHtml(entry.child) }}
        />
      );
    case "style":
      return null;
  }
}

/**
 * Data written inside a `<script>` data block: JSON, with every `<` escaped,
 * so no text in it can close the block or open a comment.
 */
function scriptData(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * The site's code for one place on the page. Nothing under draft mode.
 *
 * The data block is written even when the place holds no code, as it carries
 * the paths this place skips: the other place's loader skips them too, so an
 * empty head with `skip={["/studio"]}` still keeps the body's scripts off
 * `/studio`. A data block runs nothing, so it costs a page a few bytes.
 *
 * @experimental
 */
export async function SiteCode(
  props: SiteCodeProps
): Promise<JSX.Element | null> {
  // The preview pane shows drafts in draft mode, framed by the admin.
  if ((await draftMode()).isEnabled) return null;
  const slug = props.slug ?? SITE_CODE_SLUG;
  const entries = storedSiteCodeEntries(
    await (props.read ?? readStoredSiteCode)(slug),
    props.slot
  );
  const gated = entries.filter(isGatedSiteCode);
  return (
    <>
      {entries
        .filter(entry => !isGatedSiteCode(entry))
        .map((entry, index) => (
          <DirectEntry key={`direct-${index}`} entry={entry} />
        ))}
      <script
        type="application/json"
        {...{ [SITE_CODE_DATA_ATTRIBUTE]: props.slot }}
        dangerouslySetInnerHTML={{
          __html: scriptData({
            slot: props.slot,
            skip: skippedPaths(props),
            entries: gated,
          }),
        }}
      />
      {/* The loader reads the data block just before it. */}
      {gated.length === 0 ? null : (
        <script
          {...(props.nonce === undefined ? {} : { nonce: props.nonce })}
          dangerouslySetInnerHTML={{ __html: SITE_CODE_BOOTSTRAP }}
        />
      )}
    </>
  );
}
