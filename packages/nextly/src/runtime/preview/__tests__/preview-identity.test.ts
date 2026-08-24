/**
 * A preview link must not show its recipient more than its sender can see.
 *
 * A granted draft read is TRUSTED so the working-draft overlay appears at all,
 * and ONE flag decided both row trust and FIELD trust — `applyFieldReadAccess`
 * returns immediately when `overrideAccess` is set. So the trusted read handed
 * back every field, including any the sharer's own permissions withhold, and a
 * link became a way to read past those permissions by sending yourself one.
 *
 * These cover the identity half of the repair: WHO the draft is rendered as,
 * and what happens when that cannot be established. The other half — that the
 * read enforces field rules at all — is covered in `preview-draft-gate.test.ts`
 * and in the query service's own tests.
 */
import { describe, expect, it, vi } from "vitest";

const { findById, listRoleSlugsForUser, getService } = vi.hoisted(() => {
  const findById = vi.fn();
  return {
    findById,
    listRoleSlugsForUser: vi.fn(),
    getService: vi.fn(() => ({ findById })),
  };
});

vi.mock("../../../di/register", () => ({ getService }));
vi.mock("../../../services/lib/permissions", () => ({ listRoleSlugsForUser }));
vi.mock("../../../init", () => ({
  getCachedNextly: () => Promise.resolve({}),
}));

const { resolvePreviewIdentity } = await import("../preview-identity");

describe("the identity a previewed draft is rendered as", () => {
  // A role-based rule reads `roles`; an owner-only rule compares the document's
  // owner against `id`; a rule keyed on an email domain reads `email`. All of
  // them have to be present or the rules answer about nobody — which strips
  // more than the sharer would lose and looks like a broken page.
  it("is the sharer, with the identity their own request would carry", async () => {
    findById.mockResolvedValue({
      id: "u1",
      name: "Ada",
      email: "ada@example.com",
    });
    listRoleSlugsForUser.mockResolvedValue(["editor", "reviewer"]);

    const identity = await resolvePreviewIdentity("u1");

    expect(findById).toHaveBeenCalledWith("u1", {});
    expect(listRoleSlugsForUser).toHaveBeenCalledWith("u1");
    expect(identity).toMatchObject({
      id: "u1",
      name: "Ada",
      email: "ada@example.com",
      roles: ["editor", "reviewer"],
      // Rules and field callbacks written against a single-role model read
      // `user.role`; without it a legitimately authorized sharer loses fields.
      role: "editor",
    });
  });

  // Custom columns on the users table are NOT claims. They never reach a live
  // request's `UserContext`, so a rule reading one denies there — carrying them
  // here would make a preview show MORE than the sharer sees in the admin,
  // which is the direction this module exists to prevent.
  it("does not carry stored user columns the sharer's own request would not", async () => {
    findById.mockResolvedValue({
      id: "u1",
      name: "Ada",
      email: "ada@example.com",
      department: "engineering",
      tier: "gold",
    });
    listRoleSlugsForUser.mockResolvedValue([]);

    const identity = await resolvePreviewIdentity("u1");

    expect(identity).not.toHaveProperty("department");
    expect(identity).not.toHaveProperty("tier");
  });

  // An absent name is stored as null. Passed through, a rule comparing
  // `user.name` reads the null as a value it can test rather than as nothing.
  it("reports an absent name as absent rather than as null", async () => {
    findById.mockResolvedValue({ id: "u1", name: null, email: "a@b.c" });
    listRoleSlugsForUser.mockResolvedValue([]);

    const identity = await resolvePreviewIdentity("u1");

    expect(identity?.name).toBeUndefined();
  });

  // Fails CLOSED. The caller turns null into "no draft": rendering as nobody
  // applies no field rules at all, which is the leak itself.
  it("answers null when the sharer's account is gone", async () => {
    findById.mockRejectedValue(new Error("NOT_FOUND"));
    listRoleSlugsForUser.mockResolvedValue([]);

    expect(await resolvePreviewIdentity("deleted-user")).toBeNull();
  });

  // The same answer for a database that will not respond. A lookup failure must
  // not degrade into an unredacted render, which is what returning a partial
  // identity would do for every rule that reads what is missing.
  it("answers null when the roles lookup fails", async () => {
    findById.mockResolvedValue({ id: "u1", name: "Ada", email: "a@b.c" });
    listRoleSlugsForUser.mockRejectedValue(new Error("connection refused"));

    expect(await resolvePreviewIdentity("u1")).toBeNull();
  });
});
