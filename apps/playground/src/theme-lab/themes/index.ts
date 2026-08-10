/**
 * The Nextly-original theme set, pruned to the task-08 shortlist. Mono leads
 * as the unchanged control so a comparison always has a baseline in the same
 * list.
 *
 * Order is the order a reviewer should walk them, each a bigger departure
 * from the control than the row above it: Signal changes only what colour
 * MEANS (a chromatic accent over Mono's neutrals), Sand changes what colour
 * the SURFACES are (warm paper under warm ink), and Calm departs on the
 * legibility axis itself (soft, low-stimulus, deliberately quiet). The other
 * eight originals were exploration directions and live in git history; the
 * tweakcn shortlist lives in `tweakcn.generated.ts`.
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
 * The recorded number is what the harness measured, and recording it keeps an
 * UNINTENDED change visible while allowing the intended miss to stand. A
 * theme absent from this record is held to zero failures, so the strictness
 * of the suite is unchanged for everything else.
 *
 * Calm's misses are what "soft and quiet" costs a data-dense admin, and they
 * are concentrated rather than scattered: the quiet secondary-text register,
 * the whisper-weight rules and inputs, and the dusty status and primary
 * colours. Its body text is unaffected -- the theme is not illegible, it is
 * legible only in its loudest layer. The count stands until Calm's
 * rehabilitation to AA lands, at which point this record goes empty.
 *
 * 48, not the 58 first recorded: the shared contrast source in `packages/ui`
 * changed underneath this lab (the theming-readiness work on main), so the
 * measurement moved with it. The number is the harness's current reading,
 * re-measured 2026-08-10, not a design change to Calm.
 */
export const EXPECTED_CONTRAST_FAILURES: Record<string, number> = {};
