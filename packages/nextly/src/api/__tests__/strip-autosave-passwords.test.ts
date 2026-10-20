/**
 * A recovery point keeps no password values, and is refused rather than stored
 * when the schema that says which fields are passwords cannot be read.
 *
 * REST's autosave and the plugin service's both store through this one
 * function, so what it leaves out is what every door leaves out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCollection = vi.fn();
const getSingleBySlug = vi.fn();
const getComponentFields = vi.fn();
let dataServiceWired = true;

vi.mock("../../di", () => ({
  getService: vi.fn((name: string) =>
    name === "singleRegistryService" ? { getSingleBySlug } : { getCollection }
  ),
}));

vi.mock("../../di/container", () => ({
  container: {
    has: vi.fn(() => dataServiceWired),
    get: vi.fn(() => ({ getComponentFields })),
  },
}));

import { stripAutosavePasswords } from "../versions-access";

beforeEach(() => {
  vi.clearAllMocks();
  dataServiceWired = true;
  getComponentFields.mockResolvedValue(null);
});

describe("stripAutosavePasswords", () => {
  it("leaves out a password value and keeps every other field", async () => {
    getCollection.mockResolvedValue({
      fields: [
        { type: "text", name: "title" },
        { type: "password", name: "pin" },
      ],
    });
    const snapshot = { title: "typing", pin: "4321" };

    await stripAutosavePasswords("collection", "notes", snapshot);

    expect(snapshot).toEqual({ title: "typing" });
  });

  it("leaves out a password declared inside a referenced component", async () => {
    getCollection.mockResolvedValue({
      fields: [{ type: "component", name: "hero", component: "hero" }],
    });
    getComponentFields.mockImplementation(async (slug: string) =>
      slug === "hero"
        ? [
            { type: "text", name: "heading" },
            { type: "password", name: "code" },
          ]
        : null
    );
    const snapshot = { hero: { heading: "Hi", code: "9999" } };

    await stripAutosavePasswords("collection", "notes", snapshot);

    expect(snapshot).toEqual({ hero: { heading: "Hi" } });
  });

  it("refuses when the fields cannot be read", async () => {
    getCollection.mockRejectedValue(new Error("registry down"));
    const snapshot = { pin: "4321" };

    await expect(
      stripAutosavePasswords("collection", "notes", snapshot)
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("refuses when the collection is not there, rather than finding no fields", async () => {
    // A missing entity is not one with no fields: nothing says which values are
    // passwords, so the snapshot is not kept.
    getCollection.mockResolvedValue(null);

    await expect(
      stripAutosavePasswords("collection", "gone", { pin: "4321" })
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("refuses when the Single is not there, rather than finding no fields", async () => {
    getSingleBySlug.mockResolvedValue(null);

    await expect(
      stripAutosavePasswords("single", "gone", { pin: "4321" })
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("keeps a Single that is there and has no fields of its own", async () => {
    // The control: an entity whose identity columns alone form a document
    // has nothing to strip, and is kept.
    getSingleBySlug.mockResolvedValue({ fields: [] });
    const snapshot = { id: "s1" };

    await stripAutosavePasswords("single", "bare", snapshot);

    expect(snapshot).toEqual({ id: "s1" });
  });

  it("refuses when a referenced component's fields cannot be read at all", async () => {
    dataServiceWired = false;
    getCollection.mockResolvedValue({
      fields: [{ type: "component", name: "hero", component: "hero" }],
    });

    await expect(
      stripAutosavePasswords("collection", "notes", { hero: { code: "9" } })
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("leaves a page's snapshot as it is: a page holds blocks, not fields", async () => {
    const snapshot = { blocks: [{ pin: "4321" }] };

    await stripAutosavePasswords("page", "home", snapshot);

    expect(snapshot).toEqual({ blocks: [{ pin: "4321" }] });
    expect(getCollection).not.toHaveBeenCalled();
  });
});
