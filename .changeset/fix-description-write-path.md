---
"@revnixhq/admin": patch
---

Fix Schema Builder description input writing to wrong property path. The
Builder's GeneralTab now writes field descriptions under
`field.admin.description`, matching the renderer's read path
(`FieldWrapper` reads `field.admin?.description`), the persistence
transformer (`field-transformers.ts` round-trips `admin.description`), and
the code-first config convention. Without this, descriptions added in the
Builder UI were silently dropped during persistence and never reached the
entry create/edit page. Visual treatment (helper text below input vs the
existing tooltip) ships separately.
