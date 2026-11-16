/**
 * What an editor's save needs of the field groups not saved yet: the ones its
 * fields use, for the review and the save to create first, and the ones its
 * picker made, for the save and Discard all to let go.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook as renderBare, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "@admin/__tests__/utils";
import type { BuilderField } from "@admin/components/features/schema-builder/types";

/** Each create, in the order made, as "kind:address". */
const { createGroup, createCollection, created } = vi.hoisted(() => {
  const created: string[] = [];
  return {
    created,
    createGroup: vi.fn(async (payload: { slug: string }) => {
      created.push(`field-group:${payload.slug}`);
      return { slug: payload.slug };
    }),
    createCollection: vi.fn(async (payload: { name: string }) => {
      created.push(`collection:${payload.name}`);
      return { message: "Created." };
    }),
  };
});
vi.mock("@admin/services/fieldGroupApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/fieldGroupApi")>()),
  fieldGroupApi: { create: createGroup },
}));
vi.mock("@admin/services/collectionApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/collectionApi")>()),
  collectionApi: { create: createCollection },
}));
const { writeFieldGroup, writeCollection } = vi.hoisted(() => ({
  writeFieldGroup: vi.fn(async () => ({})),
  writeCollection: vi.fn(async () => ({})),
}));
vi.mock("@admin/services/schemaFileApi", () => ({
  schemaFileApi: { writeFieldGroup, writeCollection },
}));
vi.mock("@admin/services/addressCheckApi", () => ({
  addressCheckApi: {
    check: async (kind: string, address: string) => ({
      kind,
      address,
      refusal: null,
    }),
  },
}));

import {
  addUnsavedEntity,
  removeUnsavedEntity,
  unsavedEntity,
  type UnsavedEntity,
} from "@admin/lib/builder/unsaved-entities";

import type { BuilderPendingChanges } from "../useBuilderEntityState";
import {
  useDiscardLetsGoOwned,
  useFieldGroupsFirst,
} from "../useFieldGroupsFirst";

const POSTS = { kind: "collection" as const, address: "posts" };

