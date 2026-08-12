// Regression coverage for upload-field expansion on Singles.
//
// fetchMediaByIds used to run a raw `db.execute(sql...)`, which crashes on
// SQLite ("db.execute is not a function" — better-sqlite3's Drizzle handle
// exposes all()/run(), not execute()); the error was swallowed and every
// upload field expanded to null. The service now uses Drizzle's typed query
// builder (select().from(mediaTable).where(inArray(...))), which every
// dialect's handle supports. These tests run the expansion against a handle
// that — like better-sqlite3's — has NO execute() method, so a regression to
// raw execute fails them immediately.

import { describe, expect, it, vi } from "vitest";

import { getDialectTables } from "../../../database";
import type { FieldConfig } from "../../../collections/fields/types";
import { SingleQueryService } from "../services/single-query-service";

/**
 * These cover media expansion itself, not the trust bound, so they read as a
 * caller that narrowed nothing. Stated rather than defaulted: the parameter is
 * required precisely because "no bound" and "forgot the caller" want opposite
 * outcomes and look identical when omitted.
 */
const UNBOUNDED = { trusted: undefined } as const;

// absolutizeMediaUrls resolves the app base URL through the validated env,
// which unit tests don't populate; pin it like media-variant.test.ts does.
vi.mock("../../../shared/lib/get-base-url", () => ({
  getBaseUrl: () => "http://localhost:3000",
}));

type Row = Record<string, unknown>;

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Minimal builder-only Drizzle handle: select().from().where() resolves to
// rows, and there is deliberately no execute() property (the better-sqlite3
// shape that broke the old implementation).
function makeBuilderOnlyDb(rows: Row[]) {
  const from = vi.fn(() => ({ where: vi.fn(async () => rows) }));
  return { db: { select: vi.fn(() => ({ from })) }, from };
}

function makeService(db: unknown) {
  const adapter = {
    dialect: "sqlite",
    getCapabilities: () => ({ dialect: "sqlite" }),
    getDrizzle: () => db,
  };
  return new SingleQueryService(
    adapter as never,
    logger as never,
    {} as never,
    {} as never
  );
}

const uploadFields = [
  { name: "images", type: "upload", label: "Images" },
] as unknown as FieldConfig[];

describe("SingleQueryService.expandUploadFields — dialect-portable media fetch", () => {
  it("expands an upload field via the query builder on a handle without execute()", async () => {
    const { db, from } = makeBuilderOnlyDb([
      {
        id: "m1",
        file_name: "hero.png",
        mime_type: "image/png",
        url: "/uploads/hero.png",
      },
    ]);
    const service = makeService(db);

    const doc = { id: "s1", images: "m1" } as never;
    // Read the expanded field off the document's index signature rather than
    // asserting a shape onto SingleDocument: `images` is a user field, so the
    // document type says nothing about it.
    const expanded: Row = await service.expandUploadFields(
      doc,
      uploadFields,
      UNBOUNDED
    );
    const images = expanded.images as Row;

    // Surface the swallowed fetch error, if any, before asserting the shape.
    const firstError = logger.error.mock.calls[0]?.[1] as
      | { error?: Error }
      | undefined;
    if (firstError?.error) throw firstError.error;

    // The raw id is replaced by the fetched record, with snake_case columns
    // camelCased for the API response.
    expect(images).toMatchObject({
      id: "m1",
      fileName: "hero.png",
      mimeType: "image/png",
    });
    expect(String(images.url)).toContain("/uploads/hero.png");
    // No fetch error was swallowed (the old raw-execute path logged one and
    // nulled the field).
    expect(logger.error).not.toHaveBeenCalled();
    // The query targeted the dialect's registered media table.
    expect(from).toHaveBeenCalledWith(
      (getDialectTables("sqlite") as Record<string, unknown>).media
    );
  });

  it("raises instead of degrading a failed fetch into a null field", async () => {
    // Swallowing here is what made the original SQLite bug invisible: the
    // fetch threw, the catch returned [], and the upload field rendered as
    // null — indistinguishable from a document that references no media.
    const boom = new Error("connection terminated");
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.reject(boom)),
        })),
      })),
    };
    const service = makeService(db);

    await expect(
      service.expandUploadFields(
        { id: "s1", images: "m1" } as never,
        uploadFields,
        UNBOUNDED
      )
    ).rejects.toThrow();
  });

  it("returns the document unchanged when it references no media", async () => {
    const { db } = makeBuilderOnlyDb([]);
    const service = makeService(db);

    const doc = { id: "s1", images: null } as never;
    const expanded: Row = await service.expandUploadFields(
      doc,
      uploadFields,
      UNBOUNDED
    );

    expect(expanded.images).toBeNull();
  });
});
