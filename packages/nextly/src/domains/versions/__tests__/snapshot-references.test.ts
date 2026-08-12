/**
 * The snapshot hydrator walks a stored snapshot against its schema and, through
 * the access-checked resolver, rewrites each relationship/upload value to the
 * value kit's display shape in place — preserving cardinality and descending
 * containers. These tests drive it with a mocked read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getEntrySpy, checkAccessSpy, findByIdSpy } = vi.hoisted(() => ({
  getEntrySpy: vi.fn(),
  checkAccessSpy: vi.fn(),
  findByIdSpy: vi.fn(),
}));

vi.mock("../../../di", () => ({
  getService: vi.fn((name: string) => {
    if (name === "collectionsHandler") return { getEntry: getEntrySpy };
    if (name === "rbacAccessControlService") {
      return { checkAccess: checkAccessSpy };
    }
    if (name === "mediaService") return { findById: findByIdSpy };
    return {};
  }),
}));

// The system-resource read gate resolves RBAC from the container directly, so
// that it can be reached from a leaf module without pulling in the one that
// registers every service.
vi.mock("../../../di/container", () => ({
  container: {
    has: (name: string) => name === "rbacAccessControlService",
    get: (name: string) =>
      name === "rbacAccessControlService"
        ? { checkAccess: checkAccessSpy }
        : {},
  },
}));

import type { FieldConfig } from "../../../collections/fields/types";
import type { UserContext } from "../../singles/types";
import { hydrateSnapshotReferences } from "../snapshot-references";

const user = { id: "u1", roles: ["editor"] } as unknown as UserContext;

function fields(...defs: unknown[]): FieldConfig[] {
  return defs as FieldConfig[];
}

beforeEach(() => {
  vi.clearAllMocks();
  getEntrySpy.mockImplementation(({ entryId }: { entryId: string }) =>
    Promise.resolve({ success: true, data: { title: `T-${entryId}` } })
  );
  checkAccessSpy.mockResolvedValue(true);
  findByIdSpy.mockResolvedValue({
    originalFilename: "pic.png",
    filename: "abc.png",
    url: "/u",
    thumbnailUrl: "/t",
    mimeType: "image/png",
  });
});

describe("hydrateSnapshotReferences", () => {
  it("rewrites a single relationship to { id, label } in place", async () => {
    const snapshot: Record<string, unknown> = { author: "a1" };

    await hydrateSnapshotReferences(
      snapshot,
      fields({ name: "author", type: "relationship", relationTo: "authors" }),
      user
    );

    expect(snapshot.author).toEqual({ id: "a1", label: "T-a1" });
  });

  it("rewrites a many-relationship preserving the stored order", async () => {
    const snapshot: Record<string, unknown> = { tags: ["t1", "t2"] };

    await hydrateSnapshotReferences(
      snapshot,
      fields({
        name: "tags",
        type: "relationship",
        relationTo: "tags",
        hasMany: true,
      }),
      user
    );

    expect(snapshot.tags).toEqual([
      { id: "t1", label: "T-t1" },
      { id: "t2", label: "T-t2" },
    ]);
  });

  it("rewrites an upload to the media display shape after a read check", async () => {
    const snapshot: Record<string, unknown> = { cover: "m1" };

    await hydrateSnapshotReferences(
      snapshot,
      fields({ name: "cover", type: "upload" }),
      user
    );

    expect(checkAccessSpy).toHaveBeenCalled();
    expect(snapshot.cover).toEqual({
      id: "m1",
      originalFilename: "pic.png",
      filename: "abc.png",
      url: "/u",
      thumbnailUrl: "/t",
      mimeType: "image/png",
    });
  });

  it("resolves a polymorphic value against its own collection", async () => {
    const snapshot: Record<string, unknown> = {
      ref: { relationTo: "posts", value: "p1" },
    };

    await hydrateSnapshotReferences(
      snapshot,
      fields({
        name: "ref",
        type: "relationship",
        relationTo: ["posts", "pages"],
      }),
      user
    );

    expect(getEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "posts", entryId: "p1" })
    );
    expect(snapshot.ref).toEqual({
      relationTo: "posts",
      value: "p1",
      label: "T-p1",
    });
  });

  it("descends a nested group container", async () => {
    const snapshot: Record<string, unknown> = { meta: { owner: "o1" } };

    await hydrateSnapshotReferences(
      snapshot,
      fields({
        name: "meta",
        type: "group",
        fields: [{ name: "owner", type: "relationship", relationTo: "people" }],
      }),
      user
    );

    expect(snapshot.meta).toEqual({ owner: { id: "o1", label: "T-o1" } });
  });

  it("keeps the id when the target read is denied", async () => {
    getEntrySpy.mockResolvedValue({ success: false });
    const snapshot: Record<string, unknown> = { author: "a1" };

    await hydrateSnapshotReferences(
      snapshot,
      fields({ name: "author", type: "relationship", relationTo: "authors" }),
      user
    );

    expect(snapshot.author).toEqual({ id: "a1", label: null });
  });

  it("does nothing when the schema has no reference fields", async () => {
    const snapshot: Record<string, unknown> = { title: "Hello" };

    await hydrateSnapshotReferences(
      snapshot,
      fields({ name: "title", type: "text" }),
      user
    );

    expect(getEntrySpy).not.toHaveBeenCalled();
    expect(snapshot.title).toBe("Hello");
  });

  it("resolves a relationship inside a component instance", async () => {
    const snapshot: Record<string, unknown> = {
      blocks: [{ _componentType: "quote", cite: "a1" }],
    };

    await hydrateSnapshotReferences(
      snapshot,
      fields({
        name: "blocks",
        type: "component",
        componentSchemas: {
          quote: {
            fields: [
              { name: "cite", type: "relationship", relationTo: "authors" },
            ],
          },
        },
      }),
      user
    );

    expect((snapshot.blocks as unknown[])[0]).toEqual({
      _componentType: "quote",
      cite: { id: "a1", label: "T-a1" },
    });
  });

  it("leaves a protected component child as a bare id", async () => {
    const snapshot: Record<string, unknown> = {
      blocks: [{ _componentType: "quote", secret: "a1" }],
    };

    await hydrateSnapshotReferences(
      snapshot,
      fields({
        name: "blocks",
        type: "component",
        componentSchemas: {
          quote: {
            fields: [
              {
                name: "secret",
                type: "relationship",
                relationTo: "authors",
                // Redaction cannot evaluate a component child's read rule, so
                // hydration must not add a label the caller may not be allowed
                // to see.
                access: { read: () => false },
              },
            ],
          },
        },
      }),
      user
    );

    expect(getEntrySpy).not.toHaveBeenCalled();
    expect((snapshot.blocks as unknown[])[0]).toEqual({
      _componentType: "quote",
      secret: "a1",
    });
  });

  it("leaves a protected reference nested in a group inside a component as a bare id", async () => {
    const snapshot: Record<string, unknown> = {
      blocks: [{ _componentType: "quote", meta: { owner: "a1", tag: "t1" } }],
    };

    await hydrateSnapshotReferences(
      snapshot,
      fields({
        name: "blocks",
        type: "component",
        componentSchemas: {
          quote: {
            fields: [
              {
                name: "meta",
                type: "group",
                fields: [
                  {
                    name: "owner",
                    type: "relationship",
                    relationTo: "authors",
                    // Protected below a group inside a component: still not
                    // evaluable by redaction, so it must not be hydrated.
                    access: { read: () => false },
                  },
                  { name: "tag", type: "relationship", relationTo: "tags" },
                ],
              },
            ],
          },
        },
      }),
      user
    );

    // The unprotected sibling still resolves; only the protected one stays bare.
    expect((snapshot.blocks as unknown[])[0]).toEqual({
      _componentType: "quote",
      meta: { owner: "a1", tag: { id: "t1", label: "T-t1" } },
    });
  });

  it("descends a nameless presentational group", async () => {
    const snapshot: Record<string, unknown> = { owner: "o1" };

    await hydrateSnapshotReferences(
      snapshot,
      fields({
        type: "group",
        fields: [{ name: "owner", type: "relationship", relationTo: "people" }],
      }),
      user
    );

    expect(snapshot.owner).toEqual({ id: "o1", label: "T-o1" });
  });
});
