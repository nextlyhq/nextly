/**
 * The env files a project ends up with, after the generator writes them into a
 * new project or merges them into an app that already has its own.
 *
 * Each case runs against a real temporary directory, because the defects were
 * about what lands on disk: the example file, which a template project
 * commits, carried the real NEXTLY_SECRET; an existing `.env` with
 * DATABASE_URL got none of Nextly's other values, so production answered 500;
 * and an existing `.env.example` was replaced whole.
 */
import { execFileSync } from "node:child_process";
import {
  link,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateEnv } from "../generators/env";
import type { DatabaseConfig } from "../types";
import { readEnvKeys } from "../utils/env-file";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nextly-env-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

// A URL given on the command line carries a real password; the example file
// must get the generic one instead.
const postgresWithRealUrl: DatabaseConfig = {
  type: "postgresql",
  adapter: "@nextlyhq/adapter-postgres",
  databaseDriver: "pg",
  connectionUrl: "postgresql://app:S3cr3tPassw0rd@db.internal:5432/app",
  envExample: "postgresql://user:password@localhost:5432/nextly",
};

const read = (name: string) => readFile(join(dir, name), "utf8");
const keysOf = async (name: string) => readEnvKeys(await read(name)).defined;

describe("a new project's env files", () => {
  it("puts the real secret only in .env, and a placeholder in .env.example", async () => {
    await generateEnv(dir, sqlite);

    const env = await keysOf(".env");
    const example = await keysOf(".env.example");
    expect(env.get("NEXTLY_SECRET")?.length).toBeGreaterThanOrEqual(32);
    expect(example.get("NEXTLY_SECRET")).toBe("");
    expect(await read(".env.example")).not.toContain(env.get("NEXTLY_SECRET"));
  });

  it("keeps a database URL given on the command line out of .env.example", async () => {
    await generateEnv(dir, postgresWithRealUrl);

    expect((await keysOf(".env")).get("DATABASE_URL")).toBe(
      postgresWithRealUrl.connectionUrl
    );
    expect((await keysOf(".env.example")).get("DATABASE_URL")).toBe(
      postgresWithRealUrl.envExample
    );
    expect(await read(".env.example")).not.toContain("S3cr3tPassw0rd");
  });

  it("writes the values Nextly reads, in both files", async () => {
    await generateEnv(dir, sqlite);

    for (const name of [".env", ".env.example"]) {
      const keys = await keysOf(name);
      expect(keys.get("DB_DIALECT")).toBe("sqlite");
      expect(keys.get("DATABASE_URL")).toBe("file:./data/nextly.db");
      // The core reads NEXT_PUBLIC_APP_URL for preview links, invite emails and
      // absolute API URLs.
      expect(keys.get("NEXT_PUBLIC_APP_URL")).toBe("http://localhost:3000");
      // The public site's origin is documented but commented: an uncommented
      // localhost here would override the app's own origin in every deployment.
      expect(keys.has("NEXT_PUBLIC_SITE_URL")).toBe(false);
      expect(await read(name)).toContain("# NEXT_PUBLIC_SITE_URL=");
      // The diagnostics opt-in is explained, and left off: it is the second of
      // two signals, and a default here would be true in exactly the case it
      // guards against.
      expect(await read(name)).toContain("# NEXTLY_DEV_DIAGNOSTICS=1");
      expect(keys.has("NEXTLY_DEV_DIAGNOSTICS")).toBe(false);
      expect(await read(name)).not.toMatch(
        /STORAGE_ADAPTER|S3_BUCKET|BLOB_READ_WRITE_TOKEN/
      );
    }
  });

  it("reports both files as written, and the .gitignore it had to create", async () => {
    // This directory has no .gitignore at all, so nothing kept .env out of git.
    const { files } = await generateEnv(dir, sqlite);

    expect(files.written.sort()).toEqual([
      ".env",
      ".env.example",
      ".gitignore",
    ]);
    expect(await read(".gitignore")).toMatch(/^\.env$/m);
  });
});

