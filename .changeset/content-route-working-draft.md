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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

thread the working-draft layer through the content route

`resolveContent` and `createContentRoute` gain a `draft` option, so a preview
can show pending unpublished edits instead of live content.

The draft model is two-layered and they fail differently: `status` covers an
entry that has never been published, while pending edits on an ALREADY-published
entry live in a sidecar row that no `status` scope can see. Widening `status`
alone therefore showed a published page live while the edits being previewed
stayed invisible. The two are gated differently: pending edits are judged
per row by an update-capability probe, so asking for them is safe from anywhere,
while never-published rows are judged by nothing. So `draft` widens `status`
only on a trusted read (`overrideAccess: true`); an explicit `status` always
wins.

On the route the option is a per-request decision, because route config is
captured once at module scope while whether a visitor is previewing is not:

```ts
export const { ContentPage, generateMetadata, generateStaticParams } =
  createContentRoute({
    collections: ["pages"],
    draft: async ({ collection, slug }) => grantsDraftAt(collection, slug),
    render: page => <Page {...page} />,
  });
```

The decision is handed the collection and slug being resolved, because Next's
draft mode is one boolean for the whole host: `isEnabled` says a visitor opened
a valid preview link, never which document it was for. Answering from that alone
would turn a link scoped to one page into a key to every unpublished page in the
configured collections.

Returning `true` is an authorization decision rather than a display preference,
so that request reads trusted — the route resolves anonymously and the overlay
is gated on an update-capability probe an anonymous read can never pass. Put the
authorization in that function, never in a query parameter.

A draft read is never cached, and `generateStaticParams` ignores the option
entirely, so a draft is never baked into a pre-rendered path.
