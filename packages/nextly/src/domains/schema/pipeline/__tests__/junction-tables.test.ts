/**
 * Telling a relationship's junction table apart from a collection's own.
 *
 * A many-to-many field creates `<mainA>_<mainB>_<field>` with the pair sorted,
 * and that name carries a managed prefix like any other — so the only thing
 * separating it from a declared table is whether the schema declares it.
 *
 * Getting this wrong in either direction breaks the adoption path:
 * missing a real junction records it in the snapshot and the next diff drops
 * it, while claiming a declared table is one leaves it out of the snapshot but
 * still in the SQL, so the next `migrate:create` emits `CREATE TABLE` for a
 * table the baseline already built.
 */
import { describe, expect, it } from "vitest";

import {
  junctionTablesAmong,
  snapshotComparableTables,
} from "../managed-tables";

describe("junctionTablesAmong", () => {
  it("recognises the table a many-to-many field creates", () => {
    expect([
      ...junctionTablesAmong(["dc_posts", "dc_tags", "dc_posts_dc_tags_tags"]),
    ]).toEqual(["dc_posts_dc_tags_tags"]);
  });

  it("never calls a declared table a junction", () => {
    // A collection can resolve to this name through its slug or `dbName`. The
    // shape alone cannot tell it apart, which is why the declaration is asked.
    const live = ["dc_posts", "dc_tags", "dc_posts_dc_tags_archive"];
    const declared = new Set(live);

    expect([...junctionTablesAmong(live, declared)]).toEqual([]);
    expect(snapshotComparableTables(live, declared)).toEqual(live);
  });

  it("still finds a real junction beside a same-shaped declared table", () => {
    const live = [
      "dc_posts",
      "dc_tags",
      "dc_posts_dc_tags_archive", // declared
      "dc_posts_dc_tags_tags", // derived
    ];
    const declared = new Set([
      "dc_posts",
      "dc_tags",
      "dc_posts_dc_tags_archive",
    ]);

    expect([...junctionTablesAmong(live, declared)]).toEqual([
      "dc_posts_dc_tags_tags",
    ]);
  });

  it("leaves a companion to the predicate that already excludes it", () => {
    const live = ["dc_posts", "dc_posts_locales"];
    expect([...junctionTablesAmong(live)]).toEqual([]);
    expect(snapshotComparableTables(live)).toEqual(["dc_posts"]);
  });

  it("does not treat a table as its own junction", () => {
    expect([...junctionTablesAmong(["dc_posts"])]).toEqual([]);
  });

  it("takes a custom junction name the config states outright", () => {
    // A many-to-many field may carry `options.junctionTable`, and both
    // production naming sites use it verbatim rather than the generated
    // convention — so nothing about the name reveals what it is. Missed, it is
    // recorded as a first-class table and the next diff drops it, taking the
    // relationship rows.
    const live = ["dc_posts", "dc_tags", "dc_custom_link"];
    expect([...junctionTablesAmong(live, new Set(), new Set())]).toEqual([]);
    expect([
      ...junctionTablesAmong(live, new Set(), new Set(["dc_custom_link"])),
    ]).toEqual(["dc_custom_link"]);
    expect(
      snapshotComparableTables(live, new Set(), new Set(["dc_custom_link"]))
    ).toEqual(["dc_posts", "dc_tags"]);
  });
});
