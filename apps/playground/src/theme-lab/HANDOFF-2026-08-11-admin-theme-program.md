# Handoff — admin theme program, 2026-08-11

Everything shipped, everything open, every decision, and the judgements that
settle most questions in this lane. Written to be read cold.

---

## 1. Where things stand

| PR                                  | State                  | Head        | Threads                    |
| ----------------------------------- | ---------------------- | ----------- | -------------------------- |
| **#634** admin theme                | **MERGED** `6823b57db` | —           | 59, all resolved           |
| **#659** theme lab harness          | **MERGED** `2f883401d` | —           | 14, all resolved           |
| **#675** one colour type            | **MERGED** `49a87c51f` | —           | 0                          |
| **#674** dashboard capture evidence | **OPEN**               | `b43e25c31` | 8 raised, **0 unresolved** |

Branch: `fix/dashboard-capture-evidence`.
Worktree: `nextly-worktrees/theme-variations`. **Work only here.** Never in
`/Users/mobeen/Work/Products/nextly-integrations/nextly` — another session
switched that checkout off a branch mid-command today.

`origin/main` moves several times an hour. Merge it before trusting anything.

---

## 2. What shipped

### #634 — the admin theme

The neutral admin theme in `packages/ui/src/styles/theme.css`, plus the guards
that keep it honest:

- **Contrast harness** at `packages/ui/src/styles/contrast/` — pairings, an
  oklch/`color-mix()` resolver, alpha compositing, WCAG ratios.
- **A margin gate.** Every pairing must clear its threshold by **0.25**, not
  merely clear it. This exists because a control boundary sat at 3.05:1
  against a real page surface, passed a 3:1 gate, and was reported healthy.
- **Control-boundary tokens** solved against the worst surface they land on:
  `--nx-input` and `--nx-border-strong` measured against
  `--nx-page-background` (what `.admin-page-container` paints), not
  `--nx-background`.
- Comment guards: `comments-describe-code.test.ts` (comments must not point
  outside the codebase) and `comments-match-token-values.test.ts` (a comment
  naming a colour must name the colour the token is).
- `admin-token-reachability.test.ts` — every `--nx-*` the admin consumes must
  be declared in `theme.css`.

### #659 — the theme lab harness

Made the lab's evidence trustworthy:

- **Chart tokens follow the selected theme.** Four of five slots derive from
  roles every theme declares (`chart-1→primary`, `3→success`, `4→warning`,
  `5→destructive`). Slot **2 deliberately keeps the shipped value** — the
  shipped colour is a cyan and no theme role is cyan, so deriving it would
  invent a colour nobody chose. `CHART_SLOT_WITHOUT_A_ROLE` pins that the
  exception is one slot.
- **Mono states its own charts.** A theme that declares chart tokens keeps
  them; derivation is the fallback. Mono is the unchanged control, and
  deriving from its own roles moved the baseline every other theme is
  compared against. `OPTIONAL_TOKENS` in `types.ts` makes chart slots
  declarable without loosening the stray-token rule.
- **Scripts run on `tsx`.** The hand-written `ts-extension-loader.mjs` is
  deleted; it only appended extensions and failed on Node 20. Named entries:
  `theme:audit`, `theme:capture`, `theme:contrast-report`, `theme:margins`,
  `theme:solve`, `theme:solve-lightness`, `theme:import-presets`,
  `theme:capture:setup`.
- **The importer owns the shortlist** (`scripts/tweakcn-shortlist.mjs`) and
  **derives borrowed tokens from `theme.css`** rather than hand-copying. The
  copy had drifted; correcting it changed two presets' real scores
  (`tweakcn-claude` 34→32, `tweakcn-twitter` 36→35).
- **Fonts resolve.** Nine faces loaded via `next/font`; the importer maps
  family names onto their variables. Before this, every preset previewed in
  the same face — the typography axis was one font measured nine times.
- **Hydration** via `useSyncExternalStore` with a server snapshot.
- **`densityChosen` is recorded, not inferred**, and is dropped when the
  stored density no longer exists.
