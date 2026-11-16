/**
 * Paging through the media library reads every file exactly once, on every
 * dialect, even when files share the value the list is sorted by.
 *
 * Files uploaded within one second share their upload time on MySQL, whose
 * `datetime` keeps whole seconds, and files of one size share their size. The
 * sort alone then leaves their order to the database, which may order them
 * differently for each page: one file shows on two pages and another on none,
 * and a caller paging to find a file, such as an import looking for the
 * identical image among same-named ones, misses it.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Nextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { pdfDocument } from "../../../services/upload-validation/__tests__/format-fixtures";

const PDF = pdfDocument("paged");
const FILES = 30;
const PAGE_SIZE = 7;

describe.each(getConfiguredTestDialects())(
  "paging through the media library (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let nextly: Nextly;
    const uploaded: string[] = [];

    beforeAll(async () => {
      t = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      nextly = new Nextly();
      for (let n = 0; n < FILES; n += 1) {
        const file = await nextly.media.upload({
          file: {
            data: PDF,
            name: `paged-${String(n)}.pdf`,
            mimetype: "application/pdf",
            size: PDF.length,
          },
        });
        uploaded.push(file.id);
      }
      // One upload time for all, as files uploaded within one second share
      // on MySQL.
      const when = new Date("2026-01-01T00:00:00.000Z");
      for (const id of uploaded) {
        await t.adapter.update(
          "media",
          { uploaded_at: when },
          { and: [{ column: "id", op: "=", value: id }] }
        );
      }
    });

    afterAll(async () => {
      await t?.destroy();
    });

    for (const sortBy of ["uploadedAt", "size"] as const) {
      for (const sortOrder of ["desc", "asc"] as const) {
        it(`lists each file once across the pages, by ${sortBy} ${sortOrder}`, async () => {
          const listed: string[] = [];
          for (let page = 1; page <= FILES; page += 1) {
            const found = await nextly.media.find({
              search: "paged",
              sortBy,
              sortOrder,
              limit: PAGE_SIZE,
              page,
            });
            listed.push(...found.items.map(item => String(item.id)));
            if (found.items.length < PAGE_SIZE) break;
          }

          expect([...listed].sort()).toEqual([...uploaded].sort());
        });
      }
    }
  }
);
