/**
 * The diff hydrator walks a computed diff tree and, through the access-checked
 * resolver, rewrites each relationship/upload value node to the value kit's
 * display shape and labels each many-relationship target. These tests drive it
 * with a mocked read so the walk, the in-place rewrite, and the access fallback
 * are pinned without a database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getEntrySpy } = vi.hoisted(() => ({ getEntrySpy: vi.fn() }));

vi.mock("../../../di", () => ({
  getService: vi.fn((name: string) => {
    if (name === "collectionsHandler") return { getEntry: getEntrySpy };
    return {};
  }),
}));

import type { FieldDiff } from "../diff/types";
import { hydrateDiffReferences } from "../diff-references";
import type { UserContext } from "../../singles/types";

const user = { id: "u1", roles: ["editor"] } as unknown as UserContext;

beforeEach(() => {
  vi.clearAllMocks();
  // Each read echoes the id back as a title, so a resolved value is recognisable.
  getEntrySpy.mockImplementation(({ entryId }: { entryId: string }) =>
    Promise.resolve({ success: true, data: { title: `T-${entryId}` } })
  );
});

describe("hydrateDiffReferences", () => {
  it("rewrites a single-relationship value node's before/after to { id, label }", async () => {
    const fields: FieldDiff[] = [
      {
        kind: "value",
        name: "author",
        label: "Author",
        type: "relationship",
        status: "changed",
        before: "a1",
        after: "a2",
        display: { relationTo: "authors" },
      },
    ];

    await hydrateDiffReferences(fields, user);

    const node = fields[0] as Extract<FieldDiff, { kind: "value" }>;
    expect(node.before).toEqual({ id: "a1", label: "T-a1" });
    expect(node.after).toEqual({ id: "a2", label: "T-a2" });
  });

  it("labels each target of a many-relationship set node", async () => {
    const fields: FieldDiff[] = [
      {
        kind: "set",
        name: "tags",
        label: "Tags",
        type: "relationship",
        status: "changed",
        added: [{ id: "t2" }],
        removed: [{ id: "t1" }],
        display: { relationTo: "tags", hasMany: true },
      },
    ];

    await hydrateDiffReferences(fields, user);

    const node = fields[0] as Extract<FieldDiff, { kind: "set" }>;
    expect(node.added[0]?.label).toBe("T-t2");
    expect(node.removed[0]?.label).toBe("T-t1");
  });

  it("resolves a polymorphic target against its own collection", async () => {
    const fields: FieldDiff[] = [
      {
        kind: "value",
        name: "subject",
        label: "Subject",
        type: "relationship",
        status: "added",
        before: null,
        after: { relationTo: "posts", value: "p9" },
        display: { relationTo: ["posts", "pages"] },
      },
    ];

    await hydrateDiffReferences(fields, user);

    expect(getEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "posts", entryId: "p9" })
    );
    const node = fields[0] as Extract<FieldDiff, { kind: "value" }>;
    expect(node.after).toEqual({
      relationTo: "posts",
      value: "p9",
      label: "T-p9",
    });
  });

  it("keeps the id when the target read is denied", async () => {
    getEntrySpy.mockResolvedValue({ success: false });
    const fields: FieldDiff[] = [
      {
        kind: "value",
        name: "author",
        label: "Author",
        type: "relationship",
        status: "unchanged",
        before: "a1",
        after: "a1",
        display: { relationTo: "authors" },
      },
    ];

    await hydrateDiffReferences(fields, user);

    const node = fields[0] as Extract<FieldDiff, { kind: "value" }>;
    expect(node.after).toEqual({ id: "a1", label: null });
  });

  it("descends into groups and list items", async () => {
    const fields: FieldDiff[] = [
      {
        kind: "group",
        name: "meta",
        label: "Meta",
        type: "group",
        status: "changed",
        fields: [
          {
            kind: "value",
            name: "owner",
            label: "Owner",
            type: "relationship",
            status: "added",
            before: null,
            after: "o1",
            display: { relationTo: "people" },
          },
        ],
      },
      {
        kind: "list",
        name: "blocks",
        label: "Blocks",
        type: "repeater",
        status: "changed",
        items: [
          {
            id: "row-1",
            status: "changed",
            fields: [
              {
                kind: "value",
                name: "link",
                label: "Link",
                type: "relationship",
                status: "added",
                before: null,
                after: "l1",
                display: { relationTo: "pages" },
              },
            ],
          },
        ],
      },
    ];

    await hydrateDiffReferences(fields, user);

    const group = fields[0] as Extract<FieldDiff, { kind: "group" }>;
    const owner = group.fields[0] as Extract<FieldDiff, { kind: "value" }>;
    expect(owner.after).toEqual({ id: "o1", label: "T-o1" });

    const list = fields[1] as Extract<FieldDiff, { kind: "list" }>;
    const link = list.items[0]?.fields[0] as Extract<
      FieldDiff,
      { kind: "value" }
    >;
    expect(link.after).toEqual({ id: "l1", label: "T-l1" });
  });

  it("does not read anything for a diff with no references", async () => {
    const fields: FieldDiff[] = [
      {
        kind: "value",
        name: "views",
        label: "Views",
        type: "number",
        status: "changed",
        before: 1,
        after: 2,
      },
    ];

    await hydrateDiffReferences(fields, user);

    expect(getEntrySpy).not.toHaveBeenCalled();
    const node = fields[0] as Extract<FieldDiff, { kind: "value" }>;
    expect(node.before).toBe(1);
    expect(node.after).toBe(2);
  });
});