- **Capture readiness asserts positive evidence per data family**, and hides
  the theme-lab switcher from every screenshot.
- Node range unified to `^20.19.0 || ^22.12.0 || >=24.0.0` across
  `package.json`, `CONTRIBUTING.md` and `AGENTS.md`, with
  `node-range-agrees.test.ts` holding them together.

### #675 — one colour type

`contrast/color.ts` now aliases `Rgba` from the published `lib/color` instead
of declaring its own structurally identical `Rgb`.

**Decision recorded: the WCAG functions stay unpublished.** Moving
`relativeLuminance` / `contrastRatio` / `compositeOver` into `lib/color` would
make them permanent public API, freezing which WCAG formula, which compositing
rule and which gamut-edge behaviour the harness uses. The trigger for moving
them is an external consumer who needs WCAG maths, not a tidier tree.

---

## 3. Open work

### #674 — awaiting review, 0 unresolved

Two fixes plus three comment corrections. Watch it, work findings, do not
merge without CI green **and** zero unresolved.

### Queued, unstarted

- **`SidebarInset` dead `<main>`** — `packages/admin/src/components/layout/sidebar/index.tsx:289`.
  Exported, never rendered (`grep -rn "<SidebarInset"` returns nothing),
  carries a `<main>`. A live e2e strict-mode tripwire the moment anyone
  renders it. **Hygiene, not a P1** — it was mistakenly handed over as the
  cause of task 194 and that was retracted. Options: delete it, or change its
  element to a `<div>` and keep the layout behaviour. The second is probably
  right — the `<main>` is a shadcn default, and the admin already renders its
  own landmark at `DashboardLayout.tsx:105`.
- **`--nx-font-mono` is declared nowhere.** `theme.css` has only Tailwind's
  `--font-mono` (~line 524), so the API playground's CodeMirror editor falls
  back to generic monospace. Fix: declare `--nx-font-mono` alongside the other
  shell tokens, map `--font-mono` to it in `@theme inline`, consume the `--nx-`
  token at the call site. **Spans `packages/ui` + `packages/admin`, both
  published — needs its own PR and a changeset.** Reaching past the token to
  the global is the bypass the admin contract exists to prevent.

### Ruled out by the founder

`tasks/admin-ui-tasks/09-general-ui-tweaks-improvements.md` — _"that file is
not ready yet. ignore the tasks in that file."_ Do not work from it. That
covers tabs, the dimmed search field, plugin token compliance, the sidebar
double border, the sidebar logo, the table/pagination audit, plugin pages,
Create Form, and the multilingual/versioning revamps.

### Found by measurement, not from that file

**The plugin identity contract.** `PluginDefinition` has no `displayName`.
The human-readable name lives at `admin.appearance.label` — optional, nested
under _appearance_. Only `plugin-form-builder` sets it, which is why
page-builder renders as `@nextlyhq/plugin-page-builder`. Every plugin card in
a directory needs name, description, icon, author, category; four are optional
and one does not exist. **Cheap now, breaking after a directory ships.**

Also: `style-fixture` is a deliberate e2e fixture in
`apps/playground/src/plugins/`, indistinguishable from a shipped plugin in the
admin, and its showcase renders inside `/admin/collections/posts` by design
(`posts.afterList`). Both looked like bugs to the founder. Hiding it is a
judgement call — hiding test fixtures can also hide genuine breakage.

---

## 4. Lane map (sockets go stale on restart — re-run `ListAgents`)

| Lane                            | Holds                                            | Touches my files? |
| ------------------------------- | ------------------------------------------------ | ----------------- |
| UI components (`22353`)         | #673 artifact gate, #656 layering, colour picker | No                |
| Page-builder renderer (`20554`) | `blocks-react`, `blocks-engine`, #669            | No                |
| Preview/auth (`82376`)          | #601 preview-link mint gate                      | No                |

**Ask peers for a delete-or-regenerate list, not just an edit list.** That
question has surfaced collisions twice that a normal exchange missed.
State your own holdings and intentions as **separate** lists — conflating them
made two lanes believe this one was running a sweep it never planned.

