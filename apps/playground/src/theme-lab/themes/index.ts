/**
 * The Nextly-original theme set. Mono leads as the unchanged control so a
 * comparison always has a baseline in the same list.
 *
 * Order is the order a reviewer should walk them: the control, then the two
 * that only re-temper the neutrals (Graphite, Ink), then the two that change
 * what colour means (Blueprint, Signal).
 */
import type { ThemeDefinition } from "../types";

import { BLUEPRINT } from "./blueprint";
import { GRAPHITE } from "./graphite";
import { INK } from "./ink";
import { MONO } from "./mono";
import { SIGNAL } from "./signal";

export const NEXTLY_THEMES: ThemeDefinition[] = [
  MONO,
  GRAPHITE,
  INK,
  BLUEPRINT,
  SIGNAL,
];
