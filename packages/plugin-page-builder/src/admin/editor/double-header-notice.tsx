"use client";

/**
 * The notice above the canvas when visitors may see two headers: the site's
 * own layout draws around the page on its canvas route, and a header &
 * footer set draws inside it too.
 *
 * Said once a session, on the first page where both draw, since it is about
 * the site rather than the page: every other page drawn in the same layout
 * shows the same two. A site that says it draws its header and footer in
 * code (`siteHeaderFooter: "code"`) is never told, because it already has.
 *
 * @module admin/editor/double-header-notice
 */
import type { SiteChromeDrawn } from "@nextlyhq/builder/shell";
import { useEffect, useState, type JSX } from "react";

import {
  DEFAULT_SITE_HEADER_FOOTER,
  type SiteHeaderFooter,
} from "../../site-header-footer";

/** The docs section on the option, beside the page route's `layouts` option. */
export const SITE_HEADER_FOOTER_DOCS_HREF =
  "https://nextlyhq.com/docs/page-builder/layouts#a-site-that-draws-its-header-and-footer-in-code";

/** What the notice says. */
const WORDS =
  "This site also draws a header in its code, so visitors may see two. Set the site to draw its header in code, or remove the code header.";

/** The session's record that the notice was said. */
const TOLD_KEY = "nextly:page-builder:double-header-told";

/**
 * Who draws the site's header and footer, from the plugin's client config,
 * read defensively: the config is JSON that crossed a process boundary, and
 * the server sends the key only when the site set it.
 */
export function readSiteHeaderFooter(
  clientConfig: Record<string, unknown> | undefined
): SiteHeaderFooter {
  return clientConfig?.siteHeaderFooter === "code"
    ? "code"
    : DEFAULT_SITE_HEADER_FOOTER;
}

/**
 * Whether this session was told already, and record that it now is. A
 * browser that keeps no session storage is told on each page instead, which
 * is better than never.
 */
function firstToldThisSession(): boolean {
  try {
    if (sessionStorage.getItem(TOLD_KEY) !== null) return false;
    sessionStorage.setItem(TOLD_KEY, "1");
  } catch {
    // Storage refused (a private window, blocked site data): say it here.
  }
  return true;
}

/** The notice, or nothing while only one of them draws or it was said. */
export function DoubleHeaderNotice({
  siteChrome,
  setDrawn,
  siteHeaderFooter,
}: {
  /** Where the site's own layout draws around the page on the canvas. */
  siteChrome: SiteChromeDrawn;
  /** Whether a header & footer set draws a region around the page. */
  setDrawn: boolean;
  /** Who the site says draws its header and footer. */
  siteHeaderFooter: SiteHeaderFooter;
}): JSX.Element | null {
  const doubled =
    siteHeaderFooter === "page-builder" &&
    setDrawn &&
    (siteChrome.before || siteChrome.after);
  // Whether this editor is the one the session's notice is said in.
  const [saying, setSaying] = useState(false);
  useEffect(() => {
    if (doubled && !saying && firstToldThisSession()) setSaying(true);
  }, [doubled, saying]);
  if (!doubled || !saying) return null;
  return (
    <p
      className="nx-inspector__note"
      role="status"
      data-canvas-state="double-header"
    >
      {WORDS}{" "}
      <a
        href={SITE_HEADER_FOOTER_DOCS_HREF}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
        // The visible word first, so a voice user can say what they see.
        aria-label="Details about a site that draws its header in code (opens in a new tab)"
      >
        Details
      </a>
    </p>
  );
}
