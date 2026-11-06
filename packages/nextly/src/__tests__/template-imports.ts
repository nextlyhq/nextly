/**
 * This package's source for the names a template imports nextly by, for files
 * under `templates/` only.
 *
 * A test may load a template's own code: the blog template's migration guard
 * builds its collections, and an integration test boots its Posts. A template
 * has no `node_modules` of its own to find nextly in, so `nextly` and
 * `nextly/config` imported from a template file resolve here to this
 * package's source. A file anywhere else resolves these names as before.
 *
 * Shared by `vitest.config.ts` and `vitest.integration.config.ts`, so a
 * template resolves to the same source in both runs.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/** This package's `src`. */
const SRC = fileURLToPath(new URL("..", import.meta.url));

/** The repository's starter projects, as a path prefix with forward slashes. */
const TEMPLATES = `${path.resolve(SRC, "../../../templates").split(path.sep).join("/")}/`;

const TEMPLATE_IMPORTS: Record<string, string> = {
  nextly: path.resolve(SRC, "index.ts"),
  "nextly/config": path.resolve(SRC, "config.ts"),
};

/** The Vite plugin resolving a template's nextly imports to this source. */
export function nextlyForTemplates() {
  return {
    name: "nextly-for-templates",
    enforce: "pre" as const,
    resolveId(source: string, importer: string | undefined) {
      const from = importer?.split("?")[0].split(path.sep).join("/");
      if (!from?.startsWith(TEMPLATES)) return null;
      return TEMPLATE_IMPORTS[source] ?? null;
    },
  };
}
