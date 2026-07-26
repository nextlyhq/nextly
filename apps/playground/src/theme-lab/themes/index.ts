/**
 * The Nextly-original theme set. Mono leads as the unchanged control so a
 * comparison always has a baseline in the same list.
 *
 * Order is the order a reviewer should walk them: the control, then the two
 * that only re-temper the neutrals (Graphite, Ink), then the two that change
 * what colour means (Blueprint, Signal), then the two that change what colour
 * the SURFACES are (Sand, Clay, with Ember bridging into them by keeping Mono's
 * neutrals under a warm accent), and finally Terminal, which changes the
 * typeface and refuses to have a light mode at all. Each step is a bigger
 * departure from the row above it.
 */
import type { ThemeDefinition } from "../types";

import { BLUEPRINT } from "./blueprint";
import { CLAY } from "./clay";
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
];
