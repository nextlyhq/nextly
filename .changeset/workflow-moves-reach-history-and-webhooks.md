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

Every workflow move now reaches webhooks and history. Whenever a part of a document (a language, or the shared fields) changes review stage or loses its approval, Nextly records one `workflow.stage_changed` webhook event for that part, in the same transaction as the move, and delivers it after the move is saved. This covers a step, an edit or a deployed change of workflow definition that withdraws an approval (also when the part stays in its stage), a deploy that renames a stage, redirects a removed one or detaches the workflow, discarding a working draft, and the `workflow:move-stranded` command. The event's `data` names the document (`collection` or `single`, its slug and id), the part, `from` and `to` (`to` is null when the part's review state was removed), the `cause` (`step`, `edit`, `definition`, `rename`, `redirect`, `detach`, `discard` or `recovery`), `approvalWithdrawn` and the hash of the workflow definition it was made under; its `actor` is the person or API key who acted, or the system. Endpoints can subscribe to `workflow.stage_changed`, or receive it through "all events". A comparison of versions can now start from `since-submitted` (the version a part last entered review at) or `since-approved` (the version its last approval named); a part with neither is refused with the reason, and the comparison view says which baseline it compares from. Known limits: publishing does not yet record this event when it closes a part's review; the admin's webhook form does not yet list `workflow.stage_changed` on its own (choose all events, or create the endpoint through the API); and history shows a workflow's events by their kind's name ("Workflow submit · English").
