---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

The in-admin preview pane can now be shown at a chosen viewport width instead of
whatever width the editor happened to leave it.

This matters more than it sounds. The pane sits in a split that reserves a
minimum editor, so at its default position the preview is a few hundred pixels
wide — which means it was faithfully previewing a MOBILE viewport, decided by
wherever the divider was last dragged rather than by anything anyone chose. The
two controls were also coupled: widening the preview meant narrowing the editor
being typed into.

Choosing a width now does two things in order. The split gives the preview as
much room as the minimum editor allows, and only whatever still does not fit is
scaled down. On a wide window nothing is scaled at all.

A scaled frame keeps its requested width, so the site's own media queries still
resolve against the viewport being previewed and the preview stays truthful
about layout. What it stops being truthful about is physical size — text renders
smaller than a visitor would see it — so the toolbar always states the real
width and the scale beside it rather than letting the shrinking pass unremarked.

This release ships the control with **Responsive** and a custom width. Named
presets follow: they will come from a collection's own declaration where one
exists, and from the site's page-builder breakpoints otherwise, so a preset can
never disagree with the breakpoints the site actually uses. No phone/tablet/
desktop numbers are invented here, and there are deliberately no device icons —
a site names its own breakpoints, and no glyph is honest for a tier an author
called "Kiosk".

The toolbar wraps instead of running off the edge. At a 1024px window the pane
is about 450px wide, and a viewport select, a width box, a scaling note and
three actions do not fit on one line — the pane clips its overflow, so
open-in-a-new-tab and close sat past the edge with no way to scroll to them.
Measured in a browser at that width: they were 40px and 98px outside the
clipping box, and hit-testing their centres reached nothing. The three actions
stay together as one unit, so the row breaks between the viewport control and
them rather than through the middle of them.

Clearing the width box no longer takes the box away. It held one value for two
different facts — what the box says and what the frame is sized to — so an empty
box committed "no width", which selected Responsive, which removed the input the
author was typing in. The text being typed is now kept separately, and a width
is committed only once the box names one a frame can be sized to.

The custom width box commits the whole number it shows. `parseInt` read `390.5`
as `390` and `1e3` as `1` — both of which a number input accepts and displays in
full — so the frame was sized to a width the box was not showing, and blurring
replaced the author's text with the truncated value.

The pane measures itself before the browser paints rather than after, so a frame
cannot be drawn at the wrong width on the way to the right one.

The custom width is taken when you stop typing, not on every keystroke. The
frame is a live iframe of the site, so each committed width re-lays-out a whole
page — and clearing the box to type `768` emits `7`, `76`, `768`, collapsing the
preview to 7px and then 76px on the way. Leaving the box commits immediately, so
a width typed and clicked away from is not lost. Widths below one pixel are
refused: the input's `min` marks the field invalid without clamping it, and
below a pixel the preview is not narrow but absent.
