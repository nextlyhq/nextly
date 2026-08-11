# PR #634 follow-up: the theme lab harness

What #634 did NOT close, why each item was deferred rather than dropped, and
enough context to work it without re-reading the review.

## The split

#634 ships **the admin theme itself** plus the guards that keep it honest. Every
review finding touching a published package is closed. What remains touches
only `apps/playground`, the contributor dev harness, which ships to nobody.

That split is deliberate and it is what makes merging safe: a defect in the
theme lab makes a contributor's comparison less trustworthy, and a defect in
`packages/ui` or `packages/admin` reaches every user.

**Do not read "playground only" as "cosmetic".** Several of these directly
weaken the evidence the theme choice rests on. Item 1 is the clearest: a
switcher that cannot switch mode makes every dark-mode comparison a light-mode
one.

## Priority 1 — the lab lies about what it is showing

These make the harness produce wrong evidence while looking like it works.
Anything the harness reported before these are fixed should be re-taken.

### 1. The switcher never reaches the theme provider

`PRRT_kwDOSYwUJs6YEbiY` · `src/theme-lab/ThemeSwitcher.tsx:137`

`ThemeSwitcher` renders as a sibling AFTER the admin `children` in
`app/admin/[[...params]]/layout.tsx`, while the only `ThemeProvider` is nested
inside the child's `RootLayout`. So `useTheme()` gets next-themes'
provider-less fallback: `resolvedTheme` is undefined and `setTheme` is a no-op.
The switcher always reports light, and choosing dark does nothing.

Mount it inside the same provider, or lift the provider above both subtrees.

Note when fixing: `packages/admin` now mounts a `ShortcutProvider` at the shell
root, and the pattern established there is that a component which can render
standalone brings its own provider. Nested providers are cheap. The same shape
applies here.

### 2. Preset fonts fall through to system monospace

`PRRT_kwDOSYwUJs6YD4T2` · `scripts/import-tweakcn.mjs:196`

The importer copies upstream font strings verbatim. The playground loads fonts
with `next/font` using variable-only classes, so a bare `Inter` or
`IBM Plex Mono` selects nothing — only presets already written as
`var(--font-inter)` render their declared face. And `Plus Jakarta Sans`,
`Open Sans`, `JetBrains Mono` and `Geist` are not loaded anywhere in the app.

So the typography axis of the comparison was never real. Map known upstream
stacks onto loaded variables, and load the fonts the shortlist needs.

### 3. Lab themes are missing tokens the admin renders

`PRRT_kwDOSYwUJs6YCLUj` (`--nx-table-header-bg`) and
`PRRT_kwDOSYwUJs6YGMJ5` (`--nx-chart-1`…`-5`) · `src/theme-lab/types.ts`

`themeToCss` emits only the keys present in a theme's mode map, and the
required-token list does not name these. So when a lab theme is applied, table
headers, footers, pagination and every dashboard chart keep the SHIPPED
palette while the rest of the screen changes — a partial theme that the
completeness test cannot see, because the list it checks against is the same
incomplete list.

Add both groups to the required list and define them for light and dark in
every theme. The completeness test only means something once it is checked
against what the admin actually reads, not against what the themes happen to
declare.

### 4. Captures include the switcher overlay

`PRRT_kwDOSYwUJs6YDJo4` · `scripts/capture-themes.mjs:339`

The admin layout mounts `ThemeSwitcher` unconditionally and its collapsed state
is a fixed, maximum-z-index button at the bottom right. Full-viewport captures
therefore have it burned into every artifact, over the UI being compared.

Hide it for capture runs, or screenshot the admin root rather than the
viewport.

### 5. The dashboard capture accepts an error screen

`PRRT_kwDOSYwUJs6YGMJ8` · `scripts/capture-themes.mjs:137`

Readiness waits for zero `Skeleton` elements. When a dashboard request fails,
widgets REPLACE their skeletons with error states — `ContentStatusWidget`
renders "Health synchronization failed" — so the check passes and a failed
dashboard is captured as evidence. Every other route has a positive assertion;
this one does not.

Wait for a value that can only appear after a successful load.

## Priority 2 — the harness is not reproducible by someone else

### 6. Regenerating the importer destroys the shortlist

`PRRT_kwDOSYwUJs6YCLUq` (and `PRRT_kwDOSYwUJs6YBkcI`, the same finding against
the plan) · `scripts/import-tweakcn.mjs:224`

`tweakcn.generated.ts` is generated, but the shortlist was applied by editing
the generated array. Re-running the importer restores all 37 presets, fails
`tweakcn.test.ts`, and silently expands the switcher.

Put the shortlist filter in the importer, or keep the full registry as a
separate artifact and generate the shortlist from it.

### 7. The importer's copied tokens have drifted from the theme

`PRRT_kwDOSYwUJs6YEbia` · `scripts/import-tweakcn.mjs:67`

The `SHIPPED` block is a hand-copy of theme values that has fallen behind:
`theme.css` uses `0.5264` for code comments and punctuation while the
generator still carries `0.541`, and the copied success and warning tokens are
older too. Regeneration therefore produces presets whose supposedly-shared
palette differs from the shipped one, which invalidates comparisons of exactly
the parts meant to be common.

