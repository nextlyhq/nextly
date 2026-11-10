/**
 * `nextly init --dry-run` names every file and folder a real `nextly init`
 * would make, from the same steps the real run takes, and makes none of them.
 * Where the real run would refuse, it says so and still ends normally; where
 * it cannot work out its answers, it fails as the real run does.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { folderSnapshot } from "../../__tests__/helpers/folder-snapshot";
import { createContext, type CommandContext } from "../../context";
import { dryRunLines } from "../../dry-run";
import { runInit } from "../init";

const made: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  setNonInteractive(false);
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A project with the given folders. */
function project(folders: string[] = []): string {
  const cwd = mkdtempSync(join(tmpdir(), "nextly-init-dry-"));
  made.push(cwd);
  for (const folder of folders)
    mkdirSync(join(cwd, folder), { recursive: true });
  return cwd;
}

/** A context whose logger keeps every info line it is given. */
function recording(cwd: string): { context: CommandContext; info: string[] } {
  const context = createContext({ quiet: true, cwd });
  const info: string[] = [];
  return {
    info,
    context: {
      ...context,
      logger: { ...context.logger, info: line => void info.push(line) },
    },
  };
}

/** A reported path as a folder snapshot keys it. */
const asKey = (target: string) =>
  target.replace(/^\.\//, "").replace(/\/$/, "");

describe("nextly init --dry-run", () => {
  it("names each file and folder the real run makes, and makes none", async () => {
    const cwd = project(["app"]);
    const before = folderSnapshot(cwd);
    const { context, info } = recording(cwd);

    await runInit({ cwd, yes: true, dryRun: true }, context);

    expect(folderSnapshot(cwd)).toEqual(before);
    const changes = [
      "./collections/",
      "./db/schemas/collections/",
      "./db/schemas/zod/",
      "./db/migrations/",
      "./types/generated/",
      "nextly.config.ts",
      "./collections/posts.ts",
      "./collections/index.ts",
      "./lib/nextly.ts",
      "./types/generated/.gitkeep",
      "./db/migrations/.gitkeep",
    ].map(target => ({ action: "write" as const, target }));
    expect(info.slice(-(changes.length + 1))).toEqual(dryRunLines({ changes }));

    // The real run in the same project makes exactly what was named: every
    // named path, and nothing else but the folders that hold them.
    await runInit({ cwd, yes: true }, createContext({ quiet: true, cwd }));
    const named = changes.map(change => asKey(change.target));
    const holders = named.flatMap(path => {
      const parts = path.split("/");
      return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"));
    });
    const written = Object.keys(folderSnapshot(cwd)).filter(
      path => !(path in before)
    );
    expect(named.filter(path => !written.includes(path))).toEqual([]);
    expect(
      written.filter(path => !named.includes(path) && !holders.includes(path))
    ).toEqual([]);
  });

  it("does not name a folder that is already there", async () => {
    const cwd = project(["app", "db/migrations"]);
    const { context, info } = recording(cwd);

    await runInit({ cwd, yes: true, dryRun: true }, context);

    expect(info).not.toContain("Would write ./db/migrations/");
    expect(info).toContain("Would write ./db/migrations/.gitkeep");
  });

  it("says a real run would refuse a folder it needs that is a file", async () => {
    const cwd = project(["db"]);
    // Where `init` makes the migrations folder, a file of that name.
    writeFileSync(join(cwd, "db/migrations"), "not a folder\n");
    const before = folderSnapshot(cwd);
    const { context, info } = recording(cwd);

    await runInit({ cwd, yes: true, dryRun: true }, context);

    expect(folderSnapshot(cwd)).toEqual(before);
    expect(info).toContain(
      "A real run would refuse: ./db/migrations is a file, where a folder is needed."
    );
    expect(info.at(-1)).toBe("Dry run: nothing was changed.");
  });

  it("says a real run would refuse an initialized project, and ends normally", async () => {
    const cwd = project();
    const configPath = join(cwd, "nextly.config.ts");
    writeFileSync(configPath, "export default {};\n");
    const before = folderSnapshot(cwd);
    const { context, info } = recording(cwd);

    await runInit({ cwd, dryRun: true }, context);

    expect(folderSnapshot(cwd)).toEqual(before);
    expect(info.slice(-2)).toEqual(
      dryRunLines({
        changes: [],
        refusals: [
          `Nextly is already initialized in this directory. ${configPath} already exists.`,
        ],
      })
    );
  });

  it("names the config --force would overwrite", async () => {
    const cwd = project();
    writeFileSync(join(cwd, "nextly.config.ts"), "export default {};\n");
    const { context, info } = recording(cwd);

    await runInit({ cwd, yes: true, force: true, dryRun: true }, context);

    expect(info).toContain("Would write nextly.config.ts");
    expect(readFileSync(join(cwd, "nextly.config.ts"), "utf8")).toBe(
      "export default {};\n"
    );
  });

  it("fails as the real run does when nobody can answer its questions", async () => {
    const cwd = project();
    setNonInteractive(true);
    const exit = vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Error(`exit ${String(code)}`);
    });
    const printed: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      printed.push(parts.map(String).join(" "));
    });

    await expect(
      runInit({ cwd, dryRun: true }, recording(cwd).context)
    ).rejects.toThrow("exit 1");
    expect(exit).toHaveBeenCalledWith(1);
    expect(printed.join("\n")).toContain("INIT_ANSWERS_REQUIRED");
    expect(folderSnapshot(cwd)).toEqual({});
  });
});
