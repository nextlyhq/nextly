"use client";

/**
 * The canvas inside the site's own layout: the frame source for the site's
 * canvas route, and what the editor says when it cannot use it.
 *
 * The route is the site's (`PageBuilderCanvas`, mounted at the plugin's
 * `canvasPath`), so the editor learns its path from the plugin's client
 * config. Without one, the canvas draws on the editor's blank page and says
 * nothing: that is every site that has not opted in, and a note there would
 * never go away. When a site has set the route and it cannot be shown, a note
 * above the canvas says so, because the page is then drawn without the site's
 * stylesheets and can differ from the published one.
 *
 * @module admin/editor/site-canvas
 */
import {
  CANVAS_ROUTE_DOCS_HREF,
  type CanvasFrameFallback,
  type CanvasFrameSource,
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

/** @internal */
export interface SiteCanvas {
  /** The site's canvas route, or `undefined` for the editor's blank page. */
  readonly canvasSource: CanvasFrameSource | undefined;
  /**
   * Why the canvas shows the blank page in place of the site's canvas route,
   * or `null` when it shows the route, or the site has none.
   */
  readonly canvasFallback: CanvasFrameFallback | null;
  /** What the frame calls when it falls back from the route, or recovers. */
  readonly onCanvasFallback: (reason: CanvasFrameFallback | null) => void;
  /** The direction of the language being edited, for the frame's root. */
  readonly canvasDir: "ltr" | "rtl" | undefined;
}

/** Where a canvas path names the language being edited. */
const LOCALE_PLACEHOLDER = "{locale}";

/**
 * The canvas route's path for the language being edited: `{locale}` replaced
 * by its code, or by nothing for the site's default language, which most
 * localized sites serve unprefixed. Repeated slashes the removal leaves are
 * collapsed, so a path never starts with two, which a browser would read as
 * another host.
 */
export function canvasPathFor(path: string, code: string | null): string {
  if (!path.includes(LOCALE_PLACEHOLDER)) return path;
  const filled = path
    .split(LOCALE_PLACEHOLDER)
    .join(code === null ? "" : encodeURIComponent(code));
  return filled.replace(/\/{2,}/g, "/");
}

/** The canvas's source, its fallback and its direction, for the editor. */
export function useSiteCanvas(
  clientConfig: Record<string, unknown> | undefined
): SiteCanvas {
  const locale = useDocumentLocale();
  const configured = readCanvasPath(clientConfig);
  const path =
    configured === undefined
      ? undefined
      : canvasPathFor(configured, locale?.code ?? null);
  // One source per path, so the frame loads the route once per language and
  // holds a refusal against the source it was made for.
  const canvasSource = useMemo(
    () => (path === undefined ? undefined : siteCanvasSource(path)),
    [path]
  );
  const [refused, setRefused] = useState<CanvasFrameFallback | null>(null);
  return {
    canvasSource,
    canvasFallback: canvasSource === undefined ? null : refused,
    onCanvasFallback: setRefused,
    canvasDir: locale === null ? undefined : locale.rtl ? "rtl" : "ltr",
  };
}

/**
 * What the note above the canvas says when the site's canvas route cannot be
 * shown, whatever the reason: the author can act on none of them, so it says
 * what they are looking at, and the Details link takes whoever runs the site
 * to the docs. The reason itself stays on the note as a state, for a test or
 * whoever debugs it.
 */
const FALLBACK_NOTE =
  "Shown without your site’s header, footer and styles. The site’s canvas page didn’t load.";

/**
 * The note above a canvas drawn without the site's layout, or nothing while
 * the site's own page is shown or the site has no canvas route.
 */
export function SiteLayoutNote({
  fallback,
}: {
  fallback: CanvasFrameFallback | null;
}): JSX.Element | null {
  if (fallback === null) return null;
  return (
    <p
      className="nx-inspector__note"
      role="status"
      data-canvas-state={`site-layout-${fallback}`}
    >
      {FALLBACK_NOTE}{" "}
      <a
        href={CANVAS_ROUTE_DOCS_HREF}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
        // The visible word first, so a voice user can say what they see.
        aria-label="Details about the site’s canvas page (opens in a new tab)"
      >
        Details
      </a>
    </p>
  );
}
