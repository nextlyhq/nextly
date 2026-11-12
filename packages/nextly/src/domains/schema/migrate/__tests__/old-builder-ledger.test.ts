// How ledger rows stand beside the folder's old Schema Builder files. Each
// cell is one row of R-17's judgement; the control in each is the same file
// or row judged the other way.
import { describe, expect, it } from "vitest";

import {
  judgeOldBuilderLedger,
  type OldBuilderLedgerInput,
} from "../old-builder-ledger";

const OLD = "1730000000000_create_posts.sql";
const mark = (sha256: string, status: "applied" | "superseded" = "applied") =>
  ({ status, sha256 }) as const;

function judge(over: Partial<OldBuilderLedgerInput>) {
  return judgeOldBuilderLedger({
    oldBuilderFiles: [],
    partialBuilderFiles: [],
    namedByRows: new Set(),
    marks: new Map(),
    migrations: new Set(),
    ...over,
  });
}

describe("judgeOldBuilderLedger", () => {
  it("ignores an old file's rows and marks the file a row names", () => {
    const result = judge({
      oldBuilderFiles: [{ file: OLD, checksum: "a" }],
      namedByRows: new Set([OLD]),
    });
    expect([...result.ignoredRows]).toEqual([OLD]);
    expect(result.toMark).toEqual([{ file: OLD, checksum: "a" }]);
  });

  it("marks no old file that no row names", () => {
    const result = judge({ oldBuilderFiles: [{ file: OLD, checksum: "a" }] });
    expect([...result.ignoredRows]).toEqual([OLD]);
    expect(result.toMark).toEqual([]);
  });

  it("adds no mark where one with the same checksum stands", () => {
    const result = judge({
      oldBuilderFiles: [{ file: OLD, checksum: "a" }],
      namedByRows: new Set([OLD]),
      marks: new Map([[OLD, mark("a")]]),
    });
    expect(result.toMark).toEqual([]);
  });

  it("records the new checksum of a file edited within the signature", () => {
    const result = judge({
      oldBuilderFiles: [{ file: OLD, checksum: "b" }],
      namedByRows: new Set([OLD]),
      marks: new Map([[OLD, mark("a")]]),
    });
    expect(result.toMark).toEqual([{ file: OLD, checksum: "b" }]);
  });

  it("ignores the rows of a marked file gone from the folder", () => {
    const result = judge({ marks: new Map([[OLD, mark("a")]]) });
    expect([...result.ignoredRows]).toEqual([OLD]);
  });

  it("judges the rows of a file whose mark was withdrawn, once it is gone", () => {
    const result = judge({ marks: new Map([[OLD, mark("a", "superseded")]]) });
    expect([...result.ignoredRows]).toEqual([]);
  });

  it("names a marked file whose content changed out of the signature", () => {
    const result = judge({
      partialBuilderFiles: [{ file: OLD, lacks: ["scope"], checksum: "b" }],
      marks: new Map([[OLD, mark("a")]]),
    });
    expect(result.changed).toEqual([
      { file: OLD, change: "content", lacks: ["scope"] },
    ]);
    expect([...result.ignoredRows]).toEqual([]);
  });

  it("names the snapshot when the content is as marked", () => {
    const result = judge({
      partialBuilderFiles: [{ file: OLD, lacks: ["snapshot"], checksum: "a" }],
      marks: new Map([[OLD, mark("a")]]),
    });
    expect(result.changed).toEqual([
      { file: OLD, change: "snapshot", lacks: ["snapshot"] },
    ]);
  });

  // A ledger row names a migration by its group's name, which a dialect
  // variant shares with the base file. Where the folder still keeps a
  // migration of that name, the rows are that migration's: never ignored, and
  // a mark on the name is no longer the file's alone.
  it("ignores no rows of a marked name a kept migration claims", () => {
    const result = judge({
      marks: new Map([[OLD, mark("a")]]),
      migrations: new Set([OLD]),
    });
    expect([...result.ignoredRows]).toEqual([]);
    expect(result.changed).toEqual([
      { file: OLD, change: "variant", lacks: ["variant"] },
    ]);
  });

  it("names the variant when the content is as marked", () => {
    const result = judge({
      partialBuilderFiles: [{ file: OLD, lacks: ["variant"], checksum: "a" }],
      marks: new Map([[OLD, mark("a")]]),
      migrations: new Set([OLD]),
    });
    expect(result.changed).toEqual([
      { file: OLD, change: "variant", lacks: ["variant"] },
    ]);
    expect([...result.ignoredRows]).toEqual([]);
  });

  it("does not name a partial file no current mark names", () => {
    const result = judge({
      partialBuilderFiles: [{ file: OLD, lacks: ["scope"], checksum: "b" }],
      marks: new Map([[OLD, mark("a", "superseded")]]),
    });
    expect(result.changed).toEqual([]);
  });
});
