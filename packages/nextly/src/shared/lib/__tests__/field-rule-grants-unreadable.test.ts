/**
 * A field rule whose caller's roles or permissions cannot be read is denied,
 * instead of judging the caller as holding none.
 *
 * The rule allows unless the caller holds a role, the shape for which "no
 * roles" and "the roles could not be read" give opposite answers: judged on an
 * empty role set, it allows. The collection-level gate refuses the same failure
 * before any field rule runs
 * (`domains/auth/__tests__/role-read-failure-refuses.integration.test.ts`);
 * this is the field pass's own answer, for a read that reaches it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => ({
  roles: async (): Promise<string[]> => [],
  grants: async (): Promise<never[]> => [],
}));

vi.mock("../../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../services/lib/permissions")
  >()),
  listRoleSlugsForUser: vi.fn(() => lookup.roles()),
  listEffectiveGrants: vi.fn(() => lookup.grants()),
}));

import {
  applyFieldReadAccess,
  clearFieldFunctions,
  registerFieldFunctions,
} from "../field-level-registry";

/** A rule that allows unless the caller holds the `suspended` role. */
const unlessSuspended = vi.fn(
  ({ roles }: { roles: string[] }) => !roles.includes("suspended")
);

function entry(): Record<string, unknown> {
  return { id: "e1", title: "a note", memo: "kept from the suspended" };
}

async function readAsSession(row: Record<string, unknown>) {
  registerFieldFunctions("collection", "notes", [
    { name: "title" },
    { name: "memo", access: { read: unlessSuspended } },
  ]);
  await applyFieldReadAccess({
    kind: "collection",
    slug: "notes",
    entry: row,
    user: { id: "u1", email: "u1@example.test" },
  });
}

afterEach(() => {
  clearFieldFunctions();
  unlessSuspended.mockClear();
  lookup.roles = async () => [];
  lookup.grants = async () => [];
});

describe("a field rule that allows unless a role is held", () => {
  it("shows the field when the roles read, and none is suspended", async () => {
    const row = entry();

    await readAsSession(row);

    expect(unlessSuspended).toHaveBeenCalledTimes(1);
    expect(row.memo).toBe("kept from the suspended");
  });

  it("withholds the field when the roles cannot be read", async () => {
    lookup.roles = () => Promise.reject(new Error("roles unreadable"));
    const row = entry();

    await readAsSession(row);

    expect(row).not.toHaveProperty("memo");
    expect(row.title).toBe("a note");
  });

  it("withholds the field when the permissions cannot be read", async () => {
    lookup.grants = () => Promise.reject(new Error("permissions unreadable"));
    const row = entry();

    await readAsSession(row);

    expect(row).not.toHaveProperty("memo");
  });
});
