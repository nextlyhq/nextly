"use client";

/**
 * The canvas inside the site's own layout: the frame source for the site's
 * canvas route, and what the editor says when it cannot use it.
 *
 * The route is the site's (`PageBuilderCanvas`, mounted at the plugin's
 * `canvasPath`), so the editor learns its path from the plugin's client
 * config. Without one, or when the route cannot be shown, the canvas draws on
 * the editor's blank page and a note above it says which, because a page
 * drawn without the site's stylesheets can differ from the published one.
 *
 * @module admin/editor/site-canvas
 */
import type {
  CanvasFrameFallback,
  CanvasFrameSource,
} from "@nextlyhq/builder/shell";
import { useDocumentLocale } from "@nextlyhq/plugin-sdk/admin";
import { useMemo, useState, type JSX } from "react";

import {
  CANVAS_MOUNT_ATTRIBUTE,
  CANVAS_READY_ATTRIBUTE,
} from "../../canvas/attributes";

/** The mount point, once the site's page has hydrated it. */
const READY_MOUNT = `[${CANVAS_MOUNT_ATTRIBUTE}][${CANVAS_READY_ATTRIBUTE}]`;

/**
 * The frame source for the site's canvas route at `path`.
 *
 * Ready once the route's mount point says the site's React root has hydrated
 * it, and read again whenever that changes, since the site's root can replace
 * the mount point.
 */
export function siteCanvasSource(path: string): CanvasFrameSource {
  return {
    src: path,
    served: doc => doc.querySelector(`[${CANVAS_MOUNT_ATTRIBUTE}]`) !== null,
    ready: doc => doc.querySelector(READY_MOUNT) !== null,
    mountPoint: doc => doc.querySelector<HTMLElement>(READY_MOUNT),
    watch: (doc, changed) => {
      const Mutations = doc.defaultView?.MutationObserver;
      if (Mutations === undefined) return () => undefined;
      const readiness = new Mutations(changed);
      readiness.observe(doc.documentElement, {
        subtree: true,
        attributes: true,
        attributeFilter: [CANVAS_READY_ATTRIBUTE],
      });
      return () => readiness.disconnect();
    },
  };
}

/**
 * The canvas route's path from the plugin's client config, read defensively:
 * the config is JSON that crossed a process boundary.
 */
export function readCanvasPath(
  clientConfig: Record<string, unknown> | undefined
): string | undefined {
  const path = clientConfig?.canvasPath;
  return typeof path === "string" && path !== "" ? path : undefined;
}

/** Why the canvas is drawn without the site's layout, if it is. */
export type SiteCanvasFallback = CanvasFrameFallback | "no-route";

/** @internal */
export interface SiteCanvas {
  /** The site's canvas route, or `undefined` for the editor's blank page. */
  readonly canvasSource: CanvasFrameSource | undefined;
  /** Why the canvas shows the blank page, or `null` when it shows the site's. */
  readonly canvasFallback: SiteCanvasFallback | null;
  /** What the frame calls when it falls back from the route, or recovers. */
  readonly onCanvasFallback: (reason: CanvasFrameFallback | null) => void;
  /** The direction of the language being edited, for the frame's root. */
  readonly canvasDir: "ltr" | "rtl" | undefined;
}

/** The canvas's source, its fallback and its direction, for the editor. */
export function useSiteCanvas(
  clientConfig: Record<string, unknown> | undefined
): SiteCanvas {
  const path = readCanvasPath(clientConfig);
  // One source per path, so the frame loads the route once and holds a
  // refusal against the source it was made for.
  const canvasSource = useMemo(
    () => (path === undefined ? undefined : siteCanvasSource(path)),
    [path]
  );
  const [refused, setRefused] = useState<CanvasFrameFallback | null>(null);
  const locale = useDocumentLocale();
  return {
    canvasSource,
    canvasFallback: canvasSource === undefined ? "no-route" : refused,
    onCanvasFallback: setRefused,
    canvasDir: locale === null ? undefined : locale.rtl ? "rtl" : "ltr",
  };
}

/**
 * What the note above the canvas says, by why the site's layout is missing.
 * Each says what the author is looking at first, then why.
 */
const FALLBACK_NOTES: Readonly<Record<SiteCanvasFallback, string>> = {
  "no-route":
    "Shown without your site’s layout and styles: the site has no canvas route set up.",
  "other-origin":
    "Shown without your site’s layout and styles: the canvas route is on another site.",
  "not-served":
    "Shown without your site’s layout and styles: the canvas route was not found.",
  "not-ready":
    "Shown without your site’s layout and styles: the canvas route did not finish loading.",
};

/**
 * The note above a canvas drawn without the site's layout, or nothing while
 * the site's own page is shown.
 */
export function SiteLayoutNote({
  fallback,
}: {
  fallback: SiteCanvasFallback | null;
}): JSX.Element | null {
  if (fallback === null) return null;
  return (
    <p
      className="nx-inspector__note"
      role="status"
      data-canvas-state={`site-layout-${fallback}`}
    >
      {FALLBACK_NOTES[fallback]}
    </p>
  );
}
