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

The page builder's usage counts now cover every document that places a component, and keep their rows where only the plugin reaches them.

- **Singles are counted.** A Single whose blocks place a component (a blocks-backed homepage, say) is recorded by its saves and by the background job, counted in "used on N pages", listed in a shared style's where-used list to those who may read it, and judged when the component it places changes, as a collection entry is. A site with such a Single no longer reads as "at least" for ever.
- **A component chosen through a placement counts as used.** A placement that sets one of its component's fields to another component, or a component whose variant does, is recorded as using that component, so a change to it judges the page that draws it.
- **The usage index rows moved into the plugin's own tables**, `page_builder__component_usage` and `page_builder__class_usage`, beside the bookkeeping tables. No admin screen, REST route or Direct API call reaches them, and health reads them in the same snapshot as the bookkeeping. The old `nx_pb_component_usage` and `nx_pb_class_usage` collections stay declared and are no longer read or written.
- **A Single nobody has saved is counted from its defaults.** Its default document is read as its first read will store it, so what its defaults place counts before anyone opens it, and a component or style its defaults use cannot be deleted as unused. For this, `findSingle` gains an experimental option: `findSingle({ slug, createIfMissing: false, whenAbsent: "default" })` answers, for a Single with no stored document, the default document a creating read would store, through the same access rules, lifecycle filter and read hooks, without storing it. It is refused without `createIfMissing: false`.
- `usageCountReader` is no longer exported: it read the old collection. A count is asked through the `usage-health` service's new `counts(index)`, as in `componentUsageCount({ read: service.counts(componentUsageIndexDescriptor), componentId, health: await service.read(componentUsageIndexDescriptor) })`. The service's `read` no longer needs the collection slug.

**Upgrading:** a production site runs `npx nextly migrate` before it starts on this version, for the two new tables (plugin schema version 7); until then the boot refuses with `PLUGIN_SCHEMA_BEHIND`. After the upgrade the background job indexes every page and Single again into the new tables, and counts read as "at least" until it has finished.
