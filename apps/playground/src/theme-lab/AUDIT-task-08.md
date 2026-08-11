# Admin theme audit — findings and recommendation

**Date:** 2026-08-10. **Task:** `tasks/admin-ui-tasks/08-ui-theme-feedback.md`.
**Purpose:** finalise ONE theme for the Nextly admin. Theming as a product feature is deferred; the
comparison harness in `apps/playground` is scaffolding for this decision and ships nothing.

Every number here was measured, not estimated. Contrast figures come from the shared harness in
`packages/ui/src/styles/contrast/` and are only comparable against the revision stamped in
`contrast-report.generated.ts` — see §6.

---

## 1. Recommendation

**Keep today's neutral direction, at today's density, with the corrections below applied.**

The candidate comparison did not produce a reason to change direction. What it produced was a list
of defects in the current admin, all now fixed or specified. That is a more useful outcome than a
new palette, and it is the honest reading of the evidence.

If you want a change of character, the strongest alternative measured is the warm-surface direction
(oatmeal page, clay accent) — it clears accessibility with the widest margin of any candidate and
reads noticeably less clinical. It is a taste decision, not a quality one; both are now equally
shippable.

**What is NOT recommended:** shipping any of the third-party-derived candidates as-is. Four of the
five miss WCAG AA by 24–30 asserted pairings. One was corrected to zero as an experiment (§4), and
correcting the others is possible but means their colours stop being theirs, at which point they are
Nextly palettes wearing someone else's name.

---

## 2. Defects found and fixed

### 2.1 The selected nav row used a pairing no theme declares — FIXED

The active sidebar row drew its background from `--nx-muted` and its text from
`--nx-sidebar-accent-foreground`. Those tokens are not partners: the foreground is declared against
`--nx-sidebar-accent`, and that is the pair the contrast suite asserts. **The combination the admin
actually rendered was checked by nothing.**

This is the measured cause of the report that "menu items are using primary color".

Every in-house palette survives the mismatch (6.8–16.3:1), which is why it never surfaced. Two
candidate palettes do not — 2.33:1 and 3.38:1, against the 4.5:1 text needs. It was latent, and it
activates the moment a palette not authored around the quirk is applied.

**Fixed in 4 places across 2 files** (`layout/sidebar/index.tsx`, `layout/sidebar/DualSidebar.tsx`),
covering the active state, the press state and the sub-menu row. The rendered pair is now the
declared pair, so the assertion that already existed becomes true coverage.

**The generalisable lesson:** a green assertion tells you the pair it NAMES is fine. It says nothing
about the pair the product RENDERS. The suite was green for months, correct in what it asserted, and
about the wrong pair.

### 2.2 Every palette sat close to the contrast gate — FIXED

Passing and passing-by-enough are different properties, and only the first was ever recorded. The
shipped default cleared its hardest check by **0.109**, with nine checks within a hair of failing.

| Palette         | worst margin before → after | checks near the gate |
| --------------- | --------------------------- | -------------------- |
| current default | +0.109 → **+0.253**         | 9 → 0                |
| variation A     | +0.109 → **+0.300**         | 10 → 0               |
| warm-surface    | +0.158 → **+0.253**         | 1 → 0                |
| soft/quiet      | (48 failures) → **+0.238**  | — → 1                |

**Why this mattered more than it looks.** The approved WCAG contrast CI gate would have landed on a
default sitting 0.109 above failure. Any token tweak, rounding change or routine merge would have
turned it red on work that did not cause it — and a gate that fails for unrelated reasons gets
switched off within weeks. This repo already has the rule: _a change that widens what CI checks must
land last, or carry the fixes it newly catches._ Those fixes are now carried.

`validate-contrast.ts` gained `measureTheme`, returning every pairing's ratio and margin, with
`validateTheme` defined as its filter. A miss COUNT can no longer be the only thing recorded: a
palette clearing everything by 0.01 and one clearing by 1.4 both report zero, and they are not the
same asset.

### 2.3 Hardcoded colours: 24 sites, zero violations

All 24 are legitimate and unreachable by a CSS custom property: the default favicon SVG (rendered by
browser chrome), the email-template preview (email clients strip custom properties), and the
rich-text colour pickers (content colours an author stores in the document).

