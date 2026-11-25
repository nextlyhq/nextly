/**
 * The start-up timing can stop a run once its command has connected.
 *
 * With the start-up probe naming that point, the run says it has connected
 * once the database is open and its tables are loaded, gives the connection
 * up and ends there. Without it, or with the probe's other point, a command
 * gets its connection as always.
 *
 * What would separate a correct probe from a broken one:
 * - the line written before the tables' code loads (a time that leaves out
 *   what every connecting command pays);
 * - the run going on to the work after it, the installation check among it;
 * - the connection left open as the run ends;
 * - the exit, or a disconnect that fails, taken by the open's own error
 *   handling and reported as a database that cannot be reached;
 * - an open that does fail, no longer reported as one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CliError } from "../../errors";
import {
  STARTUP_PROBE_ENV,
  STARTUP_PROBE_EXIT,
  STARTUP_PROBE_LINES,
} from "../../startup-probe";
import { createCliAdapter } from "../adapter";

/** What the run did, in order, and what fails in it. */
const run = vi.hoisted(() => ({
  events: [] as string[],
  openFails: false,
  disconnectFails: false,
  checkFails: false,
}));

vi.mock("../../../database/factory", () => ({
  createAdapter: async () => {
    if (run.openFails) throw new Error("no such host");
    run.events.push("opened");
    return {
      getDrizzle: () => ({}),
      disconnect: async () => {
        run.events.push("disconnected");
        if (run.disconnectFails) throw new Error("already closed");
      },
    };
  },
}));
vi.mock("../registry-resolver", () => ({
  installRegistryResolver: () => {
    run.events.push("tables");
  },
}));
vi.mock(
  "../../../domains/schema/services/postgres-schema",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../domains/schema/services/postgres-schema")
    >()),
    assertInstallationInConfiguredSchema: async () => {
      run.events.push("checked");
      if (run.checkFails) throw new Error("another schema");
    },
  })
);

/** Thrown by the stand-in for `process.exit`, so the run stops where it would. */
class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${String(code)}`);
  }
}

const URLS = {
  sqlite: "file:./probe.db",
  postgresql: "postgres://probe@localhost/probe",
} as const;

/** Opens the database a command of `dialect` uses, and how that ended. */
function connect(dialect: keyof typeof URLS): Promise<unknown> {
  return createCliAdapter({ dialect, databaseUrl: URLS[dialect] }).catch(
    (error: unknown) => error
  );
}

let kept: string | undefined;
let written: string[];

beforeEach(() => {
  kept = process.env[STARTUP_PROBE_ENV];
  delete process.env[STARTUP_PROBE_ENV];
  written = [];
  Object.assign(run, {
    events: [],
    openFails: false,
    disconnectFails: false,
    checkFails: false,
  });
  vi.spyOn(process.stderr, "write").mockImplementation(
    (chunk: unknown, ...rest: unknown[]) => {
      written.push(String(chunk));
      const done = rest.find(each => typeof each === "function");
      if (typeof done === "function") done();
      return true;
    }
  );
  vi.spyOn(process, "exit").mockImplementation(code => {
    run.events.push("exit");
    throw new Exited(code === undefined ? undefined : Number(code));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (kept === undefined) delete process.env[STARTUP_PROBE_ENV];
  else process.env[STARTUP_PROBE_ENV] = kept;
});

/** The lines of the run's standard error the probe wrote. */
const probeLines = () =>
  written.filter(text => text.includes(STARTUP_PROBE_LINES.connected));

describe("the start-up probe's connected point", () => {
  it.each(["sqlite", "postgresql"] as const)(
    "ends a %s run once it has connected and its tables are loaded, its connection given up",
    async dialect => {
      process.env[STARTUP_PROBE_ENV] = "connected";

      const ended = await connect(dialect);

      expect(ended).toBeInstanceOf(Exited);
      expect((ended as Exited).code).toBe(STARTUP_PROBE_EXIT);
      expect(run.events).toEqual(["opened", "tables", "disconnected", "exit"]);
      expect(probeLines()).toEqual([`${STARTUP_PROBE_LINES.connected}\n`]);
    }
  );

  it("ends the run as the probe's, not as a failed connection, when the disconnect fails", async () => {
    process.env[STARTUP_PROBE_ENV] = "connected";
    run.disconnectFails = true;

    const ended = await connect("sqlite");

    expect(ended).toBeInstanceOf(Exited);
    expect((ended as Exited).code).toBe(STARTUP_PROBE_EXIT);
    expect(probeLines()).toHaveLength(1);
  });

  it("says nothing of a database that cannot be opened, which fails as it always does", async () => {
    process.env[STARTUP_PROBE_ENV] = "connected";
    run.openFails = true;

    expect(await connect("sqlite")).toBeInstanceOf(CliError);
    expect(probeLines()).toEqual([]);
    expect(run.events).toEqual([]);
  });
});

describe("a run the probe does not end", () => {
  it.each([undefined, "loaded", "1"])(
    "gets its connection, the probe being %s",
    async value => {
      if (value !== undefined) process.env[STARTUP_PROBE_ENV] = value;

      expect(await connect("postgresql")).toHaveProperty("disconnect");

      expect(run.events).toEqual(["opened", "tables", "checked"]);
      expect(probeLines()).toEqual([]);
    }
  );

  it("gives the connection up and fails when its installation is in another schema", async () => {
    run.checkFails = true;

    expect(await connect("postgresql")).toBeInstanceOf(CliError);
    expect(run.events).toEqual(["opened", "tables", "checked", "disconnected"]);
  });
});
