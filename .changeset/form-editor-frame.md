---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The form editor now sits in the admin's frame, with one bar and one header.

- **Its controls are in the admin's top bar**, after the breadcrumb: the form's status as a menu (Live, Closed or Draft), the save state with Undo, the number of submissions (a link to the form's Submissions), More (Copy form ID, Delete form) and Save.
- **The header** shows the form's name, its field count and API path, and a tab for each page: Builder, Preview, Settings, Notifications and Submissions.
- **Each page has its own address** under the form's edit address (`/admin/collections/forms/<id>/settings`, and so on), so a reload or a shared link opens the same page. The edit address opens Builder.
- **One save for the whole form.** Changes on every page are held together, counted in the bar, can be undone one at a time, and are saved once. Moving between pages keeps them, and leaving the form with any asks first. A refused save keeps them and says what to fix, with a link to the page that holds it.
- **The Forms panel starts folded** on the form editor; the bar's toggle brings it back.
- The editor's own heading, the name, slug and status box, and the footer are gone. The name and the form ID are edited in Settings, which also holds the closed message once the form is closed.
- A new form, once created, stays open in the editor at its own address instead of returning to the list.

For plugin authors (`@experimental`): a collection's custom edit view can have pages of its own. Declare a document view on the collection whose `component` is the edit view itself; the admin draws the edit view at that address, passes the page's path as the new `view` prop of `CustomEditViewProps`, and keeps it mounted while the address moves between its pages. A custom edit view can now also report unsaved work with `useReportUnsavedWork`, and the admin asks before leaving the document while it holds any.
