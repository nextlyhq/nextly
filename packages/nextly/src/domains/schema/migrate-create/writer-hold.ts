/**
 * One writer of a project's migration files at a time.
 *
 * `migrate:create`, `migrate:baseline` and a Schema Builder save each read the
 * newest snapshot and write a migration after it. Two of them running together
 * would write two migrations from one snapshot, so each holds the project's
 * migration folder while it reads and writes. The hold is a file in that
 * folder, since the folder is what the writers share: `migrate:create`
 * connects to no database, and two writers may not reach the same one.
 *
 * - A writer that finds the folder held waits, then stops and names the holder
 *   (a command), or is refused at once (a Builder save).
 * - A holder keeps the hold its own by renewing it while it runs. One that
 *   ended without releasing it stops renewing, and the hold lapses within one
 *   lease, with nobody clearing it by hand.
 * - A holder that stalled past its lease may find another writer went ahead.
 *   It checks the hold is still its own before it writes (`assertWriterHold`),
 *   and writes nothing where it is not.
 *
 * A command takes the hold for the whole run (`withMigrationWriterHold`). A
 * Builder save opens a scope (`withBuilderWriterScope`), and the generator
 * takes the hold inside it when it first writes (`underWriterHold`), keeping it
 * to the end of the save, its withdrawal of a failed save's files included.
 *
 * @module domains/schema/migrate-create/writer-hold
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import {
  link,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";

import { NextlyError } from "../../../errors/nextly-error";
import { describeHolder } from "../pipeline/schema-lock";

/** The hold's file, in the project's migration folder. */
export const WRITER_LOCK_FILE = ".nextly-writer.lock";

/** How long a hold stands with nothing renewing it, in seconds: the database lock's lease. */
const WRITER_LEASE_SECONDS = 120;

/** How long a command waits for a held folder, in milliseconds: the database lock's wait. */
const WRITER_WAIT_MS = 60_000;

/** How often a waiting writer looks again, in milliseconds. */
const WRITER_POLL_MS = 250;

/** The bounds a hold is taken and kept with. */
export interface WriterHoldBounds {
  /** How long a hold stands with nothing renewing it, in seconds. */
  leaseSeconds: number;
  /** How long a command waits for a held folder, in milliseconds. */
  waitMs: number;
  /** How often a holder renews its hold, in milliseconds. */
  renewMs: number;
}

const DEFAULT_BOUNDS: WriterHoldBounds = {
  leaseSeconds: WRITER_LEASE_SECONDS,
  waitMs: WRITER_WAIT_MS,
  renewMs: (WRITER_LEASE_SECONDS * 1000) / 3,
};

let bounds: WriterHoldBounds = DEFAULT_BOUNDS;

/**
 * Take and keep holds with `next` in place of the defaults, until the function
 * returned is called. For a test, which cannot wait a minute for a held folder
 * or two for a lease.
 */
export function setWriterHoldBounds(
  next: Partial<WriterHoldBounds>
): () => void {
  const before = bounds;
  bounds = { ...bounds, ...next };
  return () => {
    bounds = before;
  };
}

/** What the hold's file says of its holder. */
interface HoldRecord {
  /** Unique to one taking of the hold. */
  token: string;
  /** The command, or the Builder change, that holds it. */
  command: string;
  /** The host and process, as the database lock names them. */
  owner: string;
  /** When it was taken, as ISO text. */
  startedAt: string;
  /** The lease it was taken with, in seconds. */
  leaseSeconds: number;
}

/** A hold this process took. */
export interface WriterHold {
  /** The migration folder held, as an absolute path. */
  readonly migrationsDir: string;
  readonly command: string;
  /**
   * Refuses unless the hold is still this one's: its file still carries this
   * taking's token. Renews it where it does.
   */
  assertHeld(): Promise<void>;
  /** Gives the hold up, where it is still this one's. */
  release(): Promise<void>;
}

/** How a writer that finds the folder held behaves. */
type WhenHeld = "wait" | "refuse";

/** The `logContext.reason` of a refusal over a held folder. */
const WRITER_HOLD_HELD_REASON = "migration files held by another writer";

/** The `logContext.reason` of a writer that lost its hold. */
const WRITER_HOLD_LOST_REASON = "migration writer hold lost while held";

/** Whether `error` is the refusal of a writer that found the folder held. */
export function isWriterHoldHeld(error: unknown): error is NextlyError {
  return (
    NextlyError.is(error) &&
    error.logContext?.reason === WRITER_HOLD_HELD_REASON
  );
}

