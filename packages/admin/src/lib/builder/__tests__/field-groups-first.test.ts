/**
 * The field groups not saved yet that a host's save creates first: the ones its fields use, at any
 * depth, and the ones its picker made that no field uses any more, which the save lets go. Each is
 * created after its address is checked again, and a refusal stops the rest.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CreateComponentPayload } from "@admin/services/fieldGroupApi";
import type {
  CreateCollectionPayload,
  FieldDefinition,
} from "@admin/types/collection";

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

/** An unsaved collection, as "Create it too" leaves one for its host. */
function collection(
  address: string,
  ownedBy?: UnsavedEntity["ownedBy"]
): UnsavedEntity {
  const label = address.charAt(0).toUpperCase() + address.slice(1);
  return {
    kind: "collection",
    address,
    token: `token-${address}`,
    settings: {
      singularName: label,
      pluralName: label,
      slug: address,
      icon: "Box",
    },
    fields: [],
    ...(ownedBy ? { ownedBy } : {}),
  };
}

/** Steps for each kind: the field groups' given, the collections' spies. */
function creators(
  create: (payload: CreateComponentPayload) => Promise<unknown>,
  mirror: (entity: UnsavedEntity) => Promise<void> = async () => {}
) {
  return {
    "field-group": { create, mirror },
    collection: {
      create: vi.fn(async (_payload: CreateCollectionPayload) => ({})),
      mirror: vi.fn(async (_entity: UnsavedEntity) => {}),
    },
  };
}

const field = (over: Partial<FieldDefinition>): FieldDefinition =>
  ({ name: "f", type: "text", ...over }) as FieldDefinition;

