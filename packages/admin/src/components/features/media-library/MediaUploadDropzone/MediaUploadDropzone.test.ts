import { describe, it, expect } from "vitest";

import { describeFileError, buildQueueFromDrop } from "./index";

const MB = 1024 * 1024;

function makeFile(name: string, size: number): File {
  const file = new File(["x"], name, { type: "image/png" });
  // File size is read-only; tests only need the reported value, not content.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("describeFileError", () => {
  it("maps file-too-large to human copy with the formatted limit", () => {
    const message = describeFileError(
      { code: "file-too-large", message: "File is larger than 5242880 bytes" },
      5 * MB
    );
    expect(message).toBe("File is too large (max 5 MB)");
    expect(message).not.toContain("bytes");
  });

  it("maps file-invalid-type to human copy", () => {
    expect(
      describeFileError(
        { code: "file-invalid-type", message: "File type must be image/*" },
        5 * MB
      )
    ).toBe("File type is not supported");
  });

  it("maps too-many-files to the batch-cap copy", () => {
    expect(
      describeFileError(
        { code: "too-many-files", message: "Too many files" },
        5 * MB
      )
    ).toBe("Only 10 files can be uploaded at once");
  });

  it("falls through to the library message for unknown codes", () => {
    expect(
      describeFileError(
        { code: "custom-check", message: "Custom reason" },
        5 * MB
      )
    ).toBe("Custom reason");
  });
});

describe("buildQueueFromDrop", () => {
  it("uploads all accepted files and rows every client rejection with its reason", () => {
    const accepted = Array.from({ length: 9 }, (_, i) =>
      makeFile(`small-${i + 1}.png`, 100)
    );
    const rejections = [
      {
        file: makeFile("big.png", 7 * MB),
        errors: [
          {
            code: "file-too-large",
            message: "File is larger than 5242880 bytes",
          },
        ],
      },
    ];

    const { toUpload, failed } = buildQueueFromDrop(
      accepted,
      rejections,
      5 * MB,
      null
    );

    expect(toUpload).toHaveLength(9);
    expect(toUpload.every(row => row.status === "pending")).toBe(true);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      filename: "big.png",
      status: "rejected",
      error: "File is too large (max 5 MB)",
    });
    // Validation failures are real failures, not batch-cap skips
    expect(failed[0].skipped).toBeUndefined();
  });

  it("lets rejected files never consume batch-cap slots (mixed rejection + overflow)", () => {
    // 11 valid + 1 oversized: the cap applies to VALID files, so 10 upload,
    // 1 valid file is skipped, and the oversized one fails on its own row.
    // A rejected file "ahead of" valid files in the drop must not push a
    // valid file out of the batch.
    const accepted = Array.from({ length: 11 }, (_, i) =>
      makeFile(`valid-${i + 1}.png`, 100)
    );
    const rejections = [
      {
        file: makeFile("big.png", 7 * MB),
        errors: [{ code: "file-too-large", message: "" }],
      },
    ];

    const { toUpload, failed } = buildQueueFromDrop(
      accepted,
      rejections,
      5 * MB,
      null
    );

    expect(toUpload).toHaveLength(10);
    expect(failed).toHaveLength(2);
    expect(failed.filter(row => row.skipped)).toHaveLength(1);
    expect(failed.find(row => row.skipped)?.filename).toBe("valid-11.png");
    expect(failed.find(row => !row.skipped)?.filename).toBe("big.png");
  });

  it("snapshots the drop-time folder on every row", () => {
    const { toUpload, failed } = buildQueueFromDrop(
      [makeFile("a.png", 1)],
      [
        {
          file: makeFile("bad.exe", 1),
          errors: [{ code: "file-invalid-type", message: "" }],
        },
      ],
      5 * MB,
      "folder-123"
    );

    expect(toUpload[0].folderId).toBe("folder-123");
    expect(failed[0].folderId).toBe("folder-123");
  });

  it("takes the first 10 of an over-cap drop and marks the rest skipped", () => {
    const accepted = Array.from({ length: 14 }, (_, i) =>
      makeFile(`file-${i + 1}.png`, 100)
    );

    const { toUpload, failed } = buildQueueFromDrop(accepted, [], 5 * MB, null);

    expect(toUpload).toHaveLength(10);
    expect(toUpload.map(row => row.filename)).toEqual(
      accepted.slice(0, 10).map(f => f.name)
    );
    expect(failed).toHaveLength(4);
    expect(
      failed.every(row => row.status === "rejected" && row.skipped === true)
    ).toBe(true);
    expect(failed[0].error).toBe(
      "Skipped: only 10 files can be uploaded at once"
    );
  });

  it("produces no upload rows for an all-rejected drop", () => {
    const rejections = [
      {
        file: makeFile("bad.exe", 100),
        errors: [{ code: "file-invalid-type", message: "" }],
      },
    ];

    const { toUpload, failed } = buildQueueFromDrop(
      [],
      rejections,
      5 * MB,
      null
    );

    expect(toUpload).toHaveLength(0);
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toBe("File type is not supported");
  });

  it("assigns each row a unique id", () => {
    const accepted = Array.from({ length: 12 }, (_, i) =>
      makeFile(`f-${i}.png`, 1)
    );
    const { toUpload, failed } = buildQueueFromDrop(accepted, [], 5 * MB, null);
    const ids = [...toUpload, ...failed].map(row => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("joins multiple rejection reasons on one row", () => {
    const rejections = [
      {
        file: makeFile("bad.bmp", 20 * MB),
        errors: [
          { code: "file-invalid-type", message: "" },
          { code: "file-too-large", message: "" },
        ],
      },
    ];

    const { failed } = buildQueueFromDrop([], rejections, 10 * MB, null);
    expect(failed[0].error).toBe(
      "File type is not supported, File is too large (max 10 MB)"
    );
  });
});
