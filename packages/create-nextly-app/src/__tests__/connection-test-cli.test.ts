/**
 * The connection test as a run without questions meets it, with nothing
 * mocked: a PostgreSQL string whose server is not there (port 1 on this
 * machine, where nothing listens) stops the run with exit code 1, the folder
 * untouched, and no user name, password or query in anything printed. A run
 * given no string reads DATABASE_URL and tests that.
 */
import { access, mkdir } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ui } from "./clack-recorder";
import {
  type FakeRun,
  HERMETIC,
  USER_AGENTS,
  captureConsole,
  installFakeManagers,
  makeWorkdir,
  printed,
  removeWorkdir,
  runCli,
} from "./scaffold-harness";

vi.mock("@clack/prompts", async () =>
  (await import("./clack-recorder")).clack()
);
// Every usage event the run sends, to check none carries the string.
const events = vi.hoisted(() => [] as unknown[]);
vi.mock("@nextlyhq/telemetry", async () => ({
  ...(await import("./clack-recorder")).telemetry(),
  capture: (...event: unknown[]) => {
    events.push(event);
  },
}));

const USER = "ct_user";
const PASSWORD = "Ct-S3cr3t-Pw";
const QUERY_SECRET = "Ct-Qu3ry-S3cret";
const UNREACHABLE = `postgresql://${USER}:${PASSWORD}@127.0.0.1:1/site?password=${QUERY_SECRET}`;

let dir: string;
let work: string;
let fakes: FakeRun;

beforeEach(async () => {
  ui.reset();
  events.length = 0;
  captureConsole();
  dir = await makeWorkdir("nextly-conn-cli-");
  work = path.join(dir, "work");
  await mkdir(work);
  fakes = await installFakeManagers(dir);
  vi.stubEnv("npm_config_user_agent", USER_AGENTS.pnpm);
  vi.stubEnv("DATABASE_URL", "");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await removeWorkdir(dir);
});

const allOutput = () => [...ui.out, ...printed].join("\n");

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false
  );
}

function holdsNoSecret(text: string) {
  // The usage events too: the run sent at least its failure.
  expect(events.length).toBeGreaterThan(0);
  const everything = [text, JSON.stringify(events)].join("\n");
  for (const secret of [USER, PASSWORD, QUERY_SECRET]) {
    expect(everything).not.toContain(secret);
  }
}

describe("the connection test before anything is written", () => {
  it("stops a --yes run whose server can't be reached: exit 1, no folder, no secret printed", async () => {
    const code = await runCli(
      [
        "my-app",
        "-t",
        "blank",
        "-d",
        "postgresql",
        "--yes",
        "--database-url",
        UNREACHABLE,
        ...HERMETIC,
      ],
      { cwd: work, tty: true }
    );
    expect(code).toBe(1);
    expect(allOutput()).toContain(
      "Can't reach the PostgreSQL server at 127.0.0.1:1."
    );
    expect(await exists(path.join(work, "my-app"))).toBe(false);
    expect(await fakes.calls()).toEqual([]);
    holdsNoSecret(allOutput());
  });

  it("without a terminal and no --database-url, reads DATABASE_URL and tests it", async () => {
    vi.stubEnv("DATABASE_URL", UNREACHABLE);
    const code = await runCli(
      ["my-app", "-t", "blank", "-d", "postgresql", ...HERMETIC],
      { cwd: work }
    );
    expect(code).toBe(1);
    // Tested, not refused as a missing --database-url.
    expect(allOutput()).not.toContain("--database-url <url>");
    expect(allOutput()).toContain(
      "Can't reach the PostgreSQL server at 127.0.0.1:1."
    );
    expect(await exists(path.join(work, "my-app"))).toBe(false);
    holdsNoSecret(allOutput());
  });
});
