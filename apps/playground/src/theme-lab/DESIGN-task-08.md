# Task 08 — Theme Lab Shortlist: Design

**Date:** 2026-08-10. **Status:** approved by the founder (this document records that design).
**Task file:** `tasks/admin-ui-tasks/08-ui-theme-feedback.md` (workspace root, outside this repo).
**Branch:** `explore/admin-theme-variations`, at `24e35431a` (main merged 2026-08-10). Work
continues HERE; one reviewed PR to `main` carries the final outcome after the founder's re-check.
The branch is pushed to origin as backup; no PR per sub-task.

## Decisions locked with the founder (2026-08-10)

1. **Shortlist = 9 themes.** Nextly originals: Mono (control), Signal, Sand, Calm. tweakcn: Modern
   Minimal, Violet Bloom, Twitter, Claude, Vercel. The other 45 are DELETED (git history recovers
   them); the tweakcn generator pipeline stays, so any preset can return in minutes.
2. **Calm is rehabilitated to WCAG AA**, not kept as a probe and not dropped. Its 58 recorded
   failures were a deliberate past-the-edge measurement; the founder wants a Calm that could ship.
3. **Hybrid switcher:** compact quick-switch panel on `/admin` + a real comparison gallery at
   `/theme-lab`. One shared preview-card component drives both.
4. **Audit fixes mechanical defects on this branch; judgment calls become recommendations** for the
   founder's re-check. Report-only was rejected: the re-check should judge themes, not bugs.
5. Playground-only changes need no changeset (not a published package). Mechanical fixes that touch
   `packages/ui` / `packages/admin` ride the eventual PR, which takes ONE changeset per the repo's
   fixed-group rule.

## Constraints carried from the task file

- Light AND dark for everything; WCAG AA contrast (4.5:1 text, 3:1 UI) enforced by the harness with
  **zero** allowed exceptions once Calm is rehabbed.
- Tokens stay page-builder-consumable: the admin's `--nx-*` vocabulary is the substrate the page
  builder may adopt, so nothing here invents a second token system. (Coordination note: the
  page-builder sessions freeze the STYLE RECORD at PR-S10; the admin token vocabulary is not part
  of that freeze. Verified with those sessions 2026-08-10.)
- Future theming stays open: one default theme ships, tweakcn or custom presets may follow. The
  pruning therefore deletes DATA, never the pipeline (the generator script, `ThemeDefinition`, the
  density/layout axes).

## Sub-task 1 — Prune 54 → 9

- Delete theme files: `graphite, ink, blueprint, ember, clay, terminal, brutalist, contrast`.
- `tweakcn.generated.ts`: 42 → 5 entries (Modern Minimal, Violet Bloom, Twitter, Claude, Vercel).
- `themes/index.ts`: 4 imports; the ordering comment is REWRITTEN for the new corpus (the old one
  narrates deleted themes). New order: Mono first (control), then by departure size — Signal, Sand,
  Calm — then the tweakcn five.
- `EXPECTED_CONTRAST_FAILURES` shrinks to `{ calm: 58 }` until sub-task 3 zeroes it. Brutalist and
  Contrast were the calibration endpoints; shortlisting ends the exploration phase they calibrated,
  so they go with everything else.
- Tests asserting the old corpus (`nextly-themes.test.ts`, `use-theme-lab.test.ts`, contrast suite)
  are updated to the 9-theme corpus — updated, not weakened: every assertion that held for 54 holds
  for 9.
- `use-theme-lab.ts` falls back to Mono when `localStorage` holds an unknown theme id. This failure
  is guaranteed on every browser that ever used the 54-theme lab, so it is handled and TESTED, not
  assumed.
- `capture-themes.mjs` keeps working against the shrunk registry (verify it reads the registry
  rather than a hardcoded list; fix if hardcoded).

## Sub-task 2 — One preview card, two surfaces

