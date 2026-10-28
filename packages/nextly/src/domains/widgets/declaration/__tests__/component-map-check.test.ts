/**
 * The admin's check of the app's generated component map: rewritten in
 * development, refused in production over a missing widget component, and
 * stepped aside from, saying so, when Nextly did not start.
 *
 * The boot and the file writer are stubbed; the plugins are the ones the boot
 * would have resolved, put where the boot puts them.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../init", () => ({ getNextly: vi.fn(async () => ({})) }));
vi.mock("../../../../plugins/codegen/write-component-map", () => ({
  writeComponentMapFiles: vi.fn(async () => ({ paths: [], changed: [] })),
}));

import { NextlyError } from "../../../../errors/nextly-error";
import { getNextly } from "../../../../init";
import * as loggerModule from "../../../../observability/logger";
import { writeComponentMapFiles } from "../../../../plugins/codegen/write-component-map";
import type { PluginDefinition } from "../../../../plugins/plugin-context";
import {
  checkAdminComponents,
  resetComponentMapWarnings,
} from "../component-map-check";
import { setAdminComponentPlugins } from "../component-map-store";

const shop = {
  name: "@acme/shop",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    admin: {
      pages: [{ path: "reports", component: "@acme/shop/admin#Reports" }],
    },
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

const BOTH = ["@acme/shop/admin#Reports", "@acme/shop/admin#Revenue"];
const config = {
  typescript: { outputFile: "./src/types/generated/nextly-types.ts" },
} as unknown as Parameters<typeof checkAdminComponents>[0]["config"];

let warn: ReturnType<typeof vi.fn>;
let info: ReturnType<typeof vi.fn>;
let error: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setAdminComponentPlugins([shop]);
  // Each check warns about a given incomplete map once per process, so every
  // test starts from none warned.
  resetComponentMapWarnings();
  warn = vi.fn();
  info = vi.fn();
  error = vi.fn();
  vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
    warn,
    info,
    error,
    debug: vi.fn(),
  } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
  // Reset, not cleared: a one-time rejection a test queued and the check never
  // consumed would otherwise reach the next test.
  vi.mocked(writeComponentMapFiles)
    .mockReset()
    .mockResolvedValue({ paths: [], changed: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const check = (registeredComponentPaths: readonly string[]) =>
  checkAdminComponents({ config, registeredComponentPaths });

async function refusalOf(run: Promise<void>): Promise<NextlyError> {
  try {
    await run;
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(NextlyError);
    return thrown as NextlyError;
  }
  throw new Error("expected the admin to be refused");
}

describe("in production", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "production"));

  it("serves the admin when the map holds every component", async () => {
    await expect(check(BOTH)).resolves.toBe(undefined);
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses over a missing widget component, naming the plugin, the widget, both files and the fix", async () => {
    const refused = await refusalOf(check(["@acme/shop/admin#Reports"]));
    expect(refused.code).toBe("NEXTLY_ADMIN_COMPONENT_MAP_STALE");
    expect(refused.publicMessage).toContain(
      "The server log names the widget and the fix."
    );
    // And the detail reaches the log, since Next prints only the public message.
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "admin-component-map-stale",
        message: refused.logMessage,
      })
    );
    const message = refused.logMessage ?? "";
    expect(message).toContain(
      "1 dashboard widget draws with a component that this build's component map does not include"
    );
    expect(message).toContain(
      '- plugin "@acme/shop", widget "acme/revenue": `@acme/shop/admin#Revenue`'
    );
    expect(message).toContain(
      "`src/types/generated/plugin-admin-imports.generated.ts` and `src/types/generated/plugin-admin-components.generated.ts`"
    );
    expect(message).toContain(
      "Run `npx nextly generate:types`, or start `next dev` once. Then commit both files and redeploy."
    );
    // Production never writes source files.
    expect(writeComponentMapFiles).not.toHaveBeenCalled();
  });

  it("says the app has no map when the list is empty", async () => {
    const refused = await refusalOf(check([]));
    expect(refused.logMessage).toContain(
      "because the app has no component map"
    );
  });

  it("serves the admin over a missing page, and logs it", async () => {
    // Widgets only: a page draws empty today, and refusing it is the plugin
    // platform's decision.
    await expect(check(["@acme/shop/admin#Revenue"])).resolves.toBe(undefined);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "admin-component-map-incomplete" })
    );
  });
});

describe("in development", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "development"));

  it("writes the map again and serves the admin", async () => {
    await expect(check([])).resolves.toBe(undefined);
    expect(writeComponentMapFiles).toHaveBeenCalledWith(
      [shop],
      resolve(process.cwd(), "src/types/generated/nextly-types.ts"),
      process.cwd(),
      // No config file here, so the map is written without the config's check, as before.
      undefined
    );
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "admin-component-map-regenerated" })
    );
  });

  it("leaves a map that lists exactly what the plugins declare alone", async () => {
    await expect(check(BOTH)).resolves.toBe(undefined);
    expect(writeComponentMapFiles).not.toHaveBeenCalled();
  });

  it("writes the map again when it still imports a removed plugin's component", async () => {
    // Nothing is missing: only the comparison the other way finds this map
    // out of date, and it imports a package that may be uninstalled next.
    await expect(check([...BOTH, "@gone/old/admin#Chart"])).resolves.toBe(
      undefined
    );
    expect(writeComponentMapFiles).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "admin-component-map-regenerated",
        added: [],
        removed: ["@gone/old/admin#Chart"],
      })
    );
  });

  it("warns, without refusing, when a removed plugin's imports cannot be written away", async () => {
    vi.mocked(writeComponentMapFiles).mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
    );
    await expect(check([...BOTH, "@gone/old/admin#Chart"])).resolves.toBe(
      undefined
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "admin-component-map-obsolete" })
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("refuses as production does when regeneration is turned off, naming the switch", async () => {
    vi.stubEnv("NEXTLY_GENERATED_FILES_WRITE", "0");
    const refused = await refusalOf(check(["@acme/shop/admin#Reports"]));
    expect(refused.code).toBe("NEXTLY_ADMIN_COMPONENT_MAP_STALE");
    expect(refused.logMessage).toContain(
      "automatic regeneration is off (NEXTLY_GENERATED_FILES_WRITE=0)"
    );
    expect(refused.logMessage).toContain(
      '- plugin "@acme/shop", widget "acme/revenue": `@acme/shop/admin#Revenue`'
    );
    expect(writeComponentMapFiles).not.toHaveBeenCalled();
  });

  it("reads `false` as the switch turned off too, and anything else as on", async () => {
    vi.stubEnv("NEXTLY_GENERATED_FILES_WRITE", "false");
    await refusalOf(check(["@acme/shop/admin#Reports"]));
    vi.stubEnv("NEXTLY_GENERATED_FILES_WRITE", "1");
    await expect(check([])).resolves.toBe(undefined);
    expect(writeComponentMapFiles).toHaveBeenCalledTimes(1);
  });

  it("refuses when the folder cannot be written and a widget is affected", async () => {
    vi.mocked(writeComponentMapFiles).mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
    );
    const refused = await refusalOf(check(["@acme/shop/admin#Reports"]));
    expect(refused.code).toBe("NEXTLY_ADMIN_COMPONENT_MAP_STALE");
    expect(refused.logMessage).toContain(
      "Nextly could not update the component map, because `src/types/generated/` is not writable"
    );
    expect(refused.logMessage).toContain(
      "Make the folder writable, or run `npx nextly generate:types`."
    );
  });
});

describe("where the map is", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "nextly-component-check-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("follows the app's layout for the default types file, as generate:types does", async () => {
    // A root `app/` folder wins over `src/`, so the default types file, and
    // the map beside it, lose their `src/`.
    await mkdir(join(root, "app"));
    await mkdir(join(root, "src"));
    // The site's config, found as the loader finds it, so the map imports it for its check.
    await writeFile(join(root, "nextly.config.ts"), "");
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.stubEnv("NODE_ENV", "development");
    await check([]);
    expect(writeComponentMapFiles).toHaveBeenCalledWith(
      [shop],
      join(root, "types/generated/nextly-types.ts"),
      root,
      join(root, "nextly.config.ts")
    );

    vi.stubEnv("NODE_ENV", "production");
    const refused = await refusalOf(check(["@acme/shop/admin#Reports"]));
    expect(refused.logMessage).toContain(
      "`types/generated/plugin-admin-imports.generated.ts`"
    );
    expect(refused.logMessage).not.toContain("src/types/generated");
  });
});

describe("the config a development rewrite checks against", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "nextly-component-check-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // `generate:types --config <path>` wrote the map against that config; a rewrite searching the
  // default names again would check against a different file, or none.
  it("is the one the existing map imports, not one found again by the default names", async () => {
    await mkdir(join(root, "src/types/generated"), { recursive: true });
    await writeFile(join(root, "nextly.config.ts"), "");
    await writeFile(
      join(root, "src/types/generated/plugin-admin-imports.generated.ts"),
      'import type * as siteConfig from "../../../config/site.config.mjs";\n'
    );
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.stubEnv("NODE_ENV", "development");

    await check([]);

    expect(writeComponentMapFiles).toHaveBeenCalledWith(
      [shop],
      join(root, "src/types/generated/nextly-types.ts"),
      root,
      { import: "../../../config/site.config.mjs" }
    );
  });
});

describe("two widgets drawn with one component", () => {
  it("names and counts both when it is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const twice = {
      ...shop,
      contributes: {
        dashboard: {
          widgets: [
            {
              id: "acme/revenue",
              view: { component: "@acme/shop/admin#Chart" },
            },
            {
              id: "acme/orders",
              view: { component: "@acme/shop/admin#Chart" },
            },
          ],
        },
      },
    } as unknown as PluginDefinition;
    setAdminComponentPlugins([twice]);
    const refused = await refusalOf(check([]));
    expect(refused.logMessage).toContain(
      "2 dashboard widgets draw with components"
    );
    expect(refused.logMessage).toContain('widget "acme/revenue"');
    expect(refused.logMessage).toContain('widget "acme/orders"');
  });
});

describe("when there is nothing to check against", () => {
  it("steps aside, and logs why, when Nextly did not start", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(getNextly).mockRejectedValueOnce(new Error("database down"));
    await expect(check([])).resolves.toBe(undefined);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "admin-component-check-skipped",
        reason: "boot-failed",
      })
    );
  });

  it("does nothing while `next build` evaluates the layout", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.mocked(getNextly).mockClear();
    // An empty map would be refused in production; at build it is not looked at.
    await expect(check([])).resolves.toBe(undefined);
    expect(getNextly).not.toHaveBeenCalled();
  });
});
