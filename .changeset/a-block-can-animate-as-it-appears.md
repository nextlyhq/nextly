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

A block can now animate as it appears. **Animation when it appears**, in the Style tab's Effects, offers None, Fade in, Rise, Slide in from the left, Slide in from the right and Zoom in, with a Duration and a Delay in milliseconds and a Start: When scrolled into view or When the page loads. Each part is set per device like any style, so a block can rise on desktop and stay still on mobile. The published page animates with CSS alone and adds no script; only opacity and the transform move, so nothing shifts. The starting state lives only inside the animation, so a printed page, a visitor asking for reduced motion, and (for When scrolled into view) a browser without scroll-driven animation all see every block as it is. The canvas shows blocks in their final state.
