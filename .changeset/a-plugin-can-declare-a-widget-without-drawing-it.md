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

A plugin can now contribute a dashboard widget WITHOUT shipping any UI code. Declare an `archetype` and the `query` it is drawn from and the host draws the card:

```ts
contributes: {
  admin: {
    widgets: [
      {
        id: "acme/posts",
        title: "Published posts",
        archetype: "metric",
        defaultSize: "sm",
        query: { source: "collection:posts", op: "count" },
      },
    ],
  },
}
```

`component` was required on every contributed widget until now, which made this whole tier impossible to declare — an author had to name a component core would never resolve. The requirement was honest when it was written: `PluginWidgetGrid` was the only consumer, it rendered `PluginSlot path={widget.component}` and nothing else, so a widget without one drew an empty cell. That contract said the requirement would become conditional "when that grid exists and can draw a widget from its archetype alone". It does now, it draws `metric` from a query, and nothing mounts `PluginWidgetGrid` any more.

`PluginAdminWidget` is therefore a union of `PluginAdminCustomWidget` (ships a `component`) and `PluginAdminDeclarativeWidget` (declares an `archetype` and a `query`), both exported from `nextly/config` alongside `DeclarativeWidgetArchetype`. A union rather than making `component` optional, because "either a component, or an archetype and a query" is the actual rule and all-optional fields cannot state it — `{ id }` would type-check as a widget describing no body at all. Both arms still allow `component`, so every existing `{ id, component, size }` declaration compiles unchanged: the union adds a second route rather than constraining the first. A component may accompany a data archetype deliberately, as the fallback body for an archetype this admin release cannot draw yet.

An archetype this version of Nextly does not recognise no longer fails boot. `assertAdminWidgets` runs during plugin resolution, so refusing one would abort the whole install over a single card — and the reachable cause is a plugin built against a newer core. It is accepted, logged with the known vocabulary so a typo is still findable, and the grid reports it by name in that card's own place while the rest of the dashboard stands. This follows what Grafana does with an unknown panel type and what VS Code does with an unrecognised contribution.

The boot diagnostic for a widget that describes no body now names both routes out, rather than telling authors the grid renders a widget "through its `component` and through nothing else".
