---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/eslint-config": patch
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
"create-nextly-app": patch
"nextly": patch
---

Add a keyboard shortcut manager to the UI kit: one listener, with precedence that follows the component tree.

Shortcuts registered per component could not decide who owned a key. `stopPropagation` does not stop other listeners on the same node, so every global handler ran and the winner was whichever component mounted first. Pressing Escape during a drag could cancel the drag and navigate away from the page at the same time.

`ShortcutProvider` installs the single listener. A nested `ShortcutScope` outranks the shell around it, and a layer marked `blocking` also swallows the keys it does not bind, so a drag or a modal can hold the keyboard for as long as it is up. `mod` resolves to Command on Apple platforms and Control elsewhere, sequences such as `g d` are supported, and modifier-carrying shortcuts still fire while the user is typing.
