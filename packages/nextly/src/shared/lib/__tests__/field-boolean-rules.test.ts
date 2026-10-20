/**
 * A field rule written as a boolean decides the field, as a function would.
 *
 * Registration keeps a field's rules for every read and write that redacts.
 * It kept only functions, so `read: false` written as a boolean was dropped
 * there and the field was never withheld. A boolean is turned into a function
 * answering itself when the field is registered, so every path that redacts
 * honours it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../di/container", () => ({
  container: { has: () => false, get: () => undefined },
}));

vi.mock("../../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../services/lib/permissions")
  >()),
  isSuperAdmin: vi.fn(async () => false),
  hasPermission: vi.fn(async () => true),
  listRoleSlugsForUser: vi.fn(async () => []),
  listEffectiveGrants: vi.fn(async () => []),
  listEffectivePermissions: vi.fn(async () => []),
}));

import {
  applyFieldReadAccess,
  applyFieldWriteAccess,
  clearFieldFunctions,
  hasFieldAccessRule,
  registerFieldFunctions,
} from "../field-level-registry";

const USER = { id: "u1", email: "u1@example.test" };

beforeEach(() => clearFieldFunctions());

describe("a boolean field rule", () => {
  it("withholds a field whose read rule is false", async () => {
    registerFieldFunctions("collection", "posts", [
      { name: "title" },
      { name: "secret", access: { read: false } },
    ]);
    expect(hasFieldAccessRule("collection", "posts", "read")).toBe(true);

    const entry: Record<string, unknown> = {
      id: "e1",
      title: "a",
      secret: "s",
    };
    await applyFieldReadAccess({
      kind: "collection",
      slug: "posts",
      entry,
      user: USER,
    });
    expect(entry).not.toHaveProperty("secret");
    expect(entry.title).toBe("a");
  });

  it("keeps a field whose read rule is true", async () => {
    registerFieldFunctions("collection", "posts", [
      { name: "secret", access: { read: true } },
    ]);
    const entry: Record<string, unknown> = { id: "e1", secret: "s" };
    await applyFieldReadAccess({
      kind: "collection",
      slug: "posts",
      entry,
      user: USER,
    });
    expect(entry.secret).toBe("s");
  });

  it("strips a write to a field whose update rule is false", async () => {
    registerFieldFunctions("collection", "posts", [
      { name: "title" },
      { name: "locked", access: { update: false, create: true } },
    ]);
    const update: Record<string, unknown> = { title: "a", locked: "x" };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: update,
      operation: "update",
      user: USER,
    });
    expect(update).not.toHaveProperty("locked");

    const create: Record<string, unknown> = { title: "a", locked: "x" };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: create,
      operation: "create",
      user: USER,
    });
    expect(create.locked).toBe("x");
  });

  it("withholds a field group's field whose read rule is false", async () => {
    registerFieldFunctions("fieldGroup", "seo", [
      { name: "title" },
      { name: "secret", access: { read: false } },
    ]);
    const entry: Record<string, unknown> = { title: "t", secret: "s" };
    await applyFieldReadAccess({
      kind: "fieldGroup",
      slug: "seo",
      entry,
      user: USER,
    });
    expect(entry).not.toHaveProperty("secret");
    expect(entry.title).toBe("t");
  });

  it("decides a field nested in a group", async () => {
    registerFieldFunctions("collection", "posts", [
      {
        name: "meta",
        type: "group",
        fields: [{ name: "note", access: { read: false } }],
      },
    ]);
    const entry: Record<string, unknown> = {
      id: "e1",
      meta: { note: "n", other: "o" },
    };
    await applyFieldReadAccess({
      kind: "collection",
      slug: "posts",
      entry,
      user: USER,
    });
    expect(entry.meta).not.toHaveProperty("note");
  });
});
