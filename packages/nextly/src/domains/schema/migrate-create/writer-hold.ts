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
import {
  constants,
  copyFileSync,
  linkSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import {
  copyFile,
  link,
  mkdir,
  open,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, resolve } from "node:path";

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
export const WRITER_HOLD_HELD_REASON = "migration files held by another writer";

/** The `logContext.reason` of a writer that lost its hold. */
export const WRITER_HOLD_LOST_REASON = "migration writer hold lost while held";

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

/**
 * Whether `error` is the refusal of a writer another overtook: one that lost
 * its hold, or found a migration written after the snapshot it started from.
 * Such a writer has put nothing of its own in the folder, and what is new
 * there is the other writer's.
 */
export function isWriterOvertaken(error: unknown): boolean {
  return (
    NextlyError.is(error) &&
    (error.logContext?.reason === WRITER_HOLD_LOST_REASON ||
      error.logContext?.reason === WRITER_START_MOVED_REASON)
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

/** A hold as one file stands: who holds it, and when it lapses with nothing renewing it. */
interface HoldReading {
  /** Undefined where the file holds no record: one half-written, or not ours. */
  record: HoldRecord | undefined;
  /** When the hold lapses, in epoch milliseconds. */
  lapsesAt: number;
  /** The file read, by device and inode: the path may name another by now. */
  file: { dev: number; ino: number };
}

/** The hold the open file `handle` is, whatever its path names by now. */
async function holdIn(handle: FileHandle): Promise<HoldReading> {
  const text = await handle.readFile("utf-8");
  const { mtimeMs, dev, ino } = await handle.stat();
  const record = recordOf(text);
  return {
    record,
    // A file with no record is given the lease a holder would have taken: a
    // writer may be between creating it and filling it.
    lapsesAt: mtimeMs + (record?.leaseSeconds ?? bounds.leaseSeconds) * 1000,
    file: { dev, ino },
  };
}

/** `work` over the file at `path`, opened once; undefined where there is none. */
async function withFileAt<T>(
  path: string,
  work: (handle: FileHandle) => Promise<T>,
  /** `"r+"` where `work` writes to the file. */
  mode: "r" | "r+" = "r"
): Promise<T | undefined> {
  let handle: FileHandle;
  try {
    handle = await open(path, mode);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return await work(handle);
  } finally {
    await handle.close();
  }
}

/** The hold on `path`, or undefined where nothing holds it. */
function readHold(path: string): Promise<HoldReading | undefined> {
  return withFileAt(path, holdIn);
}

/**
 * The time by the clock of the file system `dir` is on, in epoch
 * milliseconds: the modification time it gives a file written there now.
 *
 * A hold's lease is counted on this clock alone. Its file's time is set by
 * the file system when the holder writes to it (`renewOwn`), and read here
 * the same way, so two machines sharing the folder agree on when a hold
 * lapses whatever their own clocks say.
 */
async function folderNow(dir: string): Promise<number> {
  const probe = resolve(dir, `${WRITER_LOCK_FILE}.${randomUUID()}.now`);
  try {
    await writeFile(probe, "", { flag: "wx" });
    return (await stat(probe)).mtimeMs;
  } finally {
    await rm(probe, { force: true });
  }
}

/** Whether the hold read at `path` has lapsed, by the folder's clock. */
async function hasLapsed(path: string, hold: HoldReading): Promise<boolean> {
  return hold.lapsesAt <= (await folderNow(dirname(path)));
}

/** Whether `error` says the file is already there. */
function alreadyThere(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}

/** Whether `error` says the file system has no hard links. */
function noLinks(error: unknown): boolean {
  return NO_LINKS.has((error as NodeJS.ErrnoException).code ?? "");
}

/**
 * Puts a hold's file, moved to `aside`, back at `path`, unless the folder
 * was taken again meanwhile: a link where the file system has them, which
 * keeps the file it is, and otherwise a copy made only where nothing is at
 * the path. Never a move, which would replace another writer's hold. The
 * copy is a new file with a new time, so the hold put back starts a lease
 * afresh, and its holder knows it by its token (`renewOwn`).
 */
async function putBack(aside: string, path: string): Promise<void> {
  try {
    await link(aside, path);
  } catch (error) {
    if (alreadyThere(error)) return;
    if (!noLinks(error)) throw error;
    await copyFile(aside, path, constants.COPYFILE_EXCL).catch(
      (failed: unknown) => {
        if (!alreadyThere(failed)) throw failed;
      }
    );
  }
}

/**
 * Takes the hold's file from its path where `wanted` says it is the one to
 * take, and answers whether it did. The file is moved to a name of its own
 * first and judged there, as the one file it is: judged at its path, another
 * could be in its place by the time it was removed. Of two that both mean to
 * take it, one moves it and the other finds nothing to move. A file that is
 * not the one wanted is put back, unless the folder was taken again
 * meanwhile; its holder then finds its hold gone before it writes.
 */
async function takeFromPath(
  path: string,
  wanted: (moved: HoldReading) => boolean | Promise<boolean>
): Promise<boolean> {
  const aside = `${path}.${randomUUID()}.aside`;
  try {
    await rename(path, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const moved = await readHold(aside);
  const take = moved !== undefined && (await wanted(moved));
  if (!take) await putBack(aside, path);
  await rm(aside, { force: true });
  return take;
}

/**
 * Sets a lapsed hold aside so the folder can be taken: only the hold that
 * was read, and only if it is still lapsed once moved. One its holder renewed
 * between the read and the move (`renewOwn`) stays its holder's.
 */
function setLapsedAside(path: string, lapsed: HoldReading): Promise<boolean> {
  return takeFromPath(
    path,
    async moved =>
      moved.record?.token === lapsed.record?.token &&
      (await hasLapsed(path, moved))
  );
}

/**
 * Renews the hold `token` took, and answers whether it is still that
 * taking's: `true`, or the record that holds the folder instead (undefined
 * where nothing does).
 *
 * Checked and renewed as one file, opened once: the token is read from it and
 * its time set on it, never on whatever the path names a moment later. It is
 * the holder's only once that same file is still the one at the path after
 * the renewal. A writer taking a lapsed hold moves the file and reads its
 * time again (`setLapsedAside`), so of the two, one finds the renewal and
 * the other finds its file gone.
 */
async function renewOwn(
  path: string,
  token: string
): Promise<true | HoldRecord | undefined> {
  const other = () => readHold(path).then(now => now?.record);
  const renewed = await withFileAt(
    path,
    async handle => {
      const held = await holdIn(handle);
      if (held.record?.token !== token) return held.record;
      // Its first character written again: the file system sets the file's
      // time itself, by its own clock, as it does for every writer's.
      await handle.write("{", 0);
      const there = await stat(path).catch(() => undefined);
      if (there?.ino === held.file.ino && there.dev === held.file.dev) {
        return true;
      }
      // Another file is at the path. It is this taking's all the same where
      // it carries its token: its own, put back as a copy on a file system
      // with no hard links (`putBack`).
      const now = await other();
      return now?.token === token ? true : now;
    },
    "r+"
  );
  return renewed;
}

/** Who holds the folder, as the refusal names them. */
export interface WriterHolder {
  /** The host and process. */
  owner: string;
  /** The command, or null where the hold's file does not say. */
  command: string | null;
  /** Seconds since the hold was taken, or null where the file does not say. */
  heldForSeconds: number | null;
  /** Seconds until the hold lapses if nothing renews it. */
  lapsesInSeconds: number;
}

/**
 * The refusal of a writer that found the folder held: a command's, in three
 * sentences a terminal prints as what happened, why, and what to run, or a
 * Builder save's (`whenHeld: "refuse"`), which tells the editor what to do
 * and keeps the holder for the log.
 */
export function writerHeldError(args: {
  command: string;
  whenHeld: "wait" | "refuse";
  holder: WriterHolder;
  waitedMs: number;
  now?: number;
}): NextlyError {
  const { command, holder, waitedMs } = args;
  const described = describeHolder({ kind: "schema", ...holder }, args.now);
  const logContext = {
    reason: WRITER_HOLD_HELD_REASON,
    command,
    holder,
    waitedMs,
  };
  if (args.whenHeld === "refuse") {
    return NextlyError.serviceUnavailable({
      publicMessage:
        "A migration is being written for this project, so this change was not saved. " +
        "Save it again once that ends.",
      logMessage: `${command} refused: ${described}`,
      logContext,
    });
  }
  const waited =
    waitedMs > 0 ? ` after waiting ${Math.round(waitedMs / 1000)} s` : "";
  return NextlyError.serviceUnavailable({
    publicMessage:
      `\`${command}\` wrote nothing: another run is still writing this project's migration ` +
      `files${waited}. ${described[0].toUpperCase()}${described.slice(1)} ` +
      "Run it again once that finishes.",
    logContext,
  });
}

/** `writerHeldError`, for the hold as its file at `path` was read. */
async function heldError(
  path: string,
  command: string,
  whenHeld: WhenHeld,
  held: HoldReading,
  waitedMs: number
): Promise<NextlyError> {
  const now = Date.now();
  const started = Date.parse(held.record?.startedAt ?? "");
  return writerHeldError({
    command,
    whenHeld,
    holder: {
      owner: held.record?.owner ?? "an unknown process",
      command: held.record?.command ?? null,
      heldForSeconds: Number.isNaN(started)
        ? null
        : Math.max(0, Math.round((now - started) / 1000)),
      // What is left of its lease, counted on the folder's clock.
      lapsesInSeconds: Math.round(
        (held.lapsesAt - (await folderNow(dirname(path)))) / 1000
      ),
    },
    waitedMs,
    now,
  });
}

/**
 * The refusal of a writer that no longer holds the folder: it stalled past
 * its lease, and `takenBy`, where known, is the command that holds it now.
 * In the three sentences a terminal prints as what happened, why, and what
 * to run.
 */
export function writerLostError(
  command: string,
  takenBy: string | undefined
): NextlyError {
  const by = takenBy === undefined ? "" : ` \`${takenBy}\` has held it since.`;
  return NextlyError.serviceUnavailable({
    publicMessage:
      `\`${command}\` wrote no migration and no snapshot: it lost its hold on this project's ` +
      "migration files. It stopped for longer than its lease, so another run may have " +
      `written a migration.${by} Run it again.`,
    logContext: { reason: WRITER_HOLD_LOST_REASON, command },
  });
}

/** `putBack`, in the calls an exit handler may make. */
function putBackSync(aside: string, path: string): void {
  try {
    linkSync(aside, path);
  } catch (error) {
    if (!noLinks(error)) throw error;
    copyFileSync(aside, path, constants.COPYFILE_EXCL);
  }
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
      // As `takeFromPath`, in the calls an exit handler may make: moved to a
      // name of its own, judged there, and put back where it is another's.
      const aside = `${path}.${randomUUID()}.aside`;
      try {
        renameSync(path, aside);
        if (recordOf(readFileSync(aside, "utf-8"))?.token !== token) {
          putBackSync(aside, path);
        }
      } catch {
        // Gone already, unreadable, or taken again: the lease ends it.
      }
      rmSync(aside, { force: true });
    }
  });
}

/** The error codes of a file system that has no hard links. */
const NO_LINKS = new Set(["EPERM", "ENOTSUP", "ENOSYS", "EOPNOTSUPP"]);

/**
 * Puts the hold's file at `path`, where nothing is: written in full under a
 * name of its own, then linked into place, so the path never names half a
 * record and the step either takes the path or finds it taken (`EEXIST`).
 * On a file system with no hard links it is created at the path itself.
 */
async function placeHold(path: string, text: string): Promise<void> {
  const whole = `${path}.${randomUUID()}.new`;
  try {
    await writeFile(whole, text, { encoding: "utf-8", flag: "wx" });
    await link(whole, path);
  } catch (error) {
    if (!noLinks(error)) throw error;
    await writeFile(path, text, { encoding: "utf-8", flag: "wx" });
  } finally {
    await rm(whole, { force: true });
  }
}

/**
 * One try at putting this taking's hold at `path`: `"own"` where the path
 * then names it, `"no-folder"` where the folder is not there to put it in,
 * and `"taken"` where another's is at the path, or took it before this
 * one's was seen there (a writer stopped between placing its file and
 * looking may find another's in its place).
 */
async function tryTake(
  path: string,
  text: string,
  token: string
): Promise<"own" | "no-folder" | "taken"> {
  try {
    await placeHold(path, text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "no-folder";
    if (alreadyThere(error)) return "taken";
    throw error;
  }
  return (await readHold(path))?.record?.token === token ? "own" : "taken";
}

/**
 * The hold standing in a taker's way at `path`, or undefined where there is
 * none to wait for: it has gone, or it had lapsed and is now set aside.
 */
async function holdInTheWay(path: string): Promise<HoldReading | undefined> {
  const standing = await readHold(path);
  if (standing === undefined) return undefined;
  if (!(await hasLapsed(path, standing))) return standing;
  await setLapsedAside(path, standing);
  return undefined;
}

/**
 * Takes `path` for `record`, trying until it is this taking's or the wait
 * `whenHeld` allows is over, and answers whether the folder had to be made
 * again on the way (it goes with a holder that had made it only to hold it).
 */
async function takePath(args: {
  path: string;
  migrationsDir: string;
  record: HoldRecord;
  whenHeld: WhenHeld;
}): Promise<{ madeFolder: boolean }> {
  const { path, record } = args;
  const started = Date.now();
  const deadline = started + (args.whenHeld === "wait" ? bounds.waitMs : 0);
  const text = JSON.stringify(record, null, 2) + "\n";
  let madeFolder = false;
  for (;;) {
    const taken = await tryTake(path, text, record.token);
    if (taken === "own") return { madeFolder };
    if (taken === "no-folder") {
      await mkdir(args.migrationsDir, { recursive: true });
      madeFolder = true;
      continue;
    }
    const standing = await holdInTheWay(path);
    if (standing === undefined) continue;
    if (Date.now() >= deadline) {
      throw await heldError(
        path,
        record.command,
        args.whenHeld,
        standing,
        Date.now() - started
      );
    }
    await new Promise(done => setTimeout(done, WRITER_POLL_MS));
  }
}

/**
 * The hold a taking has, once its file is at `path`: renewed while its
 * holder runs, checked before each write, and given up as the holder ends.
 */
function holdTaken(args: {
  path: string;
  migrationsDir: string;
  record: HoldRecord;
  /** Whether the folder was made only to hold the file. */
  madeFolder: boolean;
}): WriterHold {
  const { path, migrationsDir, record } = args;
  const key = `${path}#${record.token}`;
  held.set(key, { path, token: record.token });
  releaseOnExit();
  let lost = false;
  /** Whether the hold is still this taking's; renews it where it is. */
  const stillOwn = () => renewOwn(path, record.token);
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
    command: record.command,
    assertHeld: async () => {
      const own = lost ? undefined : await stillOwn();
      if (own === true) return;
      lost = true;
      throw writerLostError(record.command, own?.command);
    },
    release: async () => {
      clearInterval(renewal);
      held.delete(key);
      // Only this taking's file: after a stall, the path may name another's.
      await takeFromPath(path, moved => moved.record?.token === record.token);
      // A folder made only to hold the file goes with it, where nothing was written.
      if (args.madeFolder) await rmdir(migrationsDir).catch(() => undefined);
    },
  };
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
  const madeAtStart =
    (await mkdir(migrationsDir, { recursive: true })) !== undefined;
  const record: HoldRecord = {
    token: randomUUID(),
    command: args.command,
    owner: `${hostname()}:${String(process.pid)}`,
    startedAt: new Date().toISOString(),
    leaseSeconds: bounds.leaseSeconds,
  };
  try {
    const { madeFolder } = await takePath({
      path,
      migrationsDir,
      record,
      whenHeld: args.whenHeld,
    });
    return holdTaken({
      path,
      migrationsDir,
      record,
      madeFolder: madeAtStart || madeFolder,
    });
  } catch (error) {
    // Refused: a folder made only to hold the file is not left behind.
    if (madeAtStart) await rmdir(migrationsDir).catch(() => undefined);
    throw error;
  }
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
    await releaseAll(holds);
  }
}

/**
 * The hold a command takes for the rest of its run, as
 * `withMigrationWriterHold` takes it, for a command whose run is one long
 * function rather than a step that can be handed over: `enter` is called
 * from that function itself, so what it goes on to do runs under the hold,
 * and `release` as it ends. A dry run, which writes nothing, gets a hold
 * that holds nothing.
 */
export async function commandWriterHold(args: {
  migrationsDir: string;
  command: string;
  dryRun: boolean;
}): Promise<{ enter(): void; release(): Promise<void> }> {
  if (args.dryRun) {
    return { enter: () => undefined, release: () => Promise.resolve() };
  }
  const hold = await acquireWriterHold({ ...args, whenHeld: "wait" });
  const holds = new Map([[hold.migrationsDir, hold]]);
  return {
    enter: () =>
      scope.enterWith({ command: args.command, whenHeld: "wait", holds }),
    release: () => releaseAll(holds),
  };
}

/** Gives up every hold a writer took, as it ends. */
async function releaseAll(holds: Map<string, WriterHold>): Promise<void> {
  for (const hold of holds.values()) await hold.release();
}

/**
 * Run a Schema Builder change, `work`, so that a migration it writes is
 * written holding its folder, refused at once where another writer holds it,
 * and kept until `work` ends.
 *
 * Given `migrationsDir` (a save that has a writer, which knows where its
 * migration goes), the hold is taken before `work` begins: before the save
 * changes its definition, which another writer reading the folder would
 * otherwise take for a change to write. Without it, the hold is taken when
 * the change first reads or writes the folder.
 */
export async function withBuilderWriterScope<T>(
  label: string,
  work: () => Promise<T>,
  migrationsDir?: string
): Promise<T> {
  const held = async () => {
    if (migrationsDir !== undefined) await holdInBuilderChange(migrationsDir);
    return work();
  };
  // A change made inside another's scope writes under that one's holds.
  if (scope.getStore() !== undefined) return held();
  const holds = new Map<string, WriterHold>();
  try {
    return await scope.run({ command: label, whenHeld: "refuse", holds }, held);
  } finally {
    await releaseAll(holds);
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
  await underWriterHold(migrationsDir, running.command, () =>
    Promise.resolve(undefined)
  );
}

/** The `logContext.reason` of a writer whose starting snapshot is no longer the newest. */
export const WRITER_START_MOVED_REASON =
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
  return NextlyError.serviceUnavailable({
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

/** A file written in full under another name, waiting to be put at its own. */
export interface PreparedFile {
  /** Where the file goes. */
  readonly path: string;
  /** Moves it to its own name, in one step. */
  place(): Promise<void>;
  /** Removes it where it was never placed. */
  discard(): Promise<void>;
}

/**
 * Write `text` in full under a name beside `path`, to be moved there with
 * `place`: a reader then finds the whole file at `path` or none.
 */
export async function prepareWhole(
  path: string,
  text: string
): Promise<PreparedFile> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, { encoding: "utf-8", flag: "wx" });
  return {
    path,
    place: () => rename(temporary, path),
    discard: () => rm(temporary, { force: true }),
  };
}

/** Write `text` at `path` so a reader finds the whole file or none. */
export async function writeWhole(path: string, text: string): Promise<void> {
  const file = await prepareWhole(path, text);
  try {
    await file.place();
  } catch (error) {
    await file.discard();
    throw error;
  }
}

/**
 * The refusal of a writer that found itself overtaken once its files were in
 * place. They are left: a migration file in the folder may already be
 * applied, and a writer never removes one. The developer is told which, and
 * to compare it with what the other writer wrote.
 */
function leftInPlaceError(
  command: string,
  files: readonly string[]
): NextlyError {
  const named = files.map(file => basename(file)).join(", ");
  return NextlyError.serviceUnavailable({
    publicMessage:
      `\`${command}\` lost its hold on this project's migration files as it wrote ${named}. ` +
      "It stopped for longer than its lease, so another run may have written a migration " +
      "from the same snapshot. What it wrote was left in place, since a migration file may " +
      "already be applied. Run it again once the newest migrations are compared: where two " +
      "make the same change, delete the one `nextly migrate:status` does not show applied.",
    logContext: { reason: WRITER_HOLD_LOST_REASON, command, left: files },
  });
}

/**
 * Publish a migration's files as the writer that holds `migrationsDir`.
 *
 * `prepare` writes each file in full under another name. The hold is checked
 * before that, and again with `stillCurrent` (the caller's own last check)
 * immediately before the files are put in place, in the order given, with
 * `alongside` (files written straight to their names, which it answers)
 * right after: a writer overtaken at any point before that puts nothing in
 * place.
 *
 * What is left is a writer stopped past its lease between that last check
 * and its files. The hold is checked once more after them, and a writer
 * overtaken by then stops and names what it wrote (`leftInPlaceError`). It
 * removes none of it: a migration file in the folder may already be applied
 * and recorded, and a writer never deletes one.
 *
 * Only a snapshot whose migration file then failed to follow it is
 * withdrawn: no reader counts it, and left it would describe a migration
 * that does not exist.
 */
export async function publishHeld(
  migrationsDir: string,
  prepare: () => Promise<readonly PreparedFile[]>,
  options: {
    stillCurrent?: () => Promise<void>;
    alongside?: () => readonly string[];
  } = {}
): Promise<void> {
  await assertWriterHold(migrationsDir);
  const files = await prepare();
  const placed: string[] = [];
  try {
    await assertWriterHold(migrationsDir);
    await options.stillCurrent?.();
    for (const file of files) {
      await file.place();
      placed.push(file.path);
    }
    placed.push(...(options.alongside?.() ?? []));
  } catch (error) {
    for (const file of files) await file.discard();
    // A snapshot whose migration file did not follow it. Once that file is
    // in place nothing is removed, the snapshot beside it included.
    if (!placed.some(path => path.endsWith(".sql"))) {
      for (const path of placed) await rm(path, { force: true });
    }
    throw error;
  }
  try {
    await assertWriterHold(migrationsDir);
  } catch (error) {
    if (!isWriterHoldLost(error)) throw error;
    throw leftInPlaceError(
      scope.getStore()?.command ?? "migrate:create",
      placed.filter(path => path.endsWith(".sql"))
    );
  }
}
