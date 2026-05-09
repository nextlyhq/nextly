import { describe, expect, it } from "vitest";

import { collectAttachmentInputs } from "../plugin";

describe("collectAttachmentInputs", () => {
  it("returns [] when no fields have attachToEmail", () => {
    const fields = [
      { type: "text", name: "fullName" },
      { type: "file", name: "resume" },
    ];
    const data = { fullName: "Alice", resume: "med_abc" };
    expect(collectAttachmentInputs(fields, data)).toEqual([]);
  });

  it("returns [] when no file fields exist", () => {
    const fields = [{ type: "text", name: "name" }];
    const data = { name: "Alice" };
    expect(collectAttachmentInputs(fields, data)).toEqual([]);
  });

  it("collects mediaId from a single-value file field", () => {
    const fields = [
      { type: "file", name: "resume", attachToEmail: true },
    ];
    const data = { resume: "med_abc" };
    expect(collectAttachmentInputs(fields, data)).toEqual([
      { mediaId: "med_abc" },
    ]);
  });

  it("collects multiple mediaIds from a multiple:true file field", () => {
    const fields = [
      { type: "file", name: "docs", multiple: true, attachToEmail: true },
    ];
    const data = { docs: ["med_1", "med_2", "med_3"] };
    expect(collectAttachmentInputs(fields, data)).toEqual([
      { mediaId: "med_1" },
      { mediaId: "med_2" },
      { mediaId: "med_3" },
    ]);
  });

  it("skips empty optional file fields silently", () => {
    const fields = [
      { type: "file", name: "optional_doc", attachToEmail: true },
    ];
    const data = { optional_doc: "" };
    expect(collectAttachmentInputs(fields, data)).toEqual([]);
  });

  it("skips undefined/null file field values", () => {
    const fields = [
      { type: "file", name: "missing", attachToEmail: true },
    ];
    const data = {};
    expect(collectAttachmentInputs(fields, data)).toEqual([]);
  });

  it("collects from multiple marked file fields into a flat array", () => {
    const fields = [
      { type: "file", name: "resume", attachToEmail: true },
      { type: "file", name: "cover", attachToEmail: true },
      { type: "file", name: "id_doc" }, // NOT marked
    ];
    const data = {
      resume: "med_a",
      cover: "med_b",
      id_doc: "med_c",
    };
    const result = collectAttachmentInputs(fields, data);
    expect(result).toEqual([
      { mediaId: "med_a" },
      { mediaId: "med_b" },
    ]);
  });

  it("skips non-string values in arrays", () => {
    const fields = [
      { type: "file", name: "docs", multiple: true, attachToEmail: true },
    ];
    const data = { docs: ["med_1", null, "", 42, "med_2"] };
    expect(collectAttachmentInputs(fields, data)).toEqual([
      { mediaId: "med_1" },
      { mediaId: "med_2" },
    ]);
  });
});
