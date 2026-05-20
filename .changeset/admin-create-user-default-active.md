---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Fix users created through the admin "Create user" page being unable to sign in, and clear up the misleading checkbox that caused the silent failure in the first place.

The form's submit handler in `packages/admin/src/pages/dashboard/users/create.tsx` collected the "Active Account" checkbox value into `values.active` but never forwarded it to the API, so the backend always saw `isActive` as `undefined` and fell back to its default of `false`. `verify-credentials.ts` rejects inactive accounts at every login leg, so the newly-created user could authenticate with the right password and still see a generic "invalid credentials" error. The submit handler now sends `isActive: values.active ?? true`, matching the checkbox's documented "Default: Yes" UX. The backend default of `false` is intentionally preserved -- it is load-bearing for self-registration via `/auth/register`, where `auth-service.verifyEmail` is what flips `isActive` to `true` and gates login on proof of email ownership.

The companion checkbox was also reworked. It was labeled "Send Welcome Email" with help text "Send an email with login credentials after account creation", but it actually sets `emailVerified: null` and dispatches a _verification_ email -- the user could not sign in until they clicked the link. Combined with the form's "Active: Yes" default, that meant the out-of-the-box "create user" flow promised immediate login but silently delivered the opposite. The form field is now named `requireEmailVerification`, the label is "Require Email Verification", the help text is honest about the verification gate, the default is unchecked (so the form's "Active + immediate login" promise holds end-to-end), the checkbox is disabled when the account is inactive (verification is meaningless for a disabled account), and an inline note surfaces when both flags are on so the admin understands login is still gated until the verification link is clicked. The wire shape is unchanged -- `requireEmailVerification` maps onto the historical `sendWelcomeEmail` field at submit time so existing API consumers keep working.
