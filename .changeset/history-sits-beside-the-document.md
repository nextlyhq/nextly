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

Opening a document's version history made most of the document's own controls
stop working, without disabling them or reporting anything.

The panel is pinned to the window's edge with `position: fixed`, which takes it
out of the layout — so the page underneath kept its full width and carried on
drawing beneath it. Measured in a browser at 1280x720, the panel occupied
x 800-1280 at every height, and `document.elementFromPoint` at each control's
own centre returned a row of the panel rather than the control: Save draft,
Publish, the overflow menu, the rail toggle, the entry's copy-id button, and
the account, theme and notification controls in the admin header. Eight
controls, all visible, all enabled, none of them reachable.

Nothing reported a refusal because nothing refused. The pointer simply landed
on a different element, which is worse than a disabled control — a disabled one
at least says it will not act.

Space is now reserved rather than fought over. `SidePanelReservation` carries a
mounted panel's claim up to the layout, which indents its content column by
that much, so the page ends where the panel begins. A `z-index` would not have
helped: raising the page over the panel puts the page's controls on top of the
panel's rows, which is the same collision with the winner swapped.

The width is stated once and both the element and the reservation are taken
from it. Two literals would agree until one of them changed, and the failure
after that is silent in the same way as the original: a strip of document drawn
under a panel, its controls quietly inert.

Where the window cannot hold both, the panel is modal instead of non-modal.
That is not a lesser fallback — it is the honest state. The panel covers the
document either way, and a modal one blocks the clicks it is swallowing and
scrims what it has withdrawn, instead of accepting them into nothing. Both
behaviours derive from the single question of whether room was made, so the
panel cannot end up non-modal over a page that nothing moved.
