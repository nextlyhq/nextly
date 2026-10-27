import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { startFixtureServer } from "./fixture-server.mjs";
import { visualCheck } from "./run.mjs";

/** A PNG's height in pixels, read from its header. */
const pngHeight = file => readFileSync(file).readUInt32BE(20);

/*
 * The whole command, against the fixture server standing in for the built
 * playground. Starting the server and signing in are the parts a test cannot
 * do for real here, so they are recorded rather than run; everything from the
 * browser onwards is real.
 */
describe("the visual check, run against a stubbed server", () => {
  let server;
  let out;
  let lines;
  let calls;

  beforeAll(async () => {
    server = await startFixtureServer();
  });

  afterAll(async () => {
    await server?.close();
  });

  beforeEach(() => {
    out = mkdtempSync(path.join(tmpdir(), "visual-check-run-"));
    lines = [];
    calls = { started: 0, signedIn: [] };
  });

  afterEach(() => rmSync(out, { recursive: true, force: true }));

  const deps = () => ({
    env: { E2E_PROD_PORT: String(server.port) },
    log: line => lines.push(line),
    startServer: async ({ port }) => {
      calls.started += 1;
      calls.startedOn = port;
      return {
        pid: 4242,
        stop: async () => {
          calls.stopped = (calls.stopped ?? 0) + 1;
        },
        release: () => {
          calls.released = (calls.released ?? 0) + 1;
        },
      };
    },
    signIn: async (baseURL, file) => {
      calls.signedIn.push(baseURL);
      writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }));
    },
  });

  const run = (...argv) => visualCheck([...argv, "--out", out], deps());
  const captured = () =>
    readdirSync(out)
      .filter(name => name.endsWith(".png"))
      .sort();

  it("builds and starts the server on the checkout's port, signs in, and captures six views of the route", async () => {
    const code = await run("/admin");
    expect(code).toBe(0);
    expect(calls.started).toBe(1);
    expect(calls.startedOn).toBe(server.port);
    expect(calls.signedIn).toEqual([server.baseURL]);
    expect(captured()).toEqual(
      [
        "admin-1024-dark.png",
        "admin-1024-light.png",
        "admin-1440-dark.png",
        "admin-1440-light.png",
        "admin-390-dark.png",
        "admin-390-light.png",
      ].sort()
    );
    // The schemes are really applied: the fixture differs only by its dark palette.
    expect(
      readFileSync(path.join(out, "admin-390-dark.png")).equals(
        readFileSync(path.join(out, "admin-390-light.png"))
      )
    ).toBe(false);
    expect(pngHeight(path.join(out, "admin-390-light.png"))).toBe(844);
  });

  it("stops the server it started, or with --keep leaves it running and says how to stop it", async () => {
    expect(await run("/admin")).toBe(0);
    expect(calls.stopped).toBe(1);
    expect(calls.released).toBeUndefined();

    calls.stopped = undefined;
    expect(await run("/admin", "--keep")).toBe(0);
    expect(calls.stopped).toBeUndefined();
    expect(calls.released).toBe(1);
    expect(lines.join("\n")).toMatch(/--reuse/);
    expect(lines.join("\n")).toContain("kill -TERM -4242");
  });

  it("captures the whole page with --full", async () => {
    expect(await run("/admin", "--full")).toBe(0);
    expect(pngHeight(path.join(out, "admin-390-light.png"))).toBeGreaterThan(
      2000
    );
  });

  it("uses the running server with --reuse, and starts nothing", async () => {
    expect(await run("/admin", "--reuse")).toBe(0);
    expect(calls.started).toBe(0);
    expect(calls.signedIn).toEqual([server.baseURL]);
    expect(captured()).toHaveLength(6);
  });

  it("captures nothing for a route answering 404 or sent to sign-in, says so, and exits non-zero", async () => {
    const code = await run(
      "/admin",
      "/admin/missing",
      "/admin/private",
      "--reuse"
    );
    expect(code).not.toBe(0);
    expect(captured()).toHaveLength(6);
    expect(
      captured().every(
        name =>
          name.startsWith("admin-") &&
          !name.includes("missing") &&
          !name.includes("private")
      )
    ).toBe(true);
    expect(lines.join("\n")).toMatch(/\/admin\/missing.*answered 404/);
    expect(lines.join("\n")).toMatch(/\/admin\/private.*sign-in/);
  });

  it("keeps none of a route's captures when it fails part way through its views", async () => {
    const code = await run("/admin/once", "--reuse");
    expect(code).not.toBe(0);
    expect(lines.join("\n")).toMatch(/\/admin\/once.*answered 404/);
    expect(captured()).toEqual([]);
  });

  it("prints every finding, at each width and scheme it was seen, before exiting non-zero", async () => {
    const code = await run("/admin/wide", "/admin/unlabelled", "--reuse");
    expect(code).not.toBe(0);
    const text = lines.join("\n");
    for (const scheme of ["light", "dark"]) {
      expect(text).toContain(
        `/admin/wide 390 ${scheme}: the page scrolls sideways`
      );
      expect(text).toContain(
        `/admin/wide 390 ${scheme}: div.wide-box ends past the right edge`
      );
    }
    expect(text).not.toContain(
      "/admin/wide 1024 light: the page scrolls sideways"
    );
    for (const width of [390, 1024, 1440]) {
      expect(text).toContain(
        `/admin/unlabelled ${width} dark: axe button-name (critical) at button`
      );
    }
    // Captured all the same: the reader needs to see what the check saw.
    expect(captured()).toHaveLength(12);
  });
});
