/**
 * A contributed admin component whose LOCAL module has no runtime file behind
 * it is left out of the component map, and named; every other is kept.
 *
 * What separates it from a plausible wrong one: the app is real on disk, so a
 * judge that skipped every alias or every contribution would leave out the
 * present ones too; a declaration file alone is not a module, so a judge that
 * counted one would keep a component whose import loads nothing; packages
 * are never judged, so a judge guessing at a package's entry (installed but
 * unbuilt, or not installed where looked for) would drop a valid component;
 * an alias inherited through a package-based `extends` is followed, where a
 * judge reading only relative `extends` would miss it, and so is a package's
 * `tsconfig` field; a path written with its emitted extension is read from
 * its source, where a judge reading it literally would drop it; a local
 * folder with its own manifest is a package, left to the build; an exact
 * alias wins over a pattern listed before it; the writer and the CI
 * check are both asked, so the two cannot disagree; and a widget naming a
 * missing module stays in the map, where its card's error state names it.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PluginDefinition } from "../plugin-context";

import {
  checkComponentMapFiles,
  componentMapAgrees,
} from "./check-component-map";
import { listedPathsOf } from "./component-import-map";
import {
  describeUnbackedContribution,
  modulePresence,
  unbackedContributions,
} from "./unbacked-contributions";
import { writeComponentMapFiles } from "./write-component-map";

const TYPES = "src/types/nextly-types.ts";

let root: string;

/** Writes `text` at `path` under the app's root, creating its folders. */
function put(path: string, text: string): void {
  const file = join(root, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nextly-unbacked-"));
  // Written as an app writes it: comments, an alias, a trailing comma, and
  // a shared config extended by package spec, which declares an alias of
  // its own the app's `paths` do not repeat.
  put(
    "tsconfig.json",
    `{
  // The app's own config, on top of a shared one.
  "extends": "@acme/tsconfig/next.json",
}`
  );
  put(
    "node_modules/@acme/tsconfig/package.json",
    JSON.stringify({ name: "@acme/tsconfig" })
  );
  // Relative `paths` resolve against the config that declares them: this
  // package's folder, two levels up to the app.
  put(
    "node_modules/@acme/tsconfig/next.json",
    `{
  "compilerOptions": {
    "paths": {
      "@/*": ["../../../src/*"],
    },
  },
}`
  );
  put("src/plugins/kept/contribution.tsx", "export const Kept = () => null;");
  // Types only: nothing here loads at run time.
  put("src/plugins/typed/contribution.d.ts", "export {};");
  // An installed package whose entry is not built: never judged here.
  put(
    "node_modules/@acme/unbuilt/package.json",
    JSON.stringify({
      name: "@acme/unbuilt",
      exports: { "./admin": "./dist/admin.js" },
    })
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const KEPT_ALIAS = "@/plugins/kept/contribution#Kept";
const GONE_ALIAS = "@/plugins/gone/contribution#Gone";
const GONE_TYPES_ONLY = "@/plugins/typed/contribution#Typed";
const KEPT_UNBUILT = "@acme/unbuilt/admin#Panel";
const KEPT_NOT_INSTALLED = "@acme/not-installed/admin#Panel";
const GONE_WIDGET = "@/plugins/gone/widget#Card";

const fixture = {
  name: "fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    admin: {
      contributions: [
        KEPT_ALIAS,
        GONE_ALIAS,
        GONE_TYPES_ONLY,
        KEPT_UNBUILT,
        KEPT_NOT_INSTALLED,
      ].map((component, index) => ({
        id: `fixture.block-${String(index)}`,
        kind: "block",
        place: "dashboard",
        component,
      })),
    },
    dashboard: {
      widgets: [{ id: "fixture/card", view: { component: GONE_WIDGET } }],
    },
  },
} as unknown as PluginDefinition;

describe("a contributed component with no runtime file behind it", () => {
  it("is found among local modules, and no package is", () => {
    expect(
      unbackedContributions([fixture], TYPES, root).map(each => each.path)
    ).toEqual([GONE_ALIAS, GONE_TYPES_ONLY]);
  });

  it("is left out of the map the writer writes, which keeps every other component", async () => {
    const written = await writeComponentMapFiles([fixture], TYPES, root);
    const list = written.paths[1];
    if (list === undefined) throw new Error("no path list written");
    expect(listedPathsOf(readFileSync(list, "utf-8"))).toEqual(
      [KEPT_ALIAS, KEPT_UNBUILT, KEPT_NOT_INSTALLED, GONE_WIDGET].sort((a, b) =>
        a.localeCompare(b)
      )
    );
    // The CI check reads the same answer, so the written map agrees with it.
    expect(
      componentMapAgrees(
        await checkComponentMapFiles([fixture], TYPES, root, undefined)
      )
    ).toBe(true);
  });

  it("is named with the module that is missing, in the warning", () => {
    const [gone] = unbackedContributions([fixture], TYPES, root);
    if (gone === undefined) throw new Error("nothing found");
    const warning = describeUnbackedContribution(gone);
    expect(warning).toContain('plugin "fixture"');
    expect(warning).toContain(GONE_ALIAS);
    expect(warning).toContain("@/plugins/gone/contribution");
  });
});

describe("a module path, judged only where it is local", () => {
  const place = () => ({ cwd: root, mapDir: join(root, "src/types") });

  it("reads a relative path from the map's own folder, counting runtime files only", () => {
    put("src/types/local.tsx", "export {};");
    put("src/types/declared.d.ts", "export {};");
    expect(modulePresence("./local", place())).toBe("present");
    expect(modulePresence("./declared", place())).toBe("absent");
    expect(modulePresence("./elsewhere", place())).toBe("absent");
  });

  it("reads a path written with an emitted extension as TypeScript does, from its source", () => {
    put("src/panel.ts", "export const Panel = () => null;");
    put("src/types/panel.mts", "export {};");
    expect(modulePresence("@/panel.js", place())).toBe("present");
    expect(modulePresence("./panel.mjs", place())).toBe("present");
    expect(modulePresence("./gone.js", place())).toBe("absent");
  });

  it("follows an extends naming a package alone through its tsconfig field", () => {
    put("tsconfig.json", '{ "extends": "@acme/shared" }');
    put(
      "node_modules/@acme/shared/package.json",
      JSON.stringify({ name: "@acme/shared", tsconfig: "config/base.json" })
    );
    // Four levels up from the package's `config` folder is the app.
    put(
      "node_modules/@acme/shared/config/base.json",
      JSON.stringify({
        compilerOptions: { paths: { "@/*": ["../../../../src/*"] } },
      })
    );
    expect(modulePresence("@/plugins/kept/contribution", place())).toBe(
      "present"
    );
    expect(modulePresence("@/plugins/gone/contribution", place())).toBe(
      "absent"
    );
  });

  it("follows an alias inherited through a package-based extends", () => {
    expect(modulePresence("@/plugins/kept/contribution", place())).toBe(
      "present"
    );
    // The playground's contributions fixture names its component this way:
    // an `@/*` alias with no file behind it.
    expect(modulePresence("@/plugins/gone/contribution", place())).toBe(
      "absent"
    );
  });

  it("never judges a package, installed without its entry or not installed", () => {
    expect(modulePresence("@acme/unbuilt/admin", place())).toBe("unknown");
    expect(modulePresence("@acme/not-installed/admin", place())).toBe(
      "unknown"
    );
    // An alias only a bundler declares looks the same.
    expect(modulePresence("~bundler-alias/admin", place())).toBe("unknown");
  });

  it("leaves a local folder with its own package.json to the build", () => {
    put(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { paths: { "@app/ui": ["packages/ui"] } },
      })
    );
    // Its entry is what its manifest names, not an `index.*`.
    put(
      "packages/ui/package.json",
      JSON.stringify({ name: "ui", main: "dist/panel.js" })
    );
    put(
      "src/types/vendor/package.json",
      JSON.stringify({ name: "vendor", exports: "./lib/panel.js" })
    );
    expect(modulePresence("@app/ui", place())).toBe("unknown");
    expect(modulePresence("./vendor", place())).toBe("unknown");
    // A folder without a manifest is still judged by its files.
    put("src/types/bare-folder/notes.md", "No module here.");
    expect(modulePresence("./bare-folder", place())).toBe("absent");
  });

  it("picks an exact alias over a pattern that matches as well, whatever their order", () => {
    put(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          paths: { "panel*": ["missing/*"], panel: ["src/panel"] },
        },
      })
    );
    put("src/panel.tsx", "export const Panel = () => null;");
    expect(modulePresence("panel", place())).toBe("present");
    // The pattern still answers for what the exact key does not name.
    expect(modulePresence("panel-extra", place())).toBe("absent");
  });

  it("proves nothing about an alias when an extends cannot be resolved", () => {
    put("tsconfig.json", '{ "extends": "@acme/missing-config/next.json" }');
    expect(modulePresence("@/plugins/gone/contribution", place())).toBe(
      "unknown"
    );
  });
});
