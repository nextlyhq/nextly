/**
 * Running the playground's own `next dev` from a spec, apart from the main
 * suite's server.
 *
 * For specs that need a server the main suite can't give them: one that is
 * restarted, edited under, or started on an empty database. Each run gets its
 * own port, build directory and database, so it never fights another server
 * of this app, and it is stopped and waited for before anything it wrote is
 * removed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PLAYGROUND = path.resolve(HERE, "..", "..", "apps", "playground");
export const NEXT_BIN = path.join(PLAYGROUND, "node_modules", ".bin", "next");

/** A port no other process holds right now, chosen by the operating system. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** The playground's .env.example values: what a fresh checkout starts with. */
export function exampleEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const raw = readFileSync(path.join(PLAYGROUND, ".env.example"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

/** Polls until `check` holds, or fails naming what it waited for. */
export async function waitFor(
  what: string,
  check: () => boolean | Promise<boolean>,
  ms: number
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 500));
  }
}

/** Sends `signal` to the dev server and everything it started. */
function signal(server: ChildProcess, name: NodeJS.Signals): void {
  if (server.pid === undefined) return;
  try {
    // Started detached, so the negative pid is its whole process group:
    // `next dev` runs its server in a child of its own.
    process.kill(-server.pid, name);
  } catch {
    server.kill(name);
  }
}

/**
 * Stops the dev server and waits for it to exit, so nothing is still writing
 * into its build directory when that is removed.
 */
export async function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise<void>(resolve =>
    server.once("exit", () => resolve())
  );
  signal(server, "SIGTERM");
  const outcome = await Promise.race([
    exited.then(() => "exited" as const),
    new Promise<"slow">(resolve => setTimeout(() => resolve("slow"), 15_000)),
  ]);
  if (outcome === "slow") {
    signal(server, "SIGKILL");
    await exited;
  }
}

/**
 * Remembers which of the files `next dev` writes into an app root that lacks
 * them (Next.js 16 adds agent instructions there) are present now, and returns
 * what removes the ones a run created. Call it before the first server starts.
 */
export function cleanUpNextWrites(): () => void {
  const files = ["AGENTS.md", "CLAUDE.md"].map(name =>
    path.join(PLAYGROUND, name)
  );
  const presentBefore = new Set(files.filter(file => existsSync(file)));
  return () => {
    for (const file of files) {
      if (!presentBefore.has(file)) rmSync(file, { force: true });
    }
  };
}

/** A running playground on an empty database, for a spec that sets it up. */
export interface EmptyPlayground {
  /** The port it serves, at `localhost`, its own address. */
  port: number;
  /** Everything it has printed, for a failure to attach. */
  output: () => string;
  /** Stops it and removes its build directory and database. */
  close: () => Promise<void>;
}

/**
 * Starts the playground's `next dev` on an empty SQLite database, with its own
 * port and build directory, and waits until it answers. For specs that need a
 * first-run setup the suite's own server cannot offer: that one seeds a user
 * and signs in by itself.
 */
export async function startEmptyPlayground(
  label: string
): Promise<EmptyPlayground> {
  const port = await freePort();
  const work = mkdtempSync(path.join(tmpdir(), `nextly-${label}-`));
  const distDir = `.next-${label}`;
  let output = "";
  const app = spawn(NEXT_BIN, ["dev", "-p", String(port)], {
    cwd: PLAYGROUND,
    env: {
      ...exampleEnv(),
      ...process.env,
      DB_DIALECT: "sqlite",
      DATABASE_URL: `file:${path.join(work, "setup.db")}`,
      // Its own build directory, so it never fights another server of this app.
      NEXT_DIST_DIR: distDir,
      NODE_ENV: "development",
      PORT: String(port),
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout?.on("data", chunk => (output += String(chunk)));
  app.stderr?.on("data", chunk => (output += String(chunk)));
  const close = async () => {
    await stop(app);
    rmSync(path.join(PLAYGROUND, distDir), {
      recursive: true,
      force: true,
      maxRetries: 5,
    });
    rmSync(work, { recursive: true, force: true });
  };
  try {
    await waitFor(
      "the playground to answer",
      async () =>
        (
          await fetch(
            `http://localhost:${port}/admin/api/auth/setup-status`
          ).catch(() => null)
        )?.ok === true,
      4 * 60 * 1000
    );
  } catch (error) {
    await close();
    throw error;
  }
  return { port, output: () => output, close };
}
