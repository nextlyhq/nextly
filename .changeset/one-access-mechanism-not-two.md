---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Access is decided by one mechanism. The stored per-operation rules are gone.

Two independent systems answered "may this caller do this", and only one of them
was configurable. The code-defined `access` on a collection's or Single's own
config is reached from every transport. The stored rules were a second engine —
five rule types evaluated against a JSON column — with no way to author them:
collections had no code, UI or REST surface for the column at all, and a Single
had only an undocumented REST field. Two evaluators for one question is a
divergence waiting to be found by whoever hits the gap between them, and the
half nobody could configure is the half nobody was checking.

So the second engine is removed rather than reconciled. `AccessControlService`
and its five evaluators, the `StoredAccessRule` / `CollectionAccessRules` /
`SingleAccessRules` types, the operation constants that only served them, and
the `access_rules` column on `dynamic_collections` and `dynamic_singles` all go.
`AccessOperation` and `ACCESS_OPERATIONS` stay: the RBAC gate is keyed on them.

Three behaviours change. Two narrow; one WIDENS, and it is the one to read
before upgrading.

**Stored rules are no longer enforced.** Any value still in `access_rules` is
ignored from this release on. For most installations that changes nothing,
because nothing could write the column: collections had no surface for it at
all. It DOES change behaviour for an installation that set a Single's rules
through the undocumented REST field, or wrote the column directly — and the
widest case is an `owner-only` read. That filter was produced by the stored
evaluator alone, so a list, count or by-id read that used to return only the
caller's own rows now returns every row the coarse gate admits for the
collection. Before upgrading, express any rule you still need as code-defined
`access` on the collection's or Single's config; that is the only place a rule
is read now. An installation whose database still holds rules is told so at
startup, with the tables and row counts, so the case is named rather than
silently widened.

An anonymous publish or unpublish is refused outright. It previously fell
through to a rule-less public default unless an explicit stored `publish` rule
denied it, so a collection with no rules — which was every collection — let an
unauthenticated caller move a document into the published state.

Populating a relationship judges the TARGET COLLECTION for the caller, once per
expansion rather than once per row, by evaluating that collection's own
code-defined `access.read` with the same context a direct read of it builds. A
session caller's rule sees their real roles and effective permissions; a
scoped API key's rule sees the key's own grants and roles, in the spelling a
rule reads (`posts:read`) on every path — the translation-worklist read had
built that caller by hand with the stored spelling. An anonymous reader is
judged by the target's rule too, as a direct anonymous read of it is, and so
is an anonymous read of a Single. So a related row is admitted or refused
with every other row of that target, and a row the caller can read directly
does not vanish from a relationship pointing at it. What expansion mirrors is
the target's code-defined rule, and only that: it does not require the
target's database `read-<target>` grant, for the reason it never did
(requiring a grant naming a collection the caller never asked for by name
would empty the relationship for every caller whose grants do not list it).
So a target that declares no read rule is populated for a caller the direct
read would refuse on the grant alone; a target whose rule refuses the caller
is withheld — and decided before any of its rows are queried.

A new database never gets the `access_rules` column. One that already has it
keeps it, and every schema entry point reports it rather than dropping it:
`nextly migrate` refuses and names it (`drops column
'dynamic_collections.access_rules'`), the dev-server reconcile blocks the drop
and says so, and `NEXTLY_ALLOW_CORE_DESTRUCTIVE=1` is how an operator removes
it. Dropping a column that holds configured rules is their decision, not a
side effect of upgrading.

One upgrade is NOT supported and is called out rather than papered over. A
database old enough to be missing core columns added since — a 0.45-era
install — reconciles a drop and several adds on one table, which drizzle-kit
pairs to ask whether the drop is a rename. `pushSchema` builds that resolver
internally with no way to supply a hints handler, so it throws, the boot
degrades to its additive-tables-only baseline, and no column alteration lands.
Such a database should run `nextly migrate` before taking this release.
`upgrade-sim-045.integration.test.ts` is skipped for that reason, with the fix
that restores it named in its header.
