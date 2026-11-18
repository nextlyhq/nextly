/**
 * What the site CSS routes answer, named where both ends can read it: the
 * Settings client, the canvas and the route itself.
 *
 * Free of runtime imports for the reason `library-contract` gives: a browser
 * module importing a path constant must not bring the route's server-only
 * runtime with it.
 *
 * @module site-css-contract
 */

/**
 * Where the site's own CSS is read and saved: `GET` reads it to edit, `POST`
 * saves it ({@link SiteCssRequest}). Under the site settings permission, as
 * site code is; a save is a signed-in person's alone, never an API key's.
 * The CSS has no version history: a save replaces it.
 *
 * @experimental
 */
export const SITE_CSS_ROUTE_PATH = "/site/css";

/**
 * Where the canvas reads the site's CSS to draw it: the CSS alone, for anyone
 * who may read the site style.
 *
 * @experimental
 */
export const SITE_CSS_DRAWN_ROUTE_PATH = "/site/css/drawn";

/** The site's CSS as Settings reads it, to edit. */
export interface SiteCssRead {
  /** The CSS as saved; empty when none is. */
  readonly css: string;
  /** Its SHA-256, which a save made from this read hands back. */
  readonly sha256: string;
  /** When it was last saved, as an ISO date; `null` before any save. */
  readonly changedAt: string | null;
  /** The name of the person who saved it last, when it can be read. */
  readonly changedBy: string | null;
}

/** Saving the site's CSS, made from the read whose `sha256` it names. */
export interface SiteCssRequest {
  readonly css: string;
  readonly sha256: string;
}

/** What saving the site's CSS answers: the new hash, for the next save. */
export interface SiteCssSaved {
  readonly sha256: string;
}

/** The site's CSS as the canvas draws it. */
export interface SiteCssDrawn {
  readonly css: string;
}
