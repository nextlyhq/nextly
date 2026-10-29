// The scaffold templates, which oxlint.config.mjs leaves out: they are written
// for the project each one becomes, and linted with that project's own setup.
// A scaffolded project depends on `@nextlyhq/ui`, though, so a template that
// renders its Tabs is a first-party call site, and the guard that reads call
// sites reads these too. Nothing else runs here. `pnpm lint` runs it as a pass
// of its own.
import { defineConfig } from "oxlint";

export default defineConfig({
  categories: { correctness: "off" },
  jsPlugins: ["./lint/guards.mjs"],
  options: { maxWarnings: 0 },
  rules: { "nextly/tab-indicator": "error" },
});
