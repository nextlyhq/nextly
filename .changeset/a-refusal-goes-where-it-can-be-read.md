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

A message the editor raised while its shell was too narrow to draw landed on a
surface nobody could reach. Below its minimum width the shell puts its whole
subtree behind `hidden` and `inert` and shows a notice in its place — but
neither attribute unmounts anything, so a control behind that notice was still
mounted and still deciding, from the fact that it was mounted, that it could
speak for itself. It wrote the message inline, into a subtree taken out of paint
and excluded from the accessibility tree. The queue it should have fallen back
to was no better: the region that draws it was mounted inside the same wrapper.
An author who narrowed a window while a class was being created saw the
narrow-width notice, no message, and left believing the class existed.

Being mounted is now only half of what "can still be seen" means: the shell
publishes whether it is the subtree the author is actually using, and the
decision to speak inline consults it. The notice region moved out of the
suppressed wrapper and is mounted once, unconditionally, rather than switched
between the two branches — a live region has to exist before text is put into
it, and one that remounts whenever the width crosses the threshold is created at
the exact moment it is needed.

Declaring the editor's tokens and BEING the editor's root are now separate
classes. They were one, so a surface mounted outside the root could only resolve
`--nx-builder-*` by claiming to be a second root, which every selector meaning
"the editor" would then match.

The canvas toolbar's `Show empty containers` switch says what it does. A
container holding no blocks has no height of its own and cannot be seen or
selected, which is the state the control exists for and the one its label never
named.
