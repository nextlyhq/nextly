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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
---

nextly: record what email was sent, and what failed

A failed password-reset previously left no durable trace — the adapter threw,
the service returned `{ success: false }`, one line went to the process log,
and the operator learned from the user. Sends are now recorded in
`email_deliveries`.

The table stores a **hash** of the recipient rather than the address, and a
template slug rather than a rendered subject, so it answers "did this send" and
"how many failed" without answering "to whom". Provider failure messages have
address-shaped text removed before storage, because an SMTP rejection quotes
the recipient back at you.

This is a log, not a queue: nothing drains it, and the retry columns it carries
are reserved and inert so that adding a drain later is not a migration on a
table already holding history.

The recipient column is a KEYED hash rather than a bare digest. An email address
carries too little entropy for a plain SHA-256 to resist an offline dictionary,
so anyone holding the table could confirm whether a given person was written to.
Keying it with the install secret leaves the support lookup working unchanged
while making the column unreadable without that secret. The schema no longer
claims the table sits outside identity-erasure obligations, because a keyed hash
of an address is pseudonymised data rather than anonymised data.

A send whose bookkeeping fails after the provider accepted the message is no
longer reported as a provider failure. Acceptance is recorded the instant the
provider answers, so deriving the response cannot turn a delivered message into
a full set of failed rows, an after-send action told the send failed, and an
auth flow withholding a token.

Provider containment now covers the stages that run with parsed configuration:
building an adapter and probing a connection. A parser that derives a credential
left both quoting the derived value into a diagnostic that reached the failure
log, because the needles were computed from the stored form alone. A parser that
renames one is refused outright, for the same reason a parser that shortens one
already was.

The provider's own verdict survives a failure in the bookkeeping that follows
it. Recording only that the provider answered, and defaulting to success, turned
a refusal into a delivery and had an auth flow withhold its undelivered-token
fallback for a message that was never sent.

The notice written when a row is kept without its provider reference can no
longer change what happened. An installed logger that threw was caught by the
recovery's own handler and reported as a retry that failed, for a row sitting in
the table.
