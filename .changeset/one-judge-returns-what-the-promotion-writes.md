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

Publishing no longer clears a protected value nobody touched.

The gate that judges a promotion applied the field rules and then handed their output to the write. The rules DELETE a value the caller may not write, which is the right answer for the caller's own input on an ordinary write and the wrong thing to persist here: a group is one JSON column, so a denied child removed from it was serialised over the whole column and the live value went with it. Measured on a group whose `runbook` only an owner may write, with someone else publishing an edit to an unrelated field: the column came back empty.

A denied field keeps its LIVE value now. That is what an update means, the caller may not write the field so the field does not change, and it is the answer Payload gives to the same question. One call decides the refusal and returns the document to write, so the document that was judged is the document that lands, and there is no second interpretation of the rules' output to get wrong.

The rules are asked of the live row as well as of the promoted document. A rule is only ever asked about a key that is present, so a field a pending change removes outright was judged nowhere: absent from the promoted document, and so never in its denied set to begin with.

Refusal is decided value by value over both sides, and a value the store keeps for itself is not content. A denied component or repeater row carries its own identity and timestamps beside the author's values, and a snapshot's timestamps never match the row's, so counted as content a denied component would refuse every publish.

A Single's publish keeps refusing a denied value the caller sent, where a collection's now drops it back to live. The difference is deliberate and is about what each write can apply: a collection persists exactly what the gate returns, while a Single's promotion writes from the stored snapshot in another representation, so a correction made in the gate would never reach the row and the forbidden value would go live. Refusing is what that path already did, and it is safe, since nothing denied is allowed to change and the snapshot's own copy therefore already equals live.
