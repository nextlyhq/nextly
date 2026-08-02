---
"@nextlyhq/blocks-engine": patch
---

Document validation can now check design-token names and class ids against the
site that will render them. Both are optional: validation is given the site or
it is not, and without it these names are not checked at all. An unresolved name
is always a warning, never an error, so renaming a token or retiring a class
never makes a stored document unpublishable.
