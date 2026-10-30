/**
 * `generate:types --check` as CI reads it: the exit status is the verdict (0 agrees, 1 out of
 * date, 2 could not check), and the report's first line says which before any detail. The config
 * loader is stubbed; the map's files are real, in a folder of their own.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/config-loader", () => ({ loadConfig: vi.fn() }));

import {
  COMPONENT_IMPORT_MAP_FILENAME,
  COMPONENT_PATHS_FILENAME,
} from "../../plugins/codegen/component-import-map";
import type { PluginDefinition } from "../../plugins/plugin-context";
import type { CommandContext } from "../program";
import { loadConfig } from "../utils/config-loader";

import {
  COMPONENT_MAP_CHECK_EXIT,
  runComponentMapCheck,
} from "./component-map-check-command";

const shop = {
  name: "@acme/shop",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    dashboard: {
      widgets: [
        {
          id: "acme/revenue",
          view: { component: "@acme/shop/admin#Revenue" },
        },
      ],
    },
  },
} as unknown as PluginDefinition;

const DIR = "src/types/generated";
let root: string;
let lines: { success: string[] };
/** What the command printed in the error shape, on standard error, without colour. */
let printed: string;

function context(): CommandContext {
  lines = { success: [] };
  printed = "";
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    printed += stripVTControlCharacters(parts.map(String).join(" ")) + "\n";
  });
  return {
    logger: {
      success: vi.fn((line: string) => lines.success.push(line)),
      info: vi.fn(),
      warn: vi.fn(),
      getOptions: () => ({ verbose: false, noColor: true }),
    },
  } as unknown as CommandContext;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nextly-map-check-cli-"));
  await mkdir(join(root, DIR), { recursive: true });
  vi.mocked(loadConfig).mockResolvedValue({
    config: {
      plugins: [shop],
      typescript: { outputFile: `./${DIR}/nextly-types.ts` },
    },
  } as unknown as Awaited<ReturnType<typeof loadConfig>>);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.mocked(loadConfig).mockReset();
  vi.restoreAllMocks();
});

/** A map registering `paths`, in the shape the generator writes its `registered` object. */
const mapOf = (paths: readonly string[]) =>
  [
    "export const componentMapAgreesWithList = true;",
    "",
    "const registered = {",
    // Each under the member the generator writes for its path: what follows its `#`.
    ...paths.map(
      path =>
        `  ${JSON.stringify(path)}: _p0.${path.split("#")[1] ?? "default"},`
    ),
    "};",
    "",
  ].join("\n");

/** Commits a list of `paths`, and a map registering the same. */
const list = async (paths: string[]) => {
  await writeFile(join(root, DIR, COMPONENT_IMPORT_MAP_FILENAME), mapOf(paths));
  await writeFile(
    join(root, DIR, COMPONENT_PATHS_FILENAME),
    `export const registeredComponentPaths = ${JSON.stringify(paths)} as const;\n`
  );
};

describe("the check's verdict", () => {
  it("exits 0 when the map agrees, and says so", async () => {
    await list(["@acme/shop/admin#Revenue"]);
    expect(await runComponentMapCheck({ cwd: root }, context())).toBe(
      COMPONENT_MAP_CHECK_EXIT.agrees
    );
    expect(lines.success).toEqual(["Component map: agrees with the config."]);
    expect(printed).toBe("");
  });

  it("exits 1 when it does not, the verdict first, each disagreement, then the fix", async () => {
    await list(["@gone/old/admin#Chart"]);
    expect(await runComponentMapCheck({ cwd: root }, context())).toBe(
      COMPONENT_MAP_CHECK_EXIT.outOfDate
    );
    expect(printed).toBe(
      [
        `✗ The component map is out of date (${DIR}/${COMPONENT_IMPORT_MAP_FILENAME} and ${DIR}/${COMPONENT_PATHS_FILENAME}).`,
        '  Why:  - missing: plugin "@acme/shop", widget "acme/revenue": @acme/shop/admin#Revenue',
        "        - no longer declared: @gone/old/admin#Chart",
        "  Next: Run `npx nextly generate:types` and commit both files.",
        "  Docs: https://nextlyhq.com/docs/cli/errors/component-map-out-of-date  (COMPONENT_MAP_OUT_OF_DATE)",
        "",
      ].join("\n")
    );
  });

  it("exits 1 when the map checks its widgets against another config than the one loaded", async () => {
    vi.mocked(loadConfig).mockResolvedValueOnce({
      config: {
        plugins: [shop],
        typescript: { outputFile: `./${DIR}/nextly-types.ts` },
      },
      configPath: join(root, "nextly.config.ts"),
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    // The map the helper commits imports no config at all.
    await list(["@acme/shop/admin#Revenue"]);
    expect(await runComponentMapCheck({ cwd: root }, context())).toBe(
      COMPONENT_MAP_CHECK_EXIT.outOfDate
    );
    expect(printed).toContain(
      `- checks its widgets against no config, not ../../../nextly.config: ${DIR}/${COMPONENT_IMPORT_MAP_FILENAME}`
    );
  });

  it("exits 2 when the config does not load, never reading as an answer about the map", async () => {
    vi.mocked(loadConfig).mockRejectedValueOnce(new Error("config threw"));
    expect(await runComponentMapCheck({ cwd: root }, context())).toBe(
      COMPONENT_MAP_CHECK_EXIT.couldNotCheck
    );
    // The reason it could not ask, in the error shape, with the error's own words.
    expect(printed).toMatch(/^✗ /);
    expect(printed).toContain("  Why:  config threw");
  });

  it("writes nothing, even where it finds the map out of date", async () => {
    // A map and no list at all: a writer would create the list.
    await writeFile(join(root, DIR, COMPONENT_IMPORT_MAP_FILENAME), mapOf([]));
    expect(await runComponentMapCheck({ cwd: root }, context())).toBe(
      COMPONENT_MAP_CHECK_EXIT.outOfDate
    );
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(join(root, DIR))).toEqual([
      COMPONENT_IMPORT_MAP_FILENAME,
    ]);
    expect(printed).toContain(`- absent: ${DIR}/${COMPONENT_PATHS_FILENAME}`);
  });
});