Derive from one source rather than copying. A test that the copy matches
`theme.css` would also do, but deriving removes the class of defect.

### 8. The margin solver reads uncorrected presets

`PRRT_kwDOSYwUJs6YDJo2` · `scripts/solve-margin.mjs:17`

It imports the generated file directly, bypassing the accessibility overrides
that `themes/index.ts` applies. For `tweakcn-vercel` it therefore solves
against raw upstream values rather than the theme the lab renders, so its
"current ratio" describes a theme nobody sees and its proposal can reintroduce
a corrected value.

Import both arrays from the corrected barrel.

### 9. Captures need Chromium, and nothing installs it

`PRRT_kwDOSYwUJs6YDJo-` · `scripts/capture-themes.mjs:237`

`pnpm install` installs the `playwright` package but not its browser. The only
`playwright install` instruction in the repo is scoped to the `e2e` package, so
on a fresh checkout the documented capture command dies with "Executable
doesn't exist".

Add a preflight to the capture script, or a setup entry that runs it.

### 10. jsdom's Node floor is above the repo's

`PRRT_kwDOSYwUJs6YDJo5` · `apps/playground/package.json:60`

`jsdom@27.1.0` declares `^20.19.0 || ^22.12.0 || >=24.0.0`; the repo declares
`>=20.9.0`. The jsdom-backed theme tests are therefore unreliable on Node
20.0–20.18, which the repo claims to support.

Either pin a jsdom compatible with the declared floor, or raise the floor.
This is a repo-wide decision, not a playground one — check whether anything
else already assumes a higher Node before choosing.

## Priority 3 — correctness at the edges

### 11. Persisted theme state is read during hydration

`PRRT_kwDOSYwUJs6YB3XL` · `src/theme-lab/use-theme-lab.ts:116`

The server initializer returns Mono because `localStorage` is unavailable,
while the first browser render reads the stored theme. Which card shows
"Active" versus "Apply" therefore differs between the two, so React discards
and regenerates the subtree.

Initialize from a stable server snapshot and apply the persisted selection
after hydration, or use an external-store API with an explicit server
snapshot.

### 12. Density-following through the shipped sentinel

`PRRT_kwDOSYwUJs6YJM2c` · `src/theme-lab/use-theme-lab.ts:181`

Raised against the current head; read it in full before acting. It concerns
the branch that decides whether a root keeps following the selected theme's
density when the selection returns to the shipped sentinel.

### 13. The switcher's hardcoded colors

`PRRT_kwDOSYwUJs6YB3XU` · `src/theme-lab/ThemeSwitcher.tsx` (outdated anchor)

The switcher defines its panel, controls, borders, status colors and shadow
with literal hex/rgba, while being mounted directly into the `/admin` layout —
inside the styling surface whose contract permits only `--nx-*`.

The honest options are: give it real tokens, or move it out of the admin
styling surface. A source comment claiming an exception does not create one.
Worth settling together with item 1, since both are about the switcher sitting
in a scope it does not belong to.

## The six planning-document threads

`PRRT_kwDOSYwUJs6YBkcD`, `…BkcI`, `…BkcM`, `…BkcO`, `…BkcS`, `…BkcX` against
`DESIGN-task-08.md` and `PLAN-task-08.md`.

These review a plan that has since been executed. Four of the six describe
behaviours that were fixed in the code during execution — preview tokens
scoping the whole card, controls measured on every rendered surface, the
hardcoded-color scan covering CSS. Two are still live and are captured above
as items 6 and 3.

**Recommended disposition:** reply that the plan is history and its findings
live in code, pointing at where. Editing an executed plan retroactively makes
it a worse record, not a better one. Do not silently resolve them — say which
code carries each finding.

## What #634 established that this work should not undo

- **Measure the artifact the product renders, not the one convenient to
  measure.** Every significant finding in #634 was an instance of that being
  violated.
- **Passing and passing-by-enough are different properties.** The contrast
  suite now enforces a 0.25 margin. Solve tokens to a margin, never to the
  threshold.
- **A green assertion covers the pair it NAMES**, not the pair the product
  renders.
- **Stub-verify every test.** If a stub does not falsify, first check the stub
  landed and disables an input the code reads — three times in #634 a
  non-falsifying stub was a bad probe rather than an inadequate test. Twice it
  was a genuinely inadequate test, including one that passed by matching a
  string inside its own comment.
- **`packages/ui` typechecks zero test files.** `tsconfig.json` excludes
  `**/*.test.ts`. A green `check-types` there says nothing about test
  correctness. Owned by task 167.

## Carried in from another lane

`--nx-font-mono` is declared nowhere. `packages/ui/src/styles/theme.css` has
only the Tailwind `--font-mono` (line ~524), so the API playground's CodeMirror
editor silently falls back to generic monospace and its typography cannot
follow the theme. The fix is to declare `--nx-font-mono` alongside the other
shell tokens and map `--font-mono` to it in `@theme inline`, then consume the
`--nx-` token at the call site. Reaching past the token to the global is the
bypass the admin styling contract exists to prevent.
