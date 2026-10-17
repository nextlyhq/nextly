/**
 * What `next dev` prints when a saved nextly.config.ts cannot be read.
 *
 * Where the loader can produce the failure under Vitest, it does: a config is
 * written to a temporary project and read the way a reload reads it. Two
 * failures happen only once Node imports the compiled config, which Vitest's
 * module runner cannot do, so those are built the way the loader wraps them,
 * around Node's own error. The message has to
 * name the cause and what to do about it. One fixed sentence, "Fix the syntax
 * error and save again", sent people looking for a syntax error that was not
 * there when a package was missing.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../cli/utils/config-loader";
import { NextlyError } from "../../errors/index";
import { describeConfigReloadFailure } from "../config-reload-failure";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** The error the loader throws for a project whose config is `source`. */
async function loadFailure(source: string): Promise<unknown> {
  const cwd = mkdtempSync(join(tmpdir(), "nextly-reload-failure-"));
  made.push(cwd);
  writeFileSync(join(cwd, "nextly.config.ts"), source);
  try {
    await loadConfig({ cwd });
  } catch (error) {
    return error;
  }
  throw new Error("expected the config to fail to load");
}

/** The error Node itself throws for `import(specifier)` of a missing package. */
function importErrorFromNode(specifier: string): Error {
  const script =
    `import(${JSON.stringify(specifier)}).catch(e => ` +
    `process.stdout.write(JSON.stringify({ message: e.message, code: e.code })))`;
  const { message, code } = JSON.parse(
    execFileSync(process.execPath, ["-e", script], {
      cwd: mkdtempSync(join(tmpdir(), "nextly-reload-failure-node-")),
      encoding: "utf8",
    })
  ) as { message: string; code: string };
  return Object.assign(new Error(message), { code });
}

/** How the config loader reports a failure that is not its own. */
function wrappedAsTheLoaderDoes(cause: Error): NextlyError {
  return new NextlyError({
    code: "INVALID_INPUT",
    publicMessage: "Failed to load Nextly configuration.",
    statusCode: 400,
    logMessage: "Config loader error",
    logContext: { reason: "load-error", cause: cause.message },
    cause,
  });
}

describe("the dev log when a saved config cannot be read", () => {
  it("points at the syntax error, where it is", async () => {
    const error = await loadFailure(
      'export default { collections: [ { slug: "posts" ] };\n'
    );

    const message = describeConfigReloadFailure(error);

    expect(message).toMatch(/syntax error/i);
    expect(message).toContain("nextly.config.ts:1");
    expect(message).toMatch(/previous config/i);
  });

  it("counts the column the way an editor does, from 1 and in characters", async () => {
    // esbuild reports a 0-based byte offset. Two lines, so both conversions
    // show: the ASCII one is off by one when the column is passed through,
    // and the "café" one is off by two, since "é" is two bytes.
    const ascii = 'export default { collections: [ { slug: "posts" ] };';
    const accented =
      'export default { label: "café", collections: [ { slug: "posts" ] };';

    for (const line of [ascii, accented]) {
      const message = describeConfigReloadFailure(
        await loadFailure(`${line}\n`)
      );
      // The error is at the "]" that should have been a "}".
      expect(message).toContain(`nextly.config.ts:1:${line.indexOf("]") + 1})`);
    }
  });

  it("names a package the config imports that is not installed, and does not call it a syntax error", () => {
    // Node's own error for the import, taken from a real Node process: the
    // compiled config imports packages at runtime, where this one is missing.
    const nodeError = importErrorFromNode(
      "nextly-test-package-that-is-not-installed"
    );
    const error = wrappedAsTheLoaderDoes(nodeError);

    const message = describeConfigReloadFailure(error);

    expect(message).toContain("nextly-test-package-that-is-not-installed");
    expect(message).toMatch(/install/i);
    expect(message).not.toMatch(/syntax/i);
  });

  it("names a local file the config imports that does not exist", async () => {
    const error = await loadFailure(
      'import { posts } from "./collections/posts";\n' +
        "export default { collections: [posts] };\n"
    );

    const message = describeConfigReloadFailure(error);

    expect(message).toContain("./collections/posts");
    expect(message).toContain("nextly.config.ts:1");
    expect(message).not.toMatch(/syntax/i);
  });

  it("says to install esbuild when reading the config needs it", () => {
    const error = new NextlyError({
      code: "NEXTLY_CONFIG_TOOLING_UNAVAILABLE",
      publicMessage:
        'Reading "nextly.config.ts" needs the "esbuild" package, which is not installed. ' +
        'Run "npm install --save-dev esbuild" and try again.',
    });

    const message = describeConfigReloadFailure(error);

    expect(message).toContain("esbuild");
    expect(message).toMatch(/install/i);
    expect(message).not.toMatch(/syntax/i);
  });

  it("passes on any other failure's own message", () => {
    const error = wrappedAsTheLoaderDoes(
      new Error("the config refused to load")
    );

    const message = describeConfigReloadFailure(error);

    expect(message).toContain("the config refused to load");
    expect(message).not.toMatch(/syntax/i);
  });
});
