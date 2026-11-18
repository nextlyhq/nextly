/**
 * The hold a writer of migration files takes on the project's migration
 * folder: taken by one writer at a time, waited for or refused, kept while
 * its holder runs, lapsed once its holder has gone, and found lost by a
 * holder that stalled while another went ahead.
 *
 * Each case runs on a folder of its own, with the wait and the lease
 * shortened so a held folder is waited for in milliseconds.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  WRITER_LOCK_FILE,
  acquireWriterHold,
  assertWriterHold,
  isWriterHoldHeld,
  isWriterHoldLost,
  setWriterHoldBounds,
  underWriterHold,
  withBuilderWriterScope,
  withMigrationWriterHold,
} from "../writer-hold";

let dir: string;
let restore: () => void;

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "nextly-writer-hold-")), "migrations");
  // A wait of half a second, and a lease no case outlives unless it means to.
  restore = setWriterHoldBounds({
    waitMs: 500,
    leaseSeconds: 30,
    renewMs: 10_000,
  });
});

afterEach(() => {
  restore();
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

const lockFile = () => join(dir, WRITER_LOCK_FILE);

/** The error `work` throws. */
async function thrownBy(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal, and nothing was thrown");
}

/** Ages the hold's file by `seconds`, as time passing with nothing renewing it. */
async function age(seconds: number): Promise<void> {
  const then = new Date(Date.now() - seconds * 1000);
  await utimes(lockFile(), then, then);
}

describe("the hold on a project's migration files", () => {
  it("is one writer's at a time: a second is refused at once, and takes it once the first lets go", async () => {
    const first = await acquireWriterHold({
      migrationsDir: dir,
      command: "migrate:create",
      whenHeld: "wait",
    });

    const started = Date.now();
    const refused = await thrownBy(() =>
      acquireWriterHold({
        migrationsDir: dir,
        command: "Schema Builder save",
        whenHeld: "refuse",
      })
    );
    expect(isWriterHoldHeld(refused)).toBe(true);
    // At once: not after the wait a command takes.
    expect(Date.now() - started).toBeLessThan(400);
    // The editor is told what to do; who holds it stays in the log.
    const { publicMessage, logMessage } = refused as {
      publicMessage: string;
      logMessage: string;
    };
    expect(publicMessage).toMatch(/being written.*Save it again/);
    expect(publicMessage).not.toContain("migrate:create");
    expect(logMessage).toContain("`migrate:create` holds it");

    await first.release();
    expect(existsSync(lockFile())).toBe(false);
    const second = await acquireWriterHold({
      migrationsDir: dir,
      command: "Schema Builder save",
      whenHeld: "refuse",
    });
    await second.release();
  });

  it("is waited for by a command, which goes on when the holder lets go inside the wait", async () => {
    const first = await acquireWriterHold({
      migrationsDir: dir,
      command: "migrate:baseline",
      whenHeld: "wait",
    });
    setTimeout(() => void first.release(), 150);

    const second = await acquireWriterHold({
      migrationsDir: dir,
      command: "migrate:create",
      whenHeld: "wait",
    });

    expect(
      (JSON.parse(readFileSync(lockFile(), "utf-8")) as { command: string })
        .command
    ).toBe("migrate:create");
    await second.release();
  });

  it("stops a command that waited the whole wait, naming the holder, when it started and when its hold lapses", async () => {
    const first = await acquireWriterHold({
      migrationsDir: dir,
      command: "migrate:baseline",
      whenHeld: "wait",
    });

    const started = Date.now();
    const refused = await thrownBy(() =>
      acquireWriterHold({
        migrationsDir: dir,
        command: "migrate:create",
        whenHeld: "wait",
      })
    );

    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
    expect(isWriterHoldHeld(refused)).toBe(true);
    const { publicMessage } = refused as { publicMessage: string };
    expect(publicMessage).toContain("`migrate:create` wrote nothing");
    expect(publicMessage).toContain("`migrate:baseline` holds it");
    expect(publicMessage).toMatch(/started .* ago at/);
    expect(publicMessage).toMatch(/lapses in .*, at /);
    // The holder's file is its own still.
    await first.assertHeld();
    await first.release();
  });

  it("lapses within one lease once its holder has gone, with nobody clearing it", async () => {
    // A holder that ended without letting go: its file stays, renewed by nothing.
    await acquireWriterHold({
      migrationsDir: dir,
      command: "migrate:create",
      whenHeld: "wait",
    });

    // Inside the lease the folder is still held.
    await age(20);
    const inside = await thrownBy(() =>
      acquireWriterHold({
        migrationsDir: dir,
        command: "migrate:create",
        whenHeld: "refuse",
      })
    );
    expect(isWriterHoldHeld(inside)).toBe(true);

    // Past it, the next writer takes the folder.
    await age(31);
    const next = await acquireWriterHold({
      migrationsDir: dir,
      command: "migrate:baseline",
      whenHeld: "refuse",
    });
    expect(readdirSync(dir)).toEqual([WRITER_LOCK_FILE]);
    await next.release();
  });

  it("stays its holder's however long the holder runs, while the holder renews it", async () => {
    restore();
    restore = setWriterHoldBounds({
      waitMs: 0,
      leaseSeconds: 1,
      renewMs: 150,
    });
    const first = await acquireWriterHold({
      migrationsDir: dir,
      command: "migrate:create",
      whenHeld: "wait",
    });

    // Three leases on, a second writer is still refused.
    await new Promise(done => setTimeout(done, 3_000));
    const refused = await thrownBy(() =>
      acquireWriterHold({
        migrationsDir: dir,
        command: "migrate:baseline",
        whenHeld: "refuse",
      })
    );

    expect(isWriterHoldHeld(refused)).toBe(true);
    await first.release();
  });

  it("is found lost by a holder that stalled past its lease while another writer took the folder", async () => {
    const stalled = await acquireWriterHold({
      migrationsDir: dir,
      command: "migrate:create",
      whenHeld: "wait",
    });
    await age(31);
    const other = await acquireWriterHold({
      migrationsDir: dir,
      command: "migrate:baseline",
      whenHeld: "refuse",
    });

    const lost = await thrownBy(() => stalled.assertHeld());

    expect(isWriterHoldLost(lost)).toBe(true);
    const { publicMessage } = lost as { publicMessage: string };
    expect(publicMessage).toContain("it lost its hold");
    expect(publicMessage).toContain("`migrate:baseline` has held it since");
    expect(publicMessage).toContain(
      "`migrate:create` wrote no migration and no snapshot"
    );
    // Letting go of a lost hold leaves the other writer's alone.
    await stalled.release();
    await other.assertHeld();
    await other.release();
  });

  it("is still its holder's after a stall nobody used, and is renewed by the check", async () => {
    const stalled = await acquireWriterHold({
      migrationsDir: dir,
      command: "migrate:create",
      whenHeld: "wait",
    });
    await age(31);

    await stalled.assertHeld();

    const refused = await thrownBy(() =>
      acquireWriterHold({
        migrationsDir: dir,
        command: "migrate:baseline",
        whenHeld: "refuse",
      })
    );
    expect(isWriterHoldHeld(refused)).toBe(true);
    await stalled.release();
  });

  it("leaves no folder behind where it made one only to hold it", async () => {
    await withMigrationWriterHold(
      { migrationsDir: dir, command: "migrate:create" },
      async () => {
        expect(existsSync(lockFile())).toBe(true);
      }
    );

    expect(existsSync(dir)).toBe(false);
  });
});

