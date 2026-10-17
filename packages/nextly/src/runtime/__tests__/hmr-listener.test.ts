// Tests for the dev-time config watcher.
// What: under `next dev`, saving nextly.config.ts or a file it imports reloads
// the config; nothing is watched outside development; the watched set is
// replaced, never stacked; a burst of saves is one reload; a save during a
// reload is not lost; a reload another process refused is tried again.
// Why: this is the only thing that applies a code-first schema edit without a
// restart. It replaced a listener on Next.js's HMR socket, which stopped
// receiving anything when Next moved that socket, so these tests drive real
// file saves rather than any message format.

import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __setRefusedRetryDelaysForTest,
  __setReloaderForTest,
  configWatchAllowed,
  ensureHmrListener,
  scheduleReloadForTest,
  stopConfigWatch,
  watchLoadedConfig,
  watchScannedConfig,
  watchedConfigFiles,
} from "../hmr-listener";

const DEV = { NODE_ENV: "development" } as NodeJS.ProcessEnv;

/** Polls until `check` holds, or fails after `ms`. */
async function eventually(check: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition never held");
    await new Promise(r => setTimeout(r, 25));
  }
}

/** Long enough for a watcher event and the 300ms debounce to have fired. */
const settle = () => new Promise(r => setTimeout(r, 1000));

