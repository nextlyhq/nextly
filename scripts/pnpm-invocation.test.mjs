/**
 * How the dev wrapper spawns pnpm, and why Windows needs a different shape.
 *
 * Every child the wrapper starts — docker:up, the workspace build, the seed,
 * and next dev itself — went through a bare "pnpm". Windows has no pnpm.exe,
 * and two Node behaviours then compound: spawn without a shell skips PATHEXT
 * (ENOENT), and naming pnpm.cmd instead is refused outright by the BatBadBut
 * mitigation (EINVAL). So dev:app, dev:postgres and dev:mysql could not start
 * at all, while CI stayed green — not for want of Windows, which the matrix
 * has, but because no CI job runs the wrapper on any platform.
 *
 * Going through a shell is therefore forced on Windows, and quoting is the
 * price of it: with shell: true Node escapes nothing, and the seed step passes
 * an absolute path that contains a space on any checkout under a name like
 * "Faisal Mehmood". The POSIX cases matter just as much — they pin that Linux
 * and macOS still get the direct, unquoted spawn they always had.
 *
 * @module pnpm-invocation.test
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  cmdExpansions,
  pnpmInvocation,
  quoteForCmd,
  treeKillCommand,
} from "./pnpm-invocation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER = path.join(HERE, "dev-playground.mjs");
const MODULE = path.join(HERE, "pnpm-invocation.mjs");
const WORKFLOWS = path.join(HERE, "..", ".github", "workflows");

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

// One fixture for every case needing a real Windows path, written raw so the
// separators survive: a plain literal eats \U and \s, and \1 is an octal escape
// that does not parse at all.
const EXPANDING_PATH = String.raw`C:\p%FOO%th\seed.ts`;

describe("cmdExpansions", () => {
  const env = { FOO: "EXPANDED", Path: String.raw`C:\Windows` };

  it("starts from a fixture that still carries its separators", () => {
    expect(EXPANDING_PATH.split("\\")).toHaveLength(3);
  });

  it("finds a reference the environment would resolve", () => {
    expect(cmdExpansions(EXPANDING_PATH, env)).toEqual(["FOO"]);
  });

  it("matches case-insensitively, as Windows lookup does", () => {
    expect(cmdExpansions("%path%", env)).toEqual(["path"]);
  });

  it("ignores a pair naming nothing, which cmd leaves alone", () => {
    expect(cmdExpansions("%NOT_SET_ANYWHERE%", env)).toEqual([]);
  });

  it("ignores a lone percent, so a 50% directory still works", () => {
    expect(cmdExpansions(String.raw`C:\100% done\seed.ts`, env)).toEqual([]);
  });

  it("reports every reference in the argument", () => {
    const found = cmdExpansions("%FOO%-%Path%", env);

    expect(found).toEqual(["FOO", "Path"]);
  });

  it("treats a missing environment as defining nothing", () => {
    expect(cmdExpansions("%FOO%", undefined)).toEqual([]);
  });
});

describe("pnpmInvocation and the expansion cmd cannot be stopped from doing", () => {
  const env = { FOO: "EXPANDED" };

  it("refuses rather than hand cmd a path it would rewrite", () => {
    // Quoting is no defence: cmd expands inside double quotes, before pnpm
    // sees anything. Measured, along with the two escapes that do not work:
    // ^% survives literally, and %% leaves the name still expanded.
    expect(() =>
      pnpmInvocation(["tsx", EXPANDING_PATH], "win32", env)
    ).toThrow(/%FOO%/);
  });

  it("names the offending argument, since the fix is to move the path", () => {
    expect(() =>
      pnpmInvocation(["tsx", EXPANDING_PATH], "win32", env)
    ).toThrow(/cmd\.exe expands even inside quotes/);
  });

  it("lets an unresolvable pair through, quoted as usual", () => {
    const arg = String.raw`C:\a b\%NOT_SET%\seed.ts`;

    const { args } = pnpmInvocation(["tsx", arg], "win32", env);

    expect(args).toEqual(["tsx", `"${arg}"`]);
  });

  it("does not police POSIX, where nothing expands anything", () => {
    // No shell there, so the argument reaches pnpm byte for byte. Throwing
    // would break a path that works today.
    const arg = "/home/ci/p%FOO%th/seed.ts";

    expect(pnpmInvocation(["tsx", arg], "linux", env).args).toEqual([
      "tsx",
      arg,
    ]);
  });
});

describe("treeKillCommand", () => {
  it.each(["linux", "darwin", "freebsd"])(
    "asks for nothing on %s, where the signal already lands",
    platform => {
      expect(treeKillCommand(4321, platform)).toBeNull();
    }
  );

  it("walks the tree on Windows, where the handle is only the shell", () => {
    // /t is the whole point: without it taskkill stops cmd.exe and leaves
    // next dev holding the port, which is the state child.kill already
    // produces. /f because a console app under a dying shell will not
    // acknowledge a polite close.
    expect(treeKillCommand(4321, "win32")).toEqual({
      command: "taskkill",
      args: ["/pid", "4321", "/t", "/f"],
    });
  });

  it("passes the pid as a string, which spawn arguments must be", () => {
    const { args } = treeKillCommand(4321, "win32");

    for (const arg of args) expect(typeof arg).toBe("string");
  });

  it("reads the running platform when none is given", () => {
    const command = treeKillCommand(4321);

    expect(command === null).toBe(process.platform !== "win32");
  });
});

describe("the wrapper's shutdown path", () => {
  it("kills the tree rather than the handle it was given", async () => {
    // The forwarder is inside main(), which cannot be imported without
    // booting a dev server, so the wiring is asserted at the source level —
    // the same reason pnpmInvocation lives in its own module.
    const source = await readFile(WRAPPER, "utf-8");

    expect(source).toContain("treeKillCommand(child.pid)");

    // A bare child.kill(sig) as the ONLY disposal would be the regression:
    // it must stay reachable as the POSIX branch and the fallback, never as
    // the unconditional path.
    expect(source).not.toMatch(/if \(child\) child\.kill\(sig\);/);
  });

  it("still falls back when the tree kill cannot run", async () => {
    const source = await readFile(WRAPPER, "utf-8");

    // Without both handlers a missing or failing taskkill leaves the
    // wrapper waiting on an exit that never comes.
    expect(source).toContain('killer.on("error"');
    expect(source).toContain('killer.on("exit"');
  });
});

describe("what CI does and does not cover", () => {
  // The module's docblock tells the next reader where coverage could go. Two
  // facts make it true, and both live in a file this module cannot see, so
  // they are pinned here rather than trusted to stay put.
  it("still has the windows-latest legs the docblock points at", async () => {
    const ci = await readFile(path.join(WORKFLOWS, "ci.yml"), "utf-8");

    expect(ci).toContain("dev-script-smoke");
    expect(ci).toContain("windows-latest");
  });

  it("still runs the wrapper on no platform at all", async () => {
    // The narrow, accurate claim: unexercised everywhere, not only on Linux.
    // A workflow that starts running it makes the docblock wrong, and this
    // is the only place that would notice.
    const names = await readdir(WORKFLOWS);

    const running = [];
    for (const name of names) {
      const body = await readFile(path.join(WORKFLOWS, name), "utf-8");
      if (body.includes("dev-playground")) running.push(name);
    }

    expect(running).toEqual([]);
  });

  it("does not claim CI is Linux-only", async () => {
    const source = await readFile(MODULE, "utf-8");

    expect(source).not.toMatch(/CI, being Linux/);
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

  it("checks the arguments against the env the child will get", async () => {
    const source = await readFile(WRAPPER, "utf-8");

    // The expansion check is only as good as the environment it is run
    // against, and the wrapper does not spawn with process.env: it merges
    // .env in first. A call site that drops back to the two-argument form
    // would check the parent's environment and pass the child's.
    const calls = source.match(/pnpmInvocation\([^)]*\)/g) ?? [];

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain("childEnv");
  });
});
