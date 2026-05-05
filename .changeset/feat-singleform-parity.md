---
"@revnixhq/admin": minor
---

SingleForm parity with the compact entry-edit layout. Replaces the old
`SingleFormHeader` + `SingleFormSidebar` + `SingleFormActions` stack with
the shared `EntrySystemHeader` + `EntryMetaStrip` + `EntryFormSidebar`
primitives so the Singles edit page now matches the collection entry edit
page in structure: borderless title input in the system header, slug strip
below with inline pencil-edit, single consolidated dropdown, rail toggle,
Document panel only (Status row when `schema.status === true`, ID with
copy button, Created, Updated). Save Draft / Update buttons light up when
the Single has the Draft / Published flag enabled — same wiring as
collections (PR 3 of Task 5). Also drops the SEO field special-case and
the `admin.position: "sidebar"` filter so no user-defined fields render
in the rail (per Task 5 design D1: rail = system content only). The
breadcrumbs and Document tabs above the form are removed; API view is
reachable via the system header dropdown's "View API response" item, which
the page route handles via `onViewApi`. Show JSON is hidden for Singles in
this PR — Singles use a different API URL pattern than collections, and
the inline `ShowJSONDialog` targets the collection shape; a Singles-shaped
Show JSON dialog can ship later. Three orphan files (`SingleFormHeader`,
`SingleFormSidebar`, `SingleFormActions`) deleted.
