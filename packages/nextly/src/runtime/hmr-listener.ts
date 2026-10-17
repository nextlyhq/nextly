// What: under `next dev`, watches nextly.config.ts and the files it imports,
// and reloads the config when one of them is saved. The reload applies the new
// schema through the same pipeline a restart would.
//
// Why files rather than Next.js's own reload signal: the dev server's HMR
// socket is internal and has moved under us. Its path changed from
// `/_next/webpack-hmr` to `/_next/hmr`, its port is the dev server's own, which
// `-p` does not put in `PORT`, and a config reached only from route handlers
// produces no server-change message on either bundler. Watching the files
// depends on none of that: it works under Turbopack and webpack, on any port,
// in every Next.js version Nextly supports.
//
// The files are the config and everything it imported the last time it was
// read (the loader reports them), so an edit to a collection kept in its own
// file applies too. Packages under node_modules are not watched.

import { watch, type FSWatcher } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Process-wide state lives on globalThis so it survives Turbopack and webpack
// re-executing this module. Same pattern as init.ts and the drizzle-kit-lazy
// module.
type WatchState = {
  /** One watcher per directory holding a watched file. */
  watchers: FSWatcher[];
  /** The absolute paths whose saves trigger a reload. */
  files: Set<string>;
};
type HmrCache = {
  __nextly_configWatch?: WatchState;
  __nextly_hmrReload?: boolean | Promise<void>;
};

const g = globalThis as HmrCache;

/**
 * Whether this process may watch and apply config edits: `next dev` only.
 * Never in production, in tests, or while `next build` collects page data, and
 * not when `NEXTLY_DISABLE_HMR=1` turns it off.
 */
export function configWatchAllowed(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.NODE_ENV === "production" || env.NODE_ENV === "test") return false;
  if (env.NEXT_PHASE === "phase-production-build") return false;
  return env.NEXTLY_DISABLE_HMR !== "1";
}

/**
 * Starts watching the project's config file, if it has one. Idempotent: once a
 * set is being watched (from an earlier call, or from a reload that read the
 * config and its imports), this leaves it as it is.
 */
export function ensureHmrListener(
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): void {
  const env = options.env ?? process.env;
  if (!configWatchAllowed(env) || g.__nextly_configWatch) return;
  const cwd = options.cwd ?? process.cwd();

  // Loaded lazily, so production, where this returns above, never loads the
  // config loader through this module.
  void import("../cli/utils/config-loader")
    .then(({ findNextlyConfig }) => {
      const configPath = findNextlyConfig(cwd);
      if (configPath && !g.__nextly_configWatch) {
        watchConfigFiles([configPath], env);
      }
    })
    .catch(() => {
      // Without the loader there is no config to watch; a restart still
      // applies the schema.
    });
}

/**
 * Watches the files a config load read, replacing whatever was watched before.
 * Called after each successful load, so a file the config started importing is
 * picked up and one it stopped importing is dropped.
 */
export function watchLoadedConfig(
  loaded: { configPath?: string; dependencies: readonly string[] },
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): void {
  if (!configWatchAllowed(env)) return;
  const files = [
    ...(loaded.configPath ? [loaded.configPath] : []),
    // esbuild reports the inputs relative to the directory it bundled from.
    ...loaded.dependencies.map(dependency => resolve(cwd, dependency)),
  ];
  watchConfigFiles(files, env);
}

/**
 * Replaces the watched set with `files`. Every call closes the previous
 * watchers first, so they never stack up across reloads or module re-runs.
 */
function watchConfigFiles(
  files: readonly string[],
  env: NodeJS.ProcessEnv
): void {
  stopConfigWatch();
  if (!configWatchAllowed(env)) return;

  const watched = new Set(
    files
      .map(file => resolve(file))
      .filter(file => !file.split(/[\\/]/).includes("node_modules"))
  );
  const state: WatchState = { watchers: [], files: watched };
  g.__nextly_configWatch = state;

  // Directories rather than files: an editor that saves by writing a new file
  // and renaming it over the old one replaces the inode a file watcher holds,
  // and that watcher then never fires again.
  for (const dir of new Set([...watched].map(file => dirname(file)))) {
    try {
      const watcher = watch(dir, (_event, filename) => {
        // Some platforms omit the name; a reload then costs one config read.
        if (!filename || state.files.has(join(dir, filename.toString()))) {
          scheduleReload();
        }
      });
      watcher.on("error", error => {
        console.warn(
          `[Nextly] Stopped watching ${dir} for config edits: ${error.message}. ` +
            `Restart next dev to apply schema changes saved there.`
        );
        watcher.close();
      });
      state.watchers.push(watcher);
    } catch (error) {
      console.warn(
        `[Nextly] Cannot watch ${dir} for config edits: ${
          error instanceof Error ? error.message : String(error)
        }. Restart next dev to apply schema changes saved there.`
      );
    }
  }
}

