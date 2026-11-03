/**
 * The `canvasPath` option, checked where it is given.
 *
 * @module canvas-path
 */

/**
 * The path the site serves its canvas route at, or a refusal naming why it
 * cannot be one.
 *
 * Only a path on this site: the editor reaches into the frame's document to
 * draw the page there, which a browser allows on the editor's own origin
 * alone. A full URL or a protocol-relative `//host/…` names another origin,
 * so it is refused at boot rather than left to fall back on every opening.
 */
export function canvasPathOption(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error(
      `[page-builder] canvasPath must be a path on this site, starting with a single "/" (got ${JSON.stringify(path)})`
    );
  }
  return path;
}
