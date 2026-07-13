---
"@nextlyhq/admin": patch
---

Collapse the admin sidebar to the mobile drawer across the full tablet range. The dashboard shell switched between the drawer and the fixed dual sidebar at `md` (768px), but the contextual sub-sidebar only re-enters the layout flow at `lg` (1024px) — so between 768 and 1023px the sub-sidebar floated over the page and clipped the main content. The shell now uses the hamburger + drawer until `lg`, matching the sub-sidebar's own breakpoint, so tablet widths get full-width, unclipped content and the sidebar nav stays reachable via the drawer. The drawer also gains a screen-reader title and description to satisfy the dialog accessibility contract.