/** The hook under the query client its create mutation reads. */
function renderHook<T>(hook: () => T) {
  const client = createTestQueryClient();
  return renderBare(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

function group(
  address: string,
  label: string,
  ownedBy?: UnsavedEntity["ownedBy"]
): UnsavedEntity {
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

/** An unsaved collection a template's link needs, as "Create it too" makes one. */
function collection(
  address: string,
  label: string,
  ownedBy?: UnsavedEntity["ownedBy"]
): UnsavedEntity {
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

const usesHero = [
  { id: "1", name: "hero", type: "component", component: "hero" },
] as BuilderField[];

afterEach(() => {
  createGroup.mockClear();
  createCollection.mockClear();
  writeFieldGroup.mockClear();
  writeCollection.mockClear();
  created.length = 0;
  for (const address of ["hero", "promo", "banner"]) {
    removeUnsavedEntity("field-group", address);
  }
  for (const address of ["authors", "tags"]) {
    removeUnsavedEntity("collection", address);
  }
});

describe("useFieldGroupsFirst", () => {
  it("lists the ones the fields use, kept current with the unsaved ones", async () => {
    addUnsavedEntity(group("hero", "Hero", POSTS));
    const { result } = renderHook(() =>
      useFieldGroupsFirst(POSTS.kind, POSTS.address, usesHero)
    );
    expect(result.current.creates).toEqual([
      { kind: "field-group", address: "hero", label: "Hero" },
    ]);

    act(() => removeUnsavedEntity("field-group", "hero"));
    await waitFor(() => expect(result.current.creates).toEqual([]));
  });

  it("creates the ones the fields use, through the field group create", async () => {
    addUnsavedEntity(group("hero", "Hero", POSTS));
    addUnsavedEntity(group("promo", "Promo", POSTS));
    const { result } = renderHook(() =>
      useFieldGroupsFirst(POSTS.kind, POSTS.address, usesHero)
    );

    let refused: string | null = "not run";
    await act(async () => {
      refused = (await result.current.fieldGroupsFirst?.create()) ?? null;
    });

    expect(refused).toBeNull();
    expect(createGroup.mock.calls.map(([payload]) => payload.slug)).toEqual([
      "hero",
    ]);
    // Written to the schema file, as a field group's own first save writes it.
    expect(writeFieldGroup).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "hero" })
    );
    expect(unsavedEntity("field-group", "hero")).toBeUndefined();
    expect(unsavedEntity("field-group", "promo")).toBeDefined();
  });

  it("has nothing for the save to do where no unsaved field group is the host's or used", () => {
    addUnsavedEntity(group("banner", "Banner"));
    const { result } = renderHook(() =>
      useFieldGroupsFirst(POSTS.kind, POSTS.address, [])
    );
    expect(result.current.creates).toEqual([]);
    expect(result.current.fieldGroupsFirst).toBeUndefined();
  });

  it("hands the save the host's unused ones to let go, with nothing to create", () => {
    addUnsavedEntity(group("promo", "Promo", POSTS));
    const { result } = renderHook(() =>
      useFieldGroupsFirst(POSTS.kind, POSTS.address, [])
    );
    expect(result.current.fieldGroupsFirst?.creates).toEqual([]);
    act(() => result.current.fieldGroupsFirst?.letGoUnused?.());
    expect(unsavedEntity("field-group", "promo")).toBeUndefined();
  });

  it("releases the host's ones when its editor goes, however it is left", () => {
    addUnsavedEntity(group("hero", "Hero", POSTS));
    const { unmount } = renderHook(() =>
      useFieldGroupsFirst(POSTS.kind, POSTS.address, [])
    );

    unmount();

    // Kept, with what it was made with, only no longer the host's.
    expect(unsavedEntity("field-group", "hero")).toEqual(
      expect.objectContaining({
        address: "hero",
        fields: [],
        settings: expect.objectContaining({ singularName: "Hero" }),
      })
    );
    expect(unsavedEntity("field-group", "hero")?.ownedBy).toBeUndefined();
  });

  it("releases the host's ones when it is left, each kept as one of its own", () => {
    addUnsavedEntity(group("hero", "Hero", POSTS));
    const { result } = renderHook(() =>
      useFieldGroupsFirst(POSTS.kind, POSTS.address, usesHero)
    );

    act(() => result.current.release());

    expect(unsavedEntity("field-group", "hero")).toEqual(
      expect.objectContaining({ address: "hero", fields: [] })
    );
    expect(unsavedEntity("field-group", "hero")?.ownedBy).toBeUndefined();
  });

  it("lets go of the host's own unused ones after a save, and only those", () => {
    addUnsavedEntity(group("hero", "Hero", POSTS));
    addUnsavedEntity(group("promo", "Promo", POSTS));
    addUnsavedEntity(group("banner", "Banner"));
    const { result } = renderHook(() =>
      useFieldGroupsFirst(POSTS.kind, POSTS.address, usesHero)
    );

    act(() => result.current.letGoUnused());

    expect(unsavedEntity("field-group", "promo")).toBeUndefined();
    expect(unsavedEntity("field-group", "hero")).toBeDefined();
    expect(unsavedEntity("field-group", "banner")).toBeDefined();
  });

  it("lets go of every one the host's picker made when its changes are discarded", () => {
    addUnsavedEntity(group("hero", "Hero", POSTS));
    addUnsavedEntity(group("promo", "Promo", POSTS));
    addUnsavedEntity(group("banner", "Banner"));
    const { result } = renderHook(() =>
      useFieldGroupsFirst(POSTS.kind, POSTS.address, usesHero)
    );

    act(() => result.current.letGoOwned());

    expect(unsavedEntity("field-group", "hero")).toBeUndefined();
    expect(unsavedEntity("field-group", "promo")).toBeUndefined();
    expect(unsavedEntity("field-group", "banner")).toBeDefined();
  });

  it("lists and creates the unsaved collections the fields link to, in field order with the field groups", async () => {
    addUnsavedEntity(collection("authors", "Authors", POSTS));
    addUnsavedEntity(group("hero", "Hero", POSTS));
    const fields = [
      { id: "1", name: "author", type: "relationship", relationTo: "authors" },
      { id: "2", name: "hero", type: "component", component: "hero" },
    ] as BuilderField[];
    const { result } = renderHook(() =>
      useFieldGroupsFirst(POSTS.kind, POSTS.address, fields)
    );
    expect(result.current.creates).toEqual([
      { kind: "collection", address: "authors", label: "Authors" },
      { kind: "field-group", address: "hero", label: "Hero" },
    ]);

    let refused: string | null = "not run";
    await act(async () => {
      refused = (await result.current.fieldGroupsFirst?.create()) ?? null;
    });

    expect(refused).toBeNull();
    expect(created).toEqual(["collection:authors", "field-group:hero"]);
    // Written to the schema file, as a collection's own first save writes it.
    expect(writeCollection).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "authors" })
    );
    expect(unsavedEntity("collection", "authors")).toBeUndefined();
  });

  it("lets go of, or releases, the host's own collections as its field groups", () => {
    addUnsavedEntity(collection("authors", "Authors", POSTS));
    addUnsavedEntity(collection("tags", "Tags", POSTS));
    const { result } = renderHook(() =>
      useFieldGroupsFirst(POSTS.kind, POSTS.address, [])
    );

    act(() => result.current.release());
    expect(unsavedEntity("collection", "authors")?.ownedBy).toBeUndefined();

    // Held again as the host's, then its changes discarded.
    act(() => {
      for (const address of ["authors", "tags"]) {
        removeUnsavedEntity("collection", address);
      }
      addUnsavedEntity(collection("authors", "Authors", POSTS));
      addUnsavedEntity(collection("tags", "Tags", POSTS));
    });
    act(() => result.current.letGoOwned());
    expect(unsavedEntity("collection", "authors")).toBeUndefined();
    expect(unsavedEntity("collection", "tags")).toBeUndefined();
  });
});

describe("useDiscardLetsGoOwned", () => {
  it("lets go of the host's picker-made groups, then discards its changes", () => {
    const order: string[] = [];
    const pending = {
      discardAll: () => order.push("discard the host's changes"),
    } as unknown as BuilderPendingChanges;
    const letGoOwned = () => order.push("let go of its groups");
    const { result } = renderHook(() =>
      useDiscardLetsGoOwned(pending, letGoOwned)
    );

    act(() => result.current.discardAll());

    expect(order).toEqual([
      "let go of its groups",
      "discard the host's changes",
    ]);
  });
});
