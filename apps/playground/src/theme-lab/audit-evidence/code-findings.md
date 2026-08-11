# Code-level audit — `packages/admin` + `packages/ui`

**Date:** 2026-08-10. Evidence for the task-08 report.

## Hardcoded colours: 24 sites, ZERO violations

`grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(|oklch\(" packages/admin/src packages/ui/src` (excluding tests,
the contrast harness and `theme.css`) returns 24 hits. **Every one is legitimate**, and each is a
place where a CSS custom property genuinely cannot reach:

| Site                                                                                                  | Count | Why a token cannot be used                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrandingProvider.tsx` — default favicon SVG                                                          | 1     | A favicon is rendered by browser chrome from a data URI. It has no access to the page's cascade, so it carries its own `prefers-color-scheme` block. |
| `EmailTemplateForm.tsx` — email preview                                                               | 5     | Email HTML is rendered in clients that strip custom properties. The preview must use the same literal colours the sent mail will.                    |
| Rich-text colour pickers (`RichTextButtonGroupPlugin`, `RichTextButtonLinkPlugin`, `useToolbarState`) | 18    | These are CONTENT colours an author picks and that get stored in the document. They are data, not chrome.                                            |

**So the "hardcoded colours" class of defect does not exist in this codebase.** Whatever is wrong
visually is in the THEMES or in which token a component reaches for — not in literal values.

That is a genuinely good result and worth stating plainly: the token discipline in `packages/admin`
is already holding.

## The real finding: the selected nav row uses an UNASSERTED pairing

`packages/admin/src/components/layout/sidebar/index.tsx:492` (and `:707`) style the active row as:

```
data-[active=true]:bg-muted  data-[active=true]:text-sidebar-accent-foreground
```

The background comes from `--nx-muted`; the text from `--nx-sidebar-accent-foreground`. **Those two
tokens are not designed as partners.** `sidebar-accent-foreground` exists to sit on
`sidebar-accent`, and that is the pairing the contrast harness asserts. The combination the admin
actually renders is checked by nothing.

Measured across all nine shortlisted themes (`sidebar-accent-foreground` on `muted`, vs on its own
partner):

| Theme                  | mode             | on `muted` (rendered) | on `sidebar-accent` (asserted) |
| ---------------------- | ---------------- | --------------------- | ------------------------------ |
| mono                   | light / dark     | 16.34 / 13.94         | 16.29 / 13.94                  |
| signal                 | light / dark     | 16.34 / 13.94         | 15.76 / 13.25                  |
| sand                   | light / dark     | 13.75 / 12.81         | 13.09 / 12.63                  |
| calm                   | light / dark     | 6.82 / 8.60           | 6.34 / 9.21                    |
| tweakcn-modern-minimal | light / dark     | 9.91 / 11.60          | 9.03 / 7.29                    |
| tweakcn-violet-bloom   | light / **dark** | 19.26 / **3.38**      | 17.62 / 3.38                   |
| tweakcn-twitter        | **light** / dark | **2.33** / 5.97       | 2.46 / 6.17                    |
| tweakcn-claude         | light / dark     | 10.26 / 9.48          | 9.97 / 10.54                   |
| tweakcn-vercel         | light / dark     | 19.25 / 16.89         | 17.61 / 12.69                  |

**Two shortlisted presets fail it: Twitter in light mode at 2.33:1, Violet Bloom in dark at 3.38:1.**
Both are below the 4.5:1 a text pairing needs, and both are invisible to the suite because it never
checks this combination.

This is the concrete, measured version of the founder's report that "menu items under
collections/singles sidebars are using primary color" — the selected row genuinely does not use the
token pair it was designed for.

**All four in-house themes are comfortable here (6.8–16.3),** which is why the defect has never
shown up in the shipped admin. It is latent, not active — and it activates the moment a theme that
was not authored against this quirk is applied. Two of the five candidates already trip it.

### Two possible fixes, and they are not equivalent

1. **Change the component** to `data-[active=true]:bg-sidebar-accent`, so the rendered pair is the
   designed pair and the existing assertion covers it. One line, and it makes the harness's
   coverage honest. Risk: it changes the selected-row colour in every theme, including today's
   default — a visible change to the shipped admin.
2. **Add the rendered pair to the harness** (`sidebar-accent-foreground` on `muted`) and fix the two
   themes that fail it. Keeps today's appearance exactly; widens what CI checks.

These are a design decision, not a mechanical fix, so both go to the founder rather than being
applied here.

## Unchecked-by-design: `border` against any surface

Recorded in full in `margin-fragility.md`. In short: the contrast suite stopped checking `border`,
`table-border` and `border on popover` when those five pairings were removed (deliberately, with
sound WCAG 1.4.11 reasoning). So border weight — the founder's "prominent big border lines" — is
unmeasured in both directions by the gate, which is why this audit measures bands instead.

Measured `border-subtle` is effectively invisible (~1.06–1.23:1) in all four in-house themes. That
is intentional for a row divider and NOT a defect, but it means `border-subtle` cannot be used to
identify a control in any theme.
