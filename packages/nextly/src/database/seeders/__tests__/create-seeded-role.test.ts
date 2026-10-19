/**
 * A role a first start seeds, when creating it fails.
 *
 * Only a role conflict (its name or slug already held) with the role now there
 * under its slug is another process's success. Any other failure is reported,
 * even when the role exists: on SQLite a role is saved before its permissions
 * are granted, so a lookup by slug can find the very role this call saved and
 * then failed to finish.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { Logger } from "../../../services/shared";
import { createSeededRole } from "../create-seeded-role";

type RoleService = Parameters<typeof createSeededRole>[0];

const ROLE = {
  name: "Editor",
  slug: "editor",
  isSystem: true,
  permissionIds: ["p1"],
};

function setUp(createError: unknown, stored: unknown) {
  const createRole = vi.fn().mockRejectedValue(createError);
  const roles = {
    createRole,
    findRoleIdBySlug: vi.fn().mockResolvedValue(stored),
  } as unknown as RoleService;
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
  return {
    createRole,
    logger,
    seed: () => createSeededRole(roles, ROLE, logger),
  };
}

describe("createSeededRole", () => {
  it("takes a conflict with the role now stored as another process's success", async () => {
    const { seed, logger } = setUp(NextlyError.duplicate(), { id: "r1" });

    await expect(seed()).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
  });

  it("asks createRole to log a conflict quietly", async () => {
    const { seed, createRole } = setUp(NextlyError.duplicate(), { id: "r1" });

    await seed();
    expect(createRole).toHaveBeenCalledWith(ROLE, { quietOnConflict: true });
  });

  it("reports any other failure, even when the role exists", async () => {
    const failure = new Error("insert into role_permissions failed");
    const { seed } = setUp(failure, { id: "r1" });

    await expect(seed()).rejects.toBe(failure);
  });

  it("reports a conflict that left no role under this slug", async () => {
    const conflict = NextlyError.duplicate();
    const { seed } = setUp(conflict, null);

    await expect(seed()).rejects.toBe(conflict);
  });
});