/** Whether `error` is the refusal of a writer that lost its hold. */
export function isWriterHoldLost(error: unknown): error is NextlyError {
  return (
    NextlyError.is(error) &&
    error.logContext?.reason === WRITER_HOLD_LOST_REASON
  );
}

/** The hold's file in `migrationsDir`. */
function lockPathOf(migrationsDir: string): string {
  return resolve(migrationsDir, WRITER_LOCK_FILE);
}

/** The record `text` holds, or undefined where it holds none. */
function recordOf(text: string): HoldRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { token, command, owner, startedAt, leaseSeconds } = value as Record<
    string,
    unknown
  >;
  return typeof token === "string" &&
    typeof command === "string" &&
    typeof owner === "string" &&
    typeof startedAt === "string" &&
    typeof leaseSeconds === "number"
    ? { token, command, owner, startedAt, leaseSeconds }
    : undefined;
}

/** A hold as its file stands: who holds it, and when it lapses with nothing renewing it. */
interface HoldReading {
  /** Undefined where the file holds no record: one half-written, or not ours. */
  record: HoldRecord | undefined;
  /** When the hold lapses, in epoch milliseconds. */
  lapsesAt: number;
}

/** The hold on `path`, or undefined where nothing holds it. */
async function readHold(path: string): Promise<HoldReading | undefined> {
  try {
    const [text, { mtimeMs }] = await Promise.all([
      readFile(path, "utf-8"),
      stat(path),
    ]);
    const record = recordOf(text);
    return {
      record,
      // A file with no record is given the lease a holder would have taken: a
      // writer may be between creating it and filling it.
      lapsesAt: mtimeMs + (record?.leaseSeconds ?? bounds.leaseSeconds) * 1000,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Whether `error` says the file is already there. */
function alreadyThere(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}

/**
 * Sets a lapsed hold aside so the folder can be taken, and answers whether it
 * did. The file is moved, never deleted in place: of two writers that both
 * read it lapsed, one moves it and the other finds nothing to move. A file
 * moved by mistake (another writer took the folder between the read and the
 * move) is put back unless the folder was taken again meanwhile, and its
 * holder then finds its hold gone before it writes (`assertHeld`).
 */
async function setLapsedAside(path: string, lapsed: HoldReading) {
  const aside = `${path}.${randomUUID()}.lapsed`;
  try {
    await rename(path, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const moved = recordOf(await readFile(aside, "utf-8"));
  const mistaken = moved !== undefined && moved.token !== lapsed.record?.token;
  if (mistaken) {
    await link(aside, path).catch((error: unknown) => {
      if (!alreadyThere(error)) throw error;
    });
  }
  await rm(aside, { force: true });
  return !mistaken;
}

/** The refusal of a writer that found the folder held. */
function heldError(
  command: string,
  whenHeld: WhenHeld,
  held: HoldReading,
  waitedMs: number
): NextlyError {
  const now = Date.now();
  const started = Date.parse(held.record?.startedAt ?? "");
  const holder = {
    kind: "schema" as const,
    owner: held.record?.owner ?? "an unknown process",
    command: held.record?.command ?? null,
    heldForSeconds: Number.isNaN(started)
      ? null
      : Math.max(0, Math.round((now - started) / 1000)),
    lapsesInSeconds: Math.round((held.lapsesAt - now) / 1000),
  };
  const logContext = {
    reason: WRITER_HOLD_HELD_REASON,
    command,
    holder,
    waitedMs,
  };
  if (whenHeld === "refuse") {
    // The editor is told what to do; the holder's host and process stay in the log.
    return NextlyError.serviceUnavailable({
      publicMessage:
        "A migration is being written for this project, so this change was not saved. " +
        "Save it again once that ends.",
      logMessage: `${command} refused: ${describeHolder(holder, now)}`,
      logContext,
    });
  }
  const waited =
    waitedMs > 0 ? ` after waiting ${Math.round(waitedMs / 1000)} seconds` : "";
  const described = describeHolder(holder, now);
  return new NextlyError({
    code: "NEXTLY_MIGRATE_LOCK_BUSY",
    publicMessage:
      `\`${command}\` wrote nothing: another run is still writing this project's migration ` +
      `files${waited}. ${described[0].toUpperCase()}${described.slice(1)} ` +
      "Run it again once that finishes.",
    logContext,
  });
}

/**
 * The refusal of a writer that no longer holds the folder. It carries the
 * code of a run stopped by a held lock, so a command prints it in the same
 * three parts: what happened, why, and what to run.
 */
function lostError(
  command: string,
  taken: HoldRecord | undefined
): NextlyError {
  const by =
    taken === undefined ? "" : ` \`${taken.command}\` has held it since.`;
  return new NextlyError({
    code: "NEXTLY_MIGRATE_LOCK_BUSY",
    publicMessage:
      `\`${command}\` wrote no migration and no snapshot: it lost its hold on this project's ` +
      "migration files. It stopped for longer than its lease, so another run may have " +
      `written a migration.${by} Run it again.`,
    logContext: { reason: WRITER_HOLD_LOST_REASON, command },
  });
}

/** Holds this process took and has not released, removed if the process exits holding them. */
const held = new Map<string, { path: string; token: string }>();
let exitHookSet = false;

/**
 * Removes this process's holds as it exits: a command that ends through
 * `process.exit` runs no `finally`, and its hold would otherwise stand for a
 * lease. Synchronous, as an exit handler has to be.
 */
function releaseOnExit(): void {
  if (exitHookSet) return;
  exitHookSet = true;
  process.on("exit", () => {
    for (const { path, token } of held.values()) {
      try {
        if (recordOf(readFileSync(path, "utf-8"))?.token === token) {
          rmSync(path, { force: true });
        }
      } catch {
        // Gone already, or unreadable: the lease ends it.
      }
    }
  });
}

/**
 * Take the hold on `migrationsDir` for `command`, waiting for a held folder or
 * refusing at once as `whenHeld` says. The folder is created where there is
 * none, since the hold's file lives in it.
 */
export async function acquireWriterHold(args: {
  migrationsDir: string;
  command: string;
  whenHeld: WhenHeld;
}): Promise<WriterHold> {
  const migrationsDir = resolve(args.migrationsDir);
  const path = lockPathOf(migrationsDir);
  let createdFolder =
    (await mkdir(migrationsDir, { recursive: true })) !== undefined;
  const record: HoldRecord = {
    token: randomUUID(),
    command: args.command,
    owner: `${hostname()}:${String(process.pid)}`,
    startedAt: new Date().toISOString(),
    leaseSeconds: bounds.leaseSeconds,
  };
  const started = Date.now();
  const deadline = started + (args.whenHeld === "wait" ? bounds.waitMs : 0);
  for (;;) {
    try {
      await writeFile(path, JSON.stringify(record, null, 2) + "\n", {
        encoding: "utf-8",
        flag: "wx",
      });
      break;
    } catch (error) {
      // The folder went with the holder that had made it: made again here.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await mkdir(migrationsDir, { recursive: true });
        createdFolder = true;
        continue;
      }
      if (!alreadyThere(error)) throw error;
    }
    const reading = await readHold(path);
    if (reading === undefined) continue;
    if (reading.lapsesAt <= Date.now()) {
      await setLapsedAside(path, reading);
      continue;
    }
    if (Date.now() >= deadline) {
      if (createdFolder) await rmdir(migrationsDir).catch(() => undefined);
      throw heldError(
        args.command,
        args.whenHeld,
        reading,
        Date.now() - started
      );
    }
    await new Promise(done => setTimeout(done, WRITER_POLL_MS));
  }

  const key = `${path}#${record.token}`;
  held.set(key, { path, token: record.token });
  releaseOnExit();
  let lost = false;
  /** Whether the file still carries this taking's token; renews it where it does. */
  const stillOwn = async (): Promise<HoldRecord | undefined | true> => {
    const now = await readHold(path);
    if (now?.record?.token !== record.token) return now?.record;
    const at = new Date();
    await utimes(path, at, at);
    return true;
  };
  const renewal = setInterval(() => {
    stillOwn().then(
      own => {
        if (own !== true) lost = true;
      },
      () => undefined
    );
  }, bounds.renewMs);
  renewal.unref();

  return {
    migrationsDir,
    command: args.command,
    assertHeld: async () => {
      const own = lost ? undefined : await stillOwn();
      if (own === true) return;
      lost = true;
      throw lostError(
        args.command,
        own ?? (await readHold(path))?.record ?? undefined
      );
    },
    release: async () => {
      clearInterval(renewal);
      held.delete(key);
      const now = await readHold(path).catch(() => undefined);
      if (now?.record?.token === record.token) await rm(path, { force: true });
      // A folder made only to hold the file goes with it, where nothing was written.
      if (createdFolder) await rmdir(migrationsDir).catch(() => undefined);
    },
  };
}

/** The holds the running writer has, and how it takes one it does not have yet. */
interface WriterScope {
  command: string;
  whenHeld: WhenHeld;
  holds: Map<string, WriterHold>;
}

const scope = new AsyncLocalStorage<WriterScope>();

/**
 * Run `work` holding `migrationsDir` throughout, as a command does: it waits
 * for a held folder, then stops and names the holder.
 */
export async function withMigrationWriterHold<T>(
  args: { migrationsDir: string; command: string },
  work: () => Promise<T>
): Promise<T> {
  const hold = await acquireWriterHold({ ...args, whenHeld: "wait" });
  const holds = new Map([[hold.migrationsDir, hold]]);
  try {
    return await scope.run(
      { command: args.command, whenHeld: "wait", holds },
      work
    );
  } finally {
    await hold.release();
  }
}

/**
 * Run a Schema Builder change, `work`, so that a migration it writes is
 * written holding its folder: taken when the generator first writes there,
 * refused at once where another writer holds it, and kept until `work` ends.
 */
export async function withBuilderWriterScope<T>(
  label: string,
  work: () => Promise<T>
): Promise<T> {
  // A change made inside another's scope writes under that one's holds.
  if (scope.getStore() !== undefined) return work();
  const holds = new Map<string, WriterHold>();
  try {
    return await scope.run({ command: label, whenHeld: "refuse", holds }, work);
  } finally {
    for (const hold of holds.values()) await hold.release();
  }
}

/**
 * Run `work`, which writes migration files into `migrationsDir`, holding that
 * folder: under the hold the running writer already has, or one taken here.
 * Inside a Builder change the hold is kept to the end of that change; with no
 * writer running (a caller of the generator alone) it is released after `work`.
 */
export async function underWriterHold<T>(
  migrationsDir: string,
  command: string,
  work: () => Promise<T>
): Promise<T> {
  const dir = resolve(migrationsDir);
  const running = scope.getStore();
  if (running?.holds.has(dir) === true) return work();
  if (running !== undefined) {
    running.holds.set(
      dir,
      await acquireWriterHold({
        migrationsDir: dir,
        command: running.command,
        whenHeld: running.whenHeld,
      })
    );
    return work();
  }
  return withMigrationWriterHold({ migrationsDir: dir, command }, work);
}

/**
 * Take the hold on `migrationsDir` for the Builder change that is running,
 * where it has none yet: asked when the change first reads the folder, so
 * nothing it reads there is written over by another writer before it writes.
 * With no Builder change running (a command, which holds the folder already,
 * or a reader that writes nothing) nothing is taken.
 */
export async function holdInBuilderChange(
  migrationsDir: string
): Promise<void> {
  const running = scope.getStore();
  if (running?.whenHeld !== "refuse") return;
  await underWriterHold(migrationsDir, running.command, async () => undefined);
}

/** The `logContext.reason` of a writer whose starting snapshot is no longer the newest. */
const WRITER_START_MOVED_REASON =
  "another writer wrote a migration after this one read the newest";

/**
 * The refusal of a writer that read the newest snapshot before it held the
 * folder and finds another there now: a migration written from the one it
 * read would be a second written from it. `newest` is the snapshot's file
 * found now, undefined where there is none. A Builder change is told to make
 * the change again; a command is told what to run, in the parts it prints a
 * held lock in.
 */
export function startMovedError(newest: string | undefined): NextlyError {
  const base = newest?.replace(/\.snapshot\.json$/, "");
  const logContext = {
    reason: WRITER_START_MOVED_REASON,
    newest: base ?? null,
  };
  const moved =
    base === undefined
      ? "The migration it started from is no longer in the project."
      : `Another run wrote the migration ${base} after it read the newest one.`;
  const running = scope.getStore();
  if (running?.whenHeld === "refuse") {
    return NextlyError.serviceUnavailable({
      publicMessage:
        "Another migration was written for this project while this change was being " +
        "prepared, so it was not saved. Save it again.",
      logMessage: `${running.command} refused: ${moved}`,
      logContext,
    });
  }
  return new NextlyError({
    code: "NEXTLY_MIGRATE_LOCK_BUSY",
    publicMessage:
      `\`${running?.command ?? "migrate:create"}\` wrote no migration and no snapshot. ` +
      `${moved} Run it again.`,
    logContext,
  });
}

/**
 * Refuses unless the running writer still holds `migrationsDir`: asked just
 * before a migration file or its snapshot is written. A writer with no hold
 * on the folder (a dry run, which writes nothing) is not asked.
 */
export async function assertWriterHold(migrationsDir: string): Promise<void> {
  await scope.getStore()?.holds.get(resolve(migrationsDir))?.assertHeld();
}

/**
 * Write `text` at `path` so a reader finds the whole file or none: under
 * another name first, then moved into place in one step.
 */
export async function writeWhole(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: "utf-8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
