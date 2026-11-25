/**
 * What stops `readRepairEntities` where the migration snapshots are there and the disk does not give
 * them: a folder that cannot be listed, and a file that cannot be opened. The refusals are stood in
 * for, since permissions do not hold against a user who may read everything.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toCliError } from "../../../../cli/errors";
import { readRepairEntities } from "../read-entities";

const disk = vi.hoisted(() => ({
  refused: new Set<string>(),
  /** Refused once, then allowed. */
  refusedOnce: new Set<string>(),
  /** The system's code for a refusal; `EACCES` unless a case says another. */
  code: "EACCES",
}));

const MESSAGES: Record<string, string> = {
  EACCES: "permission denied",
  ENOENT: "no such file or directory",
  EIO: "i/o error",
};

/** As Node refuses a path, with the code in force. */
function refuse(call: string, path: unknown): void {
  const once = disk.refusedOnce.delete(String(path));
  if (!once && !disk.refused.has(String(path))) return;
  throw Object.assign(
    new Error(
      `${disk.code}: ${MESSAGES[disk.code]}, ${call} '${String(path)}'`
    ),
    { code: disk.code, path: String(path) }
  );
}

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      refuse("scandir", args[0]);
      return actual.readdir(...args);
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      refuse("open", args[0]);
      return actual.readFile(...args);
    },
  };
});

vi.mock("../../events/schema-events-repository", () => ({
  SchemaEventsRepository: class {
    listFileRemovals() {
      return Promise.resolve([]);
    }
    listFileApplies() {
      return Promise.resolve([
        {
          eventType: "file_apply",
          status: "applied",
          filename: "0001_first.sql",
          startedAt: new Date(),
          supersededEventIds: null,
        },
      ]);
    }
  },
}));
const silent = { debug() {}, info() {}, warn() {}, error() {} };

describe("readRepairEntities: snapshots the disk does not give", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nextly-repair-columns-disk-"));
    mkdirSync(join(dir, "meta"));
    writeFileSync(join(dir, "meta", "0001_first.snapshot.json"), "{}");
    writeFileSync(join(dir, "0001_first.sql"), "");
    disk.refused.clear();
    disk.refusedOnce.clear();
    disk.code = "EACCES";
  });

  afterEach(() => {
    disk.refused.clear();
    disk.refusedOnce.clear();
    disk.code = "EACCES";
    rmSync(dir, { recursive: true, force: true });
  });

  async function stop() {
    const error: unknown = await readRepairEntities({
      adapter: {
        tableExists: (name: string) =>
          Promise.resolve(name === "nextly_schema_events"),
        getDrizzle: () => undefined,
      } as unknown as DrizzleAdapter,
      dialect: "sqlite",
      config: { collections: [], db: { uiSchemaFile: "ui-schema.json" } },
      projectRoot: dir,
      migrationsDir: dir,
      logger: silent,
    }).then(
      () => {
        throw new Error("expected the run to stop");
      },
      (reason: unknown) => reason
    );
    return toCliError(error);
  }

  async function stopped() {
    const { code, what, why, next } = await stop();
    return { code, what, why, next };
  }

  it("keeps the system's error under the refusal, which --verbose shows", async () => {
    const meta = join(dir, "meta");
    disk.refused.add(meta);
    const refusal = (await stop()).cause as Error;
    expect(refusal.cause).toMatchObject({ code: "EACCES", path: meta });
  });

  it("says to run again where a read failed once and then worked", async () => {
    disk.refusedOnce.add(join(dir, "meta", "0001_first.snapshot.json"));
    expect(await stopped()).toEqual({
      code: "MIGRATION_SNAPSHOTS_UNREADABLE",
      what: "The migration snapshot `meta/0001_first.snapshot.json` could not be read.",
      why: "Reading it failed once, and then worked: it may have been written to meanwhile.",
      next: "Run `nextly repair-columns` again.",
    });
  });

  it("names a meta folder that cannot be listed, and the system's reason", async () => {
    const meta = join(dir, "meta");
    disk.refused.add(meta);
    expect(await stopped()).toEqual({
      code: "MIGRATION_SNAPSHOTS_UNREADABLE",
      what: `The migration snapshots in \`${meta}\` could not be read.`,
      why: `EACCES: permission denied, scandir '${meta}'`,
      next: "Make the folder readable by the user running the command, then run `nextly repair-columns` again.",
    });
  });

  it("names the migrations folder where that is the one that cannot be listed", async () => {
    disk.refused.add(dir);
    expect(await stopped()).toEqual({
      code: "MIGRATION_SNAPSHOTS_UNREADABLE",
      what: `The migration snapshots in \`${join(dir, "meta")}\` could not be read.`,
      why: `EACCES: permission denied, scandir '${dir}'`,
      next: `Make the folder \`${dir}\` readable by the user running the command, then run \`nextly repair-columns\` again.`,
    });
  });

  it("names an applied snapshot file that cannot be opened", async () => {
    const file = join(dir, "meta", "0001_first.snapshot.json");
    disk.refused.add(file);
    expect(await stopped()).toEqual({
      code: "MIGRATION_SNAPSHOTS_UNREADABLE",
      what: "The migration snapshot `meta/0001_first.snapshot.json` could not be read.",
      why: `EACCES: permission denied, open '${file}'`,
      next: "Make the file readable by the user running the command, then run `nextly repair-columns` again.",
    });
  });

  it("says to restore a snapshot that is gone by the time it is read", async () => {
    disk.code = "ENOENT";
    disk.refused.add(join(dir, "meta", "0001_first.snapshot.json"));
    expect(await stopped()).toEqual({
      code: "MIGRATION_SNAPSHOTS_UNREADABLE",
      what: "The migration snapshot `meta/0001_first.snapshot.json` could not be read.",
      why: "It was there when the command listed the folder, and gone when it was read.",
      next: "Restore the snapshot from version control, then run `nextly repair-columns` again.",
    });
  });

  it("keeps the permission remedy for a permission the system refused", async () => {
    disk.code = "EIO";
    const file = join(dir, "meta", "0001_first.snapshot.json");
    disk.refused.add(file);
    expect(await stopped()).toMatchObject({
      why: `EIO: i/o error, open '${file}'`,
      next: "Put right what that error names, then run `nextly repair-columns` again.",
    });
  });
});
