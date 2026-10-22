/**
 * What createNextly asks, and passes on, for a plugin scaffold.
 *
 * The flow runs for real with the prompts and the file-writing steps replaced,
 * so the test observes which questions are put to the developer and what the
 * scaffold step is handed.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  warn: vi.fn(),
}));
const copyTemplate = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
  isCancel: () => false,
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
  log: {
    success: vi.fn(),
    warn: prompts.warn,
    info: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
  },
  select: prompts.select,
  text: prompts.text,
  confirm: prompts.confirm,
}));
vi.mock("@nextlyhq/telemetry", () => ({
  capture: vi.fn(),
  classifyError: () => "unknown",
}));
vi.mock("../utils/template", () => ({ copyTemplate }));
vi.mock("../installers/dependencies", () => ({
  installDependencies: vi.fn(async () => {}),
}));
// Nothing is written, so the app path's detection and env steps have no project
// to read; they answer as for a fresh app.
vi.mock("../utils/detect", async importOriginal => ({
  ...(await importOriginal<typeof import("../utils/detect")>()),
  detectProject: vi.fn(async () => ({
    isNextJs: true,
    isAppRouter: true,
    hasTypescript: true,
    packageManager: "pnpm",
    nextVersion: "16.0.0",
    srcDir: true,
    appDir: "src/app",
  })),
}));
vi.mock("../generators/env", () => ({ generateEnv: vi.fn(async () => {}) }));

import { createNextly } from "../create-nextly";

describe("createNextly for the plugin template", () => {
  let cwd: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // An exit would end the run silently; as a throw it fails the case.
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Error(`process.exit(${String(code)})`);
    });
    cwd = await mkdtemp(path.join(tmpdir(), "nextly-create-plugin-"));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true });
  });

  /** The questions put to the developer, by their message. */
  const asked = (): string[] =>
    [...prompts.select.mock.calls, ...prompts.text.mock.calls].map(
      ([options]) => String((options as { message: string }).message)
    );

  // The playground runs on SQLite whatever is chosen, so a database answer
  // would be collected and then ignored.
  it("asks for no database and scaffolds the SQLite playground", async () => {
    await createNextly({
      cwd,
      projectType: "plugin",
      projectNameFromArg: "my-plugin",
      skipInstall: true,
    });

    expect(asked()).toEqual([]);
    expect(copyTemplate).toHaveBeenCalledTimes(1);
    expect(copyTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectType: "plugin",
        database: expect.objectContaining({ type: "sqlite" }),
      })
    );
  });

  it("says so when --database names another database", async () => {
    await createNextly({
      cwd,
      projectType: "plugin",
      projectNameFromArg: "my-plugin",
      database: "postgresql",
      skipInstall: true,
    });

    expect(asked()).toEqual([]);
    expect(copyTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        database: expect.objectContaining({ type: "sqlite" }),
      })
    );
    expect(String(prompts.warn.mock.calls[0])).toContain("SQLite");
  });

  // createNextly is exported, so it is called without the binary too. The
  // bundled template must still come with the packages of its own release,
  // whichever way the scaffold was started.
  it("pins a bundled plugin to this package's release when called directly", async () => {
    const manifest = JSON.parse(
      await readFile(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../package.json"
        ),
        "utf-8"
      )
    ) as { version: string };

    await createNextly({
      cwd,
      projectType: "plugin",
      projectNameFromArg: "my-plugin",
      skipInstall: true,
    });

    expect(copyTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        nextlySource: { kind: "release", cliVersion: manifest.version },
      })
    );
  });

  // The control: an app template still asks.
  it("still asks an app scaffold which database to use", async () => {
    prompts.select.mockResolvedValueOnce("sqlite");
    await createNextly({
      cwd,
      projectType: "blank",
      projectNameFromArg: "my-app",
      skipInstall: true,
    });

    expect(asked()).toContain("Which database will you use?");
  });
});
