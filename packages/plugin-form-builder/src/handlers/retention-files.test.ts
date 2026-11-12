/**
 * The files retention frees: the ids a submission answered with under its
 * file fields; and of those, only the ones no remaining submission names and
 * nothing else uses are deleted, the rest kept, with a run the deadline stops
 * handing on where it got to.
 */
import { describe, expect, it, vi } from "vitest";

import type { AnyFormField } from "../types";

import {
  type FreeingDeps,
  fileIdsOf,
  freeFiles,
  SCAN_DONE,
} from "./retention-files";

const FIELDS: AnyFormField[] = [
  { type: "text", name: "name", label: "Name" },
  { type: "file", name: "cv", label: "CV" },
  { type: "file", name: "photos", label: "Photos", multiple: true },
];

describe("a submission's files", () => {
  it("are the ids under its file fields, one or several", () => {
    expect(
      fileIdsOf(FIELDS, { name: "media-1", cv: "m-cv", photos: ["m-a", "m-b"] })
    ).toEqual(["m-cv", "m-a", "m-b"]);
  });

  it("are read from answers stored as JSON text, and skip what is not an id", () => {
    expect(fileIdsOf(FIELDS, JSON.stringify({ cv: "", photos: [3] }))).toEqual(
      []
    );
    expect(fileIdsOf(FIELDS, JSON.stringify({ cv: "m-cv" }))).toEqual(["m-cv"]);
  });
});

function deps(
  remaining: Array<{ id: string; data: unknown }>,
  inUse: string[]
) {
  const deleted: string[] = [];
  return {
    deleted,
    value: {
      collections: {
        listEntries: vi.fn(
          async (
            _slug: string,
            options: { where?: Record<string, unknown> }
          ) => {
            const after = (options.where?.id as { greater_than?: string })
              ?.greater_than;
            return {
              data: remaining.filter(
                row => after === undefined || row.id > after
              ),
            };
          }
        ),
      },
      media: {
        isInUse: vi.fn(async (id: string) => inUse.includes(id)),
        delete: vi.fn(async (id: string) => {
          deleted.push(id);
        }),
      },
      submissionsSlug: "form-submissions",
    } as unknown as FreeingDeps,
  };
}

describe("freeing files", () => {
  it("deletes only what no submission names and nothing else uses", async () => {
    const { deleted, value } = deps(
      [{ id: "s2", data: { cv: "m-shared" } }],
      ["m-used"]
    );
    const later = new Date(Date.now() + 60_000);
    expect(
      await freeFiles(value, { files: ["m-free", "m-shared", "m-used"] }, later)
    ).toBe("done");
    expect(deleted).toEqual(["m-free"]);
  });

  it("hands on what is left when the deadline stops it", async () => {
    const { deleted, value } = deps([], []);
    expect(await freeFiles(value, { files: ["m-free"] }, new Date(0))).toEqual({
      files: ["m-free"],
    });
    expect(deleted).toEqual([]);
  });

  it("goes straight to freeing once the scan has read every submission", async () => {
    const { deleted, value } = deps([{ id: "s2", data: { cv: "m-free" } }], []);
    const later = new Date(Date.now() + 60_000);
    // Past the scan already: the remaining submission is not read again.
    await freeFiles(
      value,
      { files: ["m-free"], afterSubmission: SCAN_DONE },
      later
    );
    expect(deleted).toEqual(["m-free"]);
  });
});
