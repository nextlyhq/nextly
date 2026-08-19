/**
 * Announcement single — the localized Single that carries the draft/published
 * lifecycle, so the per-language publish surfaces are exercised in development
 * rather than existing only in code.
 *
 * `Authors` does this job for collections. Nothing did it for Singles: the two
 * other localized-or-versioned singles here deliberately have no `status`, so
 * the editor's Publish control, the per-language status dots and "Publish all
 * languages" had no Single in the harness to appear on. A surface no
 * contributor ever sees is how this admin has twice shipped a feature nothing
 * mounted.
 *
 * Its own single rather than a `status: true` on `site-settings`: that one is
 * the autosave fixture the e2e suite drives, and giving it a publish lifecycle
 * would change what that test is measuring.
 */
import { defineSingle, text, textarea } from "nextly/config";

export const Announcement = defineSingle({
  slug: "announcement",
  label: { singular: "Announcement" },
  // The draft/published lifecycle. On a LOCALIZED single this is per language:
  // each translation carries its own `_status` in the companion table, which is
  // what "publish every language" exists to move at once.
  status: true,
  localized: true,
  fields: [
    // Shared across languages — the campaign is one thing whatever it is called.
    text({ name: "campaign", label: "Campaign", localized: false }),
    text({ name: "headline", label: "Headline" }),
    textarea({ name: "body", label: "Body" }),
  ],
});
