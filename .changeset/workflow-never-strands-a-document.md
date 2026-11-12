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

Changing a workflow in code no longer strands a document. A stage can record the name it had with `renamedFrom`: the next deploy moves documents still in the old name to the new one, records the move in each document's history, and keeps their approvals when the rename was the only change. A stage listed in `removedStages` has its documents moved where the definition says, recorded, with their approvals withdrawn. A stage removed with nowhere named leaves its documents where they are: they read as the first stage, `nextly workflow:stranded` lists them ("Stage 'legal' no longer exists"), and the `_strandedStage: true` list filter keeps them, so a count and its list agree. `nextly workflow:move-stranded --to <stage> --as <email> --comment "…" [--collection <slug>]` moves them to a stage of the workflow, recording one event per document with that person and the comment; it refuses an unknown or deactivated person, a stage the workflow lacks or one that allows publishing. A deploy that detaches a workflow from a collection or Single removes its review state and the versions held for review, all or nothing, recorded per document, so attaching it again revives no approval. Deleting a document removes its review state in the same delete, by every delete path, and discarding a working draft closes that part's review, recorded in its history. A definition is refused when a `renamedFrom` names a stage it still has, is claimed by two stages, or is also listed in `removedStages`. A part with no review state now stands where its content puts it: a part never published starts at the first stage, so attaching a workflow to a collection with documents starts each unpublished part there; a working draft over a live part starts at the workflow's `afterPublish` stage, also after an earlier draft was discarded; and a live part with nothing unpublished has no stage, so a step or an assignment on it is refused with `WORKFLOW_NOTHING_TO_REVIEW`. A part recorded in a stage the workflow no longer has reads as the first stage.