**The token discipline in the admin is already holding.** Whatever looks wrong is in the palette or
in which token a component reaches for — not in literal values. This is a good result and worth
stating plainly.

---

## 3. Why Payload and Strapi look more colourful

The comparison board is at `/theme-lab` (collapsed section) and quotes their published values.

**They publish neutral RAMPS; we publish semantic TOKENS.** Payload ships a 21-step achromatic base
scale, from pure white through mid-grey to pure black. Strapi ships a similar neutral ladder with a
violet cast. Nextly ships ~50 semantic tokens — `background`, `card`, `muted`, `border`,
`foreground` — each a named role rather than a step on a ramp.

A ramp always _looks_ richer in a swatch board, because you are seeing 21 deliberate steps side by
side. That is a difference in how the palette is PUBLISHED, not in how much colour reaches the
screen.

**Three genuine findings underneath the appearance:**

1. **Payload's admin is more monochrome than ours, not less.** Their base scale is fully achromatic
   — equal R/G/B at every step, zero hue. Our neutrals carry a faint blue cast (hue 257–266, chroma
   0.016–0.04). Monochrome is not what separates us from Payload; it is what we have most in common.
2. **What we actually lack is the intermediate steps.** Between `background` and `border` there is
   nothing to reach for. A ramp gives a designer five stops between two surfaces; we give one token
   and a judgement call. **This is the root of the "prominent border lines" complaint** — with no
   intermediate neutral, a border is either nearly invisible or clearly drawn, and nothing in
   between.
3. **The comparison board was under-reporting us.** Two of the swatches it drew for our palette were
   the same white, so React dropped one and the row rendered six swatches where seven were passed.
   Fixed.

**Recommendation:** adding a neutral ramp (5–7 steps between page and foreground) is the single
highest-value structural improvement available, and it is what would let border weight become a
choice rather than a compromise. It is NOT required for this decision, and it should be its own
task — it changes what theme authors reach for, which is exactly the kind of surface worth settling
once rather than twice.

---

## 4. Borders, controls and backgrounds

**The contrast suite does not check `border` against any surface.** Five boundary pairings were
removed deliberately in earlier work, with sound WCAG 1.4.11 reasoning (only boundaries that
identify a control are held to 3:1, so a decorative divider does not drag the whole border scale
up). The consequence is that border WEIGHT is unmeasured in both directions — the gate cannot see a
border that is too heavy, nor `border` being too faint.

That is precisely where the "prominent big border lines" complaint lives, so the audit measures
bands instead of pass/fail:

- **Invisible (<1.5:1):** `border-subtle` in every palette (~1.06–1.23:1). Correct for a row
  divider, but it means `border-subtle` can never identify a control.
- **Prominent (>4.5:1):** 7 instances, all in candidate palettes, none in the current default.
- The current default's borders sit in the intended range once alpha is composited.

**A measurement bug worth recording:** the first sweep reported 46 prominent borders including the
default at 21:1 — pure black on white. Its border is `oklch(0 0 0 / 0.445)`; the sweep was not
compositing alpha, so a 44%-opacity hairline measured as solid black. Corrected to 7.

**Controls.** The "checkboxes barely visible" report is real in the candidate palettes: `input`
measured 1.16–1.19:1 against its surface, where 3:1 is required. The current default clears it. The
corrected candidate (§5) now clears it too.

---

## 5. The corrected candidate

One third-party-derived candidate was corrected to WCAG AA as an experiment: **14 failures → 0**,
from four tokens (a too-pale destructive, and three boundary tokens sitting almost invisibly against
their surfaces).

**Architecturally, this is the part worth keeping regardless of which palette wins.** The generated
preset file carries a "do not edit by hand" banner because its importer overwrites it. Editing there
would have passed every test and then been **silently reverted by the next regeneration, with
nothing failing to say so.** The corrections therefore live in a layer that COMPOSES with re-imports
(`tweakcn-overrides.ts`), with a test asserting the corrections are ABSENT from the generated file —
otherwise that test passes for exactly the wrong reason.

**General rule:** a "do not edit" banner is a statement about durability, not about permission. When
you must modify generated output, layer over it and assert the layer is separate.

---

## 6. Density, spacing and fonts

