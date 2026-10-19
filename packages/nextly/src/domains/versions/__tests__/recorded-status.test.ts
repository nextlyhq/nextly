/**
 * The status a version records: never "published" for a status it does not
 * know, "published" only when the document has none, and a value too long for
 * the column marked as shortened and reported once per document type.
 */
import { describe, expect, it, vi } from "vitest";

import { recordedStatus, STATUS_COLUMN_LENGTH } from "../recorded-status";

const ref = (slug: string) => ({
  scopeKind: "collection" as const,
  scopeSlug: slug,
  entryId: "e1",
});

describe("recordedStatus", () => {
  it("records a status it does not know as it is, never as published", () => {
    const report = vi.fn();
    expect(recordedStatus("archived", ref("posts"), report)).toBe("archived");
    expect(recordedStatus("in review", ref("posts"), report)).toBe("in review");
    expect(report).not.toHaveBeenCalled();
  });

  it("records the lifecycle's statuses as they are", () => {
    for (const status of ["draft", "published", "unpublished"]) {
      expect(recordedStatus(status, ref("posts"), vi.fn())).toBe(status);
    }
  });

  it("records a document with no status as published", () => {
    for (const absent of [undefined, null, ""]) {
      expect(recordedStatus(absent, ref("posts"), vi.fn())).toBe("published");
    }
  });

  it("marks a status too long for the column as shortened, and reports it once per document type", () => {
    const report = vi.fn();
    const long = "a".repeat(STATUS_COLUMN_LENGTH + 8);

    const recorded = recordedStatus(long, ref("notes"), report);

    expect(recorded).toHaveLength(STATUS_COLUMN_LENGTH);
    expect(recorded.endsWith("…")).toBe(true);
    expect(recorded.slice(0, -1)).toBe(long.slice(0, STATUS_COLUMN_LENGTH - 1));
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({
      scopeKind: "collection",
      scopeSlug: "notes",
      length: long.length,
    });

    // A second save of the same type does not report again; another type does.
    recordedStatus(long, ref("notes"), report);
    expect(report).toHaveBeenCalledTimes(1);
    recordedStatus(long, ref("memos"), report);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("records a status of exactly the column's width whole", () => {
    const exact = "b".repeat(STATUS_COLUMN_LENGTH);
    const report = vi.fn();
    expect(recordedStatus(exact, ref("posts"), report)).toBe(exact);
    expect(report).not.toHaveBeenCalled();
  });
});
