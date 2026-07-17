---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

The form builder's field editing is rebuilt as a card list on Nextly's shared field system.

**One card per field, edited inline.** The three-pane layout (field palette, canvas, properties sidebar) is gone. Fields are collapsible cards: the header shows the type (from the shared field-type catalog, so icons and names match every other field picker in the admin), the label, the generated name, and a required badge; expanding a card edits its properties right there. "Add field" opens the same catalog-driven type picker used by the rest of the admin.

**Reordering works three ways**: drag handles, Move up / Move down in each card's menu, and fully keyboard-driven (focus the handle, Space to lift, arrow keys to move, Space to drop).

**Deleting a referenced field is blocked, with the reason.** A field used by another field's conditional logic or by a notification's recipient shows a disabled Delete listing what references it, instead of letting the deletion silently break those.

**Select and radio options** now use the shared options editor: drag to reorder options, values auto-generate from labels, CSV/JSON import, and duplicate-value warnings — the old inline editor could only add and remove.

Also: new fields get readable names (`email`, then `email_2`) instead of timestamp suffixes; the plugin's field enable/disable option now actually filters the type picker (served to the builder via a new permission-gated `/builder-config` plugin route); saving no longer writes a `title` key the forms collection never declared; and the removed `FieldLibrary`/`FormCanvas` exports are superseded by `FieldCards`/`AddFieldDialog`.
