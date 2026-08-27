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

Add inline rich text on the page-builder canvas: a `core/rich-text` block, and one shared editor an author types into directly on the page.

A passage with bold, links, lists and headings inside it is now one block rather than one block per fragment. Double-clicking it opens a rich-text editor in place; double-clicking a plain value still opens the plain one, decided from the block's own prop declaration so the two surfaces cannot disagree about which values are theirs.

The stored shape, the format bits and the walk that draws them already existed and are reused rather than reimplemented, so a passage renders the same on a page as it serializes in the CMS.

The editor is loaded on first edit rather than on mount, because its node classes carry a 630KB chunk an author who never edits a passage should never fetch. It is reached through `@nextlyhq/plugin-sdk/admin`, which now hands over the operations to edit one passage rather than the editor itself: a consumer that built its own would have to import Lexical, and a second copy of Lexical makes its node classes unrecognisable, with content saving and reading back as plain text.

An author who double-clicks a passage while another one is holding unsaved text is now told why nothing opened, rather than finding the gesture silently do nothing.

Two canvases open at once no longer take an unsaved passage from one another. There is one editor behind every surface, so a passage kept open because its words could not be written is now held at that editor rather than only by the surface holding it, and anything asking for the editor is refused until it is released.

An element is also given back with the `autocapitalize` it arrived with, which the editor sets on focus and clears on release.

A passage keeps the order the author wrote it in. Words after an image inside a heading or a disclosure label used to be gathered back in front of it, so a heading reading "Before[image]After" rendered as one heading saying "BeforeAfter" with the image behind text that had followed it.

The editor also opens the passage as it stands when the editor arrives rather than as it stood when the edit was requested, so an undo or another surface landing while the editor loads no longer puts the caret into content nobody can see and refuses the first thing typed into it.

An inline edit that cannot be written no longer disappears, however the author left it — clicking away ends far more edits than the exit button does, and that path said nothing at all.

An inline edit that cannot be written no longer disappears. A passage the page changed underneath, or one the page refuses to store, keeps its editor open with the author's words still in it, and leaving the editor is declined until they have dealt with it rather than closing over the top of them; a passage whose block was deleted or locked while they typed says so instead of vanishing quietly.

A rich value is also now refused by the canvas plain-text editor. It declares itself editable in place like any other inline prop, but that path reads a value as text and writes a string back, so before this an author who double-clicked a passage would have found an empty element and committed an empty string over their work on the way out.
