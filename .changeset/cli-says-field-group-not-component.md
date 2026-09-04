---
"nextly": patch
---

The CLI now says "field group" where it still said "component". `db:sync` and
`generate-types` print a `Field groups` count, a failed sync reports field
groups, and a generated migration carries a `-- Field groups:` header. Migration
files written before this keep working: the header is read back under both
spellings, so an older file is still reported as touching the field groups it
touches.
