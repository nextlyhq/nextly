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

Comparing two versions of a document now says what changed in rich text, JSON
and code, where before it could only say THAT they differed.

Rich text was not compared at all. Two versions came back as two whole editor
documents, and the panel flattened each to plain text and showed them side by
side with nothing marked — so an edit to one sentence and a whole new paragraph
looked the same as no change. It is now compared block by block: an added
paragraph reads as an added paragraph, and an edited one shows which words
moved.

Crucially it compares more than the words. Swapping an image for a different
one, repointing a link, un-bolding a phrase, demoting a heading, changing a
list from bulleted to numbered — each of these leaves the text byte-identical,
and each was previously reported as no change at all. Every property a person
can edit is now part of the comparison, so the only way to change a document
without the comparison noticing is not to change it.

JSON was shown as two printed blobs with nothing marked. It is now compared
line by line, and reordering keys is correctly NOT a change, so a formatting
difference no longer reads as an edit.

Code fields were compared as running prose, which wrapped them into a
proportional-font paragraph — harder to read in the comparison than simply
viewing the version. They are now compared line by line as well.

When something genuinely cannot be compared — a media element with no
identifiable source, a value that cannot be represented — the comparison says
so instead of reporting the two sides as identical. "I could not read this" and
"these are the same" point a person deciding whether to restore in opposite
directions.

The admin now draws all of this. A rich-text comparison keeps the document's
own shape — one row per paragraph, in order — with the changed words marked in
place and a coloured edge marking a paragraph that was added or removed. JSON
and code are shown as numbered lines with the same colours the editors use, so
a value reads the same wherever you meet it.

A field whose comparison this version of the admin cannot draw now says so and
names itself, instead of disappearing from the list — a field that vanishes
from a comparison reads exactly like a field that did not change.
