/**
 * The admin's check of the app's generated component map: written again in
 * development, warned about where it cannot be, never a reason to refuse the
 * admin, and not read at all in production.
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
  // Each check warns about a given out-of-date map once per process, so every
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
  vi.mocked(getNextly).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const check = (registeredComponentPaths: readonly string[]) =>
  checkAdminComponents({ config, registeredComponentPaths });

/** The one warning a check logged about a map it left out of date. */
function staleWarning(): string {
  expect(warn).toHaveBeenCalledTimes(1);
  const [logged] = warn.mock.calls[0] as [{ kind: string; message: string }];
  expect(logged.kind).toBe("admin-component-map-stale");
  return logged.message;
}

describe("in production", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "production"));

  it("serves the admin over a missing widget component, and boots, reads and writes nothing", async () => {
    // An empty list: no map at all, with a widget that draws with a component.
    await expect(check([])).resolves.toBe(undefined);
    expect(getNextly).not.toHaveBeenCalled();
    expect(writeComponentMapFiles).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("does nothing however the regeneration switch is set", async () => {
    vi.stubEnv("NEXTLY_GENERATED_FILES_WRITE", "0");
    await expect(check(["@acme/shop/admin#Reports"])).resolves.toBe(undefined);
    expect(getNextly).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does nothing while `next build` evaluates the layout", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await expect(check([])).resolves.toBe(undefined);
    expect(getNextly).not.toHaveBeenCalled();
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
    expect(warn).not.toHaveBeenCalled();
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

  it("serves the admin with regeneration off, warning with the widget, its owner, the component and the switch", async () => {
    vi.stubEnv("NEXTLY_GENERATED_FILES_WRITE", "0");
    await expect(check(["@acme/shop/admin#Reports"])).resolves.toBe(undefined);
    expect(writeComponentMapFiles).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const message = staleWarning();
    expect(message).toContain(
      "The admin's component map in src/types/generated/ is out of date and was not written again: automatic regeneration is off (NEXTLY_GENERATED_FILES_WRITE=0)."
    );
    expect(message).toContain(
      '- missing: plugin "@acme/shop", widget "acme/revenue": @acme/shop/admin#Revenue'
    );
    expect(message).toContain(
      "A widget whose component is missing draws its card's error state"
    );
  });

  it("reads `false` as the switch turned off too, and anything else as on", async () => {
    vi.stubEnv("NEXTLY_GENERATED_FILES_WRITE", "false");
    await check(["@acme/shop/admin#Reports"]);
    expect(writeComponentMapFiles).not.toHaveBeenCalled();
    vi.stubEnv("NEXTLY_GENERATED_FILES_WRITE", "1");
    await check([]);
    expect(writeComponentMapFiles).toHaveBeenCalledTimes(1);
  });

  it("serves the admin when the folder cannot be written, warning with the folder and the fix", async () => {
    vi.mocked(writeComponentMapFiles).mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
    );
    await expect(
      check([...BOTH.slice(0, 1), "@gone/old/admin#Chart"])
    ).resolves.toBe(undefined);
    const message = staleWarning();
    expect(message).toContain(
      "`src/types/generated/` is not writable. Make the folder writable, or run `npx nextly generate:types`."
    );
    expect(message).toContain(
      '- missing: plugin "@acme/shop", widget "acme/revenue": @acme/shop/admin#Revenue'
    );
    expect(message).toContain("- no longer declared: @gone/old/admin#Chart");
  });

  it("warns about one out-of-date map once, and again for a different one", async () => {
    vi.stubEnv("NEXTLY_GENERATED_FILES_WRITE", "0");
    await check(["@acme/shop/admin#Reports"]);
    await check(["@acme/shop/admin#Reports"]);
    expect(warn).toHaveBeenCalledTimes(1);
    await check([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("names every widget drawn with one missing component", async () => {
    vi.stubEnv("NEXTLY_GENERATED_FILES_WRITE", "0");
    setAdminComponentPlugins([
      {
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
      } as unknown as PluginDefinition,
    ]);
    await check([]);
    const message = staleWarning();
    expect(message).toContain('widget "acme/revenue": @acme/shop/admin#Chart');
    expect(message).toContain('widget "acme/orders": @acme/shop/admin#Chart');
  });

  it("steps aside, and logs why, when Nextly did not start", async () => {
    vi.mocked(getNextly).mockRejectedValueOnce(new Error("database down"));
    await expect(check([])).resolves.toBe(undefined);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "admin-component-check-skipped",
        reason: "boot-failed",
      })
    );
    expect(writeComponentMapFiles).not.toHaveBeenCalled();
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

    vi.stubEnv("NEXTLY_GENERATED_FILES_WRITE", "0");
    await check(["@acme/shop/admin#Reports"]);
    const message = staleWarning();
    expect(message).toContain(
      "component map in types/generated/ is out of date"
    );
    expect(message).not.toContain("src/types/generated");
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
