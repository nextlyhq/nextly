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

The page builder's canvas is drawn in a frame of its own at the chosen device's width and height, so media queries, `vw`, `vh` and container queries behave on the canvas as on a device of that size, the page's block styles and the site's shared styles go in as they are compiled for the published page, and nothing of the admin's theme reaches the page. The app's own global stylesheets (a `globals.css`, for example) are not loaded into the frame yet, so bare-element rules from them do not show on the canvas. Boxes on the canvas size as border-box by default, as most site resets set, until the frame loads those stylesheets; any site rule for `box-sizing` loaded into the frame wins over that default. The frame's document states the language being edited. The page sits just under the top bar at every zoom; a canvas zoomed past its region scrolls from the keyboard; a locked block's ring is dashed; and a block its container clips is ringed only where it shows. A refused drop reads the same on the canvas, in Layers and from the keyboard, on one neutral notice with a red edge and a warning mark, in plain words such as "A Text can't go here. This spot takes a Column or a Row." The server words a refused placement on save the same way. Zoom scales the frame, and Fit fits both its width and its height. The selection ring, the block toolbar, the drop line, the spacing bands and other editing marks are drawn over the frame at their own size at any zoom, and the frame is named "Page canvas" with the page's title for assistive technology. For hosts building on `@nextlyhq/builder/shell` (experimental): `Canvas` no longer takes `preview`, `zoom` or `onScale`, and `CanvasPreview` is gone; render `Canvas` inside the new `CanvasFrame`, which takes the width, the zoom and the chrome as its `overlay`, under a `CanvasFrameProvider`. `DropRefusal` and `CanvasMarks` draw the refusal notice and the selection marks.