describe("configWatchAllowed: next dev only", () => {
  it("allows development", () => {
    expect(configWatchAllowed(DEV)).toBe(true);
  });

  it.each([
    ["production", { NODE_ENV: "production" }],
    ["tests", { NODE_ENV: "test" }],
    // A script that boots Nextly without setting NODE_ENV, or with a value of
    // its own, is not next dev.
    ["NODE_ENV unset", {}],
    ["a nonstandard NODE_ENV", { NODE_ENV: "staging" }],
    [
      "next build",
      { NODE_ENV: "development", NEXT_PHASE: "phase-production-build" },
    ],
    [
      "NEXTLY_DISABLE_HMR=1",
      { NODE_ENV: "development", NEXTLY_DISABLE_HMR: "1" },
    ],
  ])("refuses %s", (_label, env) => {
    expect(configWatchAllowed(env as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("watching the config and the files it imports", () => {
  let cwd: string;
  let config: string;
  let posts: string;
  let reload: ReturnType<typeof vi.fn<() => Promise<unknown>>>;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "nextly-config-watch-"));
    mkdirSync(join(cwd, "collections"));
    config = join(cwd, "nextly.config.ts");
    posts = join(cwd, "collections", "posts.ts");
    writeFileSync(config, "export default {};\n");
    writeFileSync(posts, "export const posts = {};\n");
    reload = vi.fn(() => Promise.resolve<unknown>("finished"));
    __setReloaderForTest(reload);
  });

  afterEach(() => {
    stopConfigWatch();
    __setReloaderForTest(null);
    rmSync(cwd, { recursive: true, force: true });
  });

  /**
   * Lets a new watcher settle, then forgets any reload it caused. macOS reports
   * file events through FSEvents, which can miss a write made in the instant a
   * watch begins and can also report the setup's own writes from just before
   * it, which would schedule a reload no save of the test's made. A person
   * saving a file is never that quick, so neither happens in use.
   */
  const watching = async () => {
    await new Promise(r => setTimeout(r, 800));
    reload.mockClear();
  };

  /** What a successful load of this project reports. */
  const loaded = (...dependencies: string[]) => ({
    configPath: config,
    dependencies: ["nextly.config.ts", ...dependencies],
  });

  it("reloads when the config is saved", async () => {
    watchLoadedConfig(loaded("collections/posts.ts"), cwd, DEV);
    await watching();

    writeFileSync(config, "export default { collections: [] };\n");

    await eventually(() => reload.mock.calls.length === 1);
  });

  it("reloads when a file the config imports is saved", async () => {
    watchLoadedConfig(loaded("collections/posts.ts"), cwd, DEV);
    await watching();

    writeFileSync(posts, "export const posts = { slug: 'posts' };\n");

    await eventually(() => reload.mock.calls.length === 1);
  });

  it("reloads after a save that writes a new file and renames it over the old one", async () => {
    watchLoadedConfig(loaded("collections/posts.ts"), cwd, DEV);
    await watching();

    const temporary = join(cwd, "collections", ".posts.ts.tmp");
    writeFileSync(temporary, "export const posts = { renamed: true };\n");
    renameSync(temporary, posts);
    await eventually(() => reload.mock.calls.length === 1);

    // The save after it still reloads. A watcher on the file itself follows
    // the inode the rename replaced, on Linux, and would never fire again.
    writeFileSync(posts, "export const posts = { after: true };\n");
    await eventually(() => reload.mock.calls.length === 2);
  });

  it("ignores a file the config does not import, beside one it does", async () => {
    watchLoadedConfig(loaded("collections/posts.ts"), cwd, DEV);
    await watching();

    writeFileSync(join(cwd, "collections", "unrelated.ts"), "export {};\n");
    await settle();
    expect(reload).not.toHaveBeenCalled();

    // The same directory is watched: a save of the imported file does reload.
    writeFileSync(posts, "export const posts = { edited: true };\n");
    await eventually(() => reload.mock.calls.length === 1);
  });

  it("collapses a burst of saves into one reload", async () => {
    watchLoadedConfig(loaded("collections/posts.ts"), cwd, DEV);
    await watching();

    for (let i = 0; i < 3; i++) {
      writeFileSync(config, `export default { n: ${i} };\n`);
      await new Promise(r => setTimeout(r, 50));
    }
    await settle();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("replaces the watched files rather than adding to them", async () => {
    const pages = join(cwd, "collections", "pages.ts");
    writeFileSync(pages, "export const pages = {};\n");
    watchLoadedConfig(loaded("collections/posts.ts"), cwd, DEV);
    await watching();

    // The config stopped importing posts and started importing pages.
    watchLoadedConfig(loaded("collections/pages.ts"), cwd, DEV);
    await watching();

    expect(watchedConfigFiles().sort()).toEqual([pages, config].sort());
    // A watcher left over from the first set would still reload on this.
    writeFileSync(posts, "export const posts = { dropped: true };\n");
    await settle();
    expect(reload).not.toHaveBeenCalled();

    writeFileSync(pages, "export const pages = { edited: true };\n");
    await eventually(() => reload.mock.calls.length === 1);
  });

  it("does not keep the process alive by watching", () => {
    // A script that booted Nextly in development must still exit when it is
    // done; the dev server keeps itself alive without the watcher's help.
    const handles = () =>
      process.getActiveResourcesInfo().filter(name => name === "FSEventWrap")
        .length;
    const before = handles();

    watchLoadedConfig(loaded("collections/posts.ts"), cwd, DEV);

    expect(watchedConfigFiles()).toContain(posts);
    expect(handles()).toBe(before);
  });

  it("does not watch packages under node_modules", () => {
    watchLoadedConfig(
      loaded("collections/posts.ts", "node_modules/some-plugin/index.js"),
      cwd,
      DEV
    );

    expect(watchedConfigFiles().sort()).toEqual([config, posts].sort());
  });

  it("watches nothing outside next dev", () => {
    watchLoadedConfig(loaded("collections/posts.ts"), cwd, {
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);

    expect(watchedConfigFiles()).toEqual([]);
  });

  it("starts by watching the project's config file", async () => {
    ensureHmrListener({ cwd, env: DEV });

    await eventually(() => watchedConfigFiles().includes(config));
    await watching();
    writeFileSync(config, "export default { started: true };\n");
    await eventually(() => reload.mock.calls.length === 1);
  });

  it("resolves the imports against the config's own folder, not the project's", async () => {
    // A config under src/: the loader bundles from src/, so it reports the
    // collection as "collections/posts.ts", relative to src/.
    mkdirSync(join(cwd, "src", "collections"), { recursive: true });
    const srcConfig = join(cwd, "src", "nextly.config.ts");
    const srcPosts = join(cwd, "src", "collections", "posts.ts");
    writeFileSync(srcConfig, "export default {};\n");
    writeFileSync(srcPosts, "export const posts = {};\n");

    watchLoadedConfig(
      {
        configPath: srcConfig,
        dependencies: ["nextly.config.ts", "collections/posts.ts"],
      },
      cwd,
      DEV
    );

    expect(watchedConfigFiles().sort()).toEqual([srcConfig, srcPosts].sort());
    await watching();
    writeFileSync(srcPosts, "export const posts = { edited: true };\n");
    await eventually(() => reload.mock.calls.length === 1);
  });

  it("starts by watching the files the config imports, before any reload has read it", async () => {
    // What a boot with the boot apply turned off looks like: no load has
    // reported the imports, and the first edit is to a collection file.
    writeFileSync(
      config,
      'import { posts } from "./collections/posts";\n' +
        "export default { collections: [posts] };\n"
    );
    ensureHmrListener({ cwd, env: DEV });

    await eventually(() => watchedConfigFiles().includes(posts));
    await watching();
    writeFileSync(posts, "export const posts = { slug: 'posts' };\n");
    await eventually(() => reload.mock.calls.length === 1);
  });

  it("after a load fails, also watches the imported file that broke it", async () => {
    // The last good load imported nothing. The edit that failed added an
    // import of a collection file with an error in it, and the fix will be
    // saved to that file.
    watchLoadedConfig(loaded(), cwd, DEV);
    writeFileSync(posts, "export const posts = { slug: 'posts' ;\n");
    writeFileSync(
      config,
      'import { posts } from "./collections/posts";\n' +
        "export default { collections: [posts] };\n"
    );

    await watchScannedConfig({ cwd, env: DEV });

    expect(watchedConfigFiles().sort()).toEqual([config, posts].sort());
    await watching();
    writeFileSync(posts, "export const posts = { slug: 'posts' };\n");
    await eventually(() => reload.mock.calls.length === 1);
  });

  it("after a load fails on an import that does not exist yet, reloads once it is created", async () => {
    // esbuild reports the missing import at the importing line, so the file to
    // be created has to be read from the error itself.
    watchLoadedConfig(loaded(), cwd, DEV);
    const created = join(cwd, "collections", "new.ts");
    writeFileSync(
      config,
      'import { added } from "./collections/new";\n' +
        "export default { collections: [added] };\n"
    );

    await watchScannedConfig({ cwd, env: DEV });

    expect(watchedConfigFiles()).toContain(created);
    await watching();
    writeFileSync(created, "export const added = { slug: 'added' };\n");
    await eventually(() => reload.mock.calls.length === 1);
  });

  it("keeps watching where the config was after a load finds none", async () => {
    watchLoadedConfig(loaded("collections/posts.ts"), cwd, DEV);
    rmSync(config);
    // What a load returns while the file is gone, for example mid branch
    // switch.
    watchLoadedConfig({ configPath: undefined, dependencies: [] }, cwd, DEV);
    await watching();

    writeFileSync(config, "export default { restored: true };\n");
    await eventually(() => reload.mock.calls.length === 1);
  });

  it("with no config yet, reloads once one is created", async () => {
    rmSync(config);
    ensureHmrListener({ cwd, env: DEV });

    await eventually(() => watchedConfigFiles().includes(config));
    await watching();
    writeFileSync(config, "export default { created: true };\n");
    await eventually(() => reload.mock.calls.length === 1);
  });

  it("reloads again for a save made while a reload is running", async () => {
    let finishFirst!: () => void;
    reload.mockImplementationOnce(
      () => new Promise<void>(resolve => (finishFirst = resolve))
    );
    watchLoadedConfig(loaded("collections/posts.ts"), cwd, DEV);
    await watching();

    writeFileSync(config, "export default { first: true };\n");
    await eventually(() => reload.mock.calls.length === 1);
    // Saved while the first reload is still running: the first may have read
    // the file before this edit, so it must not be dropped.
    writeFileSync(config, "export default { second: true };\n");
    await eventually(() => reload.mock.calls.length === 2);
    finishFirst();
  });
});

describe("a reload another process refused", () => {
  let reload: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __setRefusedRetryDelaysForTest([50, 50]);
    reload = vi.fn(() => Promise.resolve<unknown>("refused"));
    __setReloaderForTest(reload);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    __setRefusedRetryDelaysForTest(null);
    __setReloaderForTest(null);
    warn.mockRestore();
  });

  it("is tried again until it runs", async () => {
    reload.mockResolvedValueOnce("refused").mockResolvedValueOnce("finished");

    scheduleReloadForTest();

    await eventually(() => reload.mock.calls.length === 2);
    await settle();
    expect(reload).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops after the last retry and says the save was not applied", async () => {
    scheduleReloadForTest();

    // The save's own run and one per retry delay.
    await eventually(() => reload.mock.calls.length === 3);
    await eventually(() => warn.mock.calls.length === 1);
    await settle();
    expect(reload).toHaveBeenCalledTimes(3);
    expect(String(warn.mock.calls[0][0])).toMatch(
      /not applied.*refused 3 times/
    );
  });

  it("is not retried when it ran, even if it failed", async () => {
    reload.mockResolvedValue("finished");

    scheduleReloadForTest();

    await eventually(() => reload.mock.calls.length === 1);
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
