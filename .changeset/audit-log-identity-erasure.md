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
reached; nothing links them to a person, so no deletion can find them. This
table is pruned on `audit.retention.authMaxAgeMs` — 180 days by default — so a
window is what bounds them. A window is a weaker guarantee than an erasure,
which is why the metadata projection below is default-deny: what never enters is
the only thing certain not to persist.

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

Naming a key is not enough on its own, because none of the values are ours to
begin with. An `AuthStrategy` is application code and chooses its own failure
reason; an error's `code` accepts any string, and the two diagnostic codes are
copied straight from it. Each retained value is now checked against a vocabulary
this package controls — a reason it produces, or a code the canonical table
defines — and anything else is dropped. The value still reaches the operator log;
what it no longer does is enter a trail nothing can associate with a subject.

The reasons are named in one place that the handlers emitting them now compile
against, so a new reason is a type error until it is listed rather than being
discarded without a diagnostic. Three that the initial-password exchange already
emitted were being discarded that way, leaving `pending-token-wrong-challenge`, a
stale must-change state, and a missing user indistinguishable from each other in
the trail. All three are recorded again.

**Upgrading: rows written before this change are not covered.** The handlers
previously stored the whole error context, so existing unattributed
`login-failed` rows can already hold an attempted email address or a user id.
Deletion is keyed on the actor and those rows have none, so nothing reaches them
— the projection applies only to failures recorded from now on.

Accounts deleted BEFORE this change are not covered either, for the opposite
reason: their attributed rows still hold the address and client they connected
from, and the erasure added here runs during a deletion — it can never run for
an account that is already gone. `actor_user_id` carries no foreign key, so
those rows survive as orphans pointing at nothing.

Scrub both once, before or after upgrading:

```sql
-- Rows recorded without an actor: the context the handlers used to store
-- wholesale, which may name an attempted address.
UPDATE audit_log SET metadata = NULL
WHERE actor_user_id IS NULL AND metadata IS NOT NULL;

-- Rows attributed to accounts that no longer exist: their request identifiers,
-- which the deletion that removed them never erased.
UPDATE audit_log SET ip_address = NULL, user_agent = NULL
WHERE actor_user_id IS NOT NULL
  AND actor_user_id NOT IN (SELECT id FROM users);
```

The first discards the diagnostic codes on those rows along with the
identifiers. The second leaves `actor_user_id` in place — the trail should still
say that the same someone did these things, only not who they were. The event,
its outcome and its timestamp are columns, and neither statement touches them:
that is the security fact the trail exists for.

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
