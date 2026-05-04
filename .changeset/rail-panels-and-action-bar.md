---
"@revnixhq/admin": patch
---

Entry-form rail and action bar redesign:

- New top action bar above the form: title, optional Status pill, Preview, Save (or Save Draft + Publish when drafts are enabled), More menu, and a rail toggle button.
- Rail (right column) split into named panels: Status, Document (id / created / updated), Revisions, Activity. Width reduced from 360px to 320px.
- Rail toggle persists in localStorage. Hiding the rail expands the main column to fill the row.
- Below 1024px the rail is hidden entirely; the upcoming mobile sheet ships in a follow-up.

Title and slug remain in the existing header card. PR 6 of the redesign moves them into the new pinned-headline + rail-slug layout. Save Draft and Publish currently both submit the form; PR 7 wires the status payload through `useEntryForm` so each button writes the correct status.
