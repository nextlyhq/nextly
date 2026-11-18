"use client";

/**
 * The editor's writers of the site style: the tokens studio, the class
 * surface, the fonts panel's upload and the breakpoints writer, with the
 * readings of the stored style each of them offers from.
 *
 * Kept apart from the editor component because each owns state or a write
 * queue of its own, and none of it is about the document being edited.
 *
 * This module holds the readings and is the entry for the rest, each in a
 * module of its own: the tokens studio and Variables tab
 * (`site-style-tokens-studio`), the class surface
 * (`site-style-class-surface`), the Shared styles tab
 * (`site-style-shared-styles`) and the breakpoints writer
 * (`site-style-breakpoints`). The fonts panel (`site-style-fonts`) is not
 * among them: the editor fetches it when the Fonts tab draws it, which a
 * re-export here would undo by loading it with the rest.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/site-style-studios
 */
import {
  resolveSiteTokens,
  type FontFaceDef,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

import type { SiteStyleData } from "../../site-style";

export { useBreakpointWriter } from "./site-style-breakpoints";
export { useClassSurface, type ClassSurface } from "./site-style-class-surface";
export { SharedStylesStudio } from "./site-style-shared-styles";
export {
  ColoursTab,
  TokensStudio,
  VariablesTab,
} from "./site-style-tokens-studio";
// Part of this module's exported names; no importer in the package reads it.
// fallow-ignore-next-line unused-type
export type { StyleOpeners } from "./site-style-tokens-studio";

/**
 * The faces the site loads, or `undefined` while that is not yet known.
 *
 * The same third state `offerableTokens` keeps, and for the same reason: a site
 * that self-hosts nothing legitimately has no faces, so a surface cannot tell
 * "none stored" from "the read has not come back" by looking at the value. The
 * fonts panel draws those two differently, and would otherwise report a site
 * mid-load as one loading no fonts at all.
 *
 * Unlike tokens there are no engine defaults to layer underneath — a font file
 * is something a site provides or does not — so the resolved list is returned
 * as it stands, including an empty one.
 */
export function offerableFaces(
  style: SiteStyleData | undefined,
  pending: boolean,
  error: unknown
): readonly FontFaceDef[] | undefined {
  if (pending || error !== null) return undefined;
  return style?.fonts ?? [];
}

/**
 * The tokens as the PAGE renders them, defaults included.
 *
 * Deliberately not `offerableTokens`. A studio edits what the site AUTHORED —
 * showing the engine's defaults as rows an author can rename would offer edits
 * that write nothing — while a report on what the page draws has to read what
 * the page draws. `resolveSiteTokens` layers the engine's own underneath, and
 * one of them is `font.body: system-ui`, a real typeface every site renders
 * with. Reading the authored set had the panel announce "no typeface tokens"
 * for a site whose every page was using one.
 */
export function renderedTokens(
  style: SiteStyleData | undefined,
  pending: boolean,
  error: unknown
): SiteTokenSet | undefined {
  if (pending || error !== null) return undefined;
  return resolveSiteTokens(style?.tokens);
}

/**
 * The tokens an inspector may offer, or `undefined` while the site's own tier
 * is still unknown.
 *
 * Withheld on exactly the two states that hold the CANVAS back, and for the
 * same reason. Until the stored read answers, the merged value is the config
 * defaults alone — a real design rather than a placeholder — so a picker fed
 * from it offers a token by a name and a colour the site may have overridden,
 * and the identity an author chooses then resolves to something else on the
 * published page. The error path matters as much as the pending one: `pending`
 * is false there while the value has still fallen back to defaults.
 *
 * `undefined` rather than an empty set, because the control reads absence as
 * "the question was never asked" and offers no picker at all — which is the
 * truth here, and is different from a site that defines no tokens.
 */
export function offerableTokens(
  style: SiteStyleData | undefined,
  pending: boolean,
  error: unknown
): SiteTokenSet | undefined {
  if (pending || error !== null) return undefined;
  // A SET even when the site defines nothing, because the renderer compiles
  // with `resolveSiteTokens`, which layers the engine's own defaults underneath.
  // A site with no tokens of its own still emits `color.text`, `color.primary`
  // and the rest, so handing over `undefined` here would have the picker offer
  // none of them — and `undefined` already means something else to the control:
  // that the question was never asked.
  return style?.tokens ?? { tokens: [] };
}

/**
 * What the stored site style's read has DONE, in the manager's three words.
 *
 * Named rather than written inline for the reason the writer moved out of the
 * editor component: every decision folded into that function is another path
 * through the whole of it, and `fallow` reports the growth as introduced
 * complexity.
 *
 * `error === null`, not `!== undefined`. `useSiteStyle` types the field as
 * `Error | null` and normalises a successful read to `null`, so an `undefined`
 * comparison is true on success as well as on failure — the mistake that once
 * withheld the provenance trace unconditionally.
 */
export function siteStyleStatus(
  pending: boolean,
  error: Error | null
): "loading" | "unavailable" | "ready" {
  if (pending) return "loading";
  return error === null ? "ready" : "unavailable";
}
