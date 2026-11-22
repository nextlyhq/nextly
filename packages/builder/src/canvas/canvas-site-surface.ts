/**
 * The site's surface on the canvas root: the custom properties that name the
 * site's ground and ink under its token prefix, whether its dark values
 * include a dark ground, and the marks written before paint for its theme and
 * whether its ground is fully opaque.
 *
 * @module canvas-site-surface
 */

import {
  resolveSiteTokens,
  resolveTokenPrefix,
  tokenCustomProperty,
  tokenIdentity,
} from "@nextlyhq/blocks-engine";
import {
  sharedStyleInputs,
  type PageRendererProps,
} from "@nextlyhq/blocks-react";
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import { useEffect, useRef } from "react";

import { setFlag } from "./canvas-block-marks";
import { useNearestThemeMarker } from "./nearest-theme";
import { alphaOf, computedAlphaOf, isDarkGround } from "./site-ground";

/**
 * The site tokens the canvas page is drawn from, by IDENTITY as the default
 * token set declares them, mapped to the custom property the stylesheet reads
 * each from, with the value it falls back to where the token is undeclared.
 *
 * Set inline on the canvas root because the property each points at depends on
 * the prefix the site's tokens are emitted under, which only the site sheet
 * knows. An identity rather than a display name, so a site that renamed a
 * token still resolves: the property is built from the identity. The
 * fallbacks are the browser's own defaults, which is what a published page
 * shows where nothing paints.
 *
 * No font: the site's Body font is written by the page's own sheet on the
 * page root (Site text's Body row), the same rule on every surface.
 */
const SITE_SURFACE_TOKENS = [
  ["--nx-canvas-site-ground", "color.background", "Canvas"],
  ["--nx-canvas-site-ink", "color.text", "CanvasText"],
] as const;

/** The token the page's ground is drawn from, by identity. */
const SITE_GROUND_TOKEN = "color.background";

/** What the canvas root needs from the site sheet to draw the page as the site. */
interface SiteSurface {
  /** The custom properties naming the site's tokens, under its prefix. */
  readonly style: Record<`--${string}`, string>;
  /** Whether the site's background token has a DARK value. */
  readonly darkGround: boolean;
  /** Whether every value of the site's background token is fully opaque. */
  readonly opaqueGround: boolean;
}

/**
 * The site's own surface tokens, as the canvas root carries them, or undefined
 * when the host serves no site sheet.
 *
 * The prefix is the one the renderer compiles the sheet under:
 * `sharedStyleInputs` reconciles the site's own prefixes with the route
 * context's, exactly as `PageRenderer` does before emitting the sheet, and
 * `resolveTokenPrefix` gives what is actually written. The token set is the
 * one the sheet emits — the site's own layered over the defaults by
 * `resolveSiteTokens` — so whether the ground has a dark value is asked of the
 * same tokens the page draws with.
 *
 * The site sheet applies dark values with the device (or a dark marker), for
 * every site. The scheme goes dark only where those values include a dark
 * ground, so a site whose dark set leaves the background light keeps a light
 * page and light native controls.
 */
export function siteSurface(
  render: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>
): SiteSurface | undefined {
  if (typeof siteStyles !== "object") return undefined;
  const stated = sharedStyleInputs(
    render?.styleContext,
    siteStyles
  ).tokenPrefix;
  const { prefix } = resolveTokenPrefix(stated ?? undefined);
  const style: Record<`--${string}`, string> = {};
  for (const [property, token, fallback] of SITE_SURFACE_TOKENS) {
    style[property] = `var(${tokenCustomProperty(token, prefix)}, ${fallback})`;
  }
  const tokens = resolveSiteTokens(siteStyles.tokens);
  const values = tokens.tokens.find(
    token => tokenIdentity(token) === SITE_GROUND_TOKEN
  )?.values;
  const ground = values?.dark;
  return {
    style,
    darkGround: ground !== undefined && isDarkGround(ground),
    opaqueGround:
      values !== undefined &&
      [values.light, values.dark].every(
        value => value === undefined || alphaOf(value.trim()) === 1
      ),
  };
}

/**
 * The marks the site's surface puts on the canvas root, written before paint:
 * the nearest theme marker above it (`useNearestThemeMarker`), and whether the
 * site's ground is fully opaque.
 *
 * Only an opaque ground is repeated on the rendered page as well as the
 * canvas: painted twice, an opaque ground looks exactly as it does once, while
 * a translucent one would darken where the layers overlap. Judged from the
 * colour the root's background RESOLVES to, because the host's own CSS can
 * set the token's property to something the token set does not say. The
 * token set's answer stands where the resolved colour says nothing: one that
 * cannot be read, or one fully transparent, which is what a root painting no
 * ground of its own resolves to (a page the site serves), and a transparent
 * ground repeated on the page paints nothing either way.
 */
export function useSiteSurfaceMarks(
  rootRef: React.RefObject<HTMLElement | null>,
  opaqueByTokens: boolean
): void {
  useNearestThemeMarker(rootRef);
  const tokens = useRef(opaqueByTokens);
  tokens.current = opaqueByTokens;
  // On every render: a render is what brings new site styles.
  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    if (root !== null) markGround(root, tokens.current);
  });
  /*
   * And on what changes the ground with no render, subscribed once for the
   * root rather than on every render:
   *
   * - the site's mode: the theme marker rewrites the root's
   *   `data-nx-site-theme` from an observer of its own, and the device's
   *   colour scheme changes on its own. A light ground and a dark one can
   *   differ in whether they are opaque;
   * - the canvas's window resizing, or the canvas itself: a site can override
   *   the ground under a width or height query, which a resized frame
   *   crosses, and under a container query, which a canvas drawn without a
   *   frame crosses as the layout around it changes.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const view = root.ownerDocument.defaultView;
    const mark = (): void => markGround(root, tokens.current);
    const Observer = view?.MutationObserver;
    const theme =
      typeof Observer === "function" ? new Observer(() => mark()) : null;
    theme?.observe(root, {
      attributes: true,
      attributeFilter: ["data-nx-site-theme"],
    });
    const scheme = view?.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener("change", mark);
    view?.addEventListener("resize", mark);
    const Sizes = view?.ResizeObserver;
    const size = typeof Sizes === "function" ? new Sizes(() => mark()) : null;
    size?.observe(root);
    return () => {
      theme?.disconnect();
      scheme?.removeEventListener("change", mark);
      view?.removeEventListener("resize", mark);
      size?.disconnect();
    };
  }, [rootRef]);
}

/**
 * Mark whether the site's ground is fully opaque, from the colour the root's
 * background resolves to; the token set's answer where that says nothing.
 */
function markGround(root: HTMLElement, opaqueByTokens: boolean): void {
  const resolved = (
    root.ownerDocument.defaultView?.getComputedStyle(root).backgroundColor ?? ""
  ).trim();
  const alpha = alphaOf(resolved) ?? computedAlphaOf(resolved);
  setFlag(
    root,
    "data-nx-site-ground-opaque",
    alpha === undefined || alpha === 0 ? opaqueByTokens : alpha === 1
  );
}