afterEach(() => {
  refusals = {};
  for (const address of ["hero", "banner", "promo", "cards"]) {
    removeUnsavedEntity("field-group", address);
  }
  for (const address of ["authors", "tags", "posts"]) {
    removeUnsavedEntity("collection", address);
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

  it("creates a group a used group names before the group that names it, and ends on a loop", () => {
    const hero = {
      ...group("hero", POSTS),
      fields: [
        field({ name: "badge", type: "component", component: "banner" }),
      ],
    };
    const banner = {
      ...group("banner"),
      // Names back to the group naming it: each is visited once.
      fields: [field({ name: "back", type: "component", component: "hero" })],
    };
    const fields = [
      field({ name: "hero", type: "component", component: "hero" }),
    ];

    const { used } = fieldGroupsFirst([hero, banner], fields, POSTS);

    expect(used.map(g => g.address)).toEqual(["banner", "hero"]);
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

  it("finds the unsaved collections a host's links name, beside its field groups, in field order", () => {
    const held = [
      group("hero", POSTS),
      collection("authors", POSTS),
      collection("tags"),
    ];
    const fields = [
      field({ name: "author", type: "relationship", relationTo: "authors" }),
      field({
        name: "layout",
        type: "group",
        fields: [
          field({ name: "hero", type: "component", component: "hero" }),
          // A link to several: each unsaved one it names, in its order.
          field({
            name: "related",
            type: "relationship",
            relationTo: ["media", "tags"],
          }),
        ],
      }),
    ];

    const { used } = fieldGroupsFirst(held, fields, POSTS);

    expect(used.map(e => `${e.kind}:${e.address}`)).toEqual([
      "collection:authors",
      "field-group:hero",
      "collection:tags",
    ]);
  });

  it("never lists the host as created before itself, though its links name it", () => {
    const held = [collection("posts")];
    const fields = [
      field({ name: "parent", type: "relationship", relationTo: "posts" }),
    ];

    expect(fieldGroupsFirst(held, fields, POSTS).used).toEqual([]);
  });

  it("does not take a field group's address named by a link, nor a collection's named by a field-group field", () => {
    const held = [group("authors"), collection("hero")];
    const fields = [
      field({ name: "author", type: "relationship", relationTo: "authors" }),
      field({ name: "hero", type: "component", component: "hero" }),
    ];

    expect(fieldGroupsFirst(held, fields, POSTS).used).toEqual([]);
  });

  it("creates what an unsaved entity needs before it, though only it is named by the host", () => {
    const hero = {
      ...group("hero", POSTS),
      fields: [
        field({ name: "by", type: "relationship", relationTo: "authors" }),
      ],
    };
    const held = [hero, collection("authors", POSTS), collection("tags")];
    const fields = [
      field({ name: "hero", type: "component", component: "hero" }),
    ];

    const { used, unused } = fieldGroupsFirst(held, fields, POSTS);

    // The collection the field group links to is created before it, and is
    // not let go as unused: a field the save creates needs it.
    expect(used.map(e => `${e.kind}:${e.address}`)).toEqual([
      "collection:authors",
      "field-group:hero",
    ]);
    expect(unused).toEqual([]);
  });

  it("creates each once, however many need it, and stops at a loop", () => {
    const hero = {
      ...group("hero"),
      fields: [
        field({ name: "inner", type: "component", component: "banner" }),
      ],
    };
    const banner = {
      ...group("banner"),
      fields: [field({ name: "back", type: "component", component: "hero" })],
    };
    const fields = [
      field({ name: "a", type: "component", component: "hero" }),
      field({ name: "b", type: "component", component: "banner" }),
    ];

    const { used } = fieldGroupsFirst([hero, banner], fields, POSTS);

    expect(used.map(e => e.address)).toEqual(["banner", "hero"]);
  });

  it("lets the host's own unused collections go too", () => {
    const held = [collection("authors", POSTS), collection("tags", POSTS)];
    const fields = [
      field({ name: "author", type: "relationship", relationTo: "authors" }),
    ];

    const { unused } = fieldGroupsFirst(held, fields, POSTS);

    expect(unused.map(e => `${e.kind}:${e.address}`)).toEqual([
      "collection:tags",
    ]);
  });
});

describe("createFieldGroupsFirst", () => {
  it("creates each after checking its address again, letting it go from the unsaved ones", async () => {
    addUnsavedEntity(group("hero", POSTS));
    addUnsavedEntity(group("banner", POSTS));
    const create = vi.fn(async (_payload: CreateComponentPayload) => ({}));

    const refused = await createFieldGroupsFirst(
      [group("hero", POSTS), group("banner", POSTS)],
      creators(create)
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

    await createFieldGroupsFirst(
      [group("hero", POSTS)],
      creators(create, mirror)
    );

    expect(order).toEqual(["create hero", "write hero"]);
    expect(unsavedEntity("field-group", "hero")).toBeUndefined();
  });

  it("writes no definition for a group refused before its create", async () => {
    addUnsavedEntity(group("hero", POSTS));
    refusals = {
      hero: { code: "DUPLICATE", message: "Resource already exists." },
    };
    const mirror = vi.fn(async () => {});

    await createFieldGroupsFirst(
      [group("hero", POSTS)],
      creators(
        vi.fn(async () => ({})),
        mirror
      )
    );

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
      creators(create)
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

    const refused = await createFieldGroupsFirst(
      [group("hero", POSTS)],
      creators(create)
    );

    expect(refused).toBe(
      "The field group “Hero” was not created: The server is unavailable."
    );
    expect(unsavedEntity("field-group", "hero")).toBeDefined();
  });

  it("creates a collection with its own create, in turn with the field groups", async () => {
    addUnsavedEntity(collection("authors", POSTS));
    addUnsavedEntity(group("hero", POSTS));
    const order: string[] = [];
    const mirror = (entity: UnsavedEntity) => {
      order.push(`write ${entity.kind}:${entity.address}`);
      return Promise.resolve();
    };
    const create = {
      "field-group": {
        create: vi.fn(async (payload: CreateComponentPayload) => {
          order.push(`field-group:${payload.slug}`);
        }),
        mirror,
      },
      collection: {
        create: vi.fn(async (payload: CreateCollectionPayload) => {
          order.push(`collection:${payload.name}`);
        }),
        mirror,
      },
    };

    const refused = await createFieldGroupsFirst(
      [collection("authors", POSTS), group("hero", POSTS)],
      create
    );

    expect(refused).toBeNull();
    // Each written by its own kind's write, after its create.
    expect(order).toEqual([
      "collection:authors",
      "write collection:authors",
      "field-group:hero",
      "write field-group:hero",
    ]);
    expect(create.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "authors",
        labels: { singular: "Authors", plural: "Authors" },
        fields: [],
      })
    );
    expect(unsavedEntity("collection", "authors")).toBeUndefined();
    expect(unsavedEntity("field-group", "hero")).toBeUndefined();
  });

  it("names a refused collection as a collection, and creates nothing after it", async () => {
    addUnsavedEntity(collection("authors", POSTS));
    addUnsavedEntity(group("hero", POSTS));
    const fieldGroup = vi.fn(async (_payload: CreateComponentPayload) => ({}));
    const collectionMirror = vi.fn(async (_entity: UnsavedEntity) => {});
    const create = {
      "field-group": { create: fieldGroup, mirror: async () => {} },
      collection: {
        create: vi.fn(async (_payload: CreateCollectionPayload) => {
          throw new Error("The server is unavailable.");
        }),
        mirror: collectionMirror,
      },
    };

    const refused = await createFieldGroupsFirst(
      [collection("authors", POSTS), group("hero", POSTS)],
      create
    );

    expect(refused).toBe(
      "The collection “Authors” was not created: The server is unavailable."
    );
    expect(fieldGroup).not.toHaveBeenCalled();
    expect(collectionMirror).not.toHaveBeenCalled();
    expect(unsavedEntity("collection", "authors")).toBeDefined();
    expect(unsavedEntity("field-group", "hero")).toBeDefined();
  });
});
