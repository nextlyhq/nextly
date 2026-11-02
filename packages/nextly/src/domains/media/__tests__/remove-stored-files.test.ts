/**
 * What a media cleanup log may show of a failure: the file, never a secret
 * a signed or tokenized URL, or a message quoting one, can carry. And that
 * the search for files another item refers to still answers when the retired
 * `sizes` column is dropped between its check and its read.
 */
import { sql, type SQL } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import {
  errorForLog,
  filesKeptByOthers,
  storageReadingOf,
  storedPathForLog,
} from "../remove-stored-files";

/**
 * A storage that says neither where it serves a file nor its kind: these
 * cases are about the search, and read every record as such a storage would.
 */
const unread = storageReadingOf({});

describe("errorForLog", () => {
  it.each([
    [
      "a URL with credentials, a signed query and a fragment",
      "refused https://id:key-secret@bucket.example/a.png?X-Amz-Signature=sig-secret#frag-secret",
      "refused https://bucket.example/a.png",
    ],
    [
      "a URL without a scheme",
      "refused //bucket.example/a.png?token=token-secret",
      "refused //bucket.example/a.png",
    ],
    [
      "a query outside a URL",
      "request failed with X-Amz-Credential=cred-secret&token=token-secret in it",
      "request failed with X-Amz-Credential=[redacted] in it",
    ],
    [
      "a credential named on its own",
      "refused: access_token=token-secret was rejected",
      "refused: access_token=[redacted] was rejected",
    ],
  ])("drops the secrets of %s", (_shape, message, expected) => {
    const said = errorForLog(new Error(message));
    expect(said).not.toMatch(/secret/);
    expect(said).toBe(expected);
  });

  it.each([
    ["X-Api-Key: header-secret-1 while removing", "header-secret-1"],
    ['upstream said {"token":"json-secret-2"}', "json-secret-2"],
    ["Rejected Bearer bearer-secret-3 for this bucket", "bearer-secret-3"],
  ])("keeps a credential's name joined to its value: %s", (message, secret) => {
    const said = errorForLog(new Error(message));
    // The control: the words around it are still said.
    expect(said.length).toBeGreaterThan(10);
    expect(said).not.toContain(secret);
  });

  it("logs nothing of a thrown value that is not an error", () => {
    expect(errorForLog({ token: "token-secret" })).not.toMatch(/secret/);
  });
});

describe("storedPathForLog", () => {
  it("keeps a stored path's spelling, without its query", () => {
    expect(storedPathForLog("2026/10/a b.png?v=1")).toBe("2026/10/a b.png");
  });
});

describe("filesKeptByOthers, when the sizes column is gone by the time it is read", () => {
  // The columns the search builds its `like`s over; the read below answers
  // without a database.
  const media = sqliteTable("media", {
    filename: text("filename"),
    url: text("url"),
    thumbnailUrl: text("thumbnail_url"),
  });
  const otherOriginal = "2026/10/9a9a-other.png";

  /**
   * A search whose check finds the sizes column, and whose read naming it
   * fails with `error`, as one does once a drop has run in between; read
   * without it, the other item's row is found.
   */
  function racing(error: unknown, reads: Array<"with" | "without">) {
    return {
      columns: media,
      dialect: "postgresql" as const,
      sizesColumn: async () => sql`${sql.identifier("sizes")}`,
      read: async (_where: SQL, sizes: SQL | undefined) => {
        reads.push(sizes === undefined ? "without" : "with");
        if (sizes !== undefined) throw error;
        return [{ filename: otherOriginal, url: `/uploads/${otherOriginal}` }];
      },
    };
  }

  it.each([
    [
      "PostgreSQL",
      Object.assign(new Error('column "sizes" does not exist'), {
        code: "42703",
      }),
    ],
    [
      "MySQL",
      Object.assign(new Error("Unknown column 'sizes' in 'where clause'"), {
        code: "ER_BAD_FIELD_ERROR",
        errno: 1054,
      }),
    ],
    ["SQLite", new Error("no such column: sizes")],
    [
      "a driver error a query wrapper carries as its cause",
      new Error("Failed query: select ...", {
        cause: Object.assign(new Error('column "sizes" does not exist'), {
          code: "42703",
        }),
      }),
    ],
  ])("reads again without it on %s, and answers", async (_dialect, error) => {
    const reads: Array<"with" | "without"> = [];

    const kept = await filesKeptByOthers(
      racing(error, reads),
      ["2026/10/1d1d-gone.png", otherOriginal],
      ["deleted"],
      unread
    );

    expect(reads).toEqual(["with", "without"]);
    expect(kept).not.toBeNull();
    expect([...(kept ?? [])]).toEqual([otherOriginal]);
  });

  it.each([
    [
      "another column missing",
      Object.assign(new Error('column "filename" does not exist'), {
        code: "42703",
      }),
    ],
    ["a connection lost", new Error("Connection terminated unexpectedly")],
  ])(
    "still answers null, removing nothing, for %s (the control)",
    async (_case, error) => {
      const reads: Array<"with" | "without"> = [];

      const kept = await filesKeptByOthers(
        racing(error, reads),
        ["2026/10/1d1d-gone.png"],
        ["deleted"],
        unread
      );

      expect(reads).toEqual(["with"]);
      expect(kept).toBeNull();
    }
  );
});
