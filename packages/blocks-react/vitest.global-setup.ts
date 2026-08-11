import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Refuse to start when this package's declarations are missing, rather than
 * building them.
 *
 * Several suites here assert against the BUILT declarations rather than the
 * source, because the questions they ask — what an entry exports, what a
 * consumer can resolve — have answers only in the emitted artifact. So a `dist`
 * that is absent has to stop the run.
 *
 * **Stopping is all it does, and that is the whole design.** Freshness belongs
 * to the build system: `turbo.json` makes `test` depend on this package's own
 * `build` and names `dist/**` among its inputs, so an edit to anything the
 * declarations are emitted from rebuilds and re-runs. `pnpm test`, `turbo run
 * test` and CI all arrive through that edge with the artifact already current.
 * What is checked here is the path that bypasses it — a direct `vitest`, or
 * `pnpm --filter @nextlyhq/blocks-react test`, which runs the package script
 * without turbo's graph.
 *
 * Building here as well looked like belt-and-braces and was not. `turbo run
 * build --filter=@nextlyhq/blocks-react` carries the `^build` edge, so it
 * rebuilds this package's whole dependency tree — the engine, the adapters,
 * `nextly` — and each of those bundles with `clean: true`, deleting its `dist`
 * before emitting. Run from global setup, that happens DURING collection, while
 * sibling packages' suites are already importing from those same directories.
 * A concurrent run then fails in whichever package was mid-import, with a
 * missing chunk in code nobody changed. One package's convenience cannot be
 * bought by deleting another package's build output underneath it.
 *
 * **Absent is checked; STALE is not, and cannot usefully be.** A `dist` older
 * than the source it describes would pass here and let the suites read an
 * artifact that agrees with itself while the source has moved. Modification
 * times cannot close that: Turbo restores a cached `dist` with the timestamp of
 * the restore, so any later touch of a source file — a checkout, a branch
 * switch, a formatter — makes the source newer than an artifact whose content is
 * current. Measured on this package: a cache-restored `dist/index.d.ts` at
 * `…57.173` against an unchanged `src/index.ts` at `…57.691`. A timestamp guard
 * would refuse to run on a correct tree, which is a worse failure than the rare
 * one it prevents, and deciding freshness exactly means re-implementing Turbo's
 * hashing. Turbo stays the authority, through the `test` -> `build` edge.
 *
 * The entries are read from `package.json` rather than listed here, so this
 * checks exactly what the suites resolve and cannot drift from it as entries
 * are added.
 */
export default function setup(): void {
  const packageRoot = dirname(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8")
  ) as { name?: string; exports?: Record<string, { types?: string }> };
  const name = manifest.name ?? "@nextlyhq/blocks-react";
  // Scoped through `turbo run` directly rather than the root `build` script,
  // which already carries `--filter=./packages/*`. Turbo's filters are
  // ADDITIVE, so `pnpm build --filter <name>` selects 23 package builds rather
  // than this one's subtree — advice that would clean unrelated packages' `dist`
  // is the behaviour this file exists to stop recommending.
  const recovery = `pnpm exec turbo run build --filter=${name}`;

  const declarations = Object.entries(manifest.exports ?? {})
    .map(([subpath, entry]) => ({ subpath, types: entry?.types }))
    .filter(
      (entry): entry is { subpath: string; types: string } =>
        typeof entry.types === "string"
    )
    .map(entry => ({ ...entry, file: resolve(packageRoot, entry.types) }));

  const missing = declarations
    .filter(entry => !existsSync(entry.file))
    .map(entry => `${entry.subpath} (${entry.types})`);
  if (missing.length > 0) {
    throw new Error(
      `${name} has no built declarations for ${missing.join(", ")}.\n` +
        `Several suites here assert against the emitted artifact, so there is ` +
        `nothing for them to read.\n` +
        `Run \`${recovery}\`, or use \`pnpm test\` / \`turbo run test\`, which build first.`
    );
  }
}
