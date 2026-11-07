/**
 * `media.findByIDs` reads several files in one query and is judged exactly
 * as `media.findByID` judges one: for every caller, the batch answers what
 * the single read answers for each of its ids, and refuses whom it refuses,
 * with the same error.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { pdfDocument } from "../../services/upload-validation/__tests__/format-fixtures";
import { Nextly } from "../nextly";

import { account, role, seedPermissions } from "./checked-access-fixtures";

/** What a read answered: the files' ids and addresses, or the refusal. */
async function outcome<T>(
  read: () => Promise<T>
): Promise<
  | { readonly value: T }
  | { readonly code: unknown; readonly statusCode: unknown }
> {
  try {
    return { value: await read() };
  } catch (error) {
    const { code, statusCode } = error as {
      code?: unknown;
      statusCode?: unknown;
    };
    return { code, statusCode };
  }
}

/** A file as a test compares it: what a page draws it by. */
function drawn(
  file: { id: string; url: string; altText?: string | null } | null
) {
  return file === null
    ? null
    : { id: file.id, url: file.url, altText: file.altText ?? null };
}

describe.each(getConfiguredTestDialects())(
  "reading several media files by id (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let ids: string[];
    let readerId: string;
    let lackerId: string;

    beforeAll(async () => {
      t = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      trusted = new Nextly();
      await seedPermissions(t);
      await account(t, "owner@example.com");
      readerId = await account(t, "reader@example.com", [
        await role(t, "media-readers", ["read-media"]),
      ]);
      // No role at all: a person, signed in, granted nothing.
      lackerId = await account(t, "lacker@example.com");
      ids = [];
      for (const name of ["one", "two", "three"]) {
        const data = pdfDocument(name);
        const uploaded = await trusted.media.upload({
          file: {
            data,
            name: `${name}.pdf`,
            mimetype: "application/pdf",
            size: data.length,
          },
          altText: `${name} alt`,
        });
        ids.push(uploaded.id);
      }
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    const callers: [string, () => Nextly][] = [
      ["trusted server code", () => trusted],
      [
        "a person who may read media",
        () => new Nextly({ overrideAccess: false, user: { id: readerId } }),
      ],
      [
        "a person who may not",
        () => new Nextly({ overrideAccess: false, user: { id: lackerId } }),
      ],
      [
        "a checked call naming nobody",
        () => new Nextly({ overrideAccess: false }),
      ],
    ];

    it.each(callers)(
      "answers %s as the single read does, id by id",
      async (_who, as) => {
        const caller = as();
        const missing = "00000000-0000-4000-8000-00000000dead";
        const asked = [ids[1] ?? "", missing, ids[0] ?? "", ids[1] ?? ""];
        const batch = await outcome(async () =>
          (await caller.media.findByIDs({ ids: asked })).map(drawn)
        );
        const singles = await outcome(async () => {
          const found = [];
          for (const id of new Set(asked)) {
            const file = await caller.media.findByID({
              id,
              disableErrors: true,
            });
            if (file !== null) found.push(drawn(file));
          }
          return found;
        });
        expect(batch).toEqual(singles);
        // CONTROL: the comparison saw files where the caller may read them,
        // and a refusal where it may not, so neither side is empty for free.
        if ("value" in singles) {
          expect(singles.value.map(file => file?.id)).toEqual([ids[1], ids[0]]);
        } else {
          expect(typeof singles.code).toBe("string");
        }
      }
    );

    it("refuses more ids than one read takes, reading nothing", async () => {
      const many = Array.from(
        { length: 101 },
        (_, index) => `id-${String(index)}`
      );
      await expect(
        trusted.media.findByIDs({ ids: many })
      ).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    });
  }
);
