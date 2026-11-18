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
  readdirSync,
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
  prepareWhole,
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
  /** Once a hold's file has been put at its path, before its taker goes on. */
  afterPlaced: undefined as (() => Promise<void>) | undefined,
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
  /** The one-shot step after a hold's file is placed. */
  const afterPlaced = async () => {
    const step = between.afterPlaced;
    between.afterPlaced = undefined;
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
      await real.writeFile(...args);
      if (String(args[0]).endsWith(".nextly-writer.lock")) await afterPlaced();
    },
    link: async (from: string, to: string) => {
      await real.link(from, to);
      // A hold put at its path, not one put back there.
      if (from.endsWith(".new")) await afterPlaced();
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
  between.afterPlaced = undefined;
  between.beforeMove = undefined;
  vi.restoreAllMocks();
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

describe("a writer taking the folder", () => {
  it("does not go on as its holder when another took it between its file being placed and its taking being confirmed", async () => {
    let other: WriterHold | undefined;
    // The writer's file is at the path. Stopped there past its lease, it
    // resumes after another writer has set that file aside and taken the folder.
    between.afterPlaced = async () => {
      await lapse();
      other = await take("migrate:baseline");
    };

    const refused = await thrownBy(() => take("Schema Builder save"));

    // It finds the folder held, as any writer arriving then does.
    expect(isWriterHoldHeld(refused)).toBe(true);
    await other!.assertHeld();
    await other!.release();
  });

  it("counts a hold's lease on the folder's clock, whatever this machine's says", async () => {
    const holder = await take("migrate:create");
    // A second machine sharing the folder, its clock an hour ahead.
    const real = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => real + 3_600_000);

    const refused = await thrownBy(() => take("migrate:baseline"));

    // The hold was taken a moment ago by the folder's clock: still held.
    expect(isWriterHoldHeld(refused)).toBe(true);
    vi.restoreAllMocks();
    await holder.assertHeld();
    await holder.release();
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
  const snapshot = () =>
    join(dir, "meta", "20260101_000000_000_one.snapshot.json");
  const file = () => join(dir, "20260101_000000_000_one.sql");
  /** Both files written in full aside, as a writer prepares them. */
  const prepared = async () => {
    mkdirSync(join(dir, "meta"), { recursive: true });
    return [
      await prepareWhole(snapshot(), "{}"),
      await prepareWhole(file(), "CREATE TABLE one (id integer);\n"),
    ];
  };
  /** `work` as `migrate:create` runs it, holding the folder. */
  const asWriter = (work: () => Promise<void>) =>
    withMigrationWriterHold(
      { migrationsDir: dir, command: "migrate:create" },
      work
    );
  /** No file of the migration, placed or waiting, is in the folder. */
  const nothingLeft = () =>
    [...readdirSync(dir), ...readdirSync(join(dir, "meta"))].filter(name =>
      name.startsWith("20260101")
    );

  beforeEach(() => {
    restore();
    restore = setWriterHoldBounds({
      waitMs: 5_000,
      leaseSeconds: 30,
      renewMs: 600_000,
    });
  });

  it("puts nothing in place where it lost the folder while it prepared its files", async () => {
    let other: WriterHold | undefined;

    const lost = await thrownBy(() =>
      asWriter(() =>
        publishHeld(dir, async () => {
          const files = await prepared();
          // Stopped past its lease with its files written aside: another
          // writer takes the folder before the last check.
          await lapse();
          other = await take("migrate:baseline");
          return files;
        })
      )
    );

    expect(isWriterHoldLost(lost)).toBe(true);
    expect(nothingLeft()).toEqual([]);
    await other!.assertHeld();
    await other!.release();
  });

  it("puts nothing in place where the caller's own last check refuses", async () => {
    const refused = await thrownBy(() =>
      asWriter(() =>
        publishHeld(dir, prepared, {
          stillCurrent: async () => {
            throw new Error("the newest snapshot moved");
          },
        })
      )
    );

    expect((refused as Error).message).toBe("the newest snapshot moved");
    expect(nothingLeft()).toEqual([]);
  });

  it("leaves its files where it was overtaken between its last check and them, and names them", async () => {
    let other: WriterHold | undefined;
    // Stopped past its lease after its last check: the folder is taken
    // before its files go in.
    const overtaken = async () => {
      await lapse();
      other = await take("migrate:baseline");
    };

    const lost = await thrownBy(() =>
      asWriter(() => publishHeld(dir, prepared, { stillCurrent: overtaken }))
    );

    // The refusal of a writer another overtook, naming the file it wrote.
    expect(isWriterHoldLost(lost)).toBe(true);
    const { publicMessage } = lost as { publicMessage: string };
    expect(publicMessage).toContain("as it wrote 20260101_000000_000_one.sql");
    expect(publicMessage).toContain("was left in place");
    // A writer never removes a migration file once it is in the folder: it
    // may already be applied.
    expect(existsSync(file())).toBe(true);
    expect(existsSync(snapshot())).toBe(true);
    await other!.assertHeld();
    await other!.release();
  });

  it("withdraws a snapshot whose migration file could not follow it", async () => {
    // The migration's own name is taken by a folder, so its file cannot be placed.
    mkdirSync(file(), { recursive: true });

    const failed = await thrownBy(() =>
      asWriter(() => publishHeld(dir, prepared))
    );

    expect((failed as NodeJS.ErrnoException).code).toBeDefined();
    expect(existsSync(snapshot())).toBe(false);
    expect(readdirSync(dir).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });

  it("writes the files that go alongside in the same step, after its last check and before the one after", async () => {
    const companion = join(dir, "20260101_000000_001_one_companion.sql");
    const steps: string[] = [];

    await asWriter(() =>
      publishHeld(dir, prepared, {
        stillCurrent: async () => {
          steps.push("last check");
        },
        alongside: () => {
          // The migration and its snapshot are in place by now.
          steps.push(
            existsSync(file()) && existsSync(snapshot())
              ? "alongside, after the files"
              : "alongside, before the files"
          );
          writeFileSync(companion, "-- companion\n");
          return [companion];
        },
      })
    );

    expect(steps).toEqual(["last check", "alongside, after the files"]);
    expect(existsSync(companion)).toBe(true);
  });

  it("writes none alongside where the last check refuses", async () => {
    let written = false;

    await thrownBy(() =>
      asWriter(() =>
        publishHeld(dir, prepared, {
          stillCurrent: async () => {
            await lapse();
            const other = await take("migrate:baseline");
            await other.release();
            throw new Error("overtaken before its files");
          },
          alongside: () => {
            written = true;
            return [];
          },
        })
      )
    );

    expect(written).toBe(false);
    expect(nothingLeft()).toEqual([]);
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
