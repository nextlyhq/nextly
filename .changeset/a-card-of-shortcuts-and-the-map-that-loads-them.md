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

The `actions` archetype is drawn by the host, and Phase 1b's plumbing is finished.

A plugin declares a card of shortcuts with no UI code of its own:

```ts
{
  id: "acme/shortcuts",
  title: "Shortcuts",
  archetype: "actions",
  defaultSize: "sm",
  actions: [
    { label: "New post", href: "/admin/posts/new" },
    { label: "Invite user", href: "/admin/users/new", requiredPermission: "create-users" },
    { label: "Docs", href: "https://nextly.dev/docs", external: true },
  ],
}
```

`WidgetAction` is exported from `nextly`, `nextly/config` and `@nextlyhq/plugin-sdk`. An `actions` widget must carry a non-empty list and no other archetype may carry one — the same both-directions rule `component` and `query` follow — and each item needs a label and an href, since neither has a sensible default and a blank one is a shortcut that looks broken rather than absent.

Each shortcut is gated on its OWN `requiredPermission`, separately from the card's. The two answer different questions: the card's decides whether the widget appears, an item's decides whether that shortcut does. A card of five shortcuts where the reader may use two shows two rather than disappearing, and a shortcut to something they cannot do is worse than none — it advertises a capability, costs a click, and answers with a refusal screen. `external: true` opens in a new tab with `noopener` and says so to a screen reader. A card draws at most six and counts the rest rather than dropping them silently.

This also fixes a bug that would have broken the FIRST queryless archetype to ship. `text` and `actions` take no query, so they never enter the batch and no slot ever arrives — and the outcome resolver read that absence as "drawn from a query, and this widget declares none". Any body registered for one would have failed on every render, permanently. An archetype now declares whether it is drawn from a result or from the declaration, and the two are dispatched differently.

**Widget components are emitted into the generated import map.** Being pre-bundled by that map is what puts a component in the registry `PluginSlot` reads — the runtime fallback cannot resolve a bare package specifier in a bundled browser — so while widgets were excluded, a `custom` widget drew its card and then nothing inside it, unless the plugin called `registerComponents` itself from its admin entry, which the documented contract never asked it to do. A declarative widget still contributes no path, having no component to carry.

`PluginWidgetGrid` is deleted. `WidgetGrid` replaced it in the release that introduced it, nothing has mounted it since, and it survived only through its own test.
