# T-022 — role-assigned / user-deleted audit events deferred to follow-up

**Date:** 2026-05-01
**Audit ref:** M10
**Phase commit:** `<T-022 commit on security/phase-2>`

## What was instrumented

Three of the five event kinds the audit listed for T-022 ship in this commit, hooked at the auth-handler layer where request context (IP, UA, actor) is already in scope:

| Kind               | Hook site                                                                       |
| ------------------ | ------------------------------------------------------------------------------- |
| `csrf-failed`      | `routeAuthRequest` (intercepts any 403 carrying `error.code === "CSRF_FAILED"`) |
| `login-failed`     | `handleLogin` catch block                                                       |
| `password-changed` | `handleChangePassword` success path                                             |

## What was deferred

Two of the five event kinds the audit listed are **not** in this commit:

- `role-assigned` (and `role-revoked`, the symmetric pair)
- `user-deleted`

## Why

These mutations live in `packages/nextly/src/domains/users/services/user-mutation-service.ts` and `packages/nextly/src/domains/auth/services/user-role-service.ts`. Those services receive `adapter` and `logger` via constructor injection — they do **not** receive the per-request audit writer or the per-request context (IP, User-Agent, current actor's user ID).

To wire them up the same way as the auth handlers we'd need to:

1. Add an `AuditLogWriter` parameter to each service constructor.
2. Update the DI registration site (`di/registrations/...`) to pass the writer.
3. Plumb the request-level context (IP / UA / actor user ID) from the dispatcher down to the mutation service for each call. The current service signatures don't take a request — they take `userId` and config — so adding context means changing every mutation method's signature **and** every caller across `routeHandler.ts`, the dispatcher handlers, and any internal call sites.

That's a real refactor, not a small extension. Doing it under T-022 would have:

- pulled the commit to 8–12 files with cross-package implications;
- silently widened scope past what the prompt's _MUST NOT_ rules allow ("Do NOT silently widen scope");
- delayed the auth-event coverage, which is the load-bearing part of the audit (an external SIEM cares far more about credential-stuffing signals than admin-internal mutations).

## Recommended follow-up

Open `T-022b — Service-layer audit hooks (role + user delete)` as its own task. Scope:

1. Add an `auditLog: AuditLogWriter` field to `UserMutationServiceConfig` (or the equivalent constructor shape) and the same for the role service.
2. Add an `auditContext?: { actorUserId: string; ipAddress: string | null; userAgent: string | null }` parameter to the mutation methods. Default `undefined` so internal/seed callers don't break.
3. Hook the dispatcher (`dispatcher/handlers/auth-dispatcher.ts` and the user/role admin dispatchers) to construct `auditContext` from the incoming request and thread it through.
4. In each of `assignRoleToUser`, `unassignRoleFromUser` (or whatever the unassign path is named), and `deleteUser`, write the corresponding audit event after the DB mutation succeeds (writer is fail-safe so it cannot block the mutation).
5. Extend the existing user-service / user-role-service test files (`*.test.ts` in the same dir) with `it()` blocks asserting the audit hook fired — per the R5 test policy decision.

Estimated effort: **M** (half-day to a day). No DB-side work — the table already exists from this commit.

## Why not just have the service self-resolve the writer via DI?

It can — `buildAuditLogWriter(getService)` is exactly that pattern. But the mutation services don't currently see `getService`; they receive `adapter` and `logger`. Adding `getService` as a constructor arg is the same change-surface as adding `auditLog` directly, and `auditLog` is the more honest signature (the service depends on a writer, not on the entire DI container).

## Status of the table

The `audit_log` table and migrations ship in this commit. T-022b only needs to add writers; no further schema work.
