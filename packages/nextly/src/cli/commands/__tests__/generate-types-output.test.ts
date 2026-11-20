/**
 * `generate:types -o <path>`: the path is the types file's, the Zod schemas
 * go to a `zod` folder beside it, and the block manifest and the plugin
 * import map, which other code reads from where the configuration puts them,
 * are not written there, which the run says. Every file the run writes or
 * removes is listed, and the list is what is on disk.
 *
 * Driven through `runGenerateTypes` itself, with only the config loader
 * replaced, so the paths the command resolves are part of what is tested.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TYPESCRIPT_CONFIG } from "../../../shared/types/config";

const loadConfig = vi.hoisted(() => vi.fn());
vi.mock("../../utils/config-loader", () => ({ loadConfig }));

const { runGenerateTypes } = await import("../generate-types");
const { createContext } = await import("../../program");

const dirs: string[] = [];

afterEach(async () => {
  loadConfig.mockReset();
  vi.restoreAllMocks();
  await Promise.all(
    dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

/** An app under src/ with one collection, whose config keeps the default paths. */
async function app(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "nextly-types-output-"));
  dirs.push(cwd);
  await mkdir(join(cwd, "src/app"), { recursive: true });
  loadConfig.mockResolvedValue({
    configPath: "nextly.config.ts",
    config: {
      collections: [
        {
          slug: "posts",
          labels: { singular: "Post", plural: "Posts" },
          fields: [{ name: "title", type: "text", required: true }],
        },
      ],
      singles: [],
      fieldGroups: [],
      users: { fields: [] },
      plugins: [],
      typescript: { ...DEFAULT_TYPESCRIPT_CONFIG },
      db: { schemasDir: "./src/db/schemas/collections" },
    },
  });
  return cwd;
}

/** Every file under `cwd`, relative to it, with forward slashes. */
async function filesUnder(cwd: string): Promise<string[]> {
  const entries = await readdir(cwd, { recursive: true, withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry =>
      relative(cwd, join(entry.parentPath, entry.name)).replaceAll("\\", "/")
    )
    .sort();
}

/** Run `generate:types -o out/types.ts` in `cwd`, and answer everything it said. */
async function generateTo(cwd: string): Promise<string> {
  const context = createContext({ quiet: true, cwd });
  const said: string[] = [];
  for (const level of [
    "info",
    "success",
    "warn",
    "item",
    "debug",
    "keyValue",
    "error",
  ] as const) {
    vi.spyOn(context.logger, level).mockImplementation(
      (...parts: unknown[]) => {
        said.push(parts.map(String).join(" "));
      }
    );
  }
  await runGenerateTypes(
    { cwd, quiet: true, zod: true, output: join(cwd, "out/types.ts") },
    context
  );
  return said.join("\n");
}

/** The .ts paths a run's output names, relative to `cwd`. */
function pathsNamed(said: string, cwd: string): string[] {
  const named = said.match(/[^\s'"`→()]+\.ts\b/g) ?? [];
  return [
    ...new Set(
      named.map(path =>
        (isAbsolute(path) ? relative(cwd, path) : path).replaceAll("\\", "/")
      )
    ),
  ].sort();
}

describe("generate:types with -o", () => {
  it("-o in a temporary folder: every file written is listed and in that folder", async () => {
    const cwd = await app();

    const said = await generateTo(cwd);

    const written = await filesUnder(cwd);
    expect(written).toContain("out/types.ts");
    expect(written.some(file => file.startsWith("out/zod/"))).toBe(true);
    // Nothing outside the folder -o names: no schemas folder, no generated
    // folder beside the configured types file.
    expect(written.filter(file => !file.startsWith("out/"))).toEqual([]);
    // Each is named, with where it went.
    for (const file of written) {
      expect(said, file).toContain(file);
    }
  });

  it("names the skipped manifest and import map", async () => {
    const cwd = await app();

    const said = await generateTo(cwd);

    expect(said).toMatch(/import map[^\n]*(skipp|not written)/i);
    expect(said).toMatch(/manifest[^\n]*(skipp|not written)/i);
  });

  it("the list matches the files on disk", async () => {
    const cwd = await app();

    const said = await generateTo(cwd);

    // Every path the run names is a file it wrote, and every file it wrote
    // is named: the list and the disk agree both ways. The configuration it
    // loaded is named too, as read, not written.
    const named = pathsNamed(said, cwd).filter(
      path => path !== "nextly.config.ts"
    );
    expect(named.filter(path => !existsSync(join(cwd, path)))).toEqual([]);
    expect(named).toEqual(await filesUnder(cwd));
  });
});
