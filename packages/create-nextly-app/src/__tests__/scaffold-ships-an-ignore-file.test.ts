/**
 * A scaffolded project must arrive with a `.gitignore`.
 *
 * It writes a real `.env`, so without one the first `git add .` in a new project commits it.
 *
 * The failure this guards is specifically a PACKAGING failure, and that is what makes it hard to
 * see: npm removes `.gitignore` from every tarball it packs, with no way to opt out. A template
 * storing the file under its real name therefore keeps it in a checkout — which is what
 * `--local-template` reads, and what everyone working on this repository uses — and loses it in
 * the published CLI, which is what every user runs.
 *
 * So the invariant is asserted on the NAME the template stores it under, not on the presence of an
 * ignore file. A test that only asked "does a scaffold have a .gitignore" passes from a checkout
 * while the published package ships without one, which is the state this replaces.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseConfig } from "../types";
import { copyTemplate } from "../utils/template";

vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(),
    existsSync: vi.fn(),
    copy: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    ensureDir: vi.fn(),
  },
}));

const templates = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "templates"
);

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

describe("the ignore file survives packing", () => {
  // `node:fs` rather than the mocked `fs-extra`, because this asserts what is on disk in the
  // repository rather than anything the scaffolder does.
  it.each(["base", "plugin"])(
    "templates/%s stores it under a name npm will pack",
    template => {
      expect(existsSync(join(templates, template, "gitignore"))).toBe(true);
      // The dotted name is the failure mode, not merely a duplicate: npm would strip it, and its
      // presence would mean someone had restored the arrangement this guards against.
      expect(existsSync(join(templates, template, ".gitignore"))).toBe(false);
    }
  );

  // A control on the two assertions above. Both would also pass if `templates` resolved to a
  // directory that does not exist — `existsSync` would answer false for the dotted name for the
  // wrong reason, and the first assertion's failure is the only thing separating them.
  it("is looking at the real templates directory", () => {
    expect(existsSync(join(templates, "base", "package.json"))).toBe(false);
    expect(existsSync(join(templates, "base", "tsconfig.json"))).toBe(true);
  });
});

describe("copyTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.pathExists).mockResolvedValue(true as never);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.copy).mockResolvedValue(undefined as never);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined as never);
    vi.mocked(fs.move).mockResolvedValue(undefined as never);
    vi.mocked(fs.readdir).mockResolvedValue([] as never);
    vi.mocked(fs.readFile).mockResolvedValue("" as never);
  });

  // OBSERVED on the real call rather than reconstructed: the assertion reads the arguments
  // `fs.move` actually received, so it keeps watching the line it exists for.
  it("renames the shipped ignore file to its real name in the project", async () => {
    await copyTemplate({
      projectName: "app",
      projectType: "blank",
      targetDir: "/out",
      database: sqlite,
      templateSource: { basePath: "/tpl/base", templatePath: "/tpl/blank" },
      // The mocked filesystem answers "exists" to everything, which the copy reads as a
      // target directory already in use. The installer sets this whenever it has already
      // settled that question with the user.
      allowExistingTarget: true,
    });

    const move = vi
      .mocked(fs.move)
      .mock.calls.find(([from]) => String(from).endsWith("gitignore"));

    expect(
      move,
      "no rename of the shipped ignore file was attempted"
    ).toBeDefined();
    expect(String(move?.[0])).toBe(join("/out", "gitignore"));
    expect(String(move?.[1])).toBe(join("/out", ".gitignore"));
  }, 30_000);
});