describe("an existing .env", () => {
  const existing = `# the app's own settings
DATABASE_URL=file:./data/mine.db
export SOME_APP_KEY="kept as it is"
`;

  it("keeps every line and adds only the values Nextly needs that it lacks", async () => {
    await writeFile(join(dir, ".env"), existing);

    const { files } = await generateEnv(dir, sqlite);

    const after = await read(".env");
    expect(after.startsWith(existing)).toBe(true);
    const keys = readEnvKeys(after).defined;
    expect(keys.get("DATABASE_URL")).toBe("file:./data/mine.db");
    expect(keys.get("SOME_APP_KEY")).toBe("kept as it is");
    expect(keys.get("DB_DIALECT")).toBe("sqlite");
    expect(keys.get("NEXTLY_SECRET")?.length).toBeGreaterThanOrEqual(32);
    expect(keys.get("NEXT_PUBLIC_APP_URL")).toBe("http://localhost:3000");
    // DATABASE_URL was there, so it is not added a second time.
    expect(after.match(/^DATABASE_URL=/gm)).toHaveLength(1);
    expect(files.changed).toEqual([
      {
        path: ".env",
        added: [
          "DB_DIALECT",
          "NEXTLY_SECRET",
          "NEXT_PUBLIC_APP_URL",
          "the NEXTLY_DEV_DIAGNOSTICS note",
        ],
      },
    ]);
  });

  it("counts a key named only in a comment as missing", async () => {
    await writeFile(join(dir, ".env"), "# NEXTLY_SECRET=\nDATABASE_URL=x\n");

    await generateEnv(dir, sqlite);

    expect(
      (await keysOf(".env")).get("NEXTLY_SECRET")?.length
    ).toBeGreaterThanOrEqual(32);
  });

  // A usable-length value built at run time, so no secret-shaped literal sits
  // in the source for a secret scanner to stop on.
  const usable = "k".repeat(32);

  it.each([
    ["export form", `export NEXTLY_SECRET=${usable}`],
    ["quoted", `NEXTLY_SECRET="${usable}"`],
    ["spaced around =", `NEXTLY_SECRET = ${usable}`],
  ])("recognises a key written as %s", async (_label, line) => {
    await writeFile(join(dir, ".env"), `DATABASE_URL=x\n${line}\n`);

    await generateEnv(dir, sqlite);

    expect((await read(".env")).match(/NEXTLY_SECRET/g)).toHaveLength(1);
  });

  it("does not mistake a similarly named variable for a key", async () => {
    await writeFile(
      join(dir, ".env"),
      "DATABASE_URL_BACKUP=x\nNEXTLY_DEV_DIAGNOSTICS_BACKUP=1\n"
    );

    await generateEnv(dir, sqlite);

    const keys = await keysOf(".env");
    expect(keys.get("DATABASE_URL")).toBe("file:./data/nextly.db");
    expect(await read(".env")).toContain("# NEXTLY_DEV_DIAGNOSTICS=1");
  });

  it("leaves a secret too short for production, and says what to change without printing it", async () => {
    await writeFile(
      join(dir, ".env"),
      "DATABASE_URL=x\nNEXTLY_SECRET=short-one\n"
    );

    const { warnings } = await generateEnv(dir, sqlite);

    expect((await keysOf(".env")).get("NEXTLY_SECRET")).toBe("short-one");
    expect(warnings.join("\n")).toMatch(/NEXTLY_SECRET.*\.env.*32/);
    expect(warnings.join("\n")).not.toContain("short-one");
  });

  // dotenv ends an unquoted value at the first `#`, spaced or not, so the
  // app gets `short` here; reading the comment as part of the value took it
  // for a secret long enough for production.
  it("reads a secret the way dotenv does when a comment follows it unspaced", async () => {
    await writeFile(
      join(dir, ".env"),
      `DATABASE_URL=x\nNEXTLY_SECRET=short#${"c".repeat(40)}\n`
    );

    const { warnings } = await generateEnv(dir, sqlite);

    expect(warnings.join("\n")).toMatch(/NEXTLY_SECRET.*\.env.*32/);
  });

  // An empty value is the app's line, so it stays, but Nextly cannot start on
  // it: a PostgreSQL or MySQL URL is required.
  it("keeps an empty required value, and says it needs one without printing the URL given", async () => {
    await writeFile(join(dir, ".env"), "DATABASE_URL=\n");

    const { warnings } = await generateEnv(dir, postgresWithRealUrl);

    expect(await read(".env")).toMatch(/^DATABASE_URL=\n/);
    expect(warnings.join("\n")).toMatch(/DATABASE_URL in \.env is empty/);
    expect(warnings.join("\n")).not.toContain("S3cr3tPassw0rd");
  });

  it("changes nothing and reports nothing on a second run", async () => {
    await writeFile(join(dir, ".env"), existing);
    await generateEnv(dir, sqlite);
    const first = await read(".env");

    const { files } = await generateEnv(dir, sqlite);

    expect(await read(".env")).toBe(first);
    expect(files.changed.filter(f => f.path === ".env")).toEqual([]);
  });

  it("scans a blank-line-heavy file without backtracking", async () => {
    await writeFile(
      join(dir, ".env"),
      "DATABASE_URL=x\n" + "   \n".repeat(20000)
    );

    const started = performance.now();
    await generateEnv(dir, sqlite);

    // Generous: this fails on catastrophic backtracking, not on a slow machine.
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("an existing .env.example", () => {
  const existingExample = `# the app's documented settings
NEXT_PUBLIC_SITE_URL=http://localhost:3000
`;

  it("keeps every line and appends Nextly's missing keys with placeholders", async () => {
    await writeFile(join(dir, ".env.example"), existingExample);

    const { files } = await generateEnv(dir, sqlite);

    const after = await read(".env.example");
    expect(after.startsWith(existingExample)).toBe(true);
    const keys = readEnvKeys(after).defined;
    expect(keys.get("NEXTLY_SECRET")).toBe("");
    expect(keys.get("DB_DIALECT")).toBe("sqlite");
    expect(after).not.toContain((await keysOf(".env")).get("NEXTLY_SECRET"));
    expect(files.changed.find(f => f.path === ".env.example")?.added).toContain(
      "NEXTLY_SECRET"
    );
  });

  it("keeps a real-looking secret it finds there, and warns without printing it", async () => {
    const leaked = "Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5";
    await writeFile(join(dir, ".env.example"), `NEXTLY_SECRET=${leaked}\n`);

    const { warnings } = await generateEnv(dir, sqlite);

    expect(await read(".env.example")).toContain(`NEXTLY_SECRET=${leaked}`);
    const said = warnings.join("\n");
    expect(said).toMatch(/\.env\.example.*NEXTLY_SECRET/);
    expect(said).toMatch(/placeholder/);
    expect(said).not.toContain(leaked);
  });

  it("warns about a database password it finds there, without printing it", async () => {
    await writeFile(
      join(dir, ".env.example"),
      "DATABASE_URL=postgresql://app:S3cr3tPassw0rd@db:5432/app\n"
    );

    const { warnings } = await generateEnv(dir, postgresWithRealUrl);

    expect(warnings.join("\n")).toMatch(/\.env\.example.*DATABASE_URL/);
    expect(warnings.join("\n")).not.toContain("S3cr3tPassw0rd");
  });

  it("does not warn about the generic example values", async () => {
    await writeFile(
      join(dir, ".env.example"),
      "NEXTLY_SECRET=\nDATABASE_URL=postgresql://user:password@localhost:5432/nextly\n"
    );

    const { warnings } = await generateEnv(dir, postgresWithRealUrl);

    expect(warnings).toEqual([]);
  });
});

describe("keeping .env out of git", () => {
  it("adds .env to a .gitignore that does not ignore it, and says so", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules\n");

    const { files } = await generateEnv(dir, sqlite);

    expect(await read(".gitignore")).toMatch(/^node_modules\n[\s\S]*^\.env$/m);
    expect(files.changed).toContainEqual({
      path: ".gitignore",
      added: [".env"],
    });
  });

  it.each([".env*", ".env", "/.env", "*.env"])(
    "leaves a .gitignore that already ignores it with %s",
    async pattern => {
      await writeFile(join(dir, ".gitignore"), `${pattern}\n!.env.example\n`);

      await generateEnv(dir, sqlite);

      expect(await read(".gitignore")).toBe(`${pattern}\n!.env.example\n`);
    }
  );

  // Git reads a leading space as part of the pattern: ` .env` ignores a file
  // named " .env", not `.env`. Trailing spaces are dropped.
  it("adds .env when the only rule for it is indented, and accepts one with trailing spaces", async () => {
    await writeFile(join(dir, ".gitignore"), " .env\n");
    await generateEnv(dir, sqlite);
    expect(await read(".gitignore")).toMatch(/^\.env$/m);

    await rm(join(dir, ".gitignore"));
    await writeFile(join(dir, ".gitignore"), ".env   \n");
    await generateEnv(dir, sqlite);
    expect(await read(".gitignore")).toBe(".env   \n");
  });

  // Appending through a link would edit the shared file every other project
  // linking to it reads.
  it.each([
    ["a symbolic link", (target: string, at: string) => symlink(target, at)],
    ["a hard link", (target: string, at: string) => link(target, at)],
  ])(
    "leaves a .gitignore that is %s, and says what to add",
    async (_kind, makeLink) => {
      const shared = await mkdtemp(join(tmpdir(), "nextly-shared-"));
      try {
        await writeFile(join(shared, "gitignore"), "node_modules\n");
        await makeLink(join(shared, "gitignore"), join(dir, ".gitignore"));

        const { files } = await generateEnv(dir, sqlite);

        expect(await readFile(join(shared, "gitignore"), "utf8")).toBe(
          "node_modules\n"
        );
        expect(files.skipped).toContainEqual(
          expect.objectContaining({ path: ".gitignore", toAdd: ".env" })
        );
      } finally {
        await rm(shared, { recursive: true, force: true });
      }
    }
  );

  // A tracked file stays tracked whatever .gitignore says, so a secret written
  // to it goes out with the next commit.
  it("writes no secret to a .env git tracks, and says how to stop tracking it", async () => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await writeFile(join(dir, ".gitignore"), ".env\n");
    await writeFile(join(dir, ".env"), "DB_DIALECT=postgresql\n");
    execFileSync("git", ["add", "-f", ".env", ".gitignore"], { cwd: dir });

    const { warnings } = await generateEnv(dir, postgresWithRealUrl);

    const env = await read(".env");
    expect(readEnvKeys(env).defined.has("NEXTLY_SECRET")).toBe(false);
    expect(env).not.toContain("S3cr3tPassw0rd");
    expect(readEnvKeys(env).defined.get("NEXT_PUBLIC_APP_URL")).toBe(
      "http://localhost:3000"
    );
    const said = warnings.join("\n");
    expect(said).toMatch(/\.env is tracked by git/);
    expect(said).toContain("git rm --cached .env");
    expect(said).toMatch(/NEXTLY_SECRET/);
    expect(said).toMatch(/DATABASE_URL/);
    expect(await read(".gitignore")).toBe(".env\n");
  });

  it("writes a tracked .env deleted from the working tree without a secret too", async () => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await writeFile(join(dir, ".env"), "DB_DIALECT=sqlite\n");
    execFileSync("git", ["add", "-f", ".env"], { cwd: dir });
    await rm(join(dir, ".env"));

    await generateEnv(dir, sqlite);

    expect(readEnvKeys(await read(".env")).defined.has("NEXTLY_SECRET")).toBe(
      false
    );
  });

  it("stages no file holding the generated secret in a fresh repository", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules\n");
    execFileSync("git", ["init", "-q"], { cwd: dir });

    await generateEnv(dir, sqlite);

    execFileSync("git", ["add", "-A"], { cwd: dir });
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: dir,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    const secret = (await keysOf(".env")).get("NEXTLY_SECRET") ?? "";
    expect(secret.length).toBeGreaterThanOrEqual(32);
    for (const name of staged) {
      expect(await read(name)).not.toContain(secret);
    }
    expect(staged).toContain(".env.example");
    expect(existsSync(join(dir, ".env"))).toBe(true);
  });
});

describe("readEnvKeys", () => {
  it("reads defined keys, and keys named only in comments, line by line", () => {
    const { defined, mentioned } = readEnvKeys(
      [
        "A=1",
        "export B=two",
        'C="three # not a comment"',
        "D='four'",
        "E=five # a comment",
        "# F=commented",
        "#export G=7",
        "  H = eight  ",
        "not a key line",
        "I=",
        "J=unspaced#comment",
        "K=`backtick # quoted`",
      ].join("\n")
    );

    expect(Object.fromEntries(defined)).toEqual({
      A: "1",
      B: "two",
      C: "three # not a comment",
      D: "four",
      E: "five",
      H: "eight",
      I: "",
      J: "unspaced",
      K: "backtick # quoted",
    });
    expect([...mentioned].sort()).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
    ]);
  });
});
