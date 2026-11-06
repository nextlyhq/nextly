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
  siteCodeEntryProblem,
  siteCodeScriptKind,
  type SiteCodeAttrs,
  type SiteCodeEntry,
  type SiteCodeSlot,
} from "../site-code/rules";
import { SITE_CODE_SLUG } from "../site-code/storage";

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
  /** The paths site code never runs under. Defaults to `["/admin"]`. */
  readonly skip?: readonly string[];
  /** The site code Single's slug, where the site renamed it. */
  readonly slug?: string;
  /** How the stored code is read; Nextly's cached Direct API by default. */
  readonly read?: (slug: string) => Promise<unknown>;
}

/** The paths site code never runs under unless told otherwise. */
const DEFAULT_SKIP: readonly string[] = ["/admin"];

/** The stored site code, read through Nextly's cache, tagged by its Single. */
async function readStoredSiteCode(slug: string): Promise<unknown> {
  const [{ getCachedNextly }, { cachedFind, nextlySingleTags }] =
    await Promise.all([
      import("@nextlyhq/plugin-sdk"),
      import("nextly/runtime"),
    ]);
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

/**
 * The stored entries for `slot` that the rules still accept; any other is
 * left out, and the server log says so.
 */
function entriesOf(doc: unknown, slot: SiteCodeSlot): SiteCodeEntry[] {
  const stored = (doc as Record<string, unknown> | null)?.[slot];
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry: unknown): entry is SiteCodeEntry => {
    const problem = siteCodeEntryProblem(entry, slot);
    if (problem === undefined) return true;
    console.warn(
      `[page-builder] A stored site code entry was left out of the ${slot}: ${problem}.`
    );
    return false;
  });
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
 * The site's code for one place on the page. Nothing under draft mode, and
 * nothing when none is stored.
 *
 * @experimental
 */
export async function SiteCode(
  props: SiteCodeProps
): Promise<JSX.Element | null> {
  // The preview pane shows drafts in draft mode, framed by the admin.
  if ((await draftMode()).isEnabled) return null;
  const slug = props.slug ?? SITE_CODE_SLUG;
  const entries = entriesOf(
    await (props.read ?? readStoredSiteCode)(slug),
    props.slot
  );
  if (entries.length === 0) return null;
  const gated = entries.filter(isGatedSiteCode);
  return (
    <>
      {entries
        .filter(entry => !isGatedSiteCode(entry))
        .map((entry, index) => (
          <DirectEntry key={`direct-${index}`} entry={entry} />
        ))}
      {gated.length === 0 ? null : (
        <>
          <script
            type="application/json"
            {...{ [SITE_CODE_DATA_ATTRIBUTE]: props.slot }}
            dangerouslySetInnerHTML={{
              __html: scriptData({
                slot: props.slot,
                skip: props.skip ?? DEFAULT_SKIP,
                entries: gated,
              }),
            }}
          />
          <script
            {...(props.nonce === undefined ? {} : { nonce: props.nonce })}
            dangerouslySetInnerHTML={{ __html: SITE_CODE_BOOTSTRAP }}
          />
        </>
      )}
    </>
  );
}
