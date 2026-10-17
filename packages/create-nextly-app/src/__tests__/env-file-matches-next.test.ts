/**
 * The env-file reader against the loader Next.js itself runs, on the same files.
 *
 * The reader decides what to add to an app's env files and what to warn about,
 * so it has to read them as the app will. Next.js parses an env file with
 * dotenv and expands its references with dotenv-expand, both bundled into
 * `@next/env`. Each file below goes through the real `@next/env`, the one the
 * playground's Next.js installs here, in a child process with an empty
 * environment: the values an app gets when the environment it runs in sets none
 * of the variables a file refers to. The reader must give the same value for
 * every key, and read the same keys.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readEnvKeys } from "../utils/env-file";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repo = join(packageDir, "..", "..");

/**
 * Where `@next/env` is: a dependency of `next`, which the playground depends
 * on. A repository without it fails here rather than passing without a
 * comparison.
 */
function nextEnvDir(): string {
  const fromPlayground = createRequire(
    join(repo, "apps", "playground", "package.json")
  );
  const next = fromPlayground.resolve("next/package.json");
  return dirname(createRequire(next).resolve("@next/env/package.json"));
}

/**
 * What `@next/env` loads from a folder holding only `.env`, with no
 * environment, less what it gives for a folder with no env file at all: its
 * own marker and what the operating system sets in every process.
 */
async function fromFileByNext(dir: string): Promise<Record<string, string>> {
  const empty = await mkdtemp(join(tmpdir(), "nextly-env-none-"));
  try {
    const baseline = loadedByNext(empty);
    return Object.fromEntries(
      Object.entries(loadedByNext(dir)).filter(([key]) => !(key in baseline))
    );
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
}

function loadedByNext(dir: string): Record<string, string> {
  const script = `
    const { loadEnvConfig } = require(process.argv[1]);
    const { combinedEnv } = loadEnvConfig(process.argv[2], true, { info() {}, error() {} }, true);
    process.stdout.write(JSON.stringify(combinedEnv));
  `;
  // Windows needs SystemRoot to start a process.
  const env: Record<string, string> = {};
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return JSON.parse(
    execFileSync(process.execPath, ["-e", script, nextEnvDir(), dir], {
      env,
      encoding: "utf8",
    })
  ) as Record<string, string>;
}

const FILES: Array<[string, string]> = [
  [
    "assignments, quotes and comments",
    [
      "A=1",
      "export B=two",
      'C="three # not a comment"',
      "D='four'",
      "E=five # a comment",
      "# F=commented",
      "  H = eight  ",
      "I=",
      "J=unspaced#comment",
      "K=`backtick # quoted`",
      'L="two\\nlines"',
      "M='kept\\nraw'",
      "N=$A-${B}-\\$C-${MISSING}",
      "O: colon form",
    ].join("\n"),
  ],
  ["a byte order mark", "﻿FIRST=1\nSECOND=2\n"],
  ["lone carriage returns", "A=1\rNEXTLY_SECRET=abc\rB=2"],
  [
    "a quote after an even run of backslashes",
    'NOTE="a\\\\"\nNEXTLY_SECRET=inside\n"\n',
  ],
  ["a multiline quoted value", 'KEY="first\nsecond"\nAFTER=1\n'],
  ["a single-quoted reference", "A=1\nB='x$A'\n"],
  ["a default over the file's own value", "A=1\nB=${A:-dflt}\n"],
  ["a dash-only default", "B=${HOST-your-secret-here}\n"],
  [
    "a default inside a URL",
    "U=postgresql://user:${DB_PASSWORD:-real-secret}@host/db\n",
  ],
  ["a nested default", "B=${X:-${Y:-deep}}\n"],
  ["a reference to a later key", "B=pre${A}post\nA=late\n"],
  ["a reference starting with a digit", "B=$1x\n"],
  ["an escaped dollar", "P=pa\\$word\n"],
];

describe("readEnvKeys reads a file as Next.js loads it", () => {
  it.each(FILES)("%s", async (_, text) => {
    const dir = await mkdtemp(join(tmpdir(), "nextly-env-next-"));
    try {
      await writeFile(join(dir, ".env"), text);
      const next = await fromFileByNext(dir);

      expect(Object.fromEntries(readEnvKeys(text).defined)).toEqual(next);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // The reader expands with dotenv-expand itself, pinned to the version
  // `@next/env` bundles. A Next.js that bundles another fails here, and the
  // pin moves with it, the comparison above saying what changed.
  it("pins the dotenv-expand that Next.js bundles", async () => {
    const read = async (dir: string) =>
      JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
    const bundled = (await read(nextEnvDir())).devDependencies?.[
      "dotenv-expand"
    ];

    expect(bundled).toMatch(/^\d+\.\d+\.\d+$/);
    expect((await read(packageDir)).dependencies?.["dotenv-expand"]).toBe(
      bundled
    );
  });
});
