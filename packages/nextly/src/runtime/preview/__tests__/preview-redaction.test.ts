/**
 * A preview link must not show its recipient more than its sender can see.
 *
 * A granted draft read is TRUSTED so the working-draft overlay appears at all,
 * and ONE flag decides both row trust and FIELD trust — `applyFieldReadAccess`
 * returns immediately when `overrideAccess` is set. So the trusted read hands
 * back every field, including any the sharer's own permissions withhold, and a
 * link becomes a way to read past those permissions by sending yourself one.
 *
 * These cover the repair: the row stays trusted, the FIELDS are judged as the
 * person who shared it.
 */
import { describe, expect, it, vi } from "vitest";

const { applyFieldReadAccess, listRoleSlugsForUser } = vi.hoisted(() => ({
  applyFieldReadAccess: vi.fn(),
  listRoleSlugsForUser: vi.fn(),
}));

vi.mock("../../../shared/lib/field-level-registry", () => ({
  applyFieldReadAccess,
}));
vi.mock("../../../services/lib/permissions", () => ({ listRoleSlugsForUser }));
vi.mock("../../../init", () => ({
  getCachedNextly: () => Promise.resolve({}),
}));

const { redactAsMinter } = await import("../preview-redaction");

describe("rendering a previewed document as the sharer", () => {
  // The positive control. Without it the assertions below cannot tell "asked
  // with the right arguments" from "never asked at all", which is the failure
  // this whole module exists to prevent and which produces no error.
  it("applies the field rules rather than skipping them", async () => {
    listRoleSlugsForUser.mockResolvedValue(["editor"]);

    await redactAsMinter(
      { id: "e1", salary: 100 },
      { kind: "collection", slug: "employees", minter: "u1" }
    );

    expect(applyFieldReadAccess).toHaveBeenCalledTimes(1);
  });

  // The defect, stated directly. `overrideAccess: true` is what makes the row
  // read trusted; passing it on here would switch the field rules straight back
  // off and this module would be an expensive no-op.
  it("judges the fields ENFORCED, whatever the row was read as", async () => {
    listRoleSlugsForUser.mockResolvedValue(["editor"]);

    await redactAsMinter(
      { id: "e1" },
      { kind: "collection", slug: "employees", minter: "u1" }
    );

    expect(applyFieldReadAccess).toHaveBeenCalledWith(
      expect.objectContaining({ overrideAccess: false })
    );
  });

  // A role-based rule reads `roles`; an owner-only rule compares the document's
  // owner against `id`. Both have to be present or the rules answer about
  // nobody, which would strip everything and look like a broken page.
  it("judges them as the sharer, with the roles that sharer holds", async () => {
    listRoleSlugsForUser.mockResolvedValue(["editor", "reviewer"]);

    await redactAsMinter(
      { id: "e1" },
      { kind: "collection", slug: "employees", minter: "u1" }
    );

    expect(listRoleSlugsForUser).toHaveBeenCalledWith("u1");
    expect(applyFieldReadAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({
          id: "u1",
          roles: ["editor", "reviewer"],
        }),
      })
    );
  });

  // The document itself, not a copy: `applyFieldReadAccess` mutates, and
  // redacting a copy would leave the caller rendering the original.
  it("passes the document that is about to be rendered", async () => {
    listRoleSlugsForUser.mockResolvedValue([]);
    const document = { id: "e1", salary: 100 };

    await redactAsMinter(document, {
      kind: "collection",
      slug: "employees",
      minter: "u1",
    });

    expect(applyFieldReadAccess).toHaveBeenCalledWith(
      expect.objectContaining({ entry: document, slug: "employees" })
    );
  });

  // Singles carry their own field rules under their own kind, so a Single's
  // preview must not be looked up as a collection of the same name.
  it("names the entity kind, so a Single is not read as a collection", async () => {
    listRoleSlugsForUser.mockResolvedValue([]);

    await redactAsMinter(
      { id: "s1" },
      { kind: "single", slug: "homepage", minter: "u1" }
    );

    expect(applyFieldReadAccess).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "single", slug: "homepage" })
    );
  });
});
