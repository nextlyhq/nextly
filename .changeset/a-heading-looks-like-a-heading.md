---
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
---

Give headings and paragraphs a typographic baseline.

Under a host's CSS reset an `h1` and an `h3` differ only in tag name, so a
correct document renders as undifferentiated text. Block defaults could not fix
it: they are keyed by block TYPE and a heading's level is a PROP, so one
`core/heading` default gives every level the same size.

The compiler now accepts `elementBases`, keyed by element and emitted at zero
specificity below block defaults, and `blocks-react` supplies a baseline for
`h1`–`h6` and `p`. Scope is heading scale and paragraph rhythm only — the two
things present in every precedent surveyed. `TYPOGRAPHY_DEFAULTS` and
`withTypographyDefaults` are exported so a host can replace the baseline.
