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
 * declarations are emitted from rebuilds and re-runs. Every documented path
 * into this suite — `pnpm test`, `turbo run test`, CI — arrives through that
 * edge with the artifact already current.
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
 * What is left is the case the build edge does not reach: someone running
 * `vitest` directly against a tree that was never built. That now ends in one
 * clear sentence naming the command to run, which is a cost worth paying —
 * a single legible failure, once, in place of a nondeterministic one somewhere
 * else.
 *
 * The entries are read from `package.json` rather than listed here, so this
 * checks exactly what the suites resolve and cannot drift from it as entries
 * are added.
 */
export default function setup(): void {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)));
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8")
  ) as { name?: string; exports?: Record<string, { types?: string }> };

  const missing = Object.entries(manifest.exports ?? {})
    .map(([subpath, entry]) => ({ subpath, types: entry?.types }))
    .filter(
      (entry): entry is { subpath: string; types: string } =>
        typeof entry.types === "string"
    )
    .filter(entry => !existsSync(resolve(packageRoot, entry.types)))
    .map(entry => `${entry.subpath} (${entry.types})`);

  if (missing.length === 0) return;

  const name = manifest.name ?? "@nextlyhq/blocks-react";
  throw new Error(
    `${name} has no built declarations for ${missing.join(", ")}.\n` +
      `Several suites here assert against the emitted artifact, so there is ` +
      `nothing for them to read.\n` +
      `Run \`pnpm build --filter ${name}\`, or use \`pnpm test\` / ` +
      `\`turbo run test\`, which build first.`
  );
}
