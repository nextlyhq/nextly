/**
 * The marker side of a Builder save's record that it is in progress, as the commands that connect
 * to no database read it: a save left part-way on this host against this database refuses them,
 * one left on another host or against another database is a line of notice, and a marker that
 * cannot be read refuses. The database is named by a hash of where it is, which the credentials
 * that reach it do not change and do not appear in.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  refuseWhileSaveLeftPartWay,
  saveInProgressFolder,
} from "../save-in-progress";
import { databaseIdentity, savedDatabase } from "../saved-database";

const URL_HERE = "postgres://editor:secret@db.example.test:5432/site";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "nextly-save-markers-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

/** Put a marker in the project's folder, as a save would have left it. */
function leaveMarker(name: string, text: string): void {
  const folder = saveInProgressFolder(projectRoot);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), text);
}

/** A marker's record of a save of the collection `slug`. */
function markerOf(slug: string, host: string, database: string): string {
  return JSON.stringify({
    id: `${slug}-${host}`,
    kind: "collection",
    slug,
    startedAt: "2026-01-01T00:00:00.000Z",
    host,
    database,
    definitionFile: "schema/builder.json",
    definitionBefore: null,
  });
}

/** What the check does over the project's markers: refuses, or the notice lines it gave. */
async function checked(
  databaseUrl = URL_HERE
): Promise<{ refused: unknown } | { notices: string[] }> {
  const notices: string[] = [];
  try {
    await refuseWhileSaveLeftPartWay({
      projectRoot,
      databaseUrl,
      notice: line => notices.push(line),
    });
    return { notices };
  } catch (refused) {
    return { refused };
  }
}

describe("databaseIdentity", () => {
  it("names a database the same whoever connects to it, and keeps no credential", () => {
    const named = databaseIdentity(URL_HERE);
    expect(
      databaseIdentity("postgres://reader:other@db.example.test:5432/site")
    ).toBe(named);
    expect(named).toMatch(/^[0-9a-f]{32}$/);
    expect(named).not.toContain("secret");
  });

  // The SQLite adapter opens the URL with `file:` stripped, relative to the working directory.
  it("names a SQLite file where the adapter opens it, so a relative and an absolute path differ", () => {
    expect(databaseIdentity("file:./data/app.db")).toBe(
      databaseIdentity(`file:${resolve("data/app.db")}`)
    );
    expect(databaseIdentity("file:./data/app.db")).not.toBe(
      databaseIdentity("file:/data/app.db")
    );
  });

  // `db.postgres.schema` puts an installation in a schema of its own, which the URL does not name.
  it("names two PostgreSQL schemas of one database differently, and public as no schema", () => {
    expect(databaseIdentity(URL_HERE, "tenant_a")).not.toBe(
      databaseIdentity(URL_HERE, "tenant_b")
    );
    expect(databaseIdentity(URL_HERE, "public")).toBe(
      databaseIdentity(URL_HERE)
    );
  });

  it("names another host, port or database differently", () => {
    const named = databaseIdentity(URL_HERE);
    for (const other of [
      "postgres://editor:secret@db2.example.test:5432/site",
      "postgres://editor:secret@db.example.test:5433/site",
      "postgres://editor:secret@db.example.test:5432/other",
    ]) {
      expect(databaseIdentity(other), other).not.toBe(named);
    }
  });
});

// An app given its adapter cannot say where it leads: its records name the database as unknown.
describe("savedDatabase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names DATABASE_URL's database for an adapter built from it, and unknown for one handed in", () => {
    vi.stubEnv("DATABASE_URL", URL_HERE);
    expect(savedDatabase(false)).toBe(databaseIdentity(URL_HERE));
    expect(savedDatabase(true)).toBe("unknown");
  });
});

