/**
 * The Nextly-original theme set. Mono leads as the unchanged control so a
 * comparison always has a baseline in the same list.
 *
 * Order is the order a reviewer should walk them: the control, then the two
 * that only re-temper the neutrals (Graphite, Ink), then the two that change
 * what colour means (Blueprint, Signal), then the two that change what colour
 * the SURFACES are (Sand, Clay, with Ember bridging into them by keeping Mono's
 * neutrals under a warm accent), and then Terminal, which changes the typeface
 * and refuses to have a light mode at all. Each step is a bigger departure from
 * the row above it.
 *
 * The last three are a different kind of entry and sit at the end for that
 * reason. Everything above is a direction that works; Brutalist, Calm and
 * Contrast are the EDGES of one axis -- how legible an admin has to be --
 * placed deliberately so the founder can see where a direction stops working
 * rather than inferring it. Calm is past that edge and is expected to fail; the
 * other two bracket it from the heavy and the maximal side.
 */
import type { ThemeDefinition } from "../types";

import { BLUEPRINT } from "./blueprint";
import { BRUTALIST } from "./brutalist";
import { CALM } from "./calm";
import { CLAY } from "./clay";
import { CONTRAST } from "./contrast";
import { EMBER } from "./ember";
import { GRAPHITE } from "./graphite";
import { INK } from "./ink";
import { MONO } from "./mono";
import { SAND } from "./sand";
import { SIGNAL } from "./signal";
import { TERMINAL } from "./terminal";

export const NEXTLY_THEMES: ThemeDefinition[] = [
  MONO,
  GRAPHITE,
  INK,
  BLUEPRINT,
  SIGNAL,
  EMBER,
  SAND,
  CLAY,
  TERMINAL,
  BRUTALIST,
  CALM,
  CONTRAST,
];

/**
 * Themes that deliberately sit outside WCAG AA, and the number of asserted
 * pairings each one misses.
 *
 * These three bracket the legibility axis, so their scores are information
 * rather than defects: the recorded number is what the harness measured, and
 * recording it keeps an UNINTENDED change visible while allowing the intended
 * miss to stand. A theme absent from this record is held to zero failures, so
 * the strictness of the suite is unchanged for everything else.
 *
 * Changing a number here is only correct alongside a deliberate design change,
 * and the reverse move -- editing a theme's colours so its number can come down
 * -- destroys the measurement these themes exist to produce. Brutalist and
 * Contrast measure 0 because both are high-contrast by construction; that is a
 * real result about those directions, not an absence of one.
 *
 * Calm's 58 are what "soft and quiet" costs a data-dense admin, and they are
 * concentrated rather than scattered: the quiet secondary-text register, the
 * whisper-weight rules and inputs, and the dusty status and primary colours.
 * Its body text is unaffected, which is the part of the finding that is easy to
 * miss -- the theme is not illegible, it is legible only in its loudest layer.
 */
export const EXPECTED_CONTRAST_FAILURES: Record<string, number> = {
  brutalist: 0,
  calm: 58,
  contrast: 0,
};
