/**
 * The hold on a project's migration files at the moments two writers'
 * steps interleave, and a file's publication while it happens.
 *
 * `writer-hold.test.ts` reads the folder between calls. These cases stop a
 * writer inside one: the file system's calls go through to the real ones,
 * with a step another writer takes, or a look at the folder, placed between
 * two of them. Each interleaving is one an implementation that checks a path
 * and then acts on it gets wrong.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WRITER_LOCK_FILE,
  acquireWriterHold,
  isWriterHoldHeld,
  isWriterHoldLost,
  publishHeld,
  setWriterHoldBounds,
  withMigrationWriterHold,
  writeWhole,
  type WriterHold,
} from "../writer-hold";

/** Steps placed between the file system's calls, each taken once. */
const between = vi.hoisted(() => ({
  /** After a file's text has been read, before the reader acts on it. */
  afterRead: undefined as (() => Promise<void>) | undefined,
  /** Before a hold's file is moved aside (to a name ending `.aside`). */
  beforeSetAside: undefined as (() => Promise<void>) | undefined,
  /** Before any file is moved, given where it goes. */
  beforeMove: undefined as ((to: string) => void) | undefined,
  /** Every write and move made, in order. */
  made: [] as { step: "write" | "move"; path: string; text?: string }[],
}));

vi.mock("node:fs/promises", async importOriginal => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  /** The one-shot step after a read, taken by the first read to reach it. */
  const afterRead = async () => {
    const step = between.afterRead;
    between.afterRead = undefined;
    await step?.();
  };
  return {
    ...real,
    readFile: async (...args: Parameters<typeof real.readFile>) => {
      const text = await real.readFile(...args);
      await afterRead();
      return text;
    },
    open: async (...args: Parameters<typeof real.open>) => {
      const handle = await real.open(...args);
      const read = handle.readFile.bind(handle);
      handle.readFile = (async (...options: Parameters<typeof read>) => {
        const text = await read(...options);
        await afterRead();
        return text;
      }) as typeof handle.readFile;
      return handle;
    },
    writeFile: async (...args: Parameters<typeof real.writeFile>) => {
      between.made.push({ step: "write", path: String(args[0]) });
      return real.writeFile(...args);
    },
    rename: async (from: string, to: string) => {
      between.made.push({
        step: "move",
        path: to,
        text: await real.readFile(from, "utf-8"),
      });
      between.beforeMove?.(to);
      if (to.endsWith(".aside")) {
        const step = between.beforeSetAside;
        between.beforeSetAside = undefined;
        await step?.();
      }
      return real.rename(from, to);
    },
  };
});

let dir: string;
let restore: () => void;

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "nextly-writer-steps-")), "migrations");
  restore = setWriterHoldBounds({
    waitMs: 0,
    leaseSeconds: 30,
    renewMs: 600_000,
  });
  between.made.length = 0;
});

