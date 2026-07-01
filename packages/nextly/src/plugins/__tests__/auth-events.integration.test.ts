/**
 * auth.* post-commit lifecycle events (D69 / B4).
 *
 * Verifies that `AuthService` / the direct-API auth namespace emit best-effort
 * `auth.*` events at their success boundaries. The events are observe-only,
 * post-commit, and must never alter the operation's result — so each test drives
 * the real public facade (`current.nextly.register` / `.login` / the
 * `authService` for `changePassword`) on the in-memory harness and asserts the
 * captured payload.
 *
 * The harness (`createTestNextly`) boots a real Nextly on in-memory SQLite but
 * only creates code-first collection tables — the core auth tables (users,
 * password_reset_tokens, email_verification_tokens, …) are not auto-synced on
 * SQLite. We bootstrap them with the shared `generateSqliteCoreTableStatements`
 * DDL (the same helper the CLI dev fallback and the user-mutation integration
 * test use) so register/login/changePassword run end-to-end against live tables.
 */

// `login()` reads `env.NEXTLY_SECRET` (lazily cached on first access) to sign
// the session token. Set it before any module reads `env` so login can sign.
process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";
import { createTestNextly, type TestNextly } from "../test-nextly";

import type { AuthService } from "../../domains/auth/services/auth-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * Boot the harness and bootstrap the core auth tables that the SQLite runtime
 * auto-sync can't create (see module header).
 */
async function bootWithCoreTables(): Promise<TestNextly> {
  const handle = await createTestNextly({});
  for (const statement of generateSqliteCoreTableStatements()) {
    await handle.adapter.executeQuery(statement);
  }
  return handle;
}

const STRONG_PASSWORD = "Str0ng-P@ssw0rd!";

describe("auth.* post-commit lifecycle events", () => {
  it("registering a user emits auth.registered with { userId, email }", async () => {
    current = await bootWithCoreTables();

    const events: Array<Record<string, unknown>> = [];
    current.events.on<Record<string, unknown>>("auth.registered", e => {
      events.push(e.payload);
    });

    const result = await current.nextly.register({
      email: "register@example.com",
      password: STRONG_PASSWORD,
      name: "Reg User",
    });
    await current.events.settle();

    const userId = (result.user as { id: string }).id;
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      userId,
      email: "register@example.com",
    });
  });

  it("logging in emits auth.loggedIn with { userId, email }", async () => {
    current = await bootWithCoreTables();

    const registered = await current.nextly.register({
      email: "login@example.com",
      password: STRONG_PASSWORD,
      name: "Login User",
    });
    const userId = (registered.user as { id: string }).id;

    const events: Array<Record<string, unknown>> = [];
    current.events.on<Record<string, unknown>>("auth.loggedIn", e => {
      events.push(e.payload);
    });

    const loginResult = await current.nextly.login({
      email: "login@example.com",
      password: STRONG_PASSWORD,
    });
    await current.events.settle();

    // Sanity: login returned a signed session token (behavior unchanged).
    expect(loginResult.token.split(".")).toHaveLength(3);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      userId,
      email: "login@example.com",
    });
  });

  it("changing a password emits auth.passwordChanged with { userId }", async () => {
    current = await bootWithCoreTables();

    const registered = await current.nextly.register({
      email: "change@example.com",
      password: STRONG_PASSWORD,
      name: "Change User",
    });
    const userId = (registered.user as { id: string }).id;

    const events: Array<Record<string, unknown>> = [];
    current.events.on<Record<string, unknown>>("auth.passwordChanged", e => {
      events.push(e.payload);
    });

    // The `authService` getter on the booted facade is the canonical emit site
    // (it's a cached accessor, not a DI-registered service, so reach for it via
    // the facade rather than getService).
    const authService: AuthService = current.nextly.authService;
    await authService.changePassword(
      userId,
      STRONG_PASSWORD,
      "An0ther-Str0ng-P@ss!"
    );
    await current.events.settle();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ userId });
  });
});
