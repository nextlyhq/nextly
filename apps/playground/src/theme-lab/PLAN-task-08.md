# Theme Lab Shortlist (Task 08) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prune the theme lab from 54 themes to the founder's 9-theme shortlist, give it a real comparison gallery plus a bigger quick-switch panel driven by one shared preview card, rehabilitate Calm to WCAG AA, and produce the UI/UX + accessibility audit with mechanical fixes on-branch.

**Architecture:** Everything lives in `apps/playground/src/theme-lab/` (data-driven: themes are data, one generator emits CSS, one validator asserts contrast). The preview card applies a theme's tokens as inline CSS custom properties around real `@nextlyhq/ui` primitives, so previews cannot drift from the components they preview. Audit fixes touch `packages/ui`/`packages/admin` only for objective defects.

**Tech Stack:** React 19, Next 16 (playground app), vitest + @testing-library/react, Playwright (captures + MCP visual checks), oklch color tokens, existing `validate-contrast.ts` harness.

## Global Constraints

- Branch: `explore/admin-theme-variations` in `nextly-worktrees/theme-variations`. Commits on this branch; NO PR per task (one PR to `main` after the founder's re-check).
- Conventional Commits, lowercase imperative subject ≤72 chars, scope `playground` (or `ui`/`admin` for mechanical fixes there). NEVER `--no-verify`. No AI attribution anywhere.
- No `as any`, no `@ts-expect-error`, no eslint-disable. Every change carries a what/why comment describing code only.
- WCAG AA thresholds: text ≥ 4.5:1, UI/large ≥ 3:1. After Task 7, `EXPECTED_CONTRAST_FAILURES` allows ZERO failures for every theme.
- Tests are updated, never weakened: every assertion that held for 54 themes holds for 9.
- Playground is not published: no changesets for playground-only commits.
- The 9 keepers: `mono, signal, sand, calm` (Nextly) + `modern-minimal, violet-bloom, twitter, claude, vercel` (tweakcn ids as they appear in `tweakcn.generated.ts` — verify exact id strings before deleting).
- After any UI-facing task, verify in the running playground (`:3000`) with Playwright MCP before committing.
- Run tests from `apps/playground` with `pnpm vitest run <file>` (or the package's test script — check `apps/playground/package.json` scripts once, first task).

---

### Task 1: Prune tweakcn 42 → 5

**Files:**

- Modify: `apps/playground/src/theme-lab/themes/tweakcn.generated.ts`
- Test: `apps/playground/src/theme-lab/__tests__/tweakcn.test.ts`

**Interfaces:**

- Produces: `TWEAKCN_THEMES: ThemeDefinition[]` with exactly 5 entries — ids for Modern Minimal, Violet Bloom, Twitter, Claude, Vercel (read the literal `id:` strings from the file; they are the ids every later task and stored selection uses).

- [ ] **Step 1: Read the current test and the 5 keepers' exact ids**

Run: `grep -n "id: \"" apps/playground/src/theme-lab/themes/tweakcn.generated.ts | head -45` and note the id lines for the 5 keeper labels (labels at lines ~13, 138, 387, 4506, 4630). Read `__tests__/tweakcn.test.ts` in full to see every count/shape assertion.

- [ ] **Step 2: Update the test to the 5-theme corpus (write the failing test first)**

Change any count assertion (e.g. `expect(TWEAKCN_THEMES.length).toBe(42)`) to `5`, and add an id pin so a wrong deletion fails loudly:

```ts
it("carries exactly the shortlisted presets", () => {
  expect(TWEAKCN_THEMES.map(t => t.id).sort()).toEqual(
    ["claude", "modern-minimal", "twitter", "vercel", "violet-bloom"].sort()
  );
});
```

(Substitute the REAL id strings from Step 1 if they differ.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/playground && pnpm vitest run src/theme-lab/__tests__/tweakcn.test.ts`
Expected: FAIL — length 42 ≠ 5.

- [ ] **Step 4: Prune the generated file**

Delete the 37 non-keeper entries from the `TWEAKCN_THEMES` array literal. Keep the file's header comment and the generator provenance note; ADD one line to the header: pruned to the task-08 shortlist on 2026-08-10 — regenerate via the generator script to restore any preset.

- [ ] **Step 5: Run the full theme-lab suite**

Run: `cd apps/playground && pnpm vitest run src/theme-lab`
Expected: tweakcn.test.ts PASSES; use-theme-lab.test.ts still passes (it references only `mono`, `graphite`, `terminal`, tweakcn's first preset — if the tweakcn id it names was deleted, retarget that one `it` to a keeper id, e.g. `claude`).

- [ ] **Step 6: Commit**

```bash
git add apps/playground/src/theme-lab/themes/tweakcn.generated.ts apps/playground/src/theme-lab/__tests__/tweakcn.test.ts
git commit -m "feat(playground): prune tweakcn presets to the five shortlisted"
```

---

### Task 2: Prune Nextly originals 12 → 4, registry comment, contrast record

**Files:**

- Delete: `apps/playground/src/theme-lab/themes/{graphite,ink,blueprint,ember,clay,terminal,brutalist,contrast}.ts`
- Modify: `apps/playground/src/theme-lab/themes/index.ts`
- Test: `apps/playground/src/theme-lab/__tests__/nextly-themes.test.ts`, `apps/playground/src/theme-lab/__tests__/use-theme-lab.test.ts`

**Interfaces:**

- Produces: `NEXTLY_THEMES = [MONO, SIGNAL, SAND, CALM]` (that order: control first, then by departure size); `EXPECTED_CONTRAST_FAILURES = { calm: 58 }`.
- Density facts later tasks rely on (measured with filename-bound grep after an unbound grep misattributed them): mono `default`, signal `default`, sand `comfortable`, calm `comfortable`.

- [ ] **Step 1: Retarget the tests (failing first)**

In `nextly-themes.test.ts`: "ships twelve themes led by mono" → four:

```ts
it("ships four themes led by mono as the control", () => {
  expect(NEXTLY_THEMES).toHaveLength(4);
  expect(NEXTLY_THEMES[0].id).toBe("mono");
});
```

In `use-theme-lab.test.ts`, the density-follow trio references `graphite` (same density as mono) and `terminal`. Retarget using the density facts above:

- "moves an untouched density" → switch `mono` → `signal` (default → comfortable), assert density becomes `"comfortable"`.
- "leaves a changed density alone" → set density `"compact"` first, switch to `signal`, assert still `"compact"`.
- "keeps following after a switch that did not move density" → `mono` → `sand` (both `default`), assert density stays `"default"` and a later switch to `signal` still moves it.
- "attributes every admin root" → use `"signal"` instead of `"terminal"`.

- [ ] **Step 2: Run to verify the retargeted tests fail**

Run: `cd apps/playground && pnpm vitest run src/theme-lab/__tests__/nextly-themes.test.ts src/theme-lab/__tests__/use-theme-lab.test.ts`
Expected: nextly-themes count FAILS (still 12). use-theme-lab retargets PASS already (signal/sand exist) — that is fine; they pin behaviour the deletion must not break.

- [ ] **Step 3: Delete the 8 theme files and rewrite the registry**

`git rm` the eight files. Rewrite `index.ts`: imports shrink to MONO/SIGNAL/SAND/CALM; array in that order; REWRITE the ordering doc-comment for the new corpus (control → accent-only departure (Signal) → warm-surface departure (Sand) → soft-quiet departure (Calm); do not narrate deleted themes). Replace `EXPECTED_CONTRAST_FAILURES` with:

```ts
export const EXPECTED_CONTRAST_FAILURES: Record<string, number> = {
  // Calm's recorded cost of "soft and quiet" (58) stands until its
  // rehabilitation lands; every other theme is held to zero.
  calm: 58,
};
```

- [ ] **Step 4: Run the whole playground suite**

Run: `cd apps/playground && pnpm vitest run`
Expected: PASS. If anything else imports a deleted theme (grep `graphite\|terminal\|brutalist\|contrast\|blueprint\|ember\|clay\|ink` under `src/` and `scripts/`), retarget it to a keeper.

- [ ] **Step 5: Verify the running lab + stale selection fallback by hand**

With `:3000` up: Playwright MCP — navigate to `/admin`, evaluate `localStorage.setItem("nextly-theme-lab", JSON.stringify({theme:"graphite",density:"default"}))`, reload, snapshot: admin renders Mono (not unstyled), switcher lists 9 themes.

- [ ] **Step 6: Add the regression test for a deleted-theme selection**

In `use-theme-lab.test.ts` (the fallback describe):

```ts
it("falls back to mono for a theme this build no longer ships", () => {
  localStorage.setItem(
    STORAGE_KEY_FOR_TEST,
    JSON.stringify({ theme: "graphite", density: "default" })
  );
  expect(readSelection()).toEqual({ theme: "mono", density: "default" });
});
```

(Reuse however the file already names the storage key.) Run the file; expect PASS — then STUB-VERIFY: temporarily make `readSelection` return `parsed.theme` unguarded and confirm THIS test fails; restore.

- [ ] **Step 7: Commit**

```bash
git add -A apps/playground/src/theme-lab
git commit -m "feat(playground): shortlist the nextly themes to mono, signal, sand, calm"
```

---

### Task 3: `ThemePreviewCard` — one card, both modes, real components

**Files:**

- Create: `apps/playground/src/theme-lab/ThemePreviewCard.tsx`
- Test: `apps/playground/src/theme-lab/__tests__/theme-preview-card.test.tsx`

**Interfaces:**

- Consumes: `ThemeDefinition`, `ThemeTokens` from `./types`.
- Produces: `ThemePreviewCard({ theme, size, onApply, applied }: { theme: ThemeDefinition; size: "panel" | "gallery"; onApply: (id: string) => void; applied: boolean })` and `themeVars(theme: ThemeDefinition, mode: "light" | "dark"): CssVars` (exported for tests).

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NEXTLY_THEMES } from "../themes";
import { ThemePreviewCard, themeVars } from "../ThemePreviewCard";

const mono = NEXTLY_THEMES[0];

describe("themeVars", () => {
  it("prefixes every token and carries the shell knobs", () => {
    const vars = themeVars(mono, "light");
    expect(vars["--nx-background"]).toBe(mono.light.background);
    expect(vars["--radius"]).toBe(mono.radius);
    expect(vars["--font-sans"]).toBe(mono.fontSans);
  });

  it("reads the requested mode, not always light", () => {
    expect(themeVars(mono, "dark")["--nx-background"]).toBe(
      mono.dark.background
    );
  });
});

describe("ThemePreviewCard", () => {
  it("renders both mode panels with that mode's tokens inline", () => {
    render(
      <ThemePreviewCard
        theme={mono}
        size="gallery"
        onApply={() => {}}
        applied={false}
      />
    );
    const panels = screen.getAllByTestId("mode-panel");
    expect(panels).toHaveLength(2);
    expect(panels[0].style.getPropertyValue("--nx-background")).toBe(
      mono.light.background
    );
    expect(panels[1].style.getPropertyValue("--nx-background")).toBe(
      mono.dark.background
    );
  });

  it("applies on click with the theme id", () => {
    const onApply = vi.fn();
    render(
      <ThemePreviewCard
        theme={mono}
        size="gallery"
        onApply={onApply}
        applied={false}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith("mono");
  });

  it("shows the applied state instead of an apply button", () => {
    render(
      <ThemePreviewCard
        theme={mono}
        size="gallery"
        onApply={() => {}}
        applied
      />
    );
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/theme-lab/__tests__/theme-preview-card.test.tsx`; expected: module not found.

- [ ] **Step 3: Implement**

```tsx
"use client";

/**
 * One theme rendered as itself: real admin primitives under that theme's
 * tokens, both modes side by side. Tokens are applied INLINE as custom
 * properties, which outranks any class-scoped declaration and cannot leak
 * beyond this subtree -- the preview needs no stylesheet of its own, so it
 * cannot drift from what `themeToCss` would emit for the same definition.
 *
 * The primitives shown are deliberately the complained-about ones: nav rows,
 * a checkbox, an input, buttons, badges -- so a theme is judged on the
 * surfaces where themes have actually failed, not on a swatch strip.
 */
import type { CSSProperties } from "react";
import { Badge } from "@nextlyhq/ui/components/badge";
import { Button } from "@nextlyhq/ui/components/button";
import { Checkbox } from "@nextlyhq/ui/components/checkbox";
import { Input } from "@nextlyhq/ui/components/input";
import type { ThemeDefinition } from "./types";

/** CSSProperties plus the custom properties a theme sets. */
export type CssVars = CSSProperties & Record<`--${string}`, string>;

export function themeVars(
  theme: ThemeDefinition,
  mode: "light" | "dark"
): CssVars {
  const vars: CssVars = {
    "--radius": theme.radius,
    "--font-sans": theme.fontSans,
    "--font-mono": theme.fontMono,
  };
  if (theme.fontSerif) vars["--font-serif"] = theme.fontSerif;
  for (const [name, value] of Object.entries(theme[mode])) {
    vars[`--nx-${name}`] = value;
  }
  return vars;
}

/** The component sampler one mode panel shows. */
function Sampler({ compact }: { compact: boolean }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {/* A nav strip with the three states a sidebar row can be in. */}
      <div className="rounded-md border border-[var(--nx-sidebar-border)] bg-[var(--nx-sidebar-background)] p-1.5 text-[13px]">
        <div className="rounded px-2 py-1 text-[var(--nx-sidebar-foreground)]">
          Posts
        </div>
        <div className="rounded bg-[var(--nx-sidebar-accent)] px-2 py-1 text-[var(--nx-sidebar-accent-foreground)]">
          Pages
        </div>
        <div className="rounded px-2 py-1 text-[var(--nx-muted-foreground)]">
          Media
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm">Save</Button>
        <Button size="sm" variant="outline">
          Cancel
        </Button>
        <Badge>Draft</Badge>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id={undefined} aria-label="Example checkbox" />
        <Input placeholder="Title" className="h-8" />
      </div>
      {!compact && (
        <p className="text-xs text-[var(--nx-muted-foreground)]">
          Secondary text at its real size.
        </p>
      )}
    </div>
  );
}

export function ThemePreviewCard({
  theme,
  size,
  onApply,
  applied,
}: {
  theme: ThemeDefinition;
  size: "panel" | "gallery";
  onApply: (id: string) => void;
  applied: boolean;
}) {
  const compact = size === "panel";
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--nx-border)]">
      <header className="flex items-center justify-between px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold">{theme.label}</h3>
          {!compact && (
            <p className="text-xs text-[var(--nx-muted-foreground)]">
              {theme.description}
            </p>
          )}
        </div>
        {applied ? (
          <span className="text-xs font-medium">Active</span>
        ) : (
          <Button size="sm" variant="outline" onClick={() => onApply(theme.id)}>
            Apply
          </Button>
        )}
      </header>
      <div className={compact ? "grid grid-cols-1" : "grid grid-cols-2"}>
        {(["light", "dark"] as const).map(mode => (
          <div
            key={mode}
            data-testid="mode-panel"
            /* `nextly-admin` scopes the ui components' base styles; the
               inline vars then decide every token those styles read. */
            className={`nextly-admin ${mode === "dark" ? "dark" : ""}`}
            style={{
              ...themeVars(theme, mode),
              background: "var(--nx-page-background)",
              color: "var(--nx-foreground)",
            }}
          >
            <Sampler compact={compact} />
          </div>
        ))}
      </div>
    </section>
  );
}
```

Adjust the `@nextlyhq/ui` import paths to whatever the package's exports map actually exposes (check `packages/ui/package.json` `exports` and how `packages/admin` imports these four components; mirror that). In `panel` size only the LIGHT/current-mode panel matters visually, but both render — the grid just stacks them; if that is too tall in the panel, render only the panel matching the admin's current resolved mode (pass a `mode` prop from the switcher; keep both for gallery).

- [ ] **Step 4: Run the tests** — expected PASS. Then STUB-VERIFY the mode test: make `themeVars` ignore `mode` and always read `theme.light`; the dark-panel assertion must fail; restore.

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/theme-lab/ThemePreviewCard.tsx apps/playground/src/theme-lab/__tests__/theme-preview-card.test.tsx
git commit -m "feat(playground): add the shared theme preview card"
```

---

### Task 4: `/theme-lab` becomes the gallery

**Files:**

- Modify: `apps/playground/src/app/theme-lab/page.tsx`
- Create: `apps/playground/src/app/theme-lab/Gallery.tsx` (client component; the page stays a server shell)

**Interfaces:**

- Consumes: `ThemePreviewCard`, `useThemeLab`, `NEXTLY_THEMES`, `TWEAKCN_THEMES`.
- Produces: the gallery page; the Payload/Strapi swatch board moves into a `<details>` reference section below the grid (keep its existing data arrays and `Swatches` component verbatim, including the index-keyed fix).

- [ ] **Step 1: Write `Gallery.tsx`**

```tsx
"use client";

/**
 * The comparison surface: every shortlisted theme as a large card, applied
 * with one click. Reads and writes the same selection the /admin switcher
 * uses, so applying here and refining there is one continuous act.
 */
import Link from "next/link";
import { NEXTLY_THEMES } from "../../theme-lab/themes";
import { TWEAKCN_THEMES } from "../../theme-lab/themes/tweakcn.generated";
import { ThemePreviewCard } from "../../theme-lab/ThemePreviewCard";
import { useThemeLab } from "../../theme-lab/use-theme-lab";

const ALL = [...NEXTLY_THEMES, ...TWEAKCN_THEMES];

export function Gallery() {
  const { theme, setTheme } = useThemeLab();
  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <p className="text-sm">
          {ALL.length} shortlisted themes — applying switches the real admin.
        </p>
        <Link className="text-sm underline" href="/admin">
          Open /admin with the applied theme →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ALL.map(t => (
          <ThemePreviewCard
            key={t.id}
            theme={t}
            size="gallery"
            onApply={setTheme}
            applied={theme === t.id}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rework `page.tsx`** — keep the heading; mount `<Gallery />`; wrap the existing Payload/Strapi/Mono `Swatches` sections in `<details><summary>Competitor palette reference (Payload / Strapi)</summary>…</details>` below the grid. Do not delete the comparison data or its provenance comments.

- [ ] **Step 3: Verify visually** — Playwright MCP: navigate `http://localhost:3000/theme-lab`, snapshot; expect 9 cards each showing two mode panels with visibly different backgrounds; click one Apply, navigate `/admin`, snapshot: theme applied. Check the collapsed reference opens.

- [ ] **Step 4: Run the suite** — `pnpm vitest run` in `apps/playground`; expected PASS (gallery has no unit tests of its own; the card carries them).

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/app/theme-lab
git commit -m "feat(playground): turn theme-lab into an applying comparison gallery"
```

---

### Task 5: The `/admin` panel reworked onto the card

**Files:**

- Modify: `apps/playground/src/theme-lab/ThemeSwitcher.tsx`

**Interfaces:**

- Consumes: `ThemePreviewCard` (size `"panel"`), `useThemeLab`, next-themes' `useTheme` (already imported there).

- [ ] **Step 1: Rework the panel body**

Replace the filter input + `ThemeRow`/`SwatchStrip` list with: a scrollless stack of 9 `ThemePreviewCard size="panel"` (pass the admin's current resolved mode so each card renders ONE mode panel — add an optional `mode?: "light" | "dark"` prop to the card: when set, render only that panel; when unset, both. Update the card test: a `mode="dark"` render has one panel carrying dark tokens). Keep: the density segmented control, the light/dark toggle, `reset`, the open/close button. Delete: `filter` state, `SwatchStrip`, `ThemeRow`, the match-count line. Widen the panel to fit the card (~320px). Add a "Compare all →" link to `/theme-lab`.

- [ ] **Step 2: Update the card test for the `mode` prop** (failing first): render with `mode="dark"`, expect ONE `mode-panel` whose `--nx-background` equals `theme.dark.background`. Run, implement, run again.

- [ ] **Step 3: Verify visually** — Playwright MCP on `/admin`: open the panel; all 9 visible without scrolling at 1080p (or with at most one fold — judge and note); switch two themes; toggle dark; density control still works; `reset` returns to Mono/default.

- [ ] **Step 4: Full suite + lint** — `pnpm vitest run` (playground), `pnpm lint --filter playground` (or the repo's equivalent — discover once and reuse). Expected: green, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/theme-lab
git commit -m "feat(playground): rebuild the switcher panel on the preview card"
```

---

### Task 6: Calm to AA

**Files:**

- Modify: `apps/playground/src/theme-lab/themes/calm.ts`, `apps/playground/src/theme-lab/themes/index.ts`
- Test: existing `nextly-themes.test.ts` contrast expectation (no new test file — the harness IS the test)

**Interfaces:**

- Produces: `EXPECTED_CONTRAST_FAILURES = {}` (empty record, comment rewritten: every theme is held to zero; the export stays so an intended exception ever needed again has a place to be recorded).

- [ ] **Step 1: Set the expectation to zero (failing first)** — change `calm: 58` to an empty record. Run `pnpm vitest run src/theme-lab/__tests__/nextly-themes.test.ts`. Expected: FAIL listing all 58 failures with mode, pairing label, and measured ratio — that listing is the worklist.

- [ ] **Step 2: Retune, in passes** — for each listed failure, in `calm.ts`, keep the token's hue (`H`) and chroma family, move its oklch `L` away from its paired background's `L` until the listed ratio clears the pair's threshold (4.5 text / 3 UI — the failure label names which). Work biggest-deficit first; re-run the test file after each pass and let the shrinking list drive. Both modes. Do not touch tokens that never appear in the list.

- [ ] **Step 3: Confirm zero** — the test passes with the empty record. Record the before/after of every changed token (old → new value, the pairing, old → new ratio) in a table saved to `apps/playground/src/theme-lab/calm-rehab-notes.md` — the audit report consumes it.

- [ ] **Step 4: Verify visually** — Playwright MCP: apply Calm on `/admin`, both modes, snapshot dashboard + an entry form; judge that it still reads "soft": surfaces unchanged, secondary text darker but quiet. Note anything that now looks broken for the report.

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/theme-lab/themes/calm.ts apps/playground/src/theme-lab/themes/index.ts apps/playground/src/theme-lab/calm-rehab-notes.md
git commit -m "feat(playground): rehabilitate calm to wcag aa"
```

---

### Task 7: Audit evidence — tokens, code, captures

**Files:**

- Create: `apps/playground/scripts/audit-themes.mjs` (token-level sweep)
- Output: `apps/playground/.theme-captures/` (regenerated), `apps/playground/src/theme-lab/audit-evidence/` (committed findings data)

- [ ] **Step 1: Token sweep script** — `audit-themes.mjs` loads the 9 themes via the same ts-extension-loader the capture script uses, and for each theme × mode emits a JSON report to `audit-evidence/tokens.json`: (a) every `validate-contrast` pairing with its ratio (PASS/FAIL); (b) the founder's named checks: `border`/`border-subtle`/`border-strong` vs `background` and `card` (flag any border whose contrast with its surface EXCEEDS 3:1 as "prominent" and any below 1.3:1 as "invisible"); `input` and checkbox-related tokens vs `background` ≥ 3:1; `sidebar-primary` usage note. Reuse `contrastRatio` from the ui package's contrast module the validator already uses — do not write a third color parser (two exist deliberately; a third is the thing to avoid).

- [ ] **Step 2: Code-level greps** — run and save outputs to `audit-evidence/code-findings.md` with file:line lists:

```bash
# hardcoded colors in shipped packages (candidates, review each hit):
grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(" packages/admin/src packages/ui/src --include="*.tsx" --include="*.ts" | grep -v "__tests__\|\.test\.\|contrast/" > /tmp/hardcoded.txt
# primary used in nav/sidebar contexts (the founder's complaint):
grep -rn "primary" packages/admin/src/components/features/dashboard packages/admin/src/components/layout/sidebar --include="*.tsx" | grep -iE "nav|menu|item|link"
```

Review every hit; classify: MECHANICAL (objective defect) vs JUDGMENT (design choice) vs FINE (e.g. the theme-lab comparison page's deliberate literals).

- [ ] **Step 3: Captures** — `cd apps/playground && node scripts/capture-themes.mjs` (~9×2 across its screen set; confirm it picked up the shrunk registry — the run count printed should reflect 9 themes). Review captures against the named complaints: top-bar/sidebar border prominence, checkbox visibility, nav-item primary misuse, background issues, plus layout breaks. Log per-theme observations in `audit-evidence/visual-notes.md`.

- [ ] **Step 4: Density + spacing + fonts** — read `densities.css`, the admin's spacing usage (`gap-`, `p-`, `space-` distributions via grep counts), and the font stacks in `theme.css` + each theme. Write observations with numbers (e.g. how many distinct gap values the dashboard uses) into `audit-evidence/spacing-density-fonts.md`.

- [ ] **Step 5: Commit evidence**

```bash
git add apps/playground/scripts/audit-themes.mjs apps/playground/src/theme-lab/audit-evidence
git commit -m "feat(playground): add the theme audit sweep and its evidence"
```

---

### Task 8: Mechanical fixes

**Files:**

- Modify: whatever Step 2/3 of Task 7 classified MECHANICAL in `packages/ui` / `packages/admin` (each fix its own commit, scope `ui` or `admin`)

- [ ] **Step 1: For each MECHANICAL finding, smallest-first:** write/adjust the failing check where one exists (the ui contrast suite asserts token pairings; a hardcoded-color fix is pinned by grep absence), fix by replacing with the correct `--nx-*` token, verify in the running admin (Playwright MCP, both modes, at least Mono + one dark-heavy theme), commit as `fix(admin): …` or `fix(ui): …` with a what/why comment at the site.
- [ ] **Step 2: Re-run** the ui package tests (`pnpm --filter @nextlyhq/ui test` — verify script name first) and the playground suite after the batch. Zero new failures.
- [ ] **Step 3:** List every fix (finding → commit SHA) in `audit-evidence/mechanical-fixes.md`; anything reclassified to JUDGMENT during fixing goes back to the report with the reason.

---

### Task 9: The report

**Files:**

- Create: `apps/playground/src/theme-lab/AUDIT-task-08.md`

- [ ] **Step 1: Write the report** from the committed evidence, sections: (1) per-theme contrast tables (from `tokens.json`); (2) the "why Payload/Strapi look more colourful" answer — neutral RAMPS (21 / 10+ steps) vs Nextly's ~50 semantic tokens with no intermediate neutral steps; the missing middle as the root of border-prominence; the fixed swatch-key bug that hid one Mono swatch; what we lack and what adding a ramp would/would not buy; (3) density recommendation with reasoning (from evidence, per-theme `recommendedDensity` facts, competitor defaults); (4) spacing + font findings; (5) Calm before/after (from `calm-rehab-notes.md`); (6) mechanical fixes made (from `mechanical-fixes.md`); (7) JUDGMENT recommendations for the founder's re-check, each with options + honest recommendation.
- [ ] **Step 2: Self-check** — every claim in the report traces to a file in `audit-evidence/` or a commit SHA; no "should probably"; both modes covered everywhere.
- [ ] **Step 3: Commit** — `git add … && git commit -m "docs(playground): write the task 08 theme audit report"`.
- [ ] **Step 4: Push the branch as backup** — `git push -u origin explore/admin-theme-variations` (branch push, still no PR), verify with `git ls-remote origin explore/admin-theme-variations`.

---

## Self-Review (done at writing time)

- **Spec coverage:** prune (T1–T2), fallback test (T2), card (T3), gallery (T4), panel (T5), Calm (T6), audit lenses (T7), mechanical fixes (T8), report incl. "why more colors" + density + spacing/fonts + before/after (T9). Competitor reference preserved (T4). Pipeline preserved (T1 header note). No gaps found.
- **Placeholders:** none; the two discovery-driven tasks (T8 mechanical fixes, T9 report) specify their loop, criteria, inputs, and outputs concretely.
- **Type consistency:** `ThemePreviewCard` props consistent across T3/T4/T5 (T5 adds optional `mode` and updates the test); `themeVars` name used consistently; `EXPECTED_CONTRAST_FAILURES` `{calm: 58}` (T2) → `{}` (T6).
