/**
 * The line a command prints before it uses a database, on real commands.
 *
 * `migrate:status`, which only reads, and `nextly migrate`, which changes
 * the database, are each run as a process with the URL given by `.env.local`
 * and by the process environment with no file. The PostgreSQL and MySQL URLs
 * hold a user name, a password and a password query parameter, and point at
 * a port nothing listens on: the command says its line and then fails to
 * connect, and nothing it printed on either stream may hold any of the
 * three.
 *
 * The line says whether the database is on this machine (`● local · …`) or
 * not (`● LIVE database …`), by where it is and never by the mode: a remote
 * URL run with `NODE_ENV=development` is still live, and gets the hint that
 * says how to mark a development copy. The remote host is a `.invalid`
 * name, which no resolver answers, so the run fails at once after its line.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NEXTLY_RUN_TIMEOUT, runNextly } from "./helpers/run-nextly";

const SECRETS = ["appuser", "s3cr3t-pass", "hunter2-query", "sslmode"];
const POSTGRES =
  "postgresql://appuser:s3cr3t-pass@127.0.0.1:1/shop?sslmode=disable&password=hunter2-query";
const MYSQL =
  "mysql://appuser:s3cr3t-pass@127.0.0.1:1/shop?password=hunter2-query";
/** A live database's URL with every kind of credential, on a host nobody answers for. */
const REMOTE =
  "postgresql://appuser:s3cr3t-pass@db.prod.invalid:5432/app?sslmode=require&password=hunter2-query";
const LIVE_HINT =
  "This database isn't on this machine. If it's a development copy: nextly db mark-dev";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/** Runs `command` in a new project, the URL in `.env.local` or in the process environment alone. */
async function run(
  command: string,
  url: string,
  from: "file" | "process",
  env: Record<string, string | undefined> = {}
) {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "nextly-line-")));
  folders.push(project);
  if (from === "file") {
    writeFileSync(join(project, ".env"), "DATABASE_URL=file:./unused.db\n");
    writeFileSync(join(project, ".env.local"), `DATABASE_URL=${url}\n`);
  }
  const result = await runNextly([command], project, {
    DATABASE_URL: from === "process" ? url : undefined,
    DB_DIALECT: undefined,
    NODE_ENV: undefined,
    CI: undefined,
    ...env,
  });
  const lines = result.stderr.split("\n").filter(line => line.trim() !== "");
  return {
    project,
    first: lines[0],
    second: lines[1],
    all: `${result.stdout}\n${result.stderr}`,
  };
}

const SOURCES = {
  file: "from .env.local",
  process: "from the process environment",
} as const;

describe.each(["migrate:status", "migrate"])("nextly %s", command => {
  it.each([
    ["PostgreSQL", POSTGRES, "file"],
    ["PostgreSQL", POSTGRES, "process"],
    ["MySQL", MYSQL, "file"],
    ["MySQL", MYSQL, "process"],
  ] as const)(
    "names a %s host, port and database, and no user, password or query parameter (URL from the %s)",
    async (name, url, from) => {
      const { first, all } = await run(command, url, from);

      expect(first, all).toBe(
        `● local · 127.0.0.1:1/shop · ${name} (development; DATABASE_URL ${SOURCES[from]})`
      );
      // Nowhere in what it printed, the connection failure included.
      for (const secret of SECRETS) expect(all).not.toContain(secret);
    },
    NEXTLY_RUN_TIMEOUT
  );

  it(
    "names a SQLite file by its path resolved against the project folder",
    async () => {
      const { project, first, all } = await run(
        command,
        "file:./data/app.db",
        "file"
      );
      expect(first, all).toBe(
        `● local · ${join(project, "data", "app.db")} · SQLite (development; DATABASE_URL from .env.local)`
      );
    },
    NEXTLY_RUN_TIMEOUT
  );

  it(
    "names an in-memory SQLite database as :memory:",
    async () => {
      const { first, all } = await run(command, "file::memory:", "process");
      expect(first, all).toBe(
        "● local · :memory: · SQLite (development; DATABASE_URL from the process environment)"
      );
    },
    NEXTLY_RUN_TIMEOUT
  );

  it.each([["development"], ["production"], [undefined]] as const)(
    "names a remote PostgreSQL database LIVE, with the hint and no credential, under NODE_ENV=%s",
    async nodeEnv => {
      const { first, second, all } = await run(command, REMOTE, "file", {
        NODE_ENV: nodeEnv,
      });
      const mode = nodeEnv ?? "development";
      expect(first, all).toBe(
        `● LIVE database db.prod.invalid:5432/app · PostgreSQL (${mode}; DATABASE_URL from .env.local)`
      );
      expect(second, all).toBe(`  ${LIVE_HINT}`);
      for (const secret of SECRETS) expect(all).not.toContain(secret);
    },
    NEXTLY_RUN_TIMEOUT
  );

  it(
    "names a Docker service name and a private address LIVE: neither is this machine",
    async () => {
      for (const host of ["db", "10.0.0.5"]) {
        const { first, all } = await run(
          command,
          `postgresql://appuser:s3cr3t-pass@${host}:1/shop`,
          "process"
        );
        expect(first, all).toMatch(
          new RegExp(`^● LIVE database ${host.replace(/\./g, "\\.")}:1/shop · PostgreSQL `)
        );
      }
    },
    NEXTLY_RUN_TIMEOUT
  );

  it(
    "gives a deploy pipeline's live database its line and no hint",
    async () => {
      const { first, second, all } = await run(command, REMOTE, "file", {
        CI: "true",
      });
      expect(first, all).toMatch(/^● LIVE database db\.prod\.invalid:5432\/app /);
      expect(all).not.toContain(LIVE_HINT);
      expect(second ?? "", all).not.toMatch(/mark-dev/);
    },
    NEXTLY_RUN_TIMEOUT
  );
});
