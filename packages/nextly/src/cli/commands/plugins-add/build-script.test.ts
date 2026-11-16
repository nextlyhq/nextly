/**
 * The step `nextly plugins add` adds to a site's build: a production boot
 * refuses a configured plugin no install has run for, so the build that
 * migrates the database installs the new plugin too, right after the
 * scaffold's own steps and before the app is built.
 */
import { describe, expect, it } from "vitest";

import { buildScriptEdit } from "./build-script";

/** A package.json with `build` as its build script. */
const manifest = (build?: string): string =>
  `${JSON.stringify(
    {
      name: "site",
      private: true,
      scripts:
        build === undefined ? { dev: "next dev" } : { dev: "next dev", build },
      dependencies: { nextly: "1.0.0" },
    },
    null,
    2
  )}\n`;

const PLUGIN = "@acme/seo";

/** The build script after the edit, failing when the answer is not an edit. */
function built(build: string): string {
  const answer = buildScriptEdit(manifest(build), PLUGIN);
  if (answer.kind !== "edit") {
    throw new Error(`expected an edit, got ${JSON.stringify(answer)}`);
  }
  return (JSON.parse(answer.after) as { scripts: { build: string } }).scripts
    .build;
}

describe("the build step for a new plugin", () => {
  it("installs the plugin after the migration, before the app is built", () => {
    expect(built("nextly migrate && next build")).toBe(
      "nextly migrate && nextly plugins install @acme/seo && next build"
    );
  });

  it("goes after the plugins the build already installs", () => {
    expect(
      built(
        "nextly migrate && nextly plugins install @nextlyhq/plugin-form-builder && next build && node scripts/build-search-index.mjs"
      )
    ).toBe(
      "nextly migrate && nextly plugins install @nextlyhq/plugin-form-builder && nextly plugins install @acme/seo && next build && node scripts/build-search-index.mjs"
    );
  });

  it("runs nextly the way the build already does", () => {
    expect(built("npx nextly migrate && next build")).toBe(
      "npx nextly migrate && npx nextly plugins install @acme/seo && next build"
    );
  });

  it("installs against the configuration the build migrates with", () => {
    expect(built("nextly migrate --config config/cms.ts && next build")).toBe(
      "nextly migrate --config config/cms.ts && nextly plugins install @acme/seo --config config/cms.ts && next build"
    );
    expect(built("nextly migrate -c cms.config.ts && next build")).toBe(
      "nextly migrate -c cms.config.ts && nextly plugins install @acme/seo --config cms.config.ts && next build"
    );
    expect(built("nextly migrate --config=cms.config.ts && next build")).toBe(
      "nextly migrate --config=cms.config.ts && nextly plugins install @acme/seo --config cms.config.ts && next build"
    );
  });

  it("installs in the mode the build migrates in", () => {
    expect(built("nextly migrate --mode production && next build")).toBe(
      "nextly migrate --mode production && nextly plugins install @acme/seo --mode production && next build"
    );
    expect(
      built("nextly migrate --mode=production -c cms.config.ts && next build")
    ).toBe(
      "nextly migrate --mode=production -c cms.config.ts && nextly plugins install @acme/seo --config cms.config.ts --mode production && next build"
    );
  });

  it("says what to add, and edits nothing, when a carried value is quoted", () => {
    const answer = buildScriptEdit(
      manifest('nextly migrate --config "config/site cms.ts" && next build'),
      PLUGIN
    );
    expect(answer).toMatchObject({ kind: "manual" });
  });

  it("keeps the rest of package.json as it was", () => {
    const answer = buildScriptEdit(
      manifest("nextly migrate && next build"),
      PLUGIN
    );
    expect(answer.kind).toBe("edit");
    if (answer.kind !== "edit") return;
    expect(answer.after).toBe(
      manifest(
        "nextly migrate && nextly plugins install @acme/seo && next build"
      )
    );
  });

  it("changes nothing when the build installs the plugin already, or every plugin", () => {
    expect(
      buildScriptEdit(
        manifest(
          "nextly migrate && nextly plugins install @acme/seo && next build"
        ),
        PLUGIN
      )
    ).toEqual({ kind: "installed" });
    expect(
      buildScriptEdit(
        manifest(
          "nextly migrate && nextly plugins install --all && next build"
        ),
        PLUGIN
      )
    ).toEqual({ kind: "installed" });
  });

  it("does not take a status command for the migration", () => {
    expect(
      buildScriptEdit(manifest("nextly migrate:status && next build"), PLUGIN)
        .kind
    ).toBe("manual");
  });

  it.each([
    ["a project with no build script", manifest()],
    ["a build that does not migrate", manifest("next build")],
    ["a package.json that does not parse", "{"],
  ])("says what to add for %s, and edits nothing", (_, text) => {
    const answer = buildScriptEdit(text, PLUGIN);
    expect(answer).toMatchObject({
      kind: "manual",
      step: "nextly plugins install @acme/seo",
    });
  });

  it("never writes a name a shell would read as more than a name", () => {
    const answer = buildScriptEdit(
      manifest("nextly migrate && next build"),
      "acme; rm -rf ."
    );
    expect(answer.kind).toBe("manual");
  });
});
