import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { ForeignKeySpec } from "../../schema/pipeline/diff/types";

import { dropOrder, type DropOrderMember } from "./collection-drop-order";

/** A key from `table`'s `column` to `target`'s id. */
function key(table: string, column: string, target: string): ForeignKeySpec {
  return {
    name: `fk_${table}_${column}`,
    columns: [column],
    referencesTable: target,
    referencesColumns: ["id"],
    onDelete: "restrict",
    onUpdate: "no action",
  };
}

const member = (
  slug: string,
  keys: ForeignKeySpec[] = []
): DropOrderMember => ({ slug, tableName: `dc_${slug}`, keys });

describe("dropOrder", () => {
  it("drops each collection after every member holding a key to it", () => {
    const members = [
      member("tags"),
      member("posts", [key("dc_posts", "tag", "dc_tags")]),
      member("comments", [key("dc_comments", "post", "dc_posts")]),
    ];

    expect(dropOrder(members).map(index => members[index].slug)).toEqual([
      "comments",
      "posts",
      "tags",
    ]);
  });

  it("keeps the order given where no key ties them, and ignores keys to tables outside the set and to a table's own", () => {
    const members = [
      member("a", [
        key("dc_a", "user", "users"),
        key("dc_a", "parent", "dc_a"),
      ]),
      member("b"),
    ];

    expect(dropOrder(members)).toEqual([0, 1]);
  });

  it("refuses members whose keys point at one another, naming the keys", () => {
    const members = [
      member("tags", [key("dc_tags", "featured", "dc_posts")]),
      member("posts", [key("dc_posts", "tag", "dc_tags")]),
      member("notes"),
    ];

    let refusal: unknown;
    try {
      dropOrder(members);
    } catch (error) {
      refusal = error;
    }

    expect(NextlyError.isConflict(refusal)).toBe(true);
    expect((refusal as NextlyError).publicMessage).toBe(
      `Nothing was deleted, because "tags", "posts" hold foreign keys to one another's tables ("fk_dc_tags_featured" on "dc_tags", "fk_dc_posts_tag" on "dc_posts"), so no order drops them. Remove one of those relationship fields, then delete them together.`
    );
  });
});
