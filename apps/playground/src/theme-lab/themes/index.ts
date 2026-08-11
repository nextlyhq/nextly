/**
 * The Nextly-original theme set. Mono leads as the unchanged control so a
 * comparison always has a baseline in the same list.
 *
 * Order is the order a reviewer should walk them, each a bigger departure
 * from the control than the row above it: Signal changes only what colour
 * MEANS (a chromatic accent over Mono's neutrals), Sand changes what colour
 * the SURFACES are (warm paper under warm ink), and Calm departs on the
 * legibility axis itself (soft, low-stimulus, deliberately quiet). The other
 * eight originals were exploration directions and live in git history; the
 * imported presets live in `tweakcn.generated.ts`.
 */
import type { ThemeDefinition } from "../types";

import { CALM } from "./calm";
import { MONO } from "./mono";
import { SAND } from "./sand";
import { SIGNAL } from "./signal";
import { withOverride } from "./tweakcn-overrides";
import { TWEAKCN_THEMES as IMPORTED_PRESETS } from "./tweakcn.generated";

export const NEXTLY_THEMES: ThemeDefinition[] = [MONO, SIGNAL, SAND, CALM];

/**
 * The tweakcn presets as the lab uses them: imported, then corrected for
 * accessibility.
 *
 * Every consumer reads this rather than `tweakcn.generated` directly, so a
 * preset cannot be corrected for one surface and raw for another -- the
 * switcher, the gallery, the contrast report and the captures all see the
 * same nine themes. The raw import stays reachable for the fidelity test,
 * which asserts what the IMPORTER produced and must therefore not see the
 * corrections.
 */
export const TWEAKCN_THEMES: ThemeDefinition[] =
  IMPORTED_PRESETS.map(withOverride);

/**
 * Themes that deliberately sit outside WCAG AA, and the number of asserted
 * pairings each one misses.
 *
 * It is EMPTY, and empty is the contract: every Nextly theme is held to zero
 * failures. The escape hatch stays because the mechanism is worth having --
 * an entry here would let a deliberate miss stand while still failing on any
 * change to its count, so an unintended regression cannot hide behind an
 * intended exception. Nothing currently needs it.
 *
 * An entry here declares that a theme ships a pairing a reader cannot read, so
 * it is a design decision rather than a bookkeeping one.
 *
 * Scope: NEXTLY themes only. The tweakcn presets are third-party references
 * shown for comparison and are scored, not gated; their measured failure
 * counts live in `contrast-report.generated.ts`.
 */
export const EXPECTED_CONTRAST_FAILURES: Record<string, number> = {};
