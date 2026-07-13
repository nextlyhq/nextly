---
"@nextlyhq/admin": patch
"@nextlyhq/plugin-sdk": patch
---

Plugins can now extend any admin list. New registries — exported from `@nextlyhq/plugin-sdk/admin` — let a plugin add cell renderers, columns, column transforms, per-row actions, and bulk actions to a list without patching core:

```ts
import {
  registerCellRenderer,
  registerColumns,
  transformColumns,
  registerRowAction,
  registerBulkAction,
} from "@nextlyhq/plugin-sdk/admin";

// A new field-type renderer (all lists)
registerCellRenderer({
  id: "rating",
  types: ["rating"],
  component: RatingCell,
});

// An extra column on the "posts" collection list
registerColumns("posts", () => [
  { name: "seoScore", header: "SEO", cell: SeoCell },
]);

// A per-row action on the users list
registerRowAction("users", {
  id: "impersonate",
  label: "Impersonate",
  onSelect: u => impersonate(u.id),
});
```

Contributions are keyed by a list `target` — a collection slug, a fixed admin-list key (`"users"`, `"media"`, `"roles"`, `"collections"`, `"singles"`, `"components"`, `"plugins"`, `"api-keys"`, `"image-sizes"`), or `"*"` for every list. The admin's unified data table consults these registries automatically. Marked `@experimental` while the surface settles.
