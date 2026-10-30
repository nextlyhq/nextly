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

import {
  FIXTURE_SESSION_COOKIE,
  startFixtureServer,
} from "./fixture-server.mjs";
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
    // Signs in as a fixture knows a session: by its cookie on the server's host.
    signIn: async (baseURL, file) => {
      calls.signedIn.push(baseURL);
      const cookie = {
        name: FIXTURE_SESSION_COOKIE,
        value: "1",
        domain: "localhost",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      };
      writeFileSync(file, JSON.stringify({ cookies: [cookie], origins: [] }));
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

  it("deletes a published topic with --unpublish, starting and capturing nothing", async () => {
    const asked = [];
    const code = await visualCheck(["--unpublish", "posts-list"], {
      ...deps(),
      unpublish: async options => {
        asked.push(options.topic);
        return { deleted: true, source: "feature-x" };
      },
    });
    expect(code).toBe(0);
    expect(asked).toEqual(["posts-list"]);
    expect(calls.started).toBe(0);
    expect(calls.signedIn).toEqual([]);
    expect(lines.join("\n")).toMatch(/pr-screenshots\/posts-list.*feature-x/);
  });

  it("captures nothing for a route that answers but never draws its screen", async () => {
    const code = await visualCheck(["/admin/blank", "--reuse", "--out", out], {
      ...deps(),
      drawnMs: 500,
    });
    expect(code).not.toBe(0);
    expect(captured()).toEqual([]);
    expect(lines.join("\n")).toMatch(/\/admin\/blank.*drew no/);
  });

  it("captures nothing for a route axe could check nothing on", async () => {
    const code = await run("/admin/bare", "--reuse");
    expect(code).not.toBe(0);
    expect(captured()).toEqual([]);
    expect(lines.join("\n")).toMatch(/\/admin\/bare.*scanned nothing/);
  });

  /** A publish that records what it was asked to push, in place of a push. */
  const recordedPublish = () => {
    const pushed = [];
    return {
      pushed,
      publish: async ({ topic, files }) => {
        pushed.push({ topic, files: files.length });
        return {
          branch: `pr-screenshots/${topic}`,
          rawBase: "https://raw.example/o/r",
        };
      },
    };
  };
  const runPublishing = (record, ...argv) =>
    visualCheck([...argv, "--reuse", "--out", out], {
      ...deps(),
      publish: record.publish,
    });

  it("publishes a clean run with every route captured", async () => {
    const record = recordedPublish();
    expect(await runPublishing(record, "/admin", "--publish", "t")).toBe(0);
    expect(record.pushed).toEqual([{ topic: "t", files: 6 }]);
    expect(lines.join("\n")).toMatch(/^## The look/m);
  });

  it("publishes nothing for a run with findings", async () => {
    const record = recordedPublish();
    expect(
      await runPublishing(record, "/admin/wide", "--publish", "t")
    ).not.toBe(0);
    expect(record.pushed).toEqual([]);
    expect(lines.join("\n")).toMatch(
      /Not published.*finding.*--allow-findings/
    );
  });

  it("with --allow-findings publishes it, and lists the findings under the captures", async () => {
    const record = recordedPublish();
    const code = await runPublishing(
      record,
      "/admin/wide",
      "--publish",
      "t",
      "--allow-findings"
    );
    expect(code).not.toBe(0);
    expect(record.pushed).toEqual([{ topic: "t", files: 6 }]);
    const text = lines.join("\n");
    const look = text.indexOf("## The look");
    const listed = text.indexOf(
      "/admin/wide 390 light: div.wide-box ends past the right edge",
      look
    );
    expect(look).toBeGreaterThanOrEqual(0);
    expect(listed).toBeGreaterThan(text.indexOf("![", look));
  });

  /*
   * The findings are published too, so a query value such as a reset token
   * must not reach them any more than it reaches a capture's name.
   */
  it("keeps a query's values out of the findings it publishes", async () => {
    const record = recordedPublish();
    // Assembled from pieces, so no credential-shaped text sits in the source.
    const secret = ["9c1e", "77ab", "03fd5e2"].join("");
    await runPublishing(
      record,
      `/admin/wide?token=${secret}`,
      "--publish",
      "t",
      "--allow-findings"
    );
    expect(record.pushed).toEqual([{ topic: "t", files: 6 }]);
    const text = lines.join("\n");
    const look = text.slice(text.indexOf("## The look"));
    expect(look).toMatch(
      /\/admin\/wide\?token=…#[0-9a-f]{8} 390 light: div\.wide-box/
    );
    expect(look).not.toContain(secret);
  });

  it("never publishes a run with a route not captured, flag or not", async () => {
    for (const flags of [[], ["--allow-findings"]]) {
      const record = recordedPublish();
      expect(
        await runPublishing(
          record,
          "/admin",
          "/admin/missing",
          "--publish",
          "t",
          ...flags
        )
      ).not.toBe(0);
      expect(record.pushed).toEqual([]);
    }
    expect(lines.join("\n")).toMatch(/Not published.*not captured/);
  });

  it("captures an admin screen once its root shows the scheme asked for", async () => {
    expect(await run("/admin/themed", "--reuse")).toBe(0);
    expect(captured()).toHaveLength(6);
  });

  it("captures nothing for a route whose admin never shows the scheme asked for, naming the view", async () => {
    const code = await visualCheck(
      ["/admin/stuck-light", "--reuse", "--out", out],
      {
        ...deps(),
        drawnMs: 500,
      }
    );
    expect(code).not.toBe(0);
    expect(captured()).toEqual([]);
    expect(lines.join("\n")).toMatch(
      /\/admin\/stuck-light 390 dark: .*dark scheme/
    );
  });

  /*
   * The register fixture turns a signed-in visitor away, as a public screen
   * may; the members-only one sends a signed-out visitor to sign in. Both pass
   * only when each is opened as its kind of screen needs.
   */
  it("captures a public screen signed out and a private one signed in", async () => {
    expect(await run("/admin/register", "/admin/members-only", "--reuse")).toBe(
      0
    );
    expect(captured()).toHaveLength(12);
  });

  it("signs in for no run whose every route is public", async () => {
    expect(await run("/admin/register", "--reuse")).toBe(0);
    expect(calls.signedIn).toEqual([]);
  });

  it("signs in again when the session is old enough to expire during the run", async () => {
    let clock = 0;
    const code = await visualCheck(["/admin", "--reuse", "--out", out], {
      ...deps(),
      // Four minutes pass with every reading of the clock.
      now: () => (clock += 4 * 60_000),
    });
    expect(code).toBe(0);
    expect(calls.signedIn.length).toBeGreaterThan(1);
  });

  /** Writes a `--prepare` module that opens the fixture's dialog, or fails where there is none. */
  const prepareModule = () => {
    const file = path.join(out, "open-filters.mjs");
    writeFileSync(
      file,
      `export default async (page, { route, width, scheme }) => {
  await page.getByRole("button", { name: "Open filters" }).click({ timeout: 1000 });
  await page.getByRole("dialog", { name: "Filters" }).waitFor({ timeout: 1000 });
};
`
    );
    return file;
  };

  it("runs --prepare before reading and capturing each view, so an opened dialog is in it", async () => {
    await run("/admin/dialog", "--reuse", "--prepare", prepareModule());
    expect(captured()).toHaveLength(6);
    expect(lines.join("\n")).toContain(
      "/admin/dialog 390 light: div#fixture-dialog ends past the right edge"
    );
  });

  it("reads no dialog without --prepare, the control for the one above", async () => {
    await run("/admin/dialog", "--reuse");
    expect(lines.join("\n")).not.toContain("fixture-dialog");
  });

  it("captures nothing for a view whose --prepare fails, naming the view", async () => {
    const code = await run("/admin", "--reuse", "--prepare", prepareModule());
    expect(code).not.toBe(0);
    expect(captured()).toEqual([]);
    expect(lines.join("\n")).toMatch(/\/admin 390 light: --prepare failed/);
  });

  it("refuses a --prepare module with no default function before anything starts", async () => {
    const file = path.join(out, "empty.mjs");
    writeFileSync(file, "export const nothing = 1;\n");
    expect(await run("/admin", "--prepare", file)).toBe(2);
    expect(calls.started).toBe(0);
    expect(lines.join("\n")).toMatch(/default export/);
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
