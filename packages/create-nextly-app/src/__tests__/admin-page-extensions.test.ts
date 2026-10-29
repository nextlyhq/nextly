/**
 * An app whose Next.js config sets `pageExtensions` routes a file only under
 * a name with one of them, so the admin's API route and its page and layout
 * written under their default names would never be served. For such an app
 * nothing is written there: each is reported with the name to create and its
 * content.
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateAdminPage } from "../generators/admin";
import { readMediaRouteTemplates } from "../generators/media-routes";
import { generateRoutes } from "../generators/routes";
import type { ProjectInfo } from "../types";

// The repository's templates, which the existing-app path reads before it
// writes anything.
const templates = await readMediaRouteTemplates(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../templates")
);

const info: ProjectInfo = {
  isNextJs: true,
  isAppRouter: true,
  hasTypescript: true,
  packageManager: "pnpm",
  nextVersion: "16.0.0",
  srcDir: false,
  appDir: "app",
};

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "nextly-admin-page-extensions-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const config = (text: string) => writeFile(join(cwd, "next.config.ts"), text);

/** What either generator wrote into the project: nothing, for these apps. */
const written = async () =>
  (await readdir(cwd, { recursive: true })).filter(
    entry => entry !== "next.config.ts"
  );

const run = async () => [
  ...(await generateRoutes(cwd, info)).skipped,
  ...(await generateAdminPage(cwd, info, templates)).skipped,
];

describe("the admin route and page in an app that sets pageExtensions", () => {
  it("writes neither, and names each under an extension the app routes", async () => {
    await config(
      'export default { pageExtensions: ["page.tsx", "page.ts"] };\n'
    );

    const skipped = await run();

    expect(skipped.map(entry => entry.path)).toEqual([
      "app/admin/api/[[...params]]/route.page.tsx",
      "app/admin/[[...params]]/page.page.tsx",
      "app/admin/[[...params]]/layout.page.tsx",
    ]);
    for (const entry of skipped) {
      expect(entry.why).toMatch(
        /^next\.config\.ts sets pageExtensions, and Next\.js routes a file there only under a name with one of them/
      );
      expect(entry.toAdd).toBeTruthy();
    }
    expect(await written()).toEqual([]);
  });

  // The page and layout hold JSX and types, so they need an extension ending
  // in tsx; the route is plain module code and takes any.
  it("names the route but asks for a tsx extension for the page and layout", async () => {
    await config(
      'export default { pageExtensions: ["page.ts", "page.js"] };\n'
    );

    const skipped = await run();

    expect(skipped.map(entry => entry.path)).toEqual([
      "app/admin/api/[[...params]]/route.page.ts",
      "app/admin/[[...params]]/page.<an extension ending in tsx added to pageExtensions>",
      "app/admin/[[...params]]/layout.<an extension ending in tsx added to pageExtensions>",
    ]);
    expect(skipped[1]?.why).toContain(
      "none of them (page.ts, page.js) is an extension ending in tsx"
    );
    expect(await written()).toEqual([]);
  });

  // A declaration file's suffix holds types only, and TypeScript refuses
  // code in it, so it is passed over for the next extension that can.
  it("never names a file with a declaration file's suffix", async () => {
    await config(
      'export default { pageExtensions: ["d.ts", "page.js", "page.tsx"] };\n'
    );

    const skipped = await run();

    expect(skipped.map(entry => entry.path)).toEqual([
      "app/admin/api/[[...params]]/route.page.tsx",
      "app/admin/[[...params]]/page.page.tsx",
      "app/admin/[[...params]]/layout.page.tsx",
    ]);
  });

  // The Next config step reads and extends only the names Next.js loads, so
  // a next.config.cjs, which it passes over, sets nothing here either.
  it("reads no pageExtensions from a next.config.cjs", async () => {
    await writeFile(
      join(cwd, "next.config.cjs"),
      'module.exports = { pageExtensions: ["page.tsx"] };\n'
    );

    expect((await generateRoutes(cwd, info)).written).toEqual([
      "app/admin/api/[[...params]]/route.ts",
    ]);
  });

  it("gives placeholder names for a list it cannot read", async () => {
    await config(
      'const extensions = ["page.tsx"];\nexport default { pageExtensions: extensions };\n'
    );

    const skipped = await run();

    expect(skipped.map(entry => entry.path)).toEqual([
      "app/admin/api/[[...params]]/route.<one of your pageExtensions>",
      "app/admin/[[...params]]/page.<one of your pageExtensions>",
      "app/admin/[[...params]]/layout.<one of your pageExtensions>",
    ]);
    expect(await written()).toEqual([]);
  });

  // The control: with no pageExtensions, both are written as before.
  it("writes both under their default names when the app sets none", async () => {
    await config("export default {};\n");

    const routes = await generateRoutes(cwd, info);
    const admin = await generateAdminPage(cwd, info, templates);

    expect(routes.written).toEqual(["app/admin/api/[[...params]]/route.ts"]);
    expect(admin.written).toEqual([
      "app/admin/[[...params]]/page.tsx",
      "app/admin/[[...params]]/layout.tsx",
    ]);
  });
});
