/**
 * Setup-status's "the install has an administrator", kept once it is yes,
 * on every dialect, through the real catch-all handler.
 *
 * The admin asks setup-status on every screen. Its answer was a walk of the
 * role graph each time (the `super-admin` role, the roles inheriting it,
 * whoever holds one): about four statements for an answer that changes only
 * with roles and their holders, every change to which moves the role
 * version. So:
 * - once an administrator exists, asking again reads none of the role
 *   tables while the role version stands;
 * - a no is never kept: the first administrator is seen by the very next
 *   question;
 * - a change to roles or their holders (the role version moving) makes the
 *   next question read them again.
 */
import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../__tests__/fixtures/permission-holders";
import { recordStatements } from "../../__tests__/helpers/record-statements";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { invalidateAllPermissionCaches } from "../../services/lib/permissions";

const ORIGIN = "http://localhost";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The statements of `texts` that read a role table. */
function roleReads(texts: readonly string[]): string[] {
  return texts.filter(text =>
    /\bfrom\s+["`]?(roles|role_inherits|user_roles)["`]?/i.test(text)
  );
}

/** GET /auth/setup-status, signed out, as the admin's screens send it. */
async function setupStatus(): Promise<{ isSetup: boolean }> {
  const response = await createDynamicHandlers().GET(
    new Request(`${ORIGIN}/admin/api/auth/setup-status`, {
      headers: { origin: ORIGIN },
    }),
    { params: Promise.resolve({ params: ["auth", "setup-status"] }) }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { isSetup: boolean };
}

describe.each(getConfiguredTestDialects())(
  "setup-status kept under the role version (%s)",
  dialect => {
    it("reads no role table again once an administrator exists, until the role version moves", async () => {
      const t = (current = await createTestNextly({ dialect }));
      await superAdminUser(t, "kept-admin");
      // Read and kept.
      expect((await setupStatus()).isSetup).toBe(true);

      const kept = await recordStatements(t.adapter, dialect);
      try {
        expect((await setupStatus()).isSetup).toBe(true);
        expect((await setupStatus()).isSetup).toBe(true);
      } finally {
        kept.uninstall();
      }
      expect(roleReads(kept.statements)).toEqual([]);

      // A change to roles or their holders moves the role version.
      await invalidateAllPermissionCaches();
      const moved = await recordStatements(t.adapter, dialect);
      try {
        expect((await setupStatus()).isSetup).toBe(true);
      } finally {
        moved.uninstall();
      }
      // POPULATION CONTROL: the walk the kept answer spares, read again.
      expect(roleReads(moved.statements).length).toBeGreaterThan(0);
    });

    it("never keeps a no: the first administrator is seen by the next question", async () => {
      const t = (current = await createTestNextly({ dialect }));
      expect((await setupStatus()).isSetup).toBe(false);
      expect((await setupStatus()).isSetup).toBe(false);

      // Past every service, so nothing here is told: only a fresh read sees it.
      await superAdminUser(t, "first-admin");

      expect((await setupStatus()).isSetup).toBe(true);
    });
  }
);
