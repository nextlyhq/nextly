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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

Version history now has a page of its own.

Comparing two versions from the history panel meant opening a dialog on top of
it — two floating surfaces at once, over a document you could no longer see,
with a comparison squeezed into whatever the panel left over. The comparison
now opens as a page: the list of versions on the left, the comparison filling
the rest, and the browser's own back button as the way out.

The pair being compared is part of the address, so a comparison can be sent to
a colleague rather than described to them. Opening the page without naming a
pair shows the most recent change, which is what someone arriving from a
bookmark is looking for.

Each version in the list now says what changed in it — the fields, by name —
so you can find the change you remember without opening each one in turn.

The history panel stays for a quick look beside the document you are editing,
and gains a control that opens the full comparison.

On a document translated into several languages, a comparison now stays within
one language. The versions of every language share one numbered history, so the
version before v5 English is often v4 French — a pair that is not a
before-and-after of anything, and which the server refuses outright. Opening the
history of a translated document, or choosing a version in it, compares against
the previous version OF THAT LANGUAGE.

A version whose predecessor has not been loaded yet no longer claims to be the
first one ever recorded. It said so at the bottom of every page of a long
history, and choosing that version then did nothing at all.

"Open full comparison" is offered only once it knows which pair it would open.
It previously appeared for every version and, where no pair had been resolved,
opened a comparison of the two newest versions instead — something the reader
had not asked to see.

A history that fails to load no longer also says the document has no versions
yet. The two now read differently, because "saving will record its first
version" is the wrong thing to tell someone whose history is merely unreachable.

Someone with permission to read a document but not to edit it can now use the
back control. It pointed at the editor, which their permission refuses, so the
one control always on screen led to a permission error.
