/**
 * A visitor's field rule is handed the Public role's permissions, as the
 * collection rule above it is.
 *
 * A collection rule and a field rule asking the same question,
 * `permissions.includes("read-notes")`, must answer a visitor alike: the
 * collection rule is handed what Public grants, so a field rule handed
 * nothing let the visitor read the document while its field was stripped, and
 * let a visitor's write the Public role allows silently drop the field. The
 * rule here reads only the permissions, so what it is handed decides it.
 *
 * Controls: a visitor Public grants nothing is still refused the field, a
 * plugin's person (who holds no permission) is refused it whatever Public
 * grants, and a visitor whose Public grants cannot be read is refused it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GrantedPermission } from "../../../auth/authenticated-scope";

const publicRole = vi.hoisted(() => ({
  grants: async (): Promise<GrantedPermission[]> => [],
}));

vi.mock("../../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../services/lib/permissions")
  >()),
  listPublicGrants: vi.fn(() => publicRole.grants()),
}));

import { decide } from "../../../auth/access/decide";
import { actorForVisitor } from "../../../auth/access/resolve-actor";
import { runAsPrincipal } from "../../../auth/principal-scope";
import { makePrincipal } from "../../../plugins/principals/principal";
import type { AccessRuleContext } from "../../types/access";
import {
  applyFieldReadAccess,
  applyFieldWriteAccess,
  clearFieldFunctions,
  registerFieldFunctions,
} from "../field-level-registry";

const READ_NOTES: GrantedPermission = {
  slug: "read-notes",
  action: "read",
  resource: "notes",
};
const CREATE_NOTES: GrantedPermission = {
  slug: "create-notes",
  action: "create",
  resource: "notes",
};

/** Allows a caller holding the permission for what it is asked. */
const holdsIt = ({ permissions, operation, collection }: AccessRuleContext) =>
  permissions.includes(`${operation}-${collection}`);

function register() {
  registerFieldFunctions("collection", "notes", [
    { name: "title" },
    { name: "memo", access: { read: holdsIt, create: holdsIt } },
  ]);
}

/** A visitor's checked read of one note, as the field pass judges it. */
async function visitorReads(): Promise<Record<string, unknown>> {
  register();
  const row = { id: "n1", title: "a note", memo: "for readers" };
  await applyFieldReadAccess({
    kind: "collection",
    slug: "notes",
    entry: row,
    overrideAccess: false,
  });
  return row;
}

afterEach(() => {
  clearFieldFunctions();
  publicRole.grants = async () => [];
});

describe("a visitor's field rule", () => {
  it("keeps a field the Public role's read permission allows, as the collection rule does", async () => {
    publicRole.grants = async () => [READ_NOTES];

    const row = await visitorReads();
    const collection = await decide(await actorForVisitor(), "read", {
      kind: "collection",
      slug: "notes",
      access: { read: holdsIt },
    });

    expect(collection.allowed).toBe(true);
    expect(row.memo).toBe("for readers");
  });

  it("keeps a field on a visitor's write the Public role allows", async () => {
    publicRole.grants = async () => [CREATE_NOTES];
    register();
    const data: Record<string, unknown> = { title: "new", memo: "kept" };

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "notes",
      data,
      operation: "create",
      overrideAccess: false,
    });

    expect(data.memo).toBe("kept");
  });

  it("strips the field when the Public role does not grant it", async () => {
    publicRole.grants = async () => [CREATE_NOTES];

    const row = await visitorReads();

    expect(row).not.toHaveProperty("memo");
    expect(row.title).toBe("a note");
  });

  it("strips the field from a plugin's person, whatever Public grants", async () => {
    publicRole.grants = async () => [READ_NOTES];
    const person = makePrincipal("accounts:account", "acc_1", {});

    const row = await runAsPrincipal(person, () => visitorReads());

    expect(row).not.toHaveProperty("memo");
  });

  it("strips the field when the Public role's grants cannot be read", async () => {
    publicRole.grants = () => Promise.reject(new Error("public unreadable"));

    const row = await visitorReads();

    expect(row).not.toHaveProperty("memo");
  });
});
