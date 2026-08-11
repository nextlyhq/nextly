# Proposed task: a neutral ramp for the admin token set

**Status:** proposed, scoped, NOT started. Deferred until the admin theme is chosen, so the ramp is
derived from the palette that actually ships.
**Origin:** the task-08 audit (`AUDIT-task-08.md` §3). This is the structural improvement that audit
identified as highest-value, and the real cause of the "prominent border lines" report.

## The problem, stated precisely

Nextly publishes ~50 SEMANTIC tokens — `background`, `card`, `muted`, `border`, `foreground` — each
a named role. Payload publishes a 21-step achromatic RAMP; Strapi publishes a similar ladder.

The consequence is not cosmetic. **Between the page surface and a border there is no intermediate
step to reach for.** A designer choosing a divider weight has one token and a judgement call, where
a ramp would offer five stops. So a border ends up either nearly invisible or clearly drawn, and the
in-between that a data-dense admin wants is unreachable without inventing a one-off value.

Measured evidence from the audit:

- `border-subtle` sits at ~1.06–1.23:1 against its surface in every palette. Correct for a row
  divider, but it means `border-subtle` can never identify a control.
- The gap between `border-subtle` and `border` is the entire usable range, with nothing between.
- Seven boundary instances measured "prominent" (>4.5:1) across the candidate palettes — a divider
  drawing as hard as body text, because the next step down was too faint to use.

## What a ramp is, and is not

**Is:** a set of neutral steps between the lightest surface and the darkest ink, spaced so adjacent
steps are visually distinguishable. Semantic tokens then REFERENCE ramp steps rather than carrying
literal values, so `--nx-border: var(--nx-neutral-300)` and a designer choosing a heavier divider
moves to `--nx-neutral-400` instead of inventing a colour.

**Is not:** a replacement for the semantic tokens. The semantic layer is the contract components
code against and must stay. The ramp sits underneath it as the vocabulary the semantic layer is
built from. Components never reference ramp steps directly — that would undo the indirection the
semantic layer exists to provide.

## Why it is deferred rather than done now

1. **It must be derived from the shipped palette.** A ramp built against a candidate that does not
   win is wasted, and worse, subtly wrong: the ramp's hue cast has to match the theme's neutrals
   (ours carry a faint blue at hue 257–266; a warm-surface theme would want a warm ramp).
2. **It changes what every theme author reaches for**, which makes it exactly the kind of foundation
   worth settling once, deliberately, rather than mid-decision.
3. **It is not required for the theme choice.** The audit's measurements already tell the founder
   what the current borders do.

## Scope when it starts

1. **Research** the step count and spacing. Payload uses 21 (0–100 in fives); Tailwind uses 11
   (50–950); Radix Colors uses 12 with documented semantic roles per step. Radix's model is the most
   directly applicable, because its steps are defined by ROLE (step 6 = subtle border, step 7 =
   element border, step 11 = low-contrast text) rather than by lightness alone — which is what makes
   a ramp usable rather than merely present.
2. **Derive** the ramp from the chosen palette's existing neutrals, preserving its hue cast.
3. **Re-point** the semantic neutral tokens at ramp steps, one at a time, asserting each keeps its
   measured contrast. Any token whose value must change to sit on a step is a finding, not a
   silent adjustment.
4. **Verify** every asserted pairing still clears WCAG AA WITH the margin established in task 08
   (+0.25 or better), so the ramp cannot quietly undo that work.
5. **Document** the role of each step, so the next person choosing a border weight has an answer
   rather than a judgement call.

## Explicit non-goals

- No new user-facing theming. Theming as a product feature is deferred; this is internal vocabulary.
- No change to the semantic token NAMES. Components must not need edits.
- No ramp for chromatic colours. Status colours already derive their scales via `color-mix()` from a
  single token, and that mechanism works.

## The check that should exist afterwards

A test asserting every semantic neutral token resolves to a ramp step rather than a literal. That is
what stops the ramp being added and then bypassed — the failure mode where the vocabulary exists,
nobody uses it, and the next one-off value goes in beside it.
