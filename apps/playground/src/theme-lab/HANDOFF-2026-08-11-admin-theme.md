# HANDOFF — Admin theme finalisation (task 08)

**Written:** 2026-08-11. **Branch:** `explore/admin-theme-variations`.
**Worktree:** `/Users/mobeen/Work/Products/nextly-integrations/nextly-worktrees/theme-variations`
**Head at handoff:** `43c100fa7`. **Remote:** pushed through `c1165e003`; `43c100fa7` is LOCAL ONLY
— push it first (see §8, step 1).
**No open PRs.** Nothing is awaiting review; nothing has been merged to `main` from this work.

---

## 1. What this work is, in one paragraph

Task 08 (`tasks/admin-ui-tasks/08-ui-theme-feedback.md`) asked to shortlist admin themes, improve
the theme switcher, answer why Payload/Strapi look more colourful, and audit the admin's UI/UX and
accessibility. **The founder later narrowed it decisively: there is no theme system, themes are
deferred to a future version, and the ONLY purpose is to finalise ONE theme for the Nextly admin.**
Everything built in `apps/playground` is exploration scaffolding that never ships. What ships is one
set of token values in `packages/ui/src/styles/theme.css` plus the defect fixes the audit found.

**Do not use the words "Nextly original", "tweakcn", or any preset's brand name in anything
user-facing.** The palette that won is a neutral achromatic set; it is simply _the admin theme_.

---

## 2. Founder decisions — all made, none pending except §7

| #   | Decision                                                                             | Status                |
| --- | ------------------------------------------------------------------------------------ | --------------------- |
| 1   | Shortlist 54 themes → 9; DELETE the rest, keep the importer pipeline                 | done                  |
| 2   | Rehabilitate the soft/quiet palette to WCAG AA rather than drop it                   | done                  |
| 3   | Hybrid switcher: quick-switch panel on `/admin` + comparison gallery at `/theme-lab` | done                  |
| 4   | Audit fixes mechanical defects on-branch; judgement calls become recommendations     | done                  |
| 5   | Keep candidate palettes as reference-with-scores; rehabilitate only the winner       | done                  |
| 6   | Fix the nav-row token mismatch in the COMPONENT (not by widening the test)           | done                  |
| 7   | Retune palettes to a contrast MARGIN before the CI gate lands                        | done                  |
| 8   | Port margins to the real `theme.css`, not just the lab copies                        | done                  |
| 9   | Neutral ramp = separate task, AFTER the theme decision                               | scoped, not started   |
| 10  | **Adopt the neutral achromatic palette as the admin theme**                          | **done, `43c100fa7`** |
| 11  | Ship as ONE PR carrying everything, after the theme choice                           | **NOT DONE — see §8** |

**Founder's stated preference that drove #10:** they liked the neutral achromatic candidate, asked
that its origin not be named anywhere, and asked specifically that **checkboxes and table search
remain clearly visible**. Both use `border-input`, which was corrected (§4.3).

---

## 3. The shipped result

`packages/ui/src/styles/theme.css` now carries the neutral achromatic palette:

- **Zero chroma throughout** (the previous theme carried a faint blue cast, hue 257–266).
- **Black primary** (`oklch(0 0 0)`) — unchanged from before; both palettes used it.
- **8px radius** (`0.5rem`), where the previous theme was sharp-cornered (0px).
- **Lighter solid borders** instead of dark alpha borders.

**Measured, final:**

```
failures 0 | worst margin +0.301 | pairings within 0.25 of the gate: 0
packages/ui suite: 323 passed
```

For comparison, the admin theme BEFORE any of this work: `0 failures, worst margin +0.109, nine
pairings within 0.25 of the gate`.

---

## 4. Defects found and fixed (all in shipped code)

### 4.1 The selected nav row used a pairing no theme declares — `cc4f06614`

The active sidebar row drew its background from `--nx-muted` and its text from
`--nx-sidebar-accent-foreground`. Those are not partners: the foreground is declared against
`--nx-sidebar-accent`, and that is the pair the contrast suite asserts. **The combination the admin
rendered was checked by nothing.** This is the measured cause of the founder's report that "menu
items are using primary color".

Fixed in **4 places across 2 files** — `layout/sidebar/index.tsx` (active state, press state,
sub-menu row) and `layout/sidebar/DualSidebar.tsx` (the icon rail). Verified live: the row's
background now equals `--nx-sidebar-accent`.

**Lesson (already in `tasks/review-lessons.md` via the UI-lane session):** _a green assertion tells
you the pair it NAMES is fine; it says nothing about the pair the product RENDERS._

### 4.2 Contrast margins — `b5f166ecd`, then re-solved for the new palette in `43c100fa7`