afterEach(() => {
  restore();
  between.afterRead = undefined;
  between.beforeSetAside = undefined;
  between.beforeMove = undefined;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

const lockFile = () => join(dir, WRITER_LOCK_FILE);

/** Ages the hold's file past its lease, as a holder stopped for that long. */
async function lapse(): Promise<void> {
  const then = new Date(Date.now() - 31_000);
  await utimes(lockFile(), then, then);
}

const take = (command: string): Promise<WriterHold> =>
  acquireWriterHold({ migrationsDir: dir, command, whenHeld: "refuse" });

/** The error `work` throws. */
async function thrownBy(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal, and nothing was thrown");
}

describe("a holder checking its hold while another writer takes the folder", () => {
  it("finds the hold lost when the folder is taken between its read of the token and its renewal", async () => {
    const stalled = await take("migrate:create");
    await lapse();
    let other: WriterHold | undefined;
    // The holder has read its own token. Before it renews, the lapsed hold
    // is set aside and the folder taken.
    between.afterRead = async () => {
      other = await take("migrate:baseline");
    };

    const lost = await thrownBy(() => stalled.assertHeld());

    expect(isWriterHoldLost(lost)).toBe(true);
    // The renewal touched nothing of the new holder's: the folder is its own.
    await other!.assertHeld();
    expect(
      (JSON.parse(readFileSync(lockFile(), "utf-8")) as { command: string })
        .command
    ).toBe("migrate:baseline");
    await other!.release();
  });

  it("keeps the hold when it renews between another writer's read of it lapsed and that writer's move", async () => {
    const stalled = await take("migrate:create");
    await lapse();
    // The other writer has read the hold lapsed. Before it sets the file
    // aside, the holder resumes and renews.
    between.beforeSetAside = () => stalled.assertHeld();

    const refused = await thrownBy(() => take("migrate:baseline"));

    // The renewed hold was put back, and the other writer is refused.
    expect(isWriterHoldHeld(refused)).toBe(true);
    await stalled.assertHeld();
    expect(
      (JSON.parse(readFileSync(lockFile(), "utf-8")) as { command: string })
        .command
    ).toBe("migrate:create");
    await stalled.release();
    expect(existsSync(lockFile())).toBe(false);
  });
});

describe("a holder letting go while another writer takes the folder", () => {
  it("leaves the other writer's hold alone when the folder is taken between its check and its removal", async () => {
    const stalled = await take("migrate:create");
    await lapse();
    let other: WriterHold | undefined;
    // The stalled holder is letting go: it has read the hold as its own.
    // Before it removes anything, the lapsed hold is set aside and the
    // folder taken.
    between.afterRead = async () => {
      other = await take("migrate:baseline");
    };

    await stalled.release();

    // What it removed was its own file, never the one now at the path.
    expect(other).toBeDefined();
    await other!.assertHeld();
    expect(
      (JSON.parse(readFileSync(lockFile(), "utf-8")) as { command: string })
        .command
    ).toBe("migrate:baseline");
    await other!.release();
  });
});

describe("a writer publishing its files", () => {
  it("withdraws them and refuses where it lost the folder between its check and its files", async () => {
    restore();
    restore = setWriterHoldBounds({
      waitMs: 5_000,
      leaseSeconds: 30,
      renewMs: 600_000,
    });
    const snapshot = join(dir, "meta", "20260101_000000_000_one.snapshot.json");
    const file = join(dir, "20260101_000000_000_one.sql");
    let other: WriterHold | undefined;

    const lost = await thrownBy(() =>
      withMigrationWriterHold(
        { migrationsDir: dir, command: "migrate:create" },
        () =>
          publishHeld(dir, [file, snapshot], async () => {
            // Checked, and then stopped past its lease: another writer takes
            // the folder before this one's files are in place.
            await lapse();
            other = await take("migrate:baseline");
            mkdirSync(join(dir, "meta"), { recursive: true });
            writeFileSync(snapshot, "{}");
            writeFileSync(file, "CREATE TABLE one (id integer);\n");
          })
      )
    );

    expect(isWriterHoldLost(lost)).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(snapshot)).toBe(false);
    await other!.assertHeld();
    await other!.release();
  });

  it("withdraws what a write that failed part-way had put in place", async () => {
    const snapshot = join(dir, "meta", "20260101_000000_000_one.snapshot.json");
    const file = join(dir, "20260101_000000_000_one.sql");

    const failed = await thrownBy(() =>
      withMigrationWriterHold(
        { migrationsDir: dir, command: "migrate:create" },
        () =>
          publishHeld(dir, [file, snapshot], async () => {
            mkdirSync(join(dir, "meta"), { recursive: true });
            writeFileSync(snapshot, "{}");
            throw new Error("no space left on device");
          })
      )
    );

    expect((failed as Error).message).toBe("no space left on device");
    expect(existsSync(snapshot)).toBe(false);
  });
});

describe("a file written whole, while it is written", () => {
  it("is never at its own name with less than all of its text", async () => {
    const hold = await take("migrate:create");
    const path = join(dir, "20260101_000000_000_one.sql");
    const text = "CREATE TABLE one (id integer);\n".repeat(200);
    between.made.length = 0;
    /** Whether the file was at its name before it was moved there. */
    let thereBeforeMove: boolean | undefined;
    between.beforeMove = to => {
      if (to === path) thereBeforeMove = existsSync(path);
    };

    await writeWhole(path, text);

    // Written under another name, in full, and only then moved to its own.
    const writes = between.made.filter(made => made.step === "write");
    expect(writes).toHaveLength(1);
    expect(writes[0].path).not.toBe(path);
    expect(between.made.filter(made => made.step === "move")).toEqual([
      { step: "move", path, text },
    ]);
    expect(thereBeforeMove).toBe(false);
    expect(readFileSync(path, "utf-8")).toBe(text);
    await hold.release();
  });
});
