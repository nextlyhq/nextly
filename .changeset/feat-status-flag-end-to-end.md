---
"@revnixhq/nextly": minor
"@revnixhq/admin": minor
---

Surface the Draft / Published status flag end-to-end for both code-first
and Visual Schema Builder. Adds `status?: boolean` to the public
`CollectionConfig` and `SingleConfig` types so users can write
`defineCollection({ slug: "posts", status: true, ... })` without
TypeScript errors. Adds the same to the admin's `Collection`,
`EntryFormCollection`, and `CollectionMetadata` interfaces so the API
response carries the flag and the entry form's `Save Draft / Publish`
split lights up on the right collections. Coerces the column value to a
real JS boolean in `DynamicCollectionRegistryService.getCollection` so
dialect quirks (sqlite returning 0/1, postgres returning native boolean)
all surface as the same shape to admin consumers. Drops the now-redundant
`as { status?: boolean }` casts at five call sites across the runtime
config loader, the entry form, and the collection / single Schema Builder
pages.
