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
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});