**`ThemePreviewCard`** (new, playground): renders a theme's tokens INLINE via a `style` object of
custom properties — no scoped-CSS generation, nothing can leak into the page — around real
`@nextlyhq/ui` primitives: a faux sidebar strip (nav item states), Button, Input, Checkbox, Badge.
Light and dark sub-panels side by side (each applies that mode's token set). Props: `theme`,
`size: "panel" | "gallery"`, `onApply`. The primitives are the exact components the founder's
complaints name (checkbox visibility, nav-item primary misuse), so the preview shows the problem
surface, not an idealized swatch.

**`/theme-lab`** becomes the gallery: grid of 9 gallery-size cards; Apply switches the admin theme
via the same `useThemeLab` hook and offers a link to `/admin`. The Payload/Strapi swatch comparison
REMAINS, moved to a collapsed reference section below the grid (it answers the founder's "why more
colors" question and stays verifiable).

**Panel** on `/admin`: same card at `panel` size, 9 visible without scrolling, search filter
removed (9 items need no search), density + light/dark controls kept, `reset` kept.

## Sub-task 3 — Calm to AA

Retune ONLY the failing layer, in Calm's existing hue families, raising lightness contrast until
the harness passes: secondary text ≥ 4.5:1; borders, inputs, controls ≥ 3:1; status colours to
threshold. Surfaces and overall softness stay. `EXPECTED_CONTRAST_FAILURES` becomes all-zero (the
record stays, so an UNINTENDED regression in any theme is still caught at exactly zero). A
before/after value table goes in the report so the founder can see what AA cost.

## Sub-task 4 — Audit, report, mechanical fixes

Three lenses over the 9 kept themes × light/dark:

1. **Token-level:** every asserted contrast pairing, plus targeted checks for the named complaints —
   border-vs-background deltas (border prominence), checkbox/input ≥ 3:1 (visibility), nav-item
   token usage (primary misuse). Computed with the existing `validate-contrast.ts` machinery, not
   by eye.
2. **Code-level:** grep `packages/admin` + `packages/ui` for hardcoded colours and token misuse;
   audit `densities.css`, the spacing scale, and font stacks. Density and spacing produce
   RECOMMENDATIONS with reasoning, not silent changes.
3. **Visual:** Playwright captures — ~6 key screens (dashboard, collection list, entry form,
   schema builder, settings, login) × 9 themes × 2 modes via the existing capture harness —
   reviewed against the named issues plus layout breaks.

**Report:** `apps/playground/src/theme-lab/AUDIT-task-08.md` (this repo; the workspace `tasks/`
folder is write-blocked for this session — the founder can copy it across). Contents: per-theme
contrast tables; the full "why Payload/Strapi look more colourful" answer (they publish neutral
RAMPS — 21 and 10+ steps — while Nextly publishes ~50 semantic tokens with no intermediate neutral
steps; that missing middle is also the root of the border-prominence complaint; includes the
swatch-key rendering bug fixed 2026-08-10 that hid one Mono swatch); the density recommendation;
spacing/font findings; Calm before/after; the list of mechanical fixes made (with commit SHAs);
and the judgment recommendations queued for the founder's re-check.

**Mechanical fixes** (objective defects: hardcoded colour where a token exists, contrast below
threshold on a control, token misuse like primary-for-nav-state) land as small conventional commits
on this branch. Anything requiring taste stays in the report.

## Order and why

1 → 2 → 3 → 4. Pruning first makes every later step ~6× faster (tests, captures, gallery). The
gallery exists before Calm is judged in it. The audit measures rehabbed Calm, not doomed Calm.

## Testing

- Existing playground (123) and `@nextlyhq/ui` (193) suites stay green, minus assertions that
  named deleted themes.
- Contrast suite tightens to zero exceptions after sub-task 3.
- New tests: unknown-theme-id fallback; `ThemePreviewCard` renders both modes and applies on click.
- Every UI change verified in the running playground via Playwright before its commit.

## Error handling

- Stale `localStorage` theme id → Mono, silently (a lab preference, not user data).
- A theme definition missing a token the card reads → the inline style simply omits that property;
  the contrast suite is what catches incomplete themes, not the preview.

## Out of scope

- Choosing the final default theme (that is the founder's re-check, after this work).
- Shipping any theme system to `packages/ui` beyond mechanical fixes (item 19's `--nx-brand`
  white-label remains post-alpha).
- The page builder's own style system (Plans 01–05; separate sessions).
