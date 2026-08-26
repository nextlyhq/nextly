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

The preview pane's viewport control now offers named widths, and they come from
the site rather than from a list Nextly invented.

A collection or Single can declare them:

```typescript
admin: {
  preview: {
    url: entry => `/blog/${entry.slug}`,
    breakpoints: [
      { label: "Phone", width: 390 },
      { label: "Desktop", width: 1280 },
    ],
  },
}
```

`breakpoints` also accepts a FUNCTION, evaluated per link on the server. That is
what lets a source which changes stay current: a page-builder site keeps its
breakpoints in stored data an author edits, and a list captured when the config
was defined would go stale the moment they change one.

`@nextlyhq/plugin-page-builder` supplies exactly that for sites that use it:

```typescript
breakpoints: previewViewportsFromSiteStyle({ reader: async () => /* ... */ })
```

so the pane offers the site's OWN tiers, by the names their author gave them,
read through the same reader the style compiler uses — a preset therefore cannot
name a width the compiled stylesheet has no rule for.

Where neither is declared, the control keeps Responsive and a custom width.
Nothing invents phone/tablet/desktop numbers, because nothing here can know the
widths a site's CSS actually breaks at: a site whose tablet is 991px would
otherwise get a "Tablet" preset that sizes the frame to 1024 and lands in a tier
its stylesheet never uses.

A malformed row is dropped rather than failing the list, and a declaration that
throws costs its presets rather than the preview — these are a convenience on
top of a credential handout, and losing the link is the worse outcome.
