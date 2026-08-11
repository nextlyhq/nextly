# Calm → WCAG AA: what it cost

**Date:** 2026-08-10. **Measured against** contrast source `packages/ui/src/styles/contrast` at the
revision stamped in `contrast-report.generated.ts`.

**Result: 48 asserted pairings failing → 0.** Every Nextly theme is now held to zero, and
`EXPECTED_CONTRAST_FAILURES` is empty.

## Method

Values were SOLVED, not guessed. `scripts/solve-calm.mts` binary-searches the oklch lightness that
clears a target ratio against a given background, using the harness's own `resolveColor` and
`contrastRatio` — so a solved value agrees with the test by construction rather than by luck. Each
token was solved against the _strictest_ surface it appears on (white card in light mode, the muted
surface in dark), so one value clears every pairing that token takes part in.

Hue and chroma were held fixed throughout. Only lightness moved, plus border alpha. Calm's colour
identity — dusty blue primary, sage highlight, warm-neutral statuses — is unchanged.

### Solved to a MARGIN, not to a pass

The first fit targeted the gate exactly (4.5 text / 3.0 UI) and left Calm's worst pairing at
**+0.042** — a pass by four hundredths. That is maximally fragile to the very thing the revision
stamp exists to detect: the next time the contrast source moves, a pairing is restated, or colour
resolution changes by a rounding step, a theme sitting on the line flips back to failing.

Re-solved at 5.0 / 3.4 so drift has somewhere to go. Because luminance is monotonic in lightness at
fixed hue and chroma, buying margin costs a small, predictable amount of lightness and nothing else
about the theme's identity.

**Worst-case margin per theme, measured:**

| Theme                    | Worst margin | Pairing                           |
| ------------------------ | ------------ | --------------------------------- |
| Mono (untouched control) | +0.109       | dark destructive text on popover  |
| Signal (untouched)       | +0.109       | dark destructive text on popover  |
| Sand (untouched)         | +0.158       | light warning text on page        |
| **Calm (re-fitted)**     | **+0.238**   | light muted text on muted surface |

Two things follow, and the second is the more useful finding:

1. Calm now has the widest margin of the four, so it is the least likely to regress. It still has
   ONE pairing inside the 0.25 band, at +0.238 -- an earlier draft of this file said zero, which was
   my arithmetic slip: 0.238 < 0.25.
2. **Thin margins are not an artifact of fitting — they are a property of the whole in-house set.**
   Mono, the shipped control nobody has tuned to this harness, sits at +0.109 with nine pairings
   within 0.25 of the gate. Any move in the contrast source threatens Mono before it threatens
   Calm. That is a standing fragility in today's admin, not something this task introduced.

`measureTheme` (in `validate-contrast.ts`) now returns every pairing's ratio and margin, with
`validateTheme` defined as its filter — so a miss COUNT can never be the only thing recorded. A
theme clearing everything by 0.01 and one clearing by 1.4 both report zero failures and are not the
same asset.

## What moved

| Token                               | Light: before → after | Dark: before → after               |
| ----------------------------------- | --------------------- | ---------------------------------- |
| `muted-foreground`                  | 0.68 → **0.535**      | 0.58 → **0.714**                   |
| `code-comment` / `code-punctuation` | 0.62 → **0.515**      | 0.62 → **0.714**                   |
| `destructive`                       | 0.66 → **0.552**      | 0.60 → **0.728**                   |
| `success`                           | 0.68 → **0.528**      | 0.62 → **0.703**                   |
| `warning`                           | 0.76 → **0.542**      | unchanged                          |
| `primary` / `sidebar-primary`       | 0.62 → **0.487**      | 0.68 → **0.80**                    |
| `primary-foreground`                | unchanged (white)     | 0.99 → **0.21** (dark page colour) |
| `border` alpha                      | 0.13 → **0.52**       | 0.11 → **0.40**                    |
| `border-strong` alpha               | 0.22 → **0.78**       | 0.18 → **0.55**                    |
| `input`                             | 0.88 → **0.632**      | 0.38 → **0.598**                   |
| `sidebar-border`                    | 0.90 → **0.614**      | 0.30 → **0.543**                   |

## The one genuine design change

**Dark mode's primary foreground flipped from near-white to the dark page colour.**

`primary` is pulled two opposite ways in dark mode: it must be dark enough to carry its button text
at 4.5:1, and light enough to be readable AS text on a 20% tint of itself (the badge and info-alert
pairings). Darkening it to satisfy the button broke the badge (2.66:1); lightening it for the badge
broke the button.

Those constraints are only irreconcilable while the foreground is assumed to be white. Flipping it
— light primary, dark type on it — satisfies both at once, and is what a light-primary-in-dark-mode
theme should do anyway. This is the only change here that alters an intent rather than a value.

## What it cost visually

The quiet register is genuinely less quiet: secondary text at L 0.535 instead of 0.68 in light mode
is a visible step darker, and the borders are no longer whisper-thin (alpha 0.52 vs 0.13). Surfaces,
radii (16px), spacing and the comfortable density are untouched, so the theme still reads as soft —
but the "legible only in its loudest layer" property the original Calm was built to demonstrate is
deliberately gone. That property is now recorded here rather than shipped in a theme.

## Note for the report

The original theme file argues at length that raising these values "would delete the very thing the
theme exists to show". That was correct while Calm was a measurement probe. It stopped being correct
when Calm was shortlisted as a candidate the product might ship: a candidate has to pass. Both the
old rationale and this rehabilitation are right, for different jobs.
