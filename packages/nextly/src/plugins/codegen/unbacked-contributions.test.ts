/**
 * A contributed admin component whose module has no file behind it is left
 * out of the component map, and named; one whose module is there is kept.
 *
 * What separates it from a plausible wrong one: the app is real on disk, so a
 * judge that skipped every alias, every package or every contribution would
 * leave out the present ones too; the writer and the CI check are both asked,
 * so a writer that skipped while the check still demanded the path (or the
 * reverse) would fail the agreement; a widget naming a missing module
 * stays in the map, where its card's error state names it; a bare name no
 * tsconfig alias and no installed package answers is kept, as an alias only
 * the bundler declares would be; and a package whose export is declared but
 * whose target file is not built is left out, where a judge reading the
 * export's key alone would keep it.
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
  // Written as an app writes it: comments, an alias, a trailing comma.
  put(
    "tsconfig.json",
    `{
  // The app's own alias.
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"], },
  },
}`
  );
  put("src/plugins/kept/contribution.tsx", "export const Kept = () => null;");
  put(
    "node_modules/@acme/x/package.json",
    JSON.stringify({ name: "@acme/x", exports: { "./admin": "./admin.js" } })
  );
  put("node_modules/@acme/x/admin.js", "export const Panel = () => null;");
  // A workspace plugin not built yet: its export names `dist`, which holds
  // only the declaration, and `types` is not what the map's import loads.
  put(
    "node_modules/@acme/unbuilt/package.json",
    JSON.stringify({
      name: "@acme/unbuilt",
      exports: {
        "./admin": { types: "./dist/admin.d.ts", import: "./dist/admin.js" },
      },
    })
  );
  put("node_modules/@acme/unbuilt/dist/admin.d.ts", "export {};");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const KEPT_ALIAS = "@/plugins/kept/contribution#Kept";
const GONE_ALIAS = "@/plugins/gone/contribution#Gone";
const KEPT_PACKAGE = "@acme/x/admin#Panel";
const GONE_SUBPATH = "@acme/x/missing#Nothing";
const GONE_UNBUILT = "@acme/unbuilt/admin#Panel";
// Neither a tsconfig alias nor an installed package: a bundler alias looks
// the same, so it is not proven missing.
const KEPT_UNKNOWN = "~bundler-alias/admin#Panel";
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
        KEPT_PACKAGE,
        GONE_SUBPATH,
        GONE_UNBUILT,
        KEPT_UNKNOWN,
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

describe("a contributed component with no file behind it", () => {
  it("is found, and every one with a file is not", () => {
    expect(
      unbackedContributions([fixture], TYPES, root).map(each => each.path)
    ).toEqual([GONE_ALIAS, GONE_SUBPATH, GONE_UNBUILT]);
  });

  it("is left out of the map the writer writes, which keeps every other component", async () => {
    const written = await writeComponentMapFiles([fixture], TYPES, root);
    const list = written.paths[1];
    if (list === undefined) throw new Error("no path list written");
    expect(listedPathsOf(readFileSync(list, "utf-8"))).toEqual(
      [KEPT_PACKAGE, KEPT_ALIAS, KEPT_UNKNOWN, GONE_WIDGET].sort((a, b) =>
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

describe("a module path, judged as the app's build would find it", () => {
  const place = () => ({ cwd: root, mapDir: join(root, "src/types") });

  it("reads a relative path from the map's own folder", () => {
    put("src/types/local.ts", "export {};");
    expect(modulePresence("./local", place())).toBe("present");
    expect(modulePresence("./elsewhere", place())).toBe("absent");
  });

  it("reads an alias through the app's tsconfig, and a package through its exports", () => {
    expect(modulePresence("@/plugins/kept/contribution", place())).toBe(
      "present"
    );
    expect(modulePresence("@acme/x/admin", place())).toBe("present");
    expect(modulePresence("@acme/x/missing", place())).toBe("absent");
  });

  it("follows an export to its file, through conditions and a `*` pattern", () => {
    // Declared, but the file a server build loads is not there.
    expect(modulePresence("@acme/unbuilt/admin", place())).toBe("absent");
    put(
      "node_modules/@acme/kit/package.json",
      JSON.stringify({
        name: "@acme/kit",
        exports: {
          "./widgets/*": { default: "./dist/widgets/*.js" },
          "./strange": { browser: "./dist/strange.js" },
        },
      })
    );
    put("node_modules/@acme/kit/dist/widgets/chart.js", "export {};");
    expect(modulePresence("@acme/kit/widgets/chart", place())).toBe("present");
    expect(modulePresence("@acme/kit/widgets/table", place())).toBe("absent");
    // A condition a server build does not resolve proves nothing.
    expect(modulePresence("@acme/kit/strange", place())).toBe("unknown");
  });

  it("keeps a bare name no tsconfig alias and no installed package answers", () => {
    expect(modulePresence("~bundler-alias/admin", place())).toBe("unknown");
    expect(modulePresence("@acme/not-installed/admin", place())).toBe(
      "unknown"
    );
    // Matched by the tsconfig alias, every target missing: proven absent.
    expect(modulePresence("@/plugins/gone/contribution", place())).toBe(
      "absent"
    );
  });
});
