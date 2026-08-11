# Why some themes sit near the contrast gate — measured

**Date:** 2026-08-10. Evidence for the task-08 report. Two hypotheses were put to me; both were
testable, and the measurements refute one and re-root the other.

## Measured: near-gate clustering vs palette structure

`scripts/audit-margins.mjs`, light mode:

| Theme                  | pairings within 0.25 of gate | distinct L steps | L range | steps ÷ range | distinct chromas |
| ---------------------- | ---------------------------- | ---------------- | ------- | ------------- | ---------------- |
| mono                   | **9**                        | 26               | 1.000   | 26.0          | 17               |
| signal                 | **10**                       | 27               | 1.000   | 27.0          | 20               |
| sand                   | 1                            | 30               | 0.750   | 40.0          | 23               |
| calm                   | 1                            | 24               | 0.550   | 43.6          | 13               |
| tweakcn-modern-minimal | 7                            | 15               | 1.000   | 15.0          | 12               |
| tweakcn-violet-bloom   | 9                            | 14               | 0.792   | 17.7          | 12               |
| tweakcn-twitter        | 9                            | 14               | 0.792   | 17.7          | 12               |
| tweakcn-claude         | 7                            | 15               | 1.000   | 15.0          | 12               |
| tweakcn-vercel         | 8                            | 21               | 1.000   | 21.0          | 13               |

### The monochrome hypothesis is REFUTED

The proposal was that a monochrome palette has only one axis to spend, so surface levels, borders
and muted text pack onto lightness alone and land near thresholds with nowhere else to go — making
thinness structural to Mono's design and unfixable without giving up the aesthetic.

The data says otherwise, twice over:

1. **Mono is not monochrome by measurement.** It carries **17 distinct chromas** — more than Calm's 13. Its code-syntax set alone spends a dozen. "Mono" describes its neutrals, not its palette.
2. **Packing density runs the WRONG way.** Sand (40.0 steps per unit range) and Calm (43.6) are the
   most tightly packed and have the FEWEST near-gate pairings (1 each). Mono (26.0) and Signal
   (27.0) are the most loosely packed and have the most (9, 10). If cramming caused thinness the
   correlation would be positive; it is negative.

**What actually predicts it: whether anyone optimised for headroom.** Calm was fitted to a margin
today. Sand was authored late, against the contrast harness. Mono is "today's Nextly, unchanged" and
Signal is an early variation on it — neither was ever tuned for margin, only for passing. So the
remedy is not a design tradeoff about surface levels; it is the ordinary work of re-fitting two
themes to a margin, exactly as Calm was.

That is a materially cheaper conclusion than the structural one, and it is the one the numbers
support.

## Root-caused: what "the ruler moved" actually was

Calm's recorded 58 misses became 48 with the theme untouched. The natural reading — colour
resolution drifted, so every ratio moved a little — is **wrong**.

`git show 648c7f4b5 -- packages/ui/src/styles/contrast/pairings.ts` shows the theming-readiness
change removed exactly **five** boundary pairings and altered no maths:

- `border on page`
- `border on card`
- `border on popover`
- `table border on card`
- `table border on page`

Five pairings × two modes = **ten checks removed**. Calm lost exactly ten failures. The whole delta,
accounted for.

**So no ratio drifted by any amount.** The instrument did not become more or less accurate; it
stopped asking five questions. Two consequences:

1. **A fragility band expressed in ratio points (0.25) calibrates against the wrong risk.** Ratio
   drift is not what has historically moved these numbers. The real exposure for a fitted theme is
   the pairing SET changing — a check added that it was never fitted for. The band is still worth
   keeping for the drift case, but it should not be mistaken for a measure of this one.
2. **The removal was deliberate and well-reasoned**, and its rationale is in the diff: only
   boundaries WCAG 1.4.11 actually reaches (those identifying a component or its state) are held to
   3:1, so a decorative container edge or row divider does not drag the whole border scale up.

## The consequence for the audit

The suite **no longer checks `border` against any surface**. What remains is `border-strong`,
`input`, `sidebar-border` and the focus ring.

That is exactly the region the founder reported by eye — "prominent big border lines somewhere (e.g.
top bar, primary sidebar)". The contrast suite is silent there **by design**, and silent in both
directions: it cannot see a border that is too heavy, and since the removal it cannot see `border`
being too faint either.

This is why the audit measures border BANDS (`scripts/audit-themes.mjs`) rather than re-running the
pass/fail gate: the founder's complaint lives precisely in the gap the gate deliberately leaves.
