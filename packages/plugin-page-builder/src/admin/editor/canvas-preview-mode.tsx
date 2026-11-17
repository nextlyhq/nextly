"use client";

/**
 * The site mode (Light or Dark) the canvas is previewed in, held once for
 * the surfaces that read it: the top bar's ☀/☾ switch picks it, the canvas
 * and the section pictures are drawn in it, and the Design panel's swatches
 * show its values.
 *
 * Two states, and light first: a session starts light whatever the author's
 * own device prefers, so the canvas never changes with an unrelated setting.
 * The pick is kept for the browser tab's session, in session storage, so it
 * holds while the author moves between pages and a new session starts light
 * again. Nothing else is stored: the page and the site are untouched, and a
 * published page and its Preview keep following each visitor's device. The
 * pick reaches the canvas frame's document and the frame element alone,
 * never the editor's own chrome.
 *
 * The switch is offered only while some variable the canvas draws with has
 * a dark value, since without one both modes look the same. Removing the
 * last one while previewing dark hides it and returns the canvas to light.
 *
 * @module canvas-preview-mode
 */
import {
  resolveSiteTokens,
  type SiteTokenSet,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import { CanvasPreviewTags, DarkPreviewSwitch } from "@nextlyhq/builder/shell";
import { useEffect, useMemo, useSyncExternalStore, type JSX } from "react";

/** The mode the canvas is drawn in, whether the switch is offered, and the way to pick. */
export interface CanvasPreviewMode {
  /** What the canvas, its pictures and the Design panel's swatches show. */
  readonly mode: TokenMode;
  /** Whether the top bar offers the switch: some variable has a dark value. */
  readonly offered: boolean;
  /** Preview the canvas in this mode. */
  readonly onPick: (mode: TokenMode) => void;
}

/** The session's pick, in the browser tab's session storage. */
const SESSION_KEY = "nextly:page-builder:canvas-preview-mode";

/**
 * The pick where the browser keeps no session storage (a private window,
 * blocked site data): kept for the page's lifetime instead.
 */
let unstored: TokenMode = "light";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function sessionPick(): TokenMode {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "dark" ? "dark" : "light";
  } catch {
    return unstored;
  }
}

function pick(mode: TokenMode): void {
  unstored = mode;
  try {
    sessionStorage.setItem(SESSION_KEY, mode);
  } catch {
    // Storage refused: the page-lifetime copy above holds it.
  }
  for (const listener of listeners) listener();
}

/** What a server render draws: light, as a new session does. */
function serverPick(): TokenMode {
  return "light";
}

/** Whether any variable the canvas draws with has a dark value. */
function hasDarkValue(tokens: SiteTokenSet): boolean {
  return resolveSiteTokens(tokens).tokens.some(
    token => token.values.dark !== undefined
  );
}

/**
 * The canvas's preview mode, from the site's variables as the editor reads
 * them, or `undefined` while they are still being read. Until they arrive
 * the pick stands, so a page opened mid-session does not flash light.
 */
export function useCanvasPreviewMode(
  tokens: SiteTokenSet | undefined
): CanvasPreviewMode {
  // Light for a server render and the first client render alike, so the two
  // agree; the stored pick follows straight after.
  const picked = useSyncExternalStore(subscribe, sessionPick, serverPick);
  const offered = useMemo(
    () => tokens !== undefined && hasDarkValue(tokens),
    [tokens]
  );
  const withdrawn = tokens !== undefined && !offered;
  // The last dark value gone while previewing dark: the pick goes back to
  // light too, so a dark value added later starts the preview light.
  useEffect(() => {
    if (withdrawn && picked === "dark") pick("light");
  }, [withdrawn, picked]);
  const mode: TokenMode = withdrawn ? "light" : picked;
  return useMemo(() => ({ mode, offered, onPick: pick }), [mode, offered]);
}

/**
 * The top bar's ☀/☾ switch, beside the device buttons, while it is offered.
 */
export function CanvasModeSwitch({
  preview,
}: {
  preview: CanvasPreviewMode;
}): JSX.Element | null {
  if (!preview.offered) return null;
  return <DarkPreviewSwitch mode={preview.mode} onMode={preview.onPick} />;
}

/** What the canvas frame is drawn with of the previews in hand. */
export interface PreviewedCanvas {
  /** The frame's `theme`: the mode previewed. */
  readonly theme: TokenMode;
  /** The one row of tags over the canvas, for the frame's pinned chrome. */
  readonly tags: JSX.Element;
}

/**
 * The canvas frame's share of the previewed mode and of the variant
 * previewed: the theme the frame draws, and the tags drawn over it.
 */
export function previewedCanvas(
  mode: CanvasPreviewMode,
  variant: string | undefined
): PreviewedCanvas {
  return {
    theme: mode.mode,
    tags: <CanvasPreviewTags variant={variant} />,
  };
}
