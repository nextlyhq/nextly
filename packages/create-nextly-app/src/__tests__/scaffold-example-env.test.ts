/**
 * The `.env.example` a template project ships. A template project commits it
 * (its `.gitignore` keeps `!.env.example`), so it may hold placeholders and
 * generic examples only.
 *
 * Scaffolded onto a real temporary directory from the repository's templates,
 * because the defects were in what the template file plus the scaffold's
 * placeholder filling produce together: a database URL the person typed, with
 * its password, filled the example's DATABASE_URL, the secret's placeholder was
 * long enough to pass production's check, and a storage token was never filled.
 */
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import fsExtra from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseConfig } from "../types";
import { readEnvKeys } from "../utils/env-file";
import { copyTemplate } from "../utils/template";

const templates = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "templates"
);

const postgres: DatabaseConfig = {
  type: "postgresql",
  adapter: "@nextlyhq/adapter-postgres",
  databaseDriver: "pg",
  connectionUrl: "postgresql://user:password@localhost:5432/nextly",
  envExample: "postgresql://user:password@localhost:5432/nextly",
};

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "nextly-example-env-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function scaffoldExampleEnv(): Promise<string> {
  const target = join(workspace, "app");
  await copyTemplate({
    projectName: "app",
    projectType: "blank",
    targetDir: target,
    database: postgres,
    packageManager: "npm",
    templateSource: {
      basePath: join(templates, "base"),
      templatePath: join(templates, "blank"),
    },
  });
  return readFile(join(target, ".env.example"), "utf-8");
}

describe("a template project's .env.example", () => {
  // A URL typed during setup carries a password. It goes to .env through the
  // env generator only: the template copy is never handed it, so it cannot
  // fill the example's DATABASE_URL.
  it("holds the database's generic example URL", async () => {
    const example = await scaffoldExampleEnv();

    expect(readEnvKeys(example).defined.get("DATABASE_URL")).toBe(
      postgres.envExample
    );
  });

  it("holds an empty secret, which production refuses, and no unfilled token", async () => {
    const example = await scaffoldExampleEnv();

    expect(readEnvKeys(example).defined.get("NEXTLY_SECRET")).toBe("");
    expect(example).not.toMatch(/\{\{\w+\}\}/);
  });

  // Scaffolding over a folder that has files (the "continue" choice) copies
  // the template on top of them. The example file is the env generator's to
  // merge, so the template's copy must not replace the one already there.
  // pathExists follows a link and calls a dangling one absent; the copy then
  // replaced the link itself.
  it("leaves a dangling example link in the target as it is", async () => {
    const target = join(workspace, "app");
    await mkdir(target);
    await symlink(join(workspace, "gone"), join(target, ".env.example"));

    await copyTemplate({
      projectName: "app",
      projectType: "blank",
      targetDir: target,
      database: postgres,
      packageManager: "npm",
      allowExistingTarget: true,
      templateSource: {
        basePath: join(templates, "base"),
        templatePath: join(templates, "blank"),
      },
    });

    expect((await lstat(join(target, ".env.example"))).isSymbolicLink()).toBe(
      true
    );
  });

  it("leaves an example file already in the target for the env generator to merge", async () => {
    const target = join(workspace, "app");
    await mkdir(target);
    // A token in the person's own text is theirs, not the template's to fill.
    await writeFile(
      join(target, ".env.example"),
      "MY_KEY=documented {{databaseUrl}}\n"
    );

    await copyTemplate({
      projectName: "app",
      projectType: "blank",
      targetDir: target,
      database: postgres,
      packageManager: "npm",
      allowExistingTarget: true,
      templateSource: {
        basePath: join(templates, "base"),
        templatePath: join(templates, "blank"),
      },
    });

    expect(await readFile(join(target, ".env.example"), "utf-8")).toBe(
      "MY_KEY=documented {{databaseUrl}}\n"
    );
  });

  // Only "absent" means absent. A file that could not be looked at may well
  // be there, and the copy would replace it.
  it("stops, and leaves the example file as it is, when it cannot look at it", async () => {
    const target = join(workspace, "app");
    await mkdir(target);
    const example = join(target, ".env.example");
    await writeFile(example, "MINE=kept\n");
    const realLstat = fsExtra.lstat.bind(fsExtra);
    const spy = vi.spyOn(fsExtra, "lstat").mockImplementation((async (
      p: string
    ) => {
      if (String(p) === example) {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      }
      return realLstat(p);
    }) as typeof fsExtra.lstat);
    try {
      await expect(
        copyTemplate({
          projectName: "app",
          projectType: "blank",
          targetDir: target,
          database: postgres,
          packageManager: "npm",
          allowExistingTarget: true,
          templateSource: {
            basePath: join(templates, "base"),
            templatePath: join(templates, "blank"),
          },
        })
      ).rejects.toMatchObject({ code: "EIO" });
    } finally {
      spy.mockRestore();
    }

    expect(await readFile(example, "utf-8")).toBe("MINE=kept\n");
  });
});
