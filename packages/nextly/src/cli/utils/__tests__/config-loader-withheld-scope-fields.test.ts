/**
 * Loading a configuration publishes what its plugins' scopes hold back from
 * switched-off types, and a configuration with no plugin holds nothing back:
 * the last plugin removed, its fields are no longer kept by any schema change.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import {
  currentWithheldScopeFields,
  publishWithheldScopeFields,
} from "../../../domains/schema/pipeline/withheld-scope-fields";
import { clearConfigCache, loadConfig } from "../config-loader";

/** What the app's config file exports, as its bundled code returns it. */
const exported = vi.hoisted(() => ({ config: {} as unknown }));

vi.mock("../config-bundler", () => ({
  bundleAndRequire: async () => ({
    mod: { default: exported.config },
    dependencies: [],
  }),
}));

const made: string[] = [];

afterEach(() => {
  clearConfigCache();
  publishWithheldScopeFields(new Map());
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function project(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "nextly-withheld-")));
  made.push(dir);
  writeFileSync(join(dir, "nextly.config.mjs"), "export default {};\n");
  return dir;
}

describe("loading a configuration with no plugin", () => {
  it("holds nothing back that an earlier configuration's plugin held back", async () => {
    // What a configuration with a plugin, switching `pages` off, left.
    publishWithheldScopeFields(
      new Map([["collection:pages", [{ name: "seo", type: "text" } as never]]])
    );
    exported.config = {
      collections: [
        { slug: "pages", fields: [{ name: "title", type: "text" }] },
      ],
    };

    await loadConfig({ cwd: project() });

    expect([...currentWithheldScopeFields().keys()]).toEqual([]);
  });

  it("puts back what was held back when a load is refused after its fold", async () => {
    const previous = new Map([
      ["collection:posts", [{ name: "seo", type: "text" } as never]],
    ]);
    publishWithheldScopeFields(previous);
    // Its plugin switches `pages` off, and its field group closes a cycle
    // with the Builder's, which the load refuses after the fold has run.
    exported.config = {
      collections: [
        { slug: "pages", fields: [{ name: "title", type: "text" }] },
      ],
      fieldGroups: [
        {
          slug: "hero",
          fields: [{ name: "card", type: "component", component: "card" }],
        },
      ],
      plugins: [
        {
          name: "@t/seo",
          version: "1.0.0",
          nextly: ">=0.0.0",
          contributes: {
            extend: [
              {
                target: { every: ["collection"], except: ["pages"] },
                fields: [{ name: "seo", type: "text" }],
              },
            ],
          },
        },
      ],
    };

    const cwd = project();
    // The Builder's `card` places `hero` back: a cycle judged once the
    // Builder's field groups are read, after the fold.
    writeFileSync(
      join(cwd, "ui-schema.json"),
      JSON.stringify({
        version: 1,
        components: [
          {
            slug: "card",
            fields: [{ name: "hero", type: "component", component: "hero" }],
          },
        ],
      })
    );

    await expect(loadConfig({ cwd })).rejects.toMatchObject({
      publicData: {
        errors: [expect.objectContaining({ code: "FIELD_GROUP_CYCLE" })],
      },
    });

    // The running configuration is still the previous one.
    expect(currentWithheldScopeFields()).toBe(previous);
  });
});
