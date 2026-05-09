import { describe, expect, it } from "vitest";

import { mergeTemplateAttachments } from "../services/template-attachment-merge";

describe("mergeTemplateAttachments", () => {
  it("returns [] when both inputs are empty/null/undefined", () => {
    expect(mergeTemplateAttachments([], [])).toEqual([]);
    expect(mergeTemplateAttachments(null, null)).toEqual([]);
    expect(mergeTemplateAttachments(undefined, undefined)).toEqual([]);
    expect(mergeTemplateAttachments(null, undefined)).toEqual([]);
  });

  it("returns template defaults when call has none", () => {
    expect(
      mergeTemplateAttachments([{ mediaId: "m1" }, { mediaId: "m2" }], undefined)
    ).toEqual([{ mediaId: "m1" }, { mediaId: "m2" }]);
  });

  it("returns call attachments when template has no defaults", () => {
    expect(
      mergeTemplateAttachments(null, [{ mediaId: "c1" }, { mediaId: "c2" }])
    ).toEqual([{ mediaId: "c1" }, { mediaId: "c2" }]);
  });

  it("concatenates template + call when there are no overlaps", () => {
    expect(
      mergeTemplateAttachments(
        [{ mediaId: "t1" }, { mediaId: "t2" }],
        [{ mediaId: "c1" }]
      )
    ).toEqual([{ mediaId: "t1" }, { mediaId: "t2" }, { mediaId: "c1" }]);
  });

  it("per-send entry wins on mediaId conflict, preserving call's filename override", () => {
    const merged = mergeTemplateAttachments(
      [
        { mediaId: "shared", filename: "template.pdf" },
        { mediaId: "t2" },
      ],
      [
        { mediaId: "shared", filename: "call-override.pdf" },
        { mediaId: "c3" },
      ]
    );
    expect(merged).toEqual([
      { mediaId: "shared", filename: "call-override.pdf" },
      { mediaId: "t2" },
      { mediaId: "c3" },
    ]);
  });

  it("preserves template ordering and appends new call entries at the end", () => {
    const merged = mergeTemplateAttachments(
      [{ mediaId: "t1" }, { mediaId: "t2" }, { mediaId: "t3" }],
      [{ mediaId: "c1" }, { mediaId: "t2", filename: "newname.pdf" }]
    );
    expect(merged.map((a) => a.mediaId)).toEqual(["t1", "t2", "t3", "c1"]);
    expect(merged[1]).toEqual({ mediaId: "t2", filename: "newname.pdf" });
  });
});
