/**
 * The field groups not saved yet that a host's save creates first: the ones its fields use, at any
 * depth, and the ones its picker made that no field uses any more, which the save lets go. Each is
 * created after its address is checked again, and a refusal stops the rest.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CreateComponentPayload } from "@admin/services/fieldGroupApi";
import type { FieldDefinition } from "@admin/types/collection";

/** What the server's address check refuses, by address. */
let refusals: Record<string, { code: string; message: string }> = {};
vi.mock("@admin/services/addressCheckApi", () => ({
  addressCheckApi: {
    check: async (kind: string, address: string) => ({
      kind,
      address,
      refusal: refusals[address] ?? null,
    }),
  },
}));

import {
  createFieldGroupsFirst,
  fieldGroupsFirst,
} from "../field-groups-first";
import {
  addUnsavedEntity,
  removeUnsavedEntity,
  unsavedEntity,
  type UnsavedEntity,
} from "../unsaved-entities";

const POSTS = { kind: "collection" as const, address: "posts" };

function group(
  address: string,
  ownedBy?: UnsavedEntity["ownedBy"]
): UnsavedEntity {
  const label = address.charAt(0).toUpperCase() + address.slice(1);
  return {
    kind: "field-group",
    address,
    // As the store gives one; adding it gives a fresh one.
    token: `token-${address}`,
    settings: { singularName: label, slug: address, icon: "Box" },
    fields: [],
    ...(ownedBy ? { ownedBy } : {}),
  };
}

const field = (over: Partial<FieldDefinition>): FieldDefinition =>
  ({ name: "f", type: "text", ...over }) as FieldDefinition;

afterEach(() => {
  refusals = {};
  for (const address of ["hero", "banner", "promo", "cards"]) {
    removeUnsavedEntity("field-group", address);
  }
});

describe("fieldGroupsFirst", () => {
  it("finds the unsaved field groups a host's fields use, nested ones included, in field order", () => {
    const held = [
      group("hero", POSTS),
      group("banner"),
      group("cards", POSTS),
      group("promo", POSTS),
    ];
    const fields = [
      field({ name: "body" }),
      field({
        name: "layout",
        type: "group",
        fields: [
          field({ name: "top", type: "component", component: "banner" }),
        ],
      }),
      field({ name: "hero", type: "component", component: "hero" }),
      field({
        name: "rows",
        type: "repeater",
        fields: [
          field({
            name: "zone",
            type: "component",
            components: ["cards", "seo"],
          }),
        ],
      }),
    ];

    const { used } = fieldGroupsFirst(held, fields, POSTS);

    expect(used.map(g => g.address)).toEqual(["banner", "hero", "cards"]);
  });

  it("lets the host's own unused picker-made groups go, and keeps any other", () => {
    const held = [
      group("hero", POSTS),
      group("promo", POSTS),
      // Made from its own create page: its own editor saves it.
      group("banner"),
      // Made from another host's picker: that host's save decides.
      group("cards", { kind: "collection", address: "pages" }),
    ];
    const fields = [
      field({ name: "hero", type: "component", component: "hero" }),
    ];

    const { unused } = fieldGroupsFirst(held, fields, POSTS);

    expect(unused.map(g => g.address)).toEqual(["promo"]);
  });
});

describe("createFieldGroupsFirst", () => {
  it("creates each after checking its address again, letting it go from the unsaved ones", async () => {
    addUnsavedEntity(group("hero", POSTS));
    addUnsavedEntity(group("banner", POSTS));
    const create = vi.fn(async (_payload: CreateComponentPayload) => ({}));

    const refused = await createFieldGroupsFirst(
      [group("hero", POSTS), group("banner", POSTS)],
      { create, mirror: async () => {} }
    );

    expect(refused).toBeNull();
    expect(create.mock.calls.map(([payload]) => payload.slug)).toEqual([
      "hero",
      "banner",
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "hero", label: "Hero", fields: [] })
    );
    expect(unsavedEntity("field-group", "hero")).toBeUndefined();
    expect(unsavedEntity("field-group", "banner")).toBeUndefined();
  });

  it("writes each created group's definition to the schema file, then lets its draft go", async () => {
    addUnsavedEntity(group("hero", POSTS));
    const order: string[] = [];
    const create = vi.fn(async (payload: CreateComponentPayload) => {
      order.push(`create ${payload.slug}`);
      return {};
    });
    const mirror = vi.fn(async (made: UnsavedEntity) => {
      order.push(`write ${made.address}`);
      // Still held while its definition is written.
      expect(unsavedEntity("field-group", made.address)).toBeDefined();
    });

    await createFieldGroupsFirst([group("hero", POSTS)], { create, mirror });

    expect(order).toEqual(["create hero", "write hero"]);
    expect(unsavedEntity("field-group", "hero")).toBeUndefined();
  });

  it("writes no definition for a group refused before its create", async () => {
    addUnsavedEntity(group("hero", POSTS));
    refusals = {
      hero: { code: "DUPLICATE", message: "Resource already exists." },
    };
    const mirror = vi.fn(async () => {});

    await createFieldGroupsFirst([group("hero", POSTS)], {
      create: vi.fn(async () => ({})),
      mirror,
    });

    expect(mirror).not.toHaveBeenCalled();
  });

  it("stops at a refused address, creating none after it and keeping it unsaved", async () => {
    addUnsavedEntity(group("hero", POSTS));
    addUnsavedEntity(group("banner", POSTS));
    refusals = {
      hero: { code: "DUPLICATE", message: "Resource already exists." },
    };
    const create = vi.fn(async (_payload: CreateComponentPayload) => ({}));

    const refused = await createFieldGroupsFirst(
      [group("hero", POSTS), group("banner", POSTS)],
      { create, mirror: async () => {} }
    );

    expect(refused).toBe(
      "The field group “Hero” was not created: Another field group already uses this address."
    );
    expect(create).not.toHaveBeenCalled();
    expect(unsavedEntity("field-group", "hero")).toBeDefined();
    expect(unsavedEntity("field-group", "banner")).toBeDefined();
  });

  it("stops at a refused create, saying which group and why", async () => {
    addUnsavedEntity(group("hero", POSTS));
    const create = vi.fn(async (_payload: CreateComponentPayload) => {
      throw new Error("The server is unavailable.");
    });

    const refused = await createFieldGroupsFirst([group("hero", POSTS)], {
      create,
      mirror: async () => {},
    });

    expect(refused).toBe(
      "The field group “Hero” was not created: The server is unavailable."
    );
    expect(unsavedEntity("field-group", "hero")).toBeDefined();
  });
});
