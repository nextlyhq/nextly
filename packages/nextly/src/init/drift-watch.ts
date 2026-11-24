/**
 * What the development server watches to say when the changes not yet in a migration change
 * without a reload (`drift-block.ts`): the migrations folder and its `meta/`, where
 * `migrate:create`, run in another process, and a Schema Builder save write a migration, and the
 * Builder's definition file, which a save rewrites. A change runs `onChange` once its writes
 * settle.
 *
 * One set of watchers per process, replaced when the folders change; none of them keeps the
 * process alive. Started only by the report, which runs only in development.
 *
 * @module init/drift-watch
 */
import { existsSync, type FSWatcher, watch } from "node:fs";
import { basename, dirname, join } from "node:path";

import { processGlobal } from "../shared/process-global";

/** How long a burst of writes (a migration file and its snapshot) settles before it is read. */
const SETTLE_MS = 300;

interface WatchState {
  key?: string;
  watchers: FSWatcher[];
  timer?: ReturnType<typeof setTimeout>;
}

const watching = (): WatchState =>
  processGlobal("driftWatch", () => ({ watchers: [] }));

/**
 * Watch `paths` for the changes that move what is not yet in a migration, calling `onChange` once
 * a change settles. Calling it again with the same folders keeps the watchers it has.
 */
export function ensureDriftWatch(
  paths: { migrationsDir: string; definitionFile: string },
  onChange: () => void
): void {
  const meta = join(paths.migrationsDir, "meta");
  // A folder made since the last call is watched from then: its existence is part of the key.
  const watched = [paths.migrationsDir, meta].filter(dir => existsSync(dir));
  const definitionDir = dirname(paths.definitionFile);
  const key = [
    ...watched,
    paths.definitionFile,
    String(existsSync(definitionDir)),
  ].join("|");
  const state = watching();
  if (state.key === key) return;
  for (const watcher of state.watchers) watcher.close();
  state.watchers = [];
  state.key = key;

  const settle = () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(onChange, SETTLE_MS);
    state.timer.unref();
  };
  const add = (dir: string, only?: string) => {
    try {
      const watcher = watch(dir, (_event, name) => {
        if (only === undefined || name === null || name.toString() === only)
          settle();
      });
      watcher.on("error", () => watcher.close());
      watcher.unref();
      state.watchers.push(watcher);
    } catch {
      // A folder that cannot be watched is read again at the next reload.
    }
  };
  for (const dir of watched) add(dir);
  // Before the first migration there is no folder: its making is the change, watched from above.
  const parent = dirname(paths.migrationsDir);
  if (!existsSync(paths.migrationsDir) && existsSync(parent)) {
    add(parent, basename(paths.migrationsDir));
  }
  if (existsSync(definitionDir))
    add(definitionDir, basename(paths.definitionFile));
}