describe("refuseWhileSaveLeftPartWay", () => {
  it("passes a project with no markers", async () => {
    expect(await checked()).toEqual({ notices: [] });
  });

  it("refuses a save left on this host against this database, naming it and how to settle it", async () => {
    leaveMarker(
      "collection-posts.json",
      markerOf("posts", hostname(), databaseIdentity(URL_HERE))
    );

    const outcome = await checked();
    expect("refused" in outcome, "the check passed").toBe(true);
    if (!("refused" in outcome)) return;
    expect(NextlyError.is(outcome.refused)).toBe(true);
    const refused = outcome.refused as NextlyError;
    expect(refused.code).toBe("CONFLICT");
    expect(refused.publicMessage).toContain('the collection "posts"');
    expect(refused.publicMessage).toContain("`next dev`");
  });

  it("gives one line of notice, and does not refuse, for a save left on another host", async () => {
    leaveMarker(
      "collection-posts.json",
      markerOf("posts", "a-teammates-laptop", databaseIdentity(URL_HERE))
    );

    const outcome = await checked();
    expect(outcome).toEqual({
      notices: [expect.stringContaining("a-teammates-laptop")],
    });
  });

  it("gives one line of notice, and does not refuse, for a save left against another database", async () => {
    leaveMarker(
      "collection-posts.json",
      markerOf(
        "posts",
        hostname(),
        databaseIdentity("postgres://editor:secret@ci.example.test:5432/site")
      )
    );

    const outcome = await checked();
    expect(outcome).toEqual({ notices: [expect.stringContaining('"posts"')] });
  });

  it.each([
    ["null", "null"],
    ["an empty object", "{}"],
    [
      "a record missing its host",
      JSON.stringify({
        ...JSON.parse(markerOf("posts", "h", "d")),
        host: undefined,
      }),
    ],
  ])(
    "refuses a marker holding %s, which names no save",
    async (_what, text) => {
      leaveMarker("collection-posts-unknown.json", text);

      const outcome = await checked();
      expect("refused" in outcome, "the check passed").toBe(true);
      if (!("refused" in outcome)) return;
      expect((outcome.refused as NextlyError).publicMessage).toContain(
        "collection-posts-unknown.json"
      );
    }
  );

  // Two for one entity on this host and database: a stopped save whose row was lost, then another.
  it("names every marker of this host and database, never one picked from them", async () => {
    const here = databaseIdentity(URL_HERE);
    leaveMarker(
      "collection-posts-first.json",
      markerOf("posts", hostname(), here)
    );
    leaveMarker(
      "collection-posts-second.json",
      markerOf("posts", hostname(), here)
    );

    const outcome = await checked();
    expect("refused" in outcome, "the check passed").toBe(true);
    if (!("refused" in outcome)) return;
    const message = (outcome.refused as NextlyError).publicMessage;
    expect(message).toContain("collection-posts-first.json");
    expect(message).toContain("collection-posts-second.json");
  });

  // Where a handed-in adapter wrote, the database cannot be told: on this host it is taken as
  // this database, so the check fails closed; on another host it is still that host's notice.
  it("refuses a marker of this host whose database is unknown, and notices one of another host", async () => {
    leaveMarker(
      "collection-posts-here.json",
      markerOf("posts", hostname(), "unknown")
    );
    const here = await checked();
    expect("refused" in here, "the check passed").toBe(true);

    rmSync(saveInProgressFolder(projectRoot), { recursive: true, force: true });
    leaveMarker(
      "collection-posts-there.json",
      markerOf("posts", "a-teammates-laptop", "unknown")
    );
    expect(await checked()).toEqual({
      notices: [expect.stringContaining("a-teammates-laptop")],
    });
  });

  it("judges a marker's database with the PostgreSQL schema the command would use", async () => {
    leaveMarker(
      "collection-posts-a.json",
      markerOf("posts", hostname(), databaseIdentity(URL_HERE, "tenant_a"))
    );
    const check = async (postgresSchema: string) => {
      const notices: string[] = [];
      try {
        await refuseWhileSaveLeftPartWay({
          projectRoot,
          databaseUrl: URL_HERE,
          postgresSchema,
          notice: line => notices.push(line),
        });
        return notices.length === 1 ? "notice" : "passed";
      } catch {
        return "refused";
      }
    };
    expect(await check("tenant_a")).toBe("refused");
    expect(await check("tenant_b")).toBe("notice");
  });

  it("refuses a marker that cannot be read, naming the file", async () => {
    leaveMarker("collection-posts.json", "{ not json");

    const outcome = await checked();
    expect("refused" in outcome, "the check passed").toBe(true);
    if (!("refused" in outcome)) return;
    expect((outcome.refused as NextlyError).publicMessage).toContain(
      "collection-posts.json"
    );
  });
});