/** Closes every watcher. Safe to call when nothing is watched. */
export function stopConfigWatch(): void {
  const state = g.__nextly_configWatch;
  if (!state) return;
  for (const watcher of state.watchers) watcher.close();
  delete g.__nextly_configWatch;
}

/** The files a save of which reloads the config. For tests and diagnostics. */
export function watchedConfigFiles(): string[] {
  return [...(g.__nextly_configWatch?.files ?? [])];
}

// Debounce window for saves. An editor save is often several file events (a
// write and a rename, or a save followed by a formatter's save), and each used
// to run the whole reload pipeline, including a database introspection. 300ms
// trailing collapses a burst without the reload feeling slow.
const HMR_DEBOUNCE_MS = 300;

// Stores the pending debounce timer so a follow-up event can reset it.
type HmrDebounceCache = {
  __nextly_hmrDebounce?: ReturnType<typeof setTimeout>;
};
const debounceCache = globalThis as HmrDebounceCache;

// Production reloader, resolved lazily on first use to avoid loading the full
// schema pipeline at module evaluation time. Tests override it with
// __setReloaderForTest.
let _reloaderFn: (() => Promise<void>) | null = null;

// Gets (or lazily loads) the reloadNextlyConfig function.
async function getReloader(): Promise<() => Promise<void>> {
  if (_reloaderFn) return _reloaderFn;
  const { reloadNextlyConfig } = await import("../init/reload-config");
  return reloadNextlyConfig;
}

// Test seam: lets unit tests inject a reloader, so they control the reload
// without vi.doMock and a dynamic import inside a fake-timer callback, which
// cannot be awaited predictably under vi.useFakeTimers(). Reset to null
// between tests.
export function __setReloaderForTest(fn: (() => Promise<void>) | null): void {
  _reloaderFn = fn;
}

function scheduleReload(): void {
  // Reset any pending debounce timer.
  if (debounceCache.__nextly_hmrDebounce) {
    clearTimeout(debounceCache.__nextly_hmrDebounce);
  }
  debounceCache.__nextly_hmrDebounce = setTimeout(() => {
    delete debounceCache.__nextly_hmrDebounce;
    const reload = (async () => {
      try {
        // reloadNextlyConfig serializes itself: a save arriving while one
        // reload runs queues a single trailing run that reads the file again,
        // so no edit is dropped.
        const reloadFn = await getReloader();
        await reloadFn();
      } catch {
        // Errors are already logged inside reloadNextlyConfig.
      }
    })();
    markHmrReloadInFlight(reload);
  }, HMR_DEBOUNCE_MS);
}

// Test seam: what a watched file's save does, without a filesystem event.
export function scheduleReloadForTest(): void {
  scheduleReload();
}

// Returns true exactly when a reload was signaled since the last call, and
// resets the flag. Returns false in two cases that the caller should treat the
// same way: (1) nothing has been signaled, (2) a reload is already in flight.
// In case (2) the in-flight reload finishes on its own; this caller may proceed
// with the current cached instance and pick up the new schema on a later call.
export function consumeHmrReloadFlag(): boolean {
  if (g.__nextly_hmrReload === true) {
    g.__nextly_hmrReload = false;
    return true;
  }
  return false;
}

// Marks a reload as in flight by storing its promise. When the promise
// settles, the flag clears unless another reload was scheduled meanwhile.
export function markHmrReloadInFlight(promise: Promise<void>): void {
  g.__nextly_hmrReload = promise;
  void promise.finally(() => {
    if (g.__nextly_hmrReload === promise) {
      g.__nextly_hmrReload = false;
    }
  });
}
