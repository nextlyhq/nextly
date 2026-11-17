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

Form posts now go to one safe receiver in the page builder, and plugins can offer their own forms through an experimental form provider contract.

- **One receiving route.** `POST /plugins/@nextlyhq/plugin-page-builder/forms/send` takes every form post as a plain HTML form post. It reads the form from the published page, component, template or header & footer set the post names, never from what the browser sent: a form only a draft holds is refused, and only the form's own fields are passed on. It caps a post at 64 KB and 200 fields, refuses a post another site's page made the browser send, limits each visitor address to 10 sends a minute in the deployment's shared limit store, and sends the visitor back only to a path of the same site, with the outcome in the address's fragment (`#form-<id>-sent`, `-invalid`, `-closed` or `-error`).
- **A spam trap in every form.** The Form block now draws a hidden `_hp` field: off screen, out of the tab order, hidden from screen readers and closed to autofill. A post with it filled is answered as a success and goes no further.
- **The simple form sends from the server.** A Form block with no provider form picked has its answers checked against its own fields and posted from the site's server to its "Send to" address, storing nothing and logging no answers. Only `https` addresses of public hosts are used, checked at each send; redirects are not followed, and a send gives up after 10 seconds. A Form block keeps posting to its "Send to" address directly until it is pointed at the receiver.
- **Form providers (experimental).** `@nextlyhq/plugin-sdk/blocks` adds `FormProvider`, `FormDescription`, `FormFieldDescription`, `FormAcceptResult` and the types around them, all `@experimental`. A plugin registers a provider from its `init` through the page builder's new `forms` service; the receiver hands it each post to one of its forms, trimmed to the fields it describes. `@nextlyhq/blocks-react/blocks` adds `FORM_HONEYPOT_FIELD` and `formFields`, the Form block's fields with their defaults applied.