Passing and passing-by-enough are different properties and only the first was recorded. Fixed by
solving each near-gate token to 5.0 (text) / 3.4 (boundary) instead of to the gate itself.

`validate-contrast.ts` gained **`measureTheme`**, returning every pairing's ratio AND margin, with
`validateTheme` defined as its filter — so a miss count can never again be the only thing stored.

### 4.3 Checkbox / table-search / input visibility

All three use `border-input`. In the adopted palette this was `oklch(0.92 0 0)` — 1.16:1 against its
surface, effectively invisible. Corrected to clear 3.4:1. **This is the founder's specific request
and it is satisfied**, but it has NOT yet been eyeballed in the browser (§8, step 3).

### 4.4 A duplicate token declaration in `theme.css`

`--nx-shadow-color` was declared **twice** in `:root` AND twice in `.dark` — same value, near
identical comments, the second silently winning. Removed the redundant pair and merged the better
reasoning into the surviving comment. Found because the token applier refused to write to an
ambiguous anchor rather than guessing.

### 4.5 Nav ink hierarchy (found by an existing test)

The adopted palette used ONE value for both `sidebar-foreground` and `sidebar-accent-foreground`, so
an active nav row was distinguished only by its fill. `sidebar-ink-hierarchy.test.ts` asserts they
must differ by ≥1.6:1. Resting ink now sits a step back (light `0.44`, dark `0.72`). **The test
caught a real design regression the palette would have introduced.**

---

## 5. Where everything lives

| Artifact                                | Path                                                               |
| --------------------------------------- | ------------------------------------------------------------------ |
| **Audit report** (the main deliverable) | `apps/playground/src/theme-lab/AUDIT-task-08.md`                   |
| Design spec                             | `apps/playground/src/theme-lab/DESIGN-task-08.md`                  |
| Implementation plan                     | `apps/playground/src/theme-lab/PLAN-task-08.md`                    |
| Margin/fragility evidence               | `apps/playground/src/theme-lab/audit-evidence/margin-fragility.md` |
| Code-level findings                     | `apps/playground/src/theme-lab/audit-evidence/code-findings.md`    |
| Token sweep data                        | `apps/playground/src/theme-lab/audit-evidence/tokens.json`         |
| Rehab notes (soft/quiet palette)        | `apps/playground/src/theme-lab/calm-rehab-notes.md`                |
| **Deferred follow-up task**             | `apps/playground/src/theme-lab/TASK-neutral-ramp.md`               |

**Tools built (all reusable):**

- `scripts/solve-margin.mjs <themeId> <mode> <token> <surfaceToken> <target>` — binary-searches the
  oklch lightness clearing a target ratio, **against the harness's own functions**, so a solved value
  agrees with the test by construction. Hue and chroma held fixed.
- `scripts/audit-themes.mjs` — token sweep: boundary BANDS (invisible / faint / clear / prominent),
  nav-primary misuse, surface separation. Writes `audit-evidence/tokens.json`.
- `scripts/audit-margins.mjs` — near-gate counts vs palette structure (lightness steps, range,
  chroma spend).
- `scripts/generate-contrast-report.mjs` — regenerates `contrast-report.generated.ts`, now stamping
  the **git revision of the contrast source** into the banner.

---

## 6. Hard-won knowledge — do not re-derive these

1. **A failure count is a property of (palette × contrast source), not of the palette.** One
   palette's recorded 58 became 48 with the palette untouched. Root-caused: a commit removed five
   boundary pairings and changed no maths — 5 pairings × 2 modes = exactly the 10 that vanished.
   Counts now carry the contrast-source revision.
2. **The lab is a MIRROR of the shipped theme, and a fix to the mirror looks identical to a fix to
   the product.** Margins were "fixed" in the lab copies while `theme.css` stayed fragile; every
   number improved, every test passed, the admin was untouched. **Measure the artifact the product
   actually loads.**
3. **An import is not proof of a read.** The contrast harness reaches into `packages/ui` source; a
   sibling parser in `blocks-engine` refuses `oklch()` entirely. Positive control run:
   `contrastRatio(white, black) === 21.00` and a reproduced suite value (2.88). **Zero is the same
   answer as "read nothing".**
4. **Alpha must be composited before comparing.** A first audit sweep scored a 44%-opacity hairline
   as solid black (21:1) and called 46 borders "prominent". Correct answer: 7.
5. **A "do not edit by hand" banner is about DURABILITY, not permission.** Corrections to generated
   preset files live in `tweakcn-overrides.ts`, which COMPOSES with re-imports, with a test asserting
   the corrections are ABSENT from the generated file — otherwise it passes for the wrong reason.
6. **The contrast suite does not check `border` against any surface** (removed deliberately, sound
   WCAG 1.4.11 reasoning). Border WEIGHT is unmeasured in both directions — which is exactly where
   the "prominent border lines" complaint lives. Hence band measurement, not pass/fail.
