/**
 * Whether `nextly repair-columns --apply` may ask before clearing a lossy column's values is decided
 * once, before anything is asked, from whether standard input and standard output are both
 * terminals, with `--non-interactive` forcing a run that may not. A run that may not never reads
 * standard input: it skips and reports the lossy column, and converts the safe one.
 *
 * The apply is the real one, over a SQLite database holding a safe difference (a required
 * relationship's NOT NULL) and a lossy one (an integer column becoming a real, holding a word). The
 * terminal question is stood in for, so each case observes whether it was put; standard input is a
 * stream each case owns, watched for any read. A terminal run with no `--non-interactive` is the
 * positive control: there the question is put.
 */
import { PassThrough } from "node:stream";

import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  adapter: undefined as unknown,
  entities: [] as unknown[],
  asked: [] as string[],
}));

vi.mock("@clack/prompts", async importOriginal => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  confirm: (options: { message: string }) => {
    state.asked.push(options.message);
    return Promise.resolve(false);
  },
}));
vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: "sqlite",
    databaseUrl: "file:./unused.db",
  }),
  // The test's own database, which the command must not close: the test reads it afterwards.
  createCliAdapter: () =>
    Promise.resolve(
      new Proxy(state.adapter as object, {
        get(target, property) {
          if (property === "disconnect") return () => Promise.resolve();
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    ),
}));
vi.mock("../../utils/config-loader", () => ({
  loadConfig: () =>
    Promise.resolve({
      config: { db: { migrationsDir: "migrations" } },
      projectRoot: "/project",
    }),
}));
vi.mock("../../utils/registry-resolver", () => ({
  installRegistryResolver: () => {},
}));
vi.mock("../../../domains/schema/repair-columns/read-entities", () => ({
  readRepairEntities: () => Promise.resolve(state.entities),
}));

import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import {
  collection,
  f,
  tableTools,
} from "../../../domains/schema/repair-columns/__tests__/apply-fixture";
import { COLUMN_REPAIRS_TABLE } from "../../../domains/schema/repair-columns/record";
import { createContext } from "../../context";
import { repairColumnsAction } from "../repair-columns";

const TABLE = "dc_ri_posts";
const TITLE = f({ name: "title", type: "text" });
const AUTHOR = f({
  name: "author",
  type: "relationship",
  relationTo: "users",
  required: true,
});
const PRICE = f({
  name: "price",
  type: "number",
  options: { format: "float" },
});

const command = () =>
  ({ optsWithGlobals: () => ({ cwd: "/project" }) }) as unknown as Command;

/** A stream standing in for standard input, with every way of reading it watched. */
function watchedInput(options: { tty: boolean; closed?: boolean }) {
  const stream = new PassThrough() as PassThrough & { isTTY?: boolean };
  if (options.tty) stream.isTTY = true;
  if (options.closed === true) stream.end();
  const reads = [
    vi.spyOn(stream, "read"),
    vi.spyOn(stream, "resume"),
    vi.spyOn(stream, "pipe"),
  ];
  const listens = [
    vi.spyOn(stream, "on"),
    vi.spyOn(stream, "once"),
    vi.spyOn(stream, "addListener"),
  ];
  const readEvents = new Set(["data", "readable", "keypress", "end"]);
  return {
    stream,
    /** Every attempt to read: a read call, or a listener for what a read delivers. */
    attempts: () => [
      ...reads.flatMap(spy => spy.mock.calls.map(() => "read")),
      ...listens.flatMap(spy =>
        spy.mock.calls
          .map(([event]) => String(event))
          .filter(event => readEvents.has(event))
      ),
    ],
  };
}

