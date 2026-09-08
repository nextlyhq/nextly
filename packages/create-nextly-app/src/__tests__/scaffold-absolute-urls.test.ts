/**
 * The origin a scaffolded app builds its absolute URLs from.
 *
 * Two ways this goes wrong, and neither fails at build time — a wrong absolute
 * URL renders perfectly and is only noticed in someone else's crawler, mail
 * client or preview pane.
 *
 * @module __tests__/scaffold-absolute-urls.test
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Repo-root templates/, which is the tree that actually ships. The copy under
// packages/create-nextly-app/templates/ is a gitignored scaffold artifact and
// asserting against it would pass on a stale build.
const here = path.dirname(fileURLToPath(import.meta.url));
const templatesRoot = path.resolve(here, "../../../../templates");

/** Every `.ts`/`.tsx` under a template's `src/`, recursively. */
async function sourceFiles(template: string): Promise<string[]> {
  const root = path.join(templatesRoot, template, "src");
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  await walk(root);
  return out;
}

describe("a scaffolded app's absolute URLs", () => {
  it("hardcodes no port in any template's runtime code", async () => {
    /*
     * A literal `localhost:3000` is wrong the moment anyone runs on another
     * port — and Next itself moves to one, silently, when 3000 is taken. The
     * pages still render; every absolute URL points at nothing.
     *
     * The port is knowable at runtime and not at scaffold time, so the
     * derivation belongs in the app rather than in the generator.
     */
    const offenders: string[] = [];
    let scanned = 0;
    for (const template of ["base", "blank", "blog"]) {
      for (const file of await sourceFiles(template)) {
        scanned += 1;
        const text = await readFile(file, "utf8");
        if (/localhost:\d+/.test(text)) {
          offenders.push(path.relative(templatesRoot, file));
        }
      }
    }

    // Population first: a moved templates/ directory or a changed extension
    // filter leaves the loop reading nothing, and "no offenders" then passes
    // on a scan that examined no files at all.
    expect(scanned).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it("reads the origin from ONE module per app", async () => {
    /*
     * The expression was repeated in five places across three templates, which
     * is the shape that drifts: a correction lands in the file someone happened
     * to open. `base/src/lib/site-url.ts` is the single implementation, and the
     * overlay copies base first, so every template gets it.
     */
    const helper = path.join(templatesRoot, "base/src/lib/site-url.ts");
    /*
     * COMMENTS STRIPPED. The docblock names every variable this module reads
     * and the reason for each, so searching the raw text finds the prose —
     * measured: removing `process.env.PORT` from the code left an assertion
     * against the whole file green, because the paragraph explaining it
     * remained.
     */
    const code = (await readFile(helper, "utf8")).replace(
      /\/\*[\s\S]*?\*\/|\/\/.*/g,
      ""
    );
    expect(code).toContain("process.env.NEXT_PUBLIC_SITE_URL");
    expect(code).toContain("process.env.NEXT_PUBLIC_APP_URL");
    expect(code).toContain("process.env.PORT");

    // No template may ship a second copy at the same path, because an overlay
    // REPLACES base's file rather than merging with it — a copy there silently
    // takes precedence over the one this suite just checked.
    for (const template of ["blank", "blog"]) {
      const shadow = (await sourceFiles(template)).filter(f =>
        f.endsWith(path.join("lib", "site-url.ts"))
      );
      expect(shadow, `${template} shadows base's site-url`).toEqual([]);
    }
  });

  it("documents the variable the app reads, not only the one the backend does", async () => {
    /*
     * `NEXT_PUBLIC_APP_URL` is where the app lives and the core package reads
     * it for preview links and invite emails. `NEXT_PUBLIC_SITE_URL` is where
     * readers find the public site. The base template documented only the
     * first and read only the second, so setting the documented variable
     * changed nothing a reader would ever see.
     */
    const example = await readFile(
      path.join(templatesRoot, "base/.env.example"),
      "utf8"
    );
    expect(example).toContain("NEXT_PUBLIC_APP_URL=");
    expect(example).toContain("NEXT_PUBLIC_SITE_URL");
  });
});
