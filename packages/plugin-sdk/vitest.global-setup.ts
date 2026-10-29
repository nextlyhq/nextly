import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Refuse to start when this package's built entries are missing, rather than
 * building them.
 *
 * The field-UI render test loads the BUILT `@nextlyhq/plugin-sdk/admin`, the
 * module a plugin's bundle imports, rather than the source, because what it
 * asks (is each part still exported and still working at runtime) has its
 * answer only in the emitted artifact. So a `dist` that is absent has to stop
 * the run.
 *
 * **Stopping is all it does, and that is the whole design.** Freshness belongs
 * to the build system: `turbo.json` makes `test` depend on this package's own
 * `build` and names `dist/**` among its inputs, so an edit to anything the
 * entry is emitted from rebuilds and re-runs. `pnpm test`, `turbo run test`
 * and CI all arrive through that edge with the artifact already current. What
 * is checked here is the path that bypasses it — a direct `vitest`, or
 * `pnpm --filter @nextlyhq/plugin-sdk test`, which runs the package script
 * without turbo's graph.
 *
 * Building here as well looks like belt-and-braces and is not. `turbo run
 * build --filter=@nextlyhq/plugin-sdk` carries the `^build` edge, so it
 * rebuilds this package's whole dependency tree — the admin, the ui, `nextly`
 * — and each of those bundles with `clean: true`, deleting its `dist` before
 * emitting. Run from global setup, that happens DURING collection, while
 * sibling packages' suites are already importing from those same directories.
 *
 * **Absent is checked; STALE is not, and cannot usefully be.** Turbo restores
 * a cached `dist` with the timestamp of the restore, so any later touch of a
 * source file — a checkout, a branch switch, a formatter — makes the source
 * newer than an artifact whose content is current. A timestamp guard would
 * refuse to run on a correct tree, which is a worse failure than the rare one
 * it prevents. Turbo stays the authority, through the `test` -> `build` edge.
 *
 * The entries are read from `package.json` rather than listed here, so this
 * checks exactly what the suites resolve and cannot drift from it as entries
 * are added.
 */
export default function setup(): void {
  const packageRoot = dirname(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8")
  ) as { name?: string; exports?: Record<string, { import?: string }> };
  const name = manifest.name ?? "@nextlyhq/plugin-sdk";
  // Scoped through `turbo run` directly rather than the root `build` script,
  // which already carries `--filter=./packages/*`. Turbo's filters are
  // ADDITIVE, so `pnpm build --filter <name>` selects every package's build
  // rather than this one's subtree.
  const recovery = `pnpm exec turbo run build --filter=${name}`;

  const missing = Object.entries(manifest.exports ?? {})
    .map(([subpath, entry]) => ({ subpath, file: entry?.import }))
    .filter(
      (entry): entry is { subpath: string; file: string } =>
        typeof entry.file === "string"
    )
    .filter(entry => !existsSync(resolve(packageRoot, entry.file)))
    .map(entry => `${entry.subpath} (${entry.file})`);
  if (missing.length > 0) {
    throw new Error(
      `${name} has no built entry for ${missing.join(", ")}.\n` +
        `A suite here loads the emitted entry, so there is nothing for it to ` +
        `load.\n` +
        `Run \`${recovery}\`, or use \`pnpm test\` / \`turbo run test\`, which build first.`
    );
  }
}