describe("repair-columns --apply decides whether it may ask before it asks anything", () => {
  let handle: TestNextly;
  const tools = tableTools(() => handle.adapter, "sqlite");
  const originalStdin = Object.getOwnPropertyDescriptor(process, "stdin");
  const originalStdoutTty = Object.getOwnPropertyDescriptor(
    process.stdout,
    "isTTY"
  );

  /** Run the command with `stdin` as standard input and standard output a terminal or a pipe. */
  async function runWith(
    stdin: PassThrough,
    stdoutTty: boolean
  ): Promise<number> {
    Object.defineProperty(process, "stdin", {
      value: stdin,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: stdoutTty,
      configurable: true,
    });
    const started = Date.now();
    await repairColumnsAction(createContext)({ apply: true }, command());
    return Date.now() - started;
  }

  beforeEach(async () => {
    handle = await createTestNextly({});
    state.adapter = handle.adapter;
    state.asked = [];
    // A run under CI may never ask; each case decides whether it is one.
    vi.stubEnv("CI", "");
    await tools.createTable(TABLE, [TITLE, AUTHOR]);
    await tools.run(`ALTER TABLE "${TABLE}" ADD COLUMN "price" integer`);
    await tools.insert(TABLE, [
      { id: "p1", title: "a", author: "u1", price: 3 },
      { id: "p2", title: "b", author: "u2", price: "word" },
    ]);
    state.entities = [collection(TABLE, [TITLE, AUTHOR, PRICE])];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    setNonInteractive(false);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (originalStdin !== undefined) {
      Object.defineProperty(process, "stdin", originalStdin);
    }
    if (originalStdoutTty !== undefined) {
      Object.defineProperty(process.stdout, "isTTY", originalStdoutTty);
    } else {
      Reflect.deleteProperty(process.stdout, "isTTY");
    }
    process.exitCode = undefined;
    await tools.run(`DROP TABLE IF EXISTS "${TABLE}"`);
    await tools.run(`DROP TABLE IF EXISTS "${COLUMN_REPAIRS_TABLE}"`);
    await handle?.destroy();
  });

  /** The lossy column skipped and unchanged, the safe one converted, and no question put. */
  async function expectSkippedAndConverted(label: string) {
    expect(state.asked, label).toEqual([]);
    expect(await tools.columnState(TABLE, "price"), label).toMatchObject({
      type: "integer",
    });
    expect(await tools.values(TABLE, "price"), label).toEqual({
      p1: 3,
      p2: "word",
    });
    expect(await tools.columnState(TABLE, "author"), label).toMatchObject({
      nullable: true,
    });
    // The lossy column remains, so differences remain.
    expect(process.exitCode, label).toBe(2);
  }

  it("no terminal, standard input an open pipe never written to: no read is attempted and the run ends promptly", async () => {
    const input = watchedInput({ tty: false });
    const took = await runWith(input.stream, false);
    expect(input.attempts()).toEqual([]);
    expect(took).toBeLessThan(10_000);
    await expectSkippedAndConverted("open pipe");
  });

  it("standard input closed", async () => {
    const input = watchedInput({ tty: false, closed: true });
    await runWith(input.stream, false);
    expect(input.attempts()).toEqual([]);
    await expectSkippedAndConverted("closed");
  });

  it("standard input a terminal and output a pipe", async () => {
    const input = watchedInput({ tty: true });
    await runWith(input.stream, false);
    expect(input.attempts()).toEqual([]);
    await expectSkippedAndConverted("output a pipe");
  });

  it("--non-interactive under a terminal", async () => {
    setNonInteractive(true);
    const input = watchedInput({ tty: true });
    await runWith(input.stream, true);
    expect(input.attempts()).toEqual([]);
    await expectSkippedAndConverted("--non-interactive");
  });

  it("a terminal on both, with nothing forcing it off, asks about the lossy column (and a no skips it)", async () => {
    const input = watchedInput({ tty: true });
    await runWith(input.stream, true);
    // The positive control: the same run asks once, naming the column, its count and its row.
    expect(state.asked).toEqual([
      `${TABLE}.price: 1 value the new type cannot hold would be cleared (set to null), in rows p2. Clear them and convert the column?`,
    ]);
    expect(await tools.values(TABLE, "price")).toEqual({ p1: 3, p2: "word" });
    expect(await tools.columnState(TABLE, "author")).toMatchObject({
      nullable: true,
    });
  });
});
