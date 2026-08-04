---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Erase a deleted account's request identifiers from the auth log.

Deleting a user already removed their name and email from the activity log while
keeping the record itself. The auth log identifies a person a second way — by the
address they connected from and the client they used — and those survived
untouched. They are now erased on the same deletion, stamped with when, while the
event kind, the actor and target references and the timestamp stay: that is the
security fact a retained trail exists for.

Erasure is keyed on the actor. A row naming someone as the TARGET carries the
address of whoever acted on them, so erasing by target would scrub a different
person's data and leave the subject's own in place. Events recorded without an
actor — a failed login, a rejected CSRF — are out of reach by design, since they
are written unattributed precisely so a failure cannot reveal which account was
reached; nothing links them to a person, and retention is what bounds them.

Whether each table can be erased is now decided per table. A database can carry
one and not the other, and answering for the pair would let a missing auth log
suppress the activity erasure, leaving behind the names and emails the deletion
exists to remove.

Identifiers are also kept out of the auth log's `metadata` in the first place. A
`NextlyError`'s `logContext` is written for operator triage, and a failed login
puts the attempted email address there; the auth handlers copied that context
into the stored event wholesale. A failure is recorded with no actor precisely
so it cannot reveal which account was reached, so nothing links such a row to a
person and the deletion that erases their other rows can never find it — the
identifier has to not be stored rather than be erased later. Only an allowlisted
set of diagnostic keys is now copied, default-deny, so a key added for logging
cannot silently become a field of the audit trail.

**Upgrading, PostgreSQL and MySQL: one required action.** If you hardened
`audit_log` by revoking UPDATE — the posture this package previously documented —
grant it back for the three columns an erasure touches, or deleting a user will
fail and roll back:

```sql
GRANT UPDATE (ip_address, user_agent, identity_erased_at) ON audit_log TO app_role;
```

Erasing the address and client a deleted account connected from is an UPDATE, and
it runs inside the deletion's transaction, so a blanket revoke now blocks account
deletion outright. DELETE stays revoked and every other column stays immutable.
Deployments that never restricted these grants, and all SQLite deployments, need
no action.