**Measured, at 1080px viewport:**

| Density             | control height | spacing unit | button   | input    |
| ------------------- | -------------- | ------------ | -------- | -------- |
| compact             | 2rem           | 0.20rem      | 35px     | 29px     |
| **default (today)** | **2.5rem**     | **0.25rem**  | **44px** | **36px** |
| comfortable         | 3rem           | 0.30rem      | 53px     | 43px     |

**Recommendation: keep `default` (2.5rem).**

- It matches the direct comparables — Payload and Strapi both land at 36–40px controls — and matches
  shadcn/ui, which the component layer is built on. Diverging means fighting the component defaults
  at every size variant.
- It clears **WCAG 2.5.8 Target Size (Minimum)** (24×24 CSS px) with room. `compact` at 29px inputs
  still clears it, but the margin over a normative minimum is not where to economise.
- `comfortable` at 53px buttons is touch-sized. A CMS admin is a mouse-and-keyboard, data-dense
  application; that height belongs on a tablet-first product.

**One structural note on the spacing lever.** `--spacing` drives EVERY padding, gap and margin
utility through `calc(var(--spacing) * n)`. Moving it from 0.25 to 0.20 rescales the entire layout,
not just controls. That is a powerful and slightly dangerous knob: it is the right design (one
source), but it means density is not a per-component decision and cannot be tuned locally without
breaking the relationship the file's own comment describes.

**Fonts.** The font stack is unchanged across candidates (Inter for sans, a standard mono stack).
Nothing measured suggests a change; a typeface change is a brand decision with no accessibility or
density consequence found here.

---

## 7. Limitations — read before using these numbers to justify anything

1. **"0 misses" measures conformance to OUR assertion set, not accessibility as such.** All four
   in-house palettes now clear at zero. Some were authored against this harness and one was fitted
   to it today, so the pass/fail line is **not symmetric** between palettes that had that benefit and
   candidates that never saw it. The failures in the candidates are real — a ratio is objective, and
   those pairings do occur — but the metric should not be read as "our palettes are inherently more
   accessible".
2. **WCAG 2.x contrast ratio is a contested proxy for perceived contrast**, and it is weakest exactly
   where much of this work sits: dark surfaces and saturated colours. It is the right gate because it
   is the one that is required and the one CI can enforce. It is not a ranking of which palette looks
   better.
3. **A failure count is a property of (palette × contrast source), not of the palette.** One
   palette's recorded 58 became 48 with the palette untouched, because the shared harness moved
   beneath it. Root-caused: five boundary pairings were removed and no maths changed — 5 pairings ×
   2 modes = exactly the 10 that disappeared. Counts are now stamped with the contrast-source
   revision so a stale reading announces itself.
4. **A refuted hypothesis, recorded so it is not re-proposed.** Thin margins were thought to be
   structural to a monochrome palette — one axis to spend, so everything packs onto lightness. The
   data says otherwise: the current default carries 17 distinct chromas (more than the soft/quiet
   palette's 13), and packing density runs the _wrong_ way — the most tightly packed palettes have
   the FEWEST near-gate pairings. What predicts margin is whether anyone optimised for it.

   **Correction, and why the conclusion survives it.** The script producing these figures matched
   `oklch(` textually, so it silently skipped the imported presets, whose surfaces and foregrounds
   are hex — their rows described a handful of inherited status tokens rather than a palette. Fixed
   to convert any notation, and the unreadable count is now printed rather than assumed to be zero.
   The claim above is unaffected because it rests on the two Nextly palettes, which are authored in
   OKLCH throughout and were always measured in full; re-running confirms 17 against 13 and the same
   density ordering. The preset rows were the wrong ones, and they were never what the claim rested
   on.

---

## 8. What is left for you to decide

1. **Which palette ships** — the recommendation is the current neutral direction; the warm-surface
   alternative is equally shippable and a matter of taste.
2. **Whether to add a neutral ramp** (§3) as its own task. Highest-value structural improvement
   found, and the real fix for border weight.
3. **When the contrast CI gate lands.** It is now safe to land strictly: every palette has margin.

Once you pick, the winning palette's tokens move into `packages/ui/src/styles/theme.css` and the
lab stays behind as unpublished scaffolding.
