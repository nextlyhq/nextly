/**
 * The entities created in the Schema Builder and not saved yet. A new entity
 * lives here, and nowhere on the server, from Create until its save, its
 * Discard all, or a confirmed leave of its editor. The store belongs to the tab:
 * a reload or a second tab starts without it.
 */
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderHook } from "@admin/__tests__/utils";

import {
  addUnsavedEntity,
  removeUnsavedEntity,
  renameUnsavedEntity,
  subscribeUnsavedEntities,
  unsavedAddresses,
  unsavedEntity,
  useUnsavedEntity,
  type UnsavedEntity,
} from "../unsaved-entities";

/** An entity as it is added: the store gives it its token. */
type Added = Omit<UnsavedEntity, "token">;

const products: Added = {
  kind: "collection",
  address: "products",
  settings: {
    singularName: "Product",
    pluralName: "Products",
    slug: "products",
    icon: "Package",
  },
  fields: [],
};

const seo: Added = {
  kind: "field-group",
  address: "seo",
  settings: { singularName: "SEO", slug: "seo", icon: "" },
  fields: [],
};

afterEach(() => {
  removeUnsavedEntity("collection", "products");
  removeUnsavedEntity("field-group", "seo");
  removeUnsavedEntity("single", "home");
  removeUnsavedEntity("collection", "items");
});

describe("the unsaved-entity store", () => {
  it("holds a created entity until it is removed", () => {
    expect(addUnsavedEntity(products)).toBe(true);
    expect(unsavedEntity("collection", "products")).toEqual({
      ...products,
      token: expect.any(String),
    });
    removeUnsavedEntity("collection", "products");
    expect(unsavedEntity("collection", "products")).toBeUndefined();
  });

  it("keeps the first of two entities under one kind and address", () => {
    addUnsavedEntity(products);
    const other = {
      ...products,
      settings: { ...products.settings, singularName: "Item" },
    };
    expect(addUnsavedEntity(other)).toBe(false);
    expect(unsavedEntity("collection", "products")).toEqual({
      ...products,
      token: expect.any(String),
    });
  });

  it("lists each unsaved address as the address check counts it", () => {
    addUnsavedEntity(products);
    addUnsavedEntity(seo);
    expect(unsavedAddresses()).toEqual([
      { kind: "collection", address: "products" },
      { kind: "fieldGroup", address: "seo" },
    ]);
  });

  it("tells its readers when it changes, and only then", () => {
    const listener = vi.fn();
    const stop = subscribeUnsavedEntities(listener);
    addUnsavedEntity(products);
    removeUnsavedEntity("collection", "products");
    removeUnsavedEntity("collection", "products");
    stop();
    addUnsavedEntity(products);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("gives a reading component the entity as it comes and goes", () => {
    const { result } = renderHook(() => useUnsavedEntity("single", "home"));
    expect(result.current).toBeUndefined();
    const home: Added = {
      kind: "single",
      address: "home",
      settings: { singularName: "Home", slug: "home", icon: "Home" },
      fields: [],
    };
    act(() => {
      addUnsavedEntity(home);
    });
    expect(result.current).toEqual({ ...home, token: expect.any(String) });
    act(() => removeUnsavedEntity("single", "home"));
    expect(result.current).toBeUndefined();
  });
});

// Before its first save an entity's address can change. It moves with its
// settings' address, and keeps the token an editor knows it by.
describe("an unsaved entity's new address", () => {
  it("moves the entity, its settings' address with it, keeping its token", () => {
    addUnsavedEntity(products);
    const before = unsavedEntity("collection", "products");
    expect(renameUnsavedEntity("collection", "products", "items")).toBe(true);
    expect(unsavedEntity("collection", "products")).toBeUndefined();
    const after = unsavedEntity("collection", "items");
    expect(after?.address).toBe("items");
    expect(after?.settings.slug).toBe("items");
    expect(after?.settings.singularName).toBe("Product");
    expect(after?.token).toBe(before?.token);
  });

  it("gives each entity a token of its own", () => {
    addUnsavedEntity(products);
    addUnsavedEntity(seo);
    expect(unsavedEntity("collection", "products")?.token).not.toBe(
      unsavedEntity("field-group", "seo")?.token
    );
  });

  it("refuses a move onto an address another unsaved entity holds, losing neither", () => {
    addUnsavedEntity(products);
    addUnsavedEntity({ ...products, address: "items" });
    expect(renameUnsavedEntity("collection", "products", "items")).toBe(false);
    expect(unsavedEntity("collection", "products")?.address).toBe("products");
    expect(unsavedEntity("collection", "items")?.address).toBe("items");
  });

  it("refuses a move of nothing", () => {
    expect(renameUnsavedEntity("collection", "nothing", "items")).toBe(false);
    expect(unsavedEntity("collection", "items")).toBeUndefined();
  });
});