---

## 5. CI hazards — check before blaming your diff

1. **`dist/chunk-<hash>.mjs` / `Failed to resolve entry for package "X"` /
   `Cannot find package 'nextly/…'`** — `blocks-react`'s vitest global setup
   ran a nested `turbo build` during collection, deleting ten packages'
   `dist/` while seventeen suites read them. **Fixed by #669 (`c975705db`).**
   Grep for **all three** signatures; the third was missed for hours because
   people grepped only `chunk-`.
2. **`PUSHSCHEMA_FAILED` / `DROP TABLE single_*`** — fixed by #649.
3. **`super-linearly`** in `blocks-engine/src/performance.test.ts` — a
   wall-clock ratio (9.87 vs a threshold of 8). Task 188. Not a defect.

---

## 6. The judgements that settle most questions here

- **Measure the artifact the product renders**, not the one convenient to
  measure. Every significant finding in this program is an instance of this
  being violated.
- **Passing and passing-by-enough are different properties.** Solve to a
  margin, never to a threshold.
- **A green assertion covers the pair it NAMES**, not the pair the product
  renders.
- **A guard that shares state with what it inspects will eventually certify
  its own output.** Ask what the check reads, then ask whether the check
  itself could have put something there. Three instances: a stylesheet guard
  counting its own explanatory comment as an import; a route detector matching
  the scope name inside its own prose; a runtime gate reading a global an
  earlier artifact installed.
- **Ask whether the check runs at all in the layer where its property lives.**
  A type assertion needs a typechecker. `packages/ui` typechecks **zero** test
  files (`tsconfig.json` excludes every test glob), so a type-level assertion
  there is stripped by esbuild and cannot fail. Verified by stub: widening
  `Rgb` to `alpha?: number` left an assignment assertion green.
- **An empty result is a claim about your QUERY until you have shown the query
  can find something.** Three instances today: a grep for an error branch that
  omitted `couldn`; a symbol count of 8 across 5 patterns that could not show
  each matched; a peer's audit reporting zero errors while every line failed
  with an unmatched error code. **Run the positive control first**, not after.
- **Uniqueness of rendered text is not an invariant** when two independently
  fetched components can produce the same label. A count describes the render
  it observed.
- **A pattern is not a line.** Prose wraps; a rule matching per line has an
  escape hatch that opens by accident whenever a comment is reflowed.
- **A guard widening what CI checks must land last, or carry the fixes it
  newly catches** — in the same commit, not merely the same PR, or a bisect
  lands on the state where the guard exists and the fixes do not.
- **Stub-verification:** if a stub does not falsify, first check the stub
  landed and disables an input the code reads. Several times a non-falsifying
  stub was a bad probe rather than an inadequate test. Only after ruling that
  out is the test at fault.
- **`git checkout -- file` restores to the last COMMIT.** It has twice
  reverted a real fix along with a stub. Commit before stub-verifying.
- **A filed task has two failure modes.** Stale content (description no longer
  matches the tree) is defended by checking before editing. Stale _status_
  (accurate but already fixed) cannot be — only closing at fix time helps.
  Seven filed findings today had descriptions that did not match the tree.

---

## 7. Hard rules

Never commit to `main`. Never `--no-verify`. No AI attribution. Conventional
Commits, lowercase imperative ≤72 chars, via `git commit -F`. ONE changeset per
PR at `patch`, covering every package in the fixed group, generated in node
from `.changeset/config.json` — never hand-typed. Playground and test-only
changes get **no** changeset. No `as any` / `@ts-expect-error` / eslint-disable
— type a `.mjs` helper with a sibling `.d.mts`. Comments describe the CODE,
never tasks, reviews or conversations — there are tests for this. Never use
"tweakcn" or any preset brand name in user-facing text. After merging main,
`pnpm install` before trusting a build; a stale `dist` produces typecheck
errors in _other_ packages that look like yours. Never bare `git stash` — the
stack is shared across worktrees.
