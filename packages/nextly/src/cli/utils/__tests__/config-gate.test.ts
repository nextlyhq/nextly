/**
 * The configuration's load reports every problem in the app's entities, including one that the
 * steps before it would otherwise trip over: an entity with no slug, or a slug that is not a
 * string, reaches the check rather than stopping the load with a TypeError.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { clearConfigCache, loadConfig } from "../config-loader";

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
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function project(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "nextly-config-gate-")));
  made.push(dir);
  writeFileSync(join(dir, "nextly.config.mjs"), "export default {};\n");
  return dir;
}

describe("an entity with no slug, or one that is not a string", () => {
  it.each([
    ["no slug", { fields: [{ name: "title", type: "text" }] }],
    [
      "a number for a slug",
      { slug: 7, fields: [{ name: "title", type: "text" }] },
    ],
  ])("with %s is reported with the rest, not thrown over", async (_, entry) => {
    exported.config = {
      collections: [
        entry,
        { slug: "Blog Posts", fields: [{ name: "title", type: "text" }] },
      ],
      singles: [{ fields: [{ name: "heading", type: "text" }] }],
    };

    const refused = await loadConfig({ cwd: project() }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "config-invalid" },
    });
    const paths = (
      (refused as { publicData?: { errors?: Array<{ path?: string }> } })
        .publicData?.errors ?? []
    ).map(problem => problem.path);
    expect(paths).toContain("collections[0].slug");
    expect(paths).toContain("collections[1].slug");
    expect(paths).toContain("singles[0].slug");
  });
});
