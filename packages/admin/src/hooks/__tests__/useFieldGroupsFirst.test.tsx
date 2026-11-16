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

const { createGroup } = vi.hoisted(() => ({
  createGroup: vi.fn(async (payload: { slug: string }) => ({
    slug: payload.slug,
  })),
}));
vi.mock("@admin/services/fieldGroupApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/fieldGroupApi")>()),
  fieldGroupApi: { create: createGroup },
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

import { useFieldGroupsFirst } from "../useFieldGroupsFirst";

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
    settings: { singularName: label, slug: address, icon: "Box" },
    fields: [],
    ...(ownedBy ? { ownedBy } : {}),
  };
}

const usesHero = [
  { id: "1", name: "hero", type: "component", component: "hero" },
] as BuilderField[];

afterEach(() => {
  createGroup.mockClear();
  for (const address of ["hero", "promo", "banner"]) {
    removeUnsavedEntity("field-group", address);
  }
});

describe("useFieldGroupsFirst", () => {
  it("lists the ones the fields use, kept current with the unsaved ones", async () => {
    addUnsavedEntity(group("hero", "Hero", POSTS));
    const { result } = renderHook(() => useFieldGroupsFirst(POSTS, usesHero));
    expect(result.current.creates).toEqual([
      { address: "hero", label: "Hero" },
    ]);

    act(() => removeUnsavedEntity("field-group", "hero"));
    await waitFor(() => expect(result.current.creates).toEqual([]));
  });

  it("creates the ones the fields use, through the field group create", async () => {
    addUnsavedEntity(group("hero", "Hero", POSTS));
    addUnsavedEntity(group("promo", "Promo", POSTS));
    const { result } = renderHook(() => useFieldGroupsFirst(POSTS, usesHero));

    let refused: string | null = "not run";
    await act(async () => {
      refused = (await result.current.fieldGroupsFirst?.create()) ?? null;
    });

    expect(refused).toBeNull();
    expect(createGroup.mock.calls.map(([payload]) => payload.slug)).toEqual([
      "hero",
    ]);
    expect(unsavedEntity("field-group", "hero")).toBeUndefined();
    expect(unsavedEntity("field-group", "promo")).toBeDefined();
  });

  it("has nothing for the save to do where the fields use none", () => {
    addUnsavedEntity(group("promo", "Promo", POSTS));
    const { result } = renderHook(() => useFieldGroupsFirst(POSTS, []));
    expect(result.current.creates).toEqual([]);
    expect(result.current.fieldGroupsFirst).toBeUndefined();
  });

  it("lets go of the host's own unused ones after a save, and only those", () => {
    addUnsavedEntity(group("hero", "Hero", POSTS));
    addUnsavedEntity(group("promo", "Promo", POSTS));
    addUnsavedEntity(group("banner", "Banner"));
    const { result } = renderHook(() => useFieldGroupsFirst(POSTS, usesHero));

    act(() => result.current.letGoUnused());

    expect(unsavedEntity("field-group", "promo")).toBeUndefined();
    expect(unsavedEntity("field-group", "hero")).toBeDefined();
    expect(unsavedEntity("field-group", "banner")).toBeDefined();
  });

  it("lets go of every one the host's picker made when its changes are discarded", () => {
    addUnsavedEntity(group("hero", "Hero", POSTS));
    addUnsavedEntity(group("promo", "Promo", POSTS));
    addUnsavedEntity(group("banner", "Banner"));
    const { result } = renderHook(() => useFieldGroupsFirst(POSTS, usesHero));

    act(() => result.current.letGoOwned());

    expect(unsavedEntity("field-group", "hero")).toBeUndefined();
    expect(unsavedEntity("field-group", "promo")).toBeUndefined();
    expect(unsavedEntity("field-group", "banner")).toBeDefined();
  });
});
