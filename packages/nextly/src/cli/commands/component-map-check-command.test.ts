/**
 * `generate:types --check` as CI reads it: the exit status is the verdict (0 agrees, 1 out of
 * date, 2 could not check), and the report's first line says which before any detail. The config
 * loader is stubbed; the map's files are real, in a folder of their own.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
let lines: { error: string[]; success: string[] };

function context(): CommandContext {
  lines = { error: [], success: [] };
  return {
    logger: {
      error: vi.fn((line: string) => lines.error.push(line)),
      success: vi.fn((line: string) => lines.success.push(line)),
      info: vi.fn(),
      warn: vi.fn(),
    },
  } as unknown as CommandContext;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nextly-map-check-cli-"));
  await mkdir(join(root, DIR), { recursive: true });
  await writeFile(
    join(root, DIR, COMPONENT_IMPORT_MAP_FILENAME),
    "// the map\n"
  );
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
});

const list = (paths: string[]) =>
  writeFile(
    join(root, DIR, COMPONENT_PATHS_FILENAME),
    `export const registeredComponentPaths = ${JSON.stringify(paths)} as const;\n`
  );

describe("the check's verdict", () => {
  it("exits 0 when the map agrees, and says so", async () => {
    await list(["@acme/shop/admin#Revenue"]);
    expect(await runComponentMapCheck({ cwd: root }, context())).toBe(
      COMPONENT_MAP_CHECK_EXIT.agrees
    );
    expect(lines.success).toEqual(["Component map: agrees with the config."]);
    expect(lines.error).toEqual([]);
  });

  it("exits 1 when it does not, the verdict first, each disagreement, then the fix", async () => {
    await list(["@gone/old/admin#Chart"]);
    expect(await runComponentMapCheck({ cwd: root }, context())).toBe(
      COMPONENT_MAP_CHECK_EXIT.outOfDate
    );
    expect(lines.error).toEqual([
      `Component map: OUT OF DATE (${DIR}/${COMPONENT_IMPORT_MAP_FILENAME} and ${DIR}/${COMPONENT_PATHS_FILENAME}).`,
      '- missing: plugin "@acme/shop", widget "acme/revenue": @acme/shop/admin#Revenue',
      "- no longer declared: @gone/old/admin#Chart",
      "Run `npx nextly generate:types` and commit both files.",
    ]);
  });

  it("exits 2 when the config does not load, never reading as an answer about the map", async () => {
    vi.mocked(loadConfig).mockRejectedValueOnce(new Error("config threw"));
    expect(await runComponentMapCheck({ cwd: root }, context())).toBe(
      COMPONENT_MAP_CHECK_EXIT.couldNotCheck
    );
    expect(lines.error).toHaveLength(1);
    expect(lines.error[0]).toMatch(/^Component map: could not be checked\. /);
    expect(lines.error[0]).toContain("config threw");
  });

  it("writes nothing, even where it finds the map out of date", async () => {
    // No list at all: a writer would create it.
    expect(await runComponentMapCheck({ cwd: root }, context())).toBe(
      COMPONENT_MAP_CHECK_EXIT.outOfDate
    );
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(join(root, DIR))).toEqual([
      COMPONENT_IMPORT_MAP_FILENAME,
    ]);
    expect(lines.error).toContain(
      `- absent: ${DIR}/${COMPONENT_PATHS_FILENAME}`
    );
  });
});
