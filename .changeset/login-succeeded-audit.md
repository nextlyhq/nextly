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

Record a `login-succeeded` audit event when a session is issued.

Failed logins have been recorded since the audit log shipped; successes were
not. A trail of failures alone shows that someone tried and not whether they got
in, which is the first question asked after a credential leak.

The event is written where the session is issued, not where the flow began.
Three handlers issue sessions — password login, second-factor resolution, and
the forced first-sign-in password change — so recording it in the login handler
alone would have left every user who completes a second factor absent from the
success trail, which is the population most worth seeing in it. Recording on an
HTTP 200 instead would have the opposite fault: the challenge and
password-change legs answer 200 while issuing no session, so a success would be
reported for an account that was never reached.

It is recorded last, after the post-login hooks. A hook that throws sends the
handler into its failure path, which returns an error and records a failure, so
the client receives neither the token body nor the cookies — a success recorded
before that point would leave the trail asserting both outcomes for one attempt.
Those hooks now run inside the same shared step for that reason: all three
handlers ran the identical pair, and the order between them decides whether the
trail can contradict itself.

Unlike the failure event it is attributed to the account. Naming the account on
a failure is the account-state leak the unified error response exists to avoid;
on a success it is the whole value of the record.