7. **A refuted hypothesis, recorded so nobody re-proposes it:** thin margins are NOT structural to a
   monochrome palette. The old default carried 17 distinct chromas; packing density correlates
   _negatively_ with near-gate count. What predicts margin is whether anyone optimised for it.
8. **After merging main, run `pnpm install` before trusting a build.** A merge brought
   `@radix-ui/react-slider` into `packages/ui/package.json`; vitest passed (resolves from source)
   while the dts build failed (resolves from `node_modules`), and the error named someone else's
   file.
9. **The admin test baseline is 27 failed / 1464 passed** and is PRE-EXISTING — verified identical
   with and without the nav change. Never add to it; always compare against it.
10. **`useThemeLab` reapplies theme/density via a MutationObserver**, so setting `data-density`
    directly in the browser is reverted immediately. Change it through `localStorage` + reload.
11. Preview panels in the lab wear `nextly-admin` for component base styles and are excluded from
    attribution with `:not([data-theme-preview])` — otherwise every preview is stamped with the
    selected density instead of its own.

---

## 7. Peer-session coordination state

- **UI lane (`packages/ui`, socket `6711`)** — holds `src/lib/color/**`, `src/lib/shortcuts/**`
  (PR #612), and a colour picker landing in `src/components/`. **Confirmed it does NOT touch
  `theme.css` or `styles/contrast/`.** It is **waiting on an all-clear from this lane** before
  consolidating `styles/contrast/color.ts` onto its new colour engine. That consolidation must ship
  with a fixture corpus including `oklch()` with alpha and `color-mix()`.
  **ACTION: give them the all-clear — the audit is finished.**
- **Styling / blocks lane (socket `82376`)** — owns `plugin-page-builder`, `blocks-engine`. No
  overlap. It has been the most useful correspondent; it verifies claims rather than relaying them.
- **Schema lane (socket `61808`)**, **email lane (`16350`)** — no overlap, confirmed.

---

## 8. What is left, in order

### Step 1 — push the theme commit (IMMEDIATE)

`43c100fa7` is local only. `git push origin explore/admin-theme-variations`, then verify with
`git ls-remote --heads origin explore/admin-theme-variations`. The pre-push hook runs a full build.

### Step 2 — rebuild and verify the new theme in the browser

```
pnpm --filter @nextlyhq/ui build && pnpm --filter @nextlyhq/admin build
pnpm dev:app     # from the worktree root; serves :3000
```

**The founder asked specifically about checkboxes and table search.** Both use `border-input`,
corrected to 3.4:1, but this has NOT been eyeballed. Check `/admin/collections/posts` in BOTH modes:
checkbox borders, the table search field edge, and row dividers. The lab's own switcher can be
ignored — clear `localStorage["nextly-theme-lab"]` to see the shipped theme.

### Step 3 — open ONE PR to `main`

Founder decision #11. It carries:

- `packages/ui/src/styles/theme.css` — the adopted palette + margins + duplicate-token cleanup
- `packages/admin/src/components/layout/sidebar/{index,DualSidebar}.tsx` — the nav-row fix
- the `apps/playground` lab, audit and docs (unpublished; include or strip — founder's call, but
  the audit report is the record of WHY the theme changed and is worth carrying)

**ONE changeset covering every package in the fixed group at `patch`, generated in node from
`.changeset/config.json` — never hand-typed.** Conventional Commits, no AI attribution.

Then post `@codex please review this PR`, and **set a 15-minute watcher** — there is no watcher
running now.

### Step 4 — after the PR merges

- Give the UI lane the all-clear on `styles/contrast/` (§7).
- Start `TASK-neutral-ramp.md` — the highest-value structural improvement the audit found, and the
  real fix for border weight. It is scoped and researched; it was deliberately deferred until the
  palette was chosen so the ramp derives from the shipped palette.

### Not started, deliberately

- Playwright captures across themes/screens. The lab's `capture-themes.mjs` works; the captures were
  never the deciding evidence and the palette is now chosen.
- Retuning the four unadopted candidate palettes. They remain reference-with-scores (24–30 misses).

---

## 9. Standing rules for this repo

Never commit to `main`; never `--no-verify`; no AI attribution anywhere. Conventional Commits,
lowercase imperative subject ≤72 chars. ONE changeset per PR covering all fixed-group packages at
`patch`; none for docs/CI/test-only. No `as any` / `@ts-expect-error` / eslint-disable. Every change
carries a what/why comment describing the CODE only — never a task, PR or review finding. Never bare
`git stash` (shared stack across worktrees). **This session was worktree-isolated: git operations and
file edits must target `nextly-worktrees/theme-variations` only.**
