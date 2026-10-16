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
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fsExtra from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    // Nextly reads the dialect from the URL when DB_DIALECT is unset, so none
    // is added beside the app's URL: a second, explicit one could disagree.
    expect(keys.has("DB_DIALECT")).toBe(false);
    expect(keys.get("NEXTLY_SECRET")?.length).toBeGreaterThanOrEqual(32);
    expect(keys.get("NEXT_PUBLIC_APP_URL")).toBe("http://localhost:3000");
    // DATABASE_URL was there, so it is not added a second time.
    expect(after.match(/^DATABASE_URL=/gm)).toHaveLength(1);
    expect(files.changed).toEqual([
      {
        path: ".env",
        added: [
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

  // dotenv turns \n and \r in a double-quoted value into the characters, so
  // 16 escaped newlines are 16 characters to the app, not 32.
  it("measures a double-quoted secret after its escapes are decoded", async () => {
    await writeFile(
      join(dir, ".env"),
      `DATABASE_URL=x\nNEXTLY_SECRET="${"\\n".repeat(16)}"\n`
    );

    const { warnings } = await generateEnv(dir, sqlite);

    expect(warnings.join("\n")).toMatch(/NEXTLY_SECRET.*\.env.*32/);
  });

  // The dialect and the URL are one setting: appending the chosen database's
  // half beside the app's other half leaves an app that cannot connect.
  it.each([
    ["DB_DIALECT=postgresql\n", "DB_DIALECT"],
    ["DATABASE_URL=postgresql://localhost:5432/app\n", "DATABASE_URL"],
  ])(
    "adds neither database key when the app's (%s) is for another database, and says so",
    async (existing, key) => {
      await writeFile(join(dir, ".env"), existing);

      const { warnings } = await generateEnv(dir, {
        type: "mysql",
        adapter: "@nextlyhq/adapter-mysql",
        databaseDriver: "mysql2",
        connectionUrl: "mysql://root:x@localhost:3306/app",
        envExample: "mysql://user:password@localhost:3306/nextly",
      });

      const keys = readEnvKeys(await read(".env")).defined;
      expect(
        keys.has(key === "DB_DIALECT" ? "DATABASE_URL" : "DB_DIALECT")
      ).toBe(false);
      expect(warnings.join("\n")).toMatch(
        new RegExp(`${key} in \\.env.*mysql`)
      );
    }
  );

  // The runtime accepts only these exact spellings.
  it("adds no URL beside a DB_DIALECT Nextly does not accept, and says so", async () => {
    await writeFile(join(dir, ".env"), "DB_DIALECT=postgres\n");

    const { warnings } = await generateEnv(dir, postgresWithRealUrl);

    expect(readEnvKeys(await read(".env")).defined.has("DATABASE_URL")).toBe(
      false
    );
    expect(warnings.join("\n")).toMatch(
      /DB_DIALECT in \.env is not one Nextly accepts.*postgresql, mysql or sqlite/
    );
  });

  // The value a variable this file does not define stands for is only known
  // where the app runs, a default included.
  it("adds no DB_DIALECT beside a DATABASE_URL set from another variable", async () => {
    await writeFile(
      join(dir, ".env"),
      "DATABASE_URL=${MISSING:-postgresql://localhost/app}\n"
    );

    await generateEnv(dir, sqlite);

    expect(readEnvKeys(await read(".env")).defined.has("DB_DIALECT")).toBe(
      false
    );
  });

  // Next.js expands `$NAME` references in env files, so the URL the app gets
  // here is PostgreSQL's, whatever the line spells.
  it("adds no DB_DIALECT beside a URL that refers to another key", async () => {
    await writeFile(
      join(dir, ".env"),
      "APP_DATABASE_URL=postgresql://localhost:5432/app\nDATABASE_URL=$APP_DATABASE_URL\n"
    );

    const { warnings } = await generateEnv(dir, {
      type: "mysql",
      adapter: "@nextlyhq/adapter-mysql",
      databaseDriver: "mysql2",
      connectionUrl: "mysql://root:x@localhost:3306/app",
      envExample: "mysql://user:password@localhost:3306/nextly",
    });

    expect(readEnvKeys(await read(".env")).defined.has("DB_DIALECT")).toBe(
      false
    );
    expect(warnings.join("\n")).toMatch(/DATABASE_URL in \.env.*mysql/);
  });

  // A reference to a variable the file doesn't define is filled in where the
  // app runs; its value is unknown here, so nothing is judged from it.
  it("judges no value that refers to a variable the file doesn't define", async () => {
    await writeFile(
      join(dir, ".env"),
      "DATABASE_URL=x\nNEXTLY_SECRET=${SECRET_FROM_HOST}\n"
    );

    const { warnings } = await generateEnv(dir, sqlite);

    expect(warnings.join("\n")).not.toMatch(/NEXTLY_SECRET/);
  });

  // The runtime refuses a DATABASE_URL that `new URL` cannot read.
  it("says a database URL is not one Nextly can read, without printing it", async () => {
    await writeFile(join(dir, ".env"), "DATABASE_URL=not-a-url\n");

    const { warnings } = await generateEnv(dir, sqlite);

    expect(warnings.join("\n")).toMatch(/DATABASE_URL in \.env is not a URL/);
    expect(warnings.join("\n")).not.toContain("not-a-url");
  });

  it("completes the pair when the app's half is for the chosen database", async () => {
    await writeFile(join(dir, ".env"), "DB_DIALECT=sqlite\n");

    await generateEnv(dir, sqlite);

    expect(readEnvKeys(await read(".env")).defined.get("DATABASE_URL")).toBe(
      sqlite.connectionUrl
    );
  });

  // Some Windows editors start a file with a byte order mark. dotenv reads
  // the first line through it; missing that line appended a second one,
  // which then won.
  it("reads the first line of a file that starts with a byte order mark", async () => {
    await writeFile(
      join(dir, ".env"),
      `\uFEFFNEXTLY_SECRET=${"s".repeat(40)}\nDATABASE_URL=x\n`
    );

    await generateEnv(dir, sqlite);

    expect((await read(".env")).match(/NEXTLY_SECRET=/g)).toHaveLength(1);
  });

  // dotenv also reads `KEY: value`; missing it appended a second secret,
  // which then won and rotated the app's.
  it("reads dotenv's colon form as an assignment", async () => {
    await writeFile(
      join(dir, ".env"),
      `NEXTLY_SECRET: ${"s".repeat(40)}\nDATABASE_URL: file:./x.db\n`
    );

    await generateEnv(dir, sqlite);

    const env = await read(".env");
    expect(env.match(/NEXTLY_SECRET/g)).toHaveLength(1);
    expect(env.match(/DATABASE_URL/g)).toHaveLength(1);
  });

  // The runtime reads NEXT_PUBLIC_APP_URL as a URL, as it does DATABASE_URL.
  it("says an app URL is not one Nextly can read", async () => {
    await writeFile(
      join(dir, ".env"),
      "DATABASE_URL=x\nNEXT_PUBLIC_APP_URL=example.com\n"
    );

    const { warnings } = await generateEnv(dir, sqlite);

    expect(warnings.join("\n")).toMatch(
      /NEXT_PUBLIC_APP_URL in \.env is not a URL/
    );
  });

  // dotenv reads a quoted value across line breaks, so an assignment-looking
  // line inside one is part of that value, not a key of its own.
  it("reads a multiline quoted value as one assignment", async () => {
    await writeFile(
      join(dir, ".env"),
      `PRIVATE_CONFIG="header\nNEXTLY_SECRET=${"s".repeat(40)}\nfooter"\nDATABASE_URL=x\n`
    );

    await generateEnv(dir, sqlite);

    const keys = readEnvKeys(await read(".env")).defined;
    expect(keys.get("PRIVATE_CONFIG")).toBe(
      `header\nNEXTLY_SECRET=${"s".repeat(40)}\nfooter`
    );
    // The real key was missing, so it was added after the value.
    expect((await read(".env")).match(/NEXTLY_SECRET=/g)).toHaveLength(2);
    expect(keys.get("NEXTLY_SECRET")?.length).toBeGreaterThanOrEqual(32);
  });

  // dotenv's quoted values may hold an escaped quote, which does not close
  // them.
  it("reads past an escaped quote in a multiline value", async () => {
    await writeFile(
      join(dir, ".env"),
      `PRIVATE_CONFIG="header \\"\nNEXTLY_SECRET=${"s".repeat(40)}\nfooter"\nDATABASE_URL=x\n`
    );

    await generateEnv(dir, sqlite);

    expect((await read(".env")).match(/NEXTLY_SECRET=/g)).toHaveLength(2);
  });

  // A file that appears between the check and the write (or one the check
  // could not see) is merged into, never truncated.
  it("merges into a .env that appears after it was checked", async () => {
    await writeFile(join(dir, ".env"), "MINE=kept\n");
    const realLstat = fsExtra.lstat.bind(fsExtra);
    const spy = vi.spyOn(fsExtra, "lstat").mockImplementation((async (
      p: string
    ) => {
      if (String(p).endsWith(`${"/"}.env`)) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return realLstat(p);
    }) as typeof fsExtra.lstat);
    try {
      await generateEnv(dir, sqlite);
    } finally {
      spy.mockRestore();
    }

    expect(await read(".env")).toMatch(/^MINE=kept\n/);
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

  // new URL accepts an unescaped % in a password that decodeURIComponent
  // then refuses; the password is no less real for it.
  it("warns about a database password it cannot decode", async () => {
    await writeFile(
      join(dir, ".env.example"),
      "DATABASE_URL=postgresql://app:pa%ss@db.internal:5432/app\n"
    );

    const { warnings } = await generateEnv(dir, sqlite);

    expect(warnings.join("\n")).toMatch(
      /\.env\.example holds a database password/
    );
  });

  // A copied example file has to work as a .env, so a database half that
  // doesn't match the chosen database is said there too.
  it("says when an example file is set up for another database", async () => {
    await writeFile(join(dir, ".env.example"), "DB_DIALECT=postgresql\n");

    const { warnings } = await generateEnv(dir, sqlite);

    expect(warnings.join("\n")).toMatch(
      /DB_DIALECT in \.env\.example is postgresql/
    );
  });

  // A copied example file has to work as a .env, so its URLs are checked too.
  it("says an example file's database URL is not one Nextly can read", async () => {
    await writeFile(join(dir, ".env.example"), "DATABASE_URL=not-a-url\n");

    const { warnings } = await generateEnv(dir, sqlite);

    expect(warnings.join("\n")).toMatch(
      /DATABASE_URL in \.env\.example is not a URL/
    );
  });

  // A malformed URL can still show its password in plain sight.
  it("warns about a password in an example URL it cannot parse", async () => {
    await writeFile(
      join(dir, ".env.example"),
      "DATABASE_URL=postgresql://user:S3cr3t@db:bad/app\n"
    );

    const { warnings } = await generateEnv(dir, sqlite);

    expect(warnings.join("\n")).toMatch(
      /\.env\.example holds a database password/
    );
    expect(warnings.join("\n")).not.toContain("S3cr3t");
  });

  // Git commits a hard link's contents, so a secret in a hard-linked example
  // is said, though the file is left alone.
  it("warns about a secret in a hard-linked example file it leaves alone", async () => {
    const shared = await mkdtemp(join(tmpdir(), "nextly-shared-"));
    try {
      await writeFile(
        join(shared, "example"),
        `NEXTLY_SECRET=${"r".repeat(40)}\n`
      );
      await link(join(shared, "example"), join(dir, ".env.example"));

      const { warnings } = await generateEnv(dir, sqlite);

      expect(warnings.join("\n")).toMatch(
        /\.env\.example holds a value for NEXTLY_SECRET/
      );
    } finally {
      await rm(shared, { recursive: true, force: true });
    }
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

        const { files, warnings } = await generateEnv(dir, sqlite);

        expect(await readFile(join(shared, "gitignore"), "utf8")).toBe(
          "node_modules\n"
        );
        expect(files.skipped).toContainEqual(
          expect.objectContaining({ path: ".gitignore", toAdd: ".env" })
        );
        // Unprotected, so nothing secret went into .env.
        expect(
          readEnvKeys(await read(".env")).defined.has("NEXTLY_SECRET")
        ).toBe(false);
        expect(warnings.join("\n")).toMatch(/\.env is not ignored/);
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

  // Whether a password looks like a placeholder is a question for an example
  // file. In a tracked .env, any password the person typed is a credential.
  it.each(["password", "your_db_pass"])(
    "writes no typed URL with a password (%s) to a .env git tracks",
    async password => {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      await writeFile(join(dir, ".env"), "DB_DIALECT=postgresql\n");
      execFileSync("git", ["add", "-f", ".env"], { cwd: dir });

      await generateEnv(dir, {
        ...postgresWithRealUrl,
        connectionUrl: `postgresql://app:${password}@db.internal:5432/app`,
      });

      expect(readEnvKeys(await read(".env")).defined.has("DATABASE_URL")).toBe(
        false
      );
    }
  );

  // Outside a repository the project's .gitignore is read here, and a
  // re-include this reader cannot evaluate exactly could leave .env stageable;
  // adding the rule last settles it, since the last matching rule wins.
  it.each(["!**/.env", "!/.e[n]v", "!\\.env"])(
    "adds .env after a re-include it cannot evaluate (%s), outside a repository",
    async negation => {
      await writeFile(join(dir, ".gitignore"), `.env\n${negation}\n`);

      await generateEnv(dir, sqlite);

      expect(await read(".gitignore")).toMatch(
        new RegExp(
          `${negation.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}\\n[\\s\\S]*^\\.env$`,
          "m"
        )
      );
    }
  );

  // An exclude that lives only on this machine (.git/info/exclude, a global
  // excludes file) doesn't travel with the project; .gitignore does.
  it("adds .env to .gitignore when only this machine's exclude ignores it", async () => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await writeFile(join(dir, ".git", "info", "exclude"), ".env\n");
    await writeFile(join(dir, ".gitignore"), "node_modules\n");

    await generateEnv(dir, sqlite);

    expect(await read(".gitignore")).toMatch(/^\.env$/m);
  });

  // Appending through a linked .env would put the secret in a file shared
  // outside the project.
  it("leaves a linked .env as it is, and lists the keys to add without values", async () => {
    const shared = await mkdtemp(join(tmpdir(), "nextly-shared-"));
    try {
      await writeFile(join(shared, "env"), "DATABASE_URL=file:./x.db\n");
      await symlink(join(shared, "env"), join(dir, ".env"));

      const { files } = await generateEnv(dir, sqlite);

      expect(await readFile(join(shared, "env"), "utf8")).toBe(
        "DATABASE_URL=file:./x.db\n"
      );
      const skipped = files.skipped.find(f => f.path === ".env");
      expect(skipped?.toAdd).toMatch(/^NEXTLY_SECRET=$/m);
      expect(skipped?.toAdd).toMatch(/^NEXT_PUBLIC_APP_URL=$/m);
    } finally {
      await rm(shared, { recursive: true, force: true });
    }
  });

  // git reports the deciding rule even when it is a `!` re-include, which
  // leaves .env stageable.
  it("adds .env to .gitignore when its deciding rule re-includes it", async () => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await writeFile(join(dir, ".gitignore"), ".env\n!.env\n");

    await generateEnv(dir, sqlite);

    expect(await read(".gitignore")).toMatch(/!\.env\n[\s\S]*^\.env$/m);
  });

  // .env is protected before the secret is written, so a later failure leaves
  // no stageable secret behind.
  it("keeps .env out of git even when writing the example file then fails", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules\n");
    await writeFile(join(dir, ".env.example"), "MY_KEY=1\n");
    await chmod(join(dir, ".env.example"), 0o444);

    await expect(generateEnv(dir, sqlite)).rejects.toThrow();

    expect(await read(".gitignore")).toMatch(/^\.env$/m);
  });

  // Git failing for another reason (a corrupt index here) leaves it unknown
  // whether .env is tracked, and unknown is treated as tracked.
  it("writes no secret to .env when git cannot say whether it tracks it", async () => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await writeFile(join(dir, ".gitignore"), ".env\n");
    await writeFile(join(dir, ".git", "index"), "not an index");

    const { warnings } = await generateEnv(dir, postgresWithRealUrl);

    const env = await read(".env");
    expect(readEnvKeys(env).defined.has("NEXTLY_SECRET")).toBe(false);
    expect(env).not.toContain("S3cr3tPassw0rd");
    expect(warnings.join("\n")).toMatch(
      /could not say whether it tracks \.env/
    );
  });

  // A typed URL new URL cannot parse may still carry a password in plain
  // sight, so it is withheld from a tracked .env too.
  it("writes no typed URL it cannot parse to a .env git tracks", async () => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await writeFile(join(dir, ".env"), "DB_DIALECT=postgresql\n");
    execFileSync("git", ["add", "-f", ".env"], { cwd: dir });

    await generateEnv(dir, {
      ...postgresWithRealUrl,
      connectionUrl: "postgresql://user:S3cr3t@db:bad/app",
    });

    expect(await read(".env")).not.toContain("S3cr3t");
  });

  // Git does not read a .gitignore that is a symbolic link, so a rule in its
  // target protects nothing once the folder becomes a repository.
  it("does not trust a linked .gitignore's rule in a folder that isn't a repository yet", async () => {
    const shared = await mkdtemp(join(tmpdir(), "nextly-shared-"));
    try {
      await writeFile(join(shared, "gitignore"), ".env\n");
      await symlink(join(shared, "gitignore"), join(dir, ".gitignore"));

      await generateEnv(dir, sqlite);

      expect(readEnvKeys(await read(".env")).defined.has("NEXTLY_SECRET")).toBe(
        false
      );
    } finally {
      await rm(shared, { recursive: true, force: true });
    }
  });

  // core.excludesFile may itself be named .gitignore; it stays on this
  // machine all the same.
  it("adds .env to .gitignore when only a global excludes file named .gitignore ignores it", async () => {
    const global = await mkdtemp(join(tmpdir(), "nextly-global-"));
    try {
      await writeFile(join(global, ".gitignore"), ".env\n");
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync(
        "git",
        ["config", "core.excludesFile", join(global, ".gitignore")],
        { cwd: dir }
      );
      await writeFile(join(dir, ".gitignore"), "node_modules\n");

      await generateEnv(dir, sqlite);

      expect(await read(".gitignore")).toMatch(/^\.env$/m);
    } finally {
      await rm(global, { recursive: true, force: true });
    }
  });

  // Reached through a symbolic link, the folder's parents are not the
  // repository's, but git still finds it and commits what .env holds.
  it("writes no secret to a tracked .env reached through a symbolic link", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "nextly-link-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      await mkdir(join(dir, "app"));
      await writeFile(join(dir, "app", ".gitignore"), ".env\n");
      await writeFile(join(dir, "app", ".env"), "DB_DIALECT=sqlite\n");
      execFileSync("git", ["add", "-f", "app/.env"], { cwd: dir });
      await symlink(join(dir, "app"), join(elsewhere, "app"));

      await generateEnv(join(elsewhere, "app"), sqlite);

      expect(
        readEnvKeys(
          await readFile(join(dir, "app", ".env"), "utf8")
        ).defined.has("NEXTLY_SECRET")
      ).toBe(false);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  // A driver can read credentials from more places than the URL's password
  // (pg takes ?password=), so any typed URL but SQLite's is withheld.
  it("writes no typed URL holding a password in its query to a .env git tracks", async () => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await writeFile(join(dir, ".env"), "DB_DIALECT=postgresql\n");
    execFileSync("git", ["add", "-f", ".env"], { cwd: dir });

    await generateEnv(dir, {
      ...postgresWithRealUrl,
      connectionUrl: "postgresql://db.example/app?user=alice&password=S3cr3t",
    });

    expect(await read(".env")).not.toContain("S3cr3t");
  });

  // SQLite's URL is a file path, with no credential in it.
  it("still writes a SQLite URL to a .env git tracks", async () => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await writeFile(join(dir, ".env"), "DB_DIALECT=sqlite\n");
    execFileSync("git", ["add", "-f", ".env"], { cwd: dir });

    await generateEnv(dir, sqlite);

    expect(readEnvKeys(await read(".env")).defined.get("DATABASE_URL")).toBe(
      sqlite.connectionUrl
    );
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
        'L="two\\nlines"',
        "N=$A-${B}-\\$C-${MISSING}",
        "M='kept\\nraw'",
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
      L: "two\nlines",
      M: "kept\\nraw",
      N: "1-two-$C-${MISSING}",
    });
    // `\$C` is an escaped dollar, not a reference; `${MISSING}` is one the
    // file cannot fill, so N is known only where the app runs.
    expect([...readEnvKeys("N=$A-${MISSING}\nA=1").unresolved]).toEqual(["N"]);
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
      "L",
      "M",
      "N",
    ]);
  });
});
