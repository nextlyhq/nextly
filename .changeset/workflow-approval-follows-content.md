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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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
"create-nextly-app": patch
"nextly": patch
---

An approval now covers exactly the content that was approved. When a save changes an approved part of a document, its approval is withdrawn in the same save and the part goes back to the stage the workflow names for edits (by default its review stage), with the editor, or the owner of the API key that saved, accountable for it; the document's history records "Approval withdrawn: edited by" whoever saved. A save that changes nothing keeps the approval, and so does an edit to a field the workflow lists in `onEdit.exemptFields`. An edit to a field every language shares withdraws the approval of each language that shows it. When a deploy changes a workflow's definition, approvals given under the earlier one are withdrawn at boot and their parts moved to `approvalsWithdrawnTo`, unless the workflow sets `keepApprovals`. An approval is refused when a field that changed since the last approval (or the last publish) is hidden from the reviewer by a field-level read rule, and the refusal names who could approve instead. The version last approved, and the version a part was in when it entered review, are kept in the history whatever its retention limit, until a publish closes the review.
