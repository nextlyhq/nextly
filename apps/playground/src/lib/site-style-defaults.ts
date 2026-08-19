/**
 * This site's style defaults, stated once.
 *
 * The value feeds three surfaces, and defining it in its own module is what
 * lets each of them import the same object instead of restating it:
 *
 * - `nextly.config.ts` hands it to `pageBuilder({ siteStyle })`, which wires
 *   the blocks-field validator and the editor canvas.
 * - The public block routes hand it to `loadSiteStyle({ defaults })`, which
 *   layers the stored Site Style document over it per request.
 * - `site-content.ts` derives the routes' `styleContext` breakpoints from it.
 *
 * Its own module rather than a `site-content.ts` export because the config
 * needs it and `site-content.ts` imports the config — an import in the other
 * direction would be a cycle.
 *
 * @module lib/site-style-defaults
 */
import type { SiteStyleData } from "@nextlyhq/plugin-page-builder";

/**
 * Breakpoints only. Tokens, fonts and classes are left to the engine's
 * guaranteed defaults and to whatever the Site Style document stores — this
 * app is a dev harness, and a hand-styled baseline here would make every
 * canvas and page look "designed" in a way no fresh site would reproduce.
 *
 * Ids must be unique across both axes, and the base breakpoint carries no
 * `maxWidth` — it is the fallback the others narrow.
 */
// `satisfies` rather than an annotation, so `.breakpoints` keeps its concrete
// type: `SITE_STYLE_CONTEXT` reads it as a required `StyleCompileContext`
// field, which an optional-typed property cannot satisfy.
export const SITE_STYLE_DEFAULTS = {
  breakpoints: {
    viewport: [
      { id: "base", label: "Base" },
      { id: "tablet", label: "Tablet", maxWidth: 1024 },
      { id: "mobile", label: "Mobile", maxWidth: 640 },
    ],
    container: [],
  },
} satisfies SiteStyleData;
