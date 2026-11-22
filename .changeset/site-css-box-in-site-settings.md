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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

Site settings now has a CSS box for the whole site, above Head and End of body under Code, for people who may change the site's settings: "CSS for every page of the site. Write plain CSS; no `<style>` tags needed." **Save code** checks it with the custom CSS checker first. Each refused line is named under the box with its reason, and nothing is saved, the code beside it included. Accepted CSS applies to every published page at once, and the note says so. If someone else saved the site's CSS while you were editing, nothing is saved, your CSS stays in the box, and saving again replaces theirs.

The custom CSS checker now refuses a pasted `<style>` wrapper with "Leave out the <style> tags." and still names what else it refuses inside the tags, rather than calling the CSS unreadable.
