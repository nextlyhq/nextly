/**
 * How the dev wrapper spawns pnpm, and why Windows needs a different shape.
 *
 * Every child the wrapper starts — docker:up, the workspace build, the seed,
 * and next dev itself — went through a bare "pnpm". Windows has no pnpm.exe,
 * and two Node behaviours then compound: spawn without a shell skips PATHEXT
 * (ENOENT), and naming pnpm.cmd instead is refused outright by the BatBadBut
 * mitigation (EINVAL). So dev:app, dev:postgres and dev:mysql could not start
 * at all, while CI stayed green because CI is Linux.
 *
 * Going through a shell is therefore forced on Windows, and quoting is the
 * price of it: with shell: true Node escapes nothing, and the seed step passes
 * an absolute path that contains a space on any checkout under a name like
 * "Faisal Mehmood". The POSIX cases matter just as much — they pin that Linux
 * and macOS still get the direct, unquoted spawn they always had.
 *
 * @module pnpm-invocation.test
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { pnpmInvocation, quoteForCmd } from "./pnpm-invocation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER = path.join(HERE, "dev-playground.mjs");

describe("pnpmInvocation on POSIX", () => {
  it.each(["linux", "darwin", "freebsd"])(
    "spawns pnpm directly, without a shell, on %s",
    platform => {
      expect(pnpmInvocation(["next", "dev"], platform)).toEqual({
        command: "pnpm",
        args: ["next", "dev"],
        shell: false,
      });
    }
  );

  it("passes arguments through untouched, spaces and all", () => {
    // The pre-change behaviour exactly: no shell means no quoting rules, so a
    // spaced path must NOT gain quotes or it would be passed as a literal.
    const args = ["tsx", "/home/ci/a b/seed.ts"];

    const invocation = pnpmInvocation(args, "linux");

    expect(invocation.args).toEqual(args);
    expect(invocation.shell).toBe(false);
  });
});

describe("pnpmInvocation on Windows", () => {
  it("asks for a shell, which a .cmd cannot be spawned without", () => {
    const { command, shell } = pnpmInvocation(["next", "dev"], "win32");

    expect(command).toBe("pnpm");
    expect(shell).toBe(true);
  });

  it("quotes a spaced path so cmd.exe does not split it in two", () => {
    // String.raw, not an escaped literal: a plain string eats \U and \s,
    // which silently turned this fixture into a path with no separators at
    // all — and it still passed, because the space alone forced the quoting.
    const seed = String.raw`C:\Users\Faisal Mehmood\playground\scripts\seed.ts`;

    expect(seed).toContain("\\");

    const { args } = pnpmInvocation(["tsx", seed], "win32");

    expect(args).toEqual(["tsx", `"${seed}"`]);
  });

  it("leaves an argument that needs no quoting alone", () => {
    const { args } = pnpmInvocation(
      ["turbo", "build", "--filter=./packages/*"],
      "win32"
    );

    expect(args).toEqual(["turbo", "build", "--filter=./packages/*"]);
  });
});

describe("pnpmInvocation defaults", () => {
  it("reads the running platform when none is given", () => {
    expect(pnpmInvocation(["next", "dev"]).shell).toBe(
      process.platform === "win32"
    );
  });
});

describe("quoteForCmd", () => {
  it("leaves an ordinary argument alone", () => {
    expect(quoteForCmd("--filter=./packages/*")).toBe("--filter=./packages/*");
  });

  it.each([" ", "&", "|", "^", "<", ">", "(", ")"])(
    "quotes an argument containing %s",
    ch => {
      expect(quoteForCmd(`a${ch}b`)).toBe(`"a${ch}b"`);
    }
  );

  it("doubles an embedded quote, as cmd.exe expects", () => {
    expect(quoteForCmd('a "b" c')).toBe('"a ""b"" c"');
  });
});

describe("the wrapper's spawn sites", () => {
  it("never spawns a bare pnpm string", async () => {
    const source = await readFile(WRAPPER, "utf-8");

    const direct = source.match(/spawn\(\s*["']pnpm/g) ?? [];

    expect(direct).toEqual([]);
  });

  it("routes every child through the resolved invocation", async () => {
    const source = await readFile(WRAPPER, "utf-8");

    // docker:up, the workspace build and the seed go via runPnpm; next dev
    // builds its invocation inline because it is the long-lived child.
    expect(source.match(/await runPnpm\(/g) ?? []).toHaveLength(3);
    expect(source.match(/pnpmInvocation\(\[/g) ?? []).toHaveLength(1);
  });
});
