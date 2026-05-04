---
"@revnixhq/admin": patch
---

Save Draft and Publish buttons now write the canonical Draft / Published status into the entry mutation. `useEntryForm.handleSubmit` accepts an optional `status` argument; the ActionBar buttons pass `'draft'` and `'published'` respectively. Collections without drafts enabled keep the single Save button and ignore the status surface entirely.