describe("a writer's work under the hold", () => {
  it("runs under the command's hold, checked before each write", async () => {
    await withMigrationWriterHold(
      { migrationsDir: dir, command: "migrate:create" },
      async () => {
        // The generator's own taking finds the command's and takes no second.
        await underWriterHold(dir, "migrate:create", async () => {
          await assertWriterHold(dir);
          await age(31);
          const other = await acquireWriterHold({
            migrationsDir: dir,
            command: "migrate:baseline",
            whenHeld: "refuse",
          });
          const lost = await thrownBy(() => assertWriterHold(dir));
          expect(isWriterHoldLost(lost)).toBe(true);
          await other.release();
        });
      }
    );
  });

  it("takes the hold for a Builder change when it first writes, refused at once, and keeps it to the change's end", async () => {
    await withBuilderWriterScope("collection save", async () => {
      expect(existsSync(lockFile())).toBe(false);
      await underWriterHold(dir, "unused", async () => undefined);
      // Kept after the write: the change may still withdraw its files.
      const refused = await thrownBy(() =>
        acquireWriterHold({
          migrationsDir: dir,
          command: "migrate:create",
          whenHeld: "refuse",
        })
      );
      expect(isWriterHoldHeld(refused)).toBe(true);
      expect((refused as { logMessage: string }).logMessage).toContain(
        "`collection save` holds it"
      );
    });
    expect(existsSync(lockFile())).toBe(false);

    // And a Builder change that finds the folder held is refused, not kept waiting.
    const command = await acquireWriterHold({
      migrationsDir: dir,
      command: "migrate:create",
      whenHeld: "wait",
    });
    const started = Date.now();
    const refused = await thrownBy(() =>
      withBuilderWriterScope("collection save", () =>
        underWriterHold(dir, "unused", async () => undefined)
      )
    );
    expect(isWriterHoldHeld(refused)).toBe(true);
    expect(Date.now() - started).toBeLessThan(400);
    await command.release();
  });

  it("takes the hold before a Builder save begins where the save names its folder, so a refused save has done nothing", async () => {
    const command = await acquireWriterHold({
      migrationsDir: dir,
      command: "migrate:create",
      whenHeld: "wait",
    });
    let began = false;

    const refused = await thrownBy(() =>
      withBuilderWriterScope(
        "collection save",
        async () => {
          began = true;
        },
        dir
      )
    );

    expect(isWriterHoldHeld(refused)).toBe(true);
    expect(began).toBe(false);
    await command.release();

    // Free, the save holds the folder from its first step to its last.
    await withBuilderWriterScope(
      "collection save",
      async () => {
        expect(
          (JSON.parse(readFileSync(lockFile(), "utf-8")) as { command: string })
            .command
        ).toBe("collection save");
      },
      dir
    );
    expect(existsSync(lockFile())).toBe(false);
  });

  it("takes and gives back a hold of its own for a caller with no writer running", async () => {
    await underWriterHold(dir, "migrate:create", async () => {
      expect(
        (JSON.parse(readFileSync(lockFile(), "utf-8")) as { command: string })
          .command
      ).toBe("migrate:create");
    });

    expect(existsSync(lockFile())).toBe(false);
  });
});
