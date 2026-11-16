"use client";

/**
 * The page a site serves for the editor's canvas: nothing but an empty mount
 * point, rendered inside the site's own layouts.
 *
 * A site mounts it once, as the default export of a route, and names that
 * route as the plugin's `canvasPath`:
 *
 * ```tsx
 * // app/(frontend)/page-builder-canvas/page.tsx
 * export { PageBuilderCanvas as default } from "@nextlyhq/plugin-page-builder/canvas";
 * ```
 *
 * The editor then loads that page into its frame and draws the page being
 * edited inside the mount point, so the site's global stylesheets, fonts,
 * header and footer are around it exactly as they are around the published
 * page. The site's own layout stays visible but inert.
 *
 * A client component because the mount point has to say when the site's React
 * root has hydrated it: before then, an element the editor added inside it
 * would not match what the server sent, and the site's root would throw its
 * own markup away. The mount point renders no children of its own, so the
 * site's React never touches what the editor puts there.
 *
 * @module canvas
 */
import { useLayoutEffect, useRef, type JSX } from "react";

import { CANVAS_MOUNT_ATTRIBUTE, CANVAS_READY_ATTRIBUTE } from "./attributes";

/** The mount point draws no box: see `PageBuilderCanvas`. */
const MOUNT_RULE = `[${CANVAS_MOUNT_ATTRIBUTE}] { display: contents; }`;

/**
 * The canvas route's page.
 *
 * Holds no content and reads nothing, so serving it reveals nothing; it is
 * kept out of search results all the same, since a visitor reaching it sees
 * the site's layout around an empty page.
 */
export function PageBuilderCanvas(): JSX.Element {
  const mount = useRef<HTMLDivElement | null>(null);
  /*
   * A layout effect, for its cleanup: React runs it before taking the mount
   * point out of the page, where a passive effect's cleanup runs after. The
   * marker is cleared while the element is still in the page, so the editor,
   * which watches the page, stops drawing into an element that is leaving it.
   * It runs only in the browser, once the site's root has hydrated.
   */
  useLayoutEffect(() => {
    const element = mount.current;
    element?.setAttribute(CANVAS_READY_ATTRIBUTE, "");
    return () => element?.removeAttribute(CANVAS_READY_ATTRIBUTE);
  }, []);
  return (
    <>
      <meta name="robots" content="noindex, nofollow" />
      {/*
        No box of its own, so the page drawn in it sits in the site's layout
        where the published page does: a flex or grid layout lays out what is
        portalled in rather than an extra wrapper. A rule rather than an
        inline style, keyed on the mount's own attribute, so nothing of the
        site's is touched.
      */}
      <style>{MOUNT_RULE}</style>
      <div ref={mount} {...{ [CANVAS_MOUNT_ATTRIBUTE]: "" }} />
    </>
  );
}
