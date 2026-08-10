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

## What moved

| Token                               | Light: before → after | Dark: before → after               |
| ----------------------------------- | --------------------- | ---------------------------------- |
| `muted-foreground`                  | 0.68 → **0.545**      | 0.58 → **0.70**                    |
| `code-comment` / `code-punctuation` | 0.62 → **0.53**       | 0.62 → **0.70**                    |
| `destructive`                       | 0.66 → **0.57**       | 0.60 → **0.71**                    |
| `success`                           | 0.68 → **0.54**       | 0.62 → **0.69**                    |
| `warning`                           | 0.76 → **0.55**       | unchanged                          |
| `primary` / `sidebar-primary`       | 0.62 → **0.50**       | 0.68 → **0.78**                    |
| `primary-foreground`                | unchanged (white)     | 0.99 → **0.21** (dark page colour) |
| `border` alpha                      | 0.13 → **0.45**       | 0.11 → **0.34**                    |
| `border-strong` alpha               | 0.22 → **0.70**       | 0.18 → **0.48**                    |
| `input`                             | 0.88 → **0.65**       | 0.38 → **0.57**                    |
| `sidebar-border`                    | 0.90 → **0.64**       | 0.30 → **0.52**                    |

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

The quiet register is genuinely less quiet: secondary text at L 0.545 instead of 0.68 in light mode
is a visible step darker, and the borders are no longer whisper-thin (alpha 0.45 vs 0.13). Surfaces,
radii (16px), spacing and the comfortable density are untouched, so the theme still reads as soft —
but the "legible only in its loudest layer" property the original Calm was built to demonstrate is
deliberately gone. That property is now recorded here rather than shipped in a theme.

## Note for the report

The original theme file argues at length that raising these values "would delete the very thing the
theme exists to show". That was correct while Calm was a measurement probe. It stopped being correct
when Calm was shortlisted as a candidate the product might ship: a candidate has to pass. Both the
old rationale and this rehabilitation are right, for different jobs.
