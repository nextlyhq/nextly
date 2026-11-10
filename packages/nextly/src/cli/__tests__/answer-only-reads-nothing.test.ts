/**
 * `--version`, `--help`, every command's `--help` and an unknown command
 * answer from the CLI alone: neither the project's configuration nor its
 * environment files are read, so the answer is the same in any folder.
 *
 * Each invocation runs as a shell runs it, in a process of its own, with a
 * probe that records every file-system call naming a `.env*` or
 * `nextly.config.*` file. It runs in three folders and must touch none of
 * those files in any of them, and answer byte for byte as in an empty folder:
 * - a project whose configuration does not parse and whose `.env` cannot be
 *   read (it is a directory);
 * - a project with a readable `.env` and a configuration that parses.
 * Watching the calls, rather than the answer alone, catches a read that
 * prints nothing or swallows its failure.
 *
 * The invocations come from the program's own command list, so a new command
 * is covered by being defined.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createProgram } from "../program";

import {
  answerOnlyInvocations,
  wrongAnswer,
} from "./helpers/answer-only-invocations";
import { NEXTLY_RUN_TIMEOUT, runNextly } from "./helpers/run-nextly";

const PROBE = pathToFileURL(
  fileURLToPath(new URL("./helpers/file-read-probe.mjs", import.meta.url))
).href;

const INVOCATIONS = answerOnlyInvocations(createProgram());

let scratch: string;
let empty: string;
let broken: string;
let readable: string;
let runs = 0;

beforeAll(() => {
  // The real path, so the folders the assertions name are the ones the probe
  // records: on macOS the temp directory is a link (`/var` to `/private/var`),
  // and a process run in it reports where the link leads.
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "nextly-answer-")));
  empty = join(scratch, "empty");
  mkdirSync(empty);
  broken = join(scratch, "broken");
  mkdirSync(broken);
  writeFileSync(join(broken, "nextly.config.ts"), "export default {{{ ;\n");
  mkdirSync(join(broken, ".env"));
  readable = join(scratch, "readable");
  mkdirSync(readable);
  writeFileSync(join(readable, ".env"), "NEXTLY_ANSWER_PROBE=1\n");
  writeFileSync(
    join(readable, "nextly.config.ts"),
    "export default { collections: [] };\n"
  );
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * The answer in `folder`, with the folder's own path (`--cwd`'s default)
 * named alike, and the `.env*` and `nextly.config.*` files the run touched.
 */
async function answer(args: string[], folder: string) {
  runs += 1;
  const out = join(scratch, `probe-${runs}.json`);
  const run = await runNextly(args, folder, {
    NODE_OPTIONS: `--import=${PROBE}`,
    NEXTLY_READ_PROBE_OUT: out,
  });
  const touched = JSON.parse(readFileSync(out, "utf8")) as string[];
  // Help prints `--cwd`'s default as a JSON string, so on Windows each `\` of
  // the folder appears doubled there; both spellings are the folder.
  const quoted = JSON.stringify(folder).slice(1, -1);
  const named = (text: string) =>
    text.split(quoted).join("<folder>").split(folder).join("<folder>");
  return {
    run,
    touched,
    shown: {
      status: run.status,
      stdout: named(run.stdout),
      stderr: named(run.stderr),
    },
  };
}

describe("an answer-only invocation reads neither the configuration nor the environment files", () => {
  it("covers every command the CLI defines", () => {
    // The population: removing a command is a decision this count makes
    // visible, rather than a case that quietly stops being run.
    expect(INVOCATIONS.length).toBeGreaterThanOrEqual(43);
  });

  // The control: the probe does see a read, so an empty list below means the
  // files were not touched, not that the probe was blind.
  it(
    "the probe records the files a command that runs reads",
    async () => {
      const { touched } = await answer(["telemetry", "status"], readable);
      expect(touched).toContain(join(readable, ".env"));
    },
    NEXTLY_RUN_TIMEOUT
  );

  it.each(INVOCATIONS.map(args => [args.join(" "), args] as const))(
    "nextly %s",
    async (_name, args) => {
      const reference = await answer([...args], empty);
      expect(wrongAnswer(args, reference.run)).toBeUndefined();
      expect(reference.touched).toEqual([]);
      for (const folder of [broken, readable]) {
        const elsewhere = await answer([...args], folder);
        expect(elsewhere.touched).toEqual([]);
        expect(elsewhere.shown).toEqual(reference.shown);
      }
    },
    3 * NEXTLY_RUN_TIMEOUT
  );
});
