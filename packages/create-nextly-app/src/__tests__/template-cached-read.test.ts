/**
 * Every app a template makes registers its `"use cache"` read function, and
 * how Nextly starts when a read finds it not started, from its root layout,
 * as the blog does.
 *
 * `create-nextly-app` turns Cache Components on in every app it makes, and
 * `<SiteCode>` refuses to read under it until a read function is registered.
 * Both registrations are side effects of importing `src/nextly/cached-read.ts`,
 * so a root layout that imports it makes them on every route, `/_not-found`
 * included, before anything reads: in a build's prerender workers nothing
 * else starts Nextly.
 *
 * Two properties are held here. Every template's root layout, as the scaffold
 * receives it (a template's own layout replaces base's), imports the file and
 * the import resolves to a file the scaffold receives. And every copy of the
 * function, the playground's included, is the blog's but for the path it
 * imports the app's config from, which must resolve in that app:
 * `blog-cached-read.test.ts` runs the blog's, so a copy that drifted would be
 * a function nothing tests. The playground's variant for Cache Components off
 * registers how Nextly starts the same way.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { cachedReadCode, configSpecifier } from "./cached-read-copy";

const REPO = join(__dirname, "../../../..");
const TEMPLATES = join(REPO, "templates");
/** The tested copy every other copy is held to. */
const BLOG_CACHED_READ = join(TEMPLATES, "blog/src/nextly/cached-read.ts");

const PLAYGROUND = join(REPO, "apps/playground");

/** A copy's code as copies are compared. */
function codeOf(file: string): string {
  return cachedReadCode(readFileSync(file, "utf8"));
}

/** The statements from the comment on how Nextly starts to the end. */
function startBlock(source: string): string {
  return source.slice(source.indexOf("// Tells Nextly how")).trim();
}

/**
 * Whether the config import in `file` resolves in the app whose tsconfig is
 * `tsconfig`: `@nextly-config` through that tsconfig's alias, a relative path
 * to a `.ts` file beside it.
 */
function configResolves(file: string, tsconfig: string | undefined): boolean {
  const specifier = configSpecifier(readFileSync(file, "utf8"));
  if (specifier === undefined) return false;
  if (specifier === "@nextly-config") {
    return (
      tsconfig !== undefined &&
      readFileSync(tsconfig, "utf8").includes('"@nextly-config"')
    );
  }
  return (
    specifier.startsWith(".") &&
    existsSync(join(dirname(file), `${specifier}.ts`))
  );
}

/** Every template, read from the folder so a new one is checked too. */
const TEMPLATE_NAMES = readdirSync(TEMPLATES, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

/**
 * The folders a template's app is assembled from, the later one winning, as
 * the copy does: an app template is `base` with its own `src` over it; the
 * plugin template's app is its `dev` folder alone.
 */
function appRoots(name: string): string[] {
  if (existsSync(join(TEMPLATES, name, "dev"))) {
    return [join(TEMPLATES, name, "dev")];
  }
  return name === "base"
    ? [join(TEMPLATES, "base")]
    : [join(TEMPLATES, "base"), join(TEMPLATES, name)];
}

/** The file at `relative` the assembled app receives, or `undefined`. */
function received(roots: string[], relative: string): string | undefined {
  return roots
    .map(root => join(root, relative))
    .filter(file => existsSync(file))
    .at(-1);
}

/** The import of the read function a layout makes, resolved inside the app. */
function cachedReadImport(layout: string, roots: string[]): string | undefined {
  const specifier = /^import "([^"]*nextly\/cached-read)";$/m.exec(
    readFileSync(layout, "utf8")
  )?.[1];
  if (specifier === undefined) return undefined;
  if (specifier.startsWith("@/")) {
    return received(roots, join("src", `${specifier.slice(2)}.ts`));
  }
  const resolved = join(dirname(layout), `${specifier}.ts`);
  return existsSync(resolved) ? resolved : undefined;
}

describe("templates: the root layout registers the cached-read function", () => {
  it("finds the app templates and the plugin's dev app", () => {
    // A rename that left this reading nothing would pass every case below.
    expect(TEMPLATE_NAMES).toEqual(
      expect.arrayContaining(["base", "blank", "blog", "plugin"])
    );
  });

  for (const name of TEMPLATE_NAMES) {
    it(`${name}: its root layout imports src/nextly/cached-read.ts`, () => {
      const roots = appRoots(name);
      const layout = received(roots, join("src", "app", "layout.tsx"));
      expect(layout, `${name} has a root layout`).toBeDefined();
      const target = cachedReadImport(layout ?? "", roots);
      expect(target, `${name}'s layout imports a file it receives`).toMatch(
        /src[\\/]nextly[\\/]cached-read\.ts$/
      );
      expect(codeOf(target ?? ""), `${name}'s copy is the blog's`).toBe(
        codeOf(BLOG_CACHED_READ)
      );
    });
  }
});

describe("every copy of the cached-read function is the blog's", () => {
  /** Each copy, with the tsconfig of the app it is in. */
  const copies = [
    ...TEMPLATE_NAMES.flatMap(name => {
      const roots = appRoots(name);
      const tsconfig = received(roots, "tsconfig.json");
      return roots.map(root => ({
        file: join(root, "src/nextly/cached-read.ts"),
        tsconfig,
      }));
    }),
    {
      file: join(PLAYGROUND, "src/nextly/cached-read.ts"),
      tsconfig: join(PLAYGROUND, "tsconfig.json"),
    },
  ].filter(
    (copy, index, all) =>
      existsSync(copy.file) &&
      all.findIndex(other => other.file === copy.file) === index
  );

  it("finds the copies it holds", () => {
    expect(copies.map(copy => copy.file)).toEqual(
      expect.arrayContaining([
        join(TEMPLATES, "base/src/nextly/cached-read.ts"),
        join(TEMPLATES, "plugin/dev/src/nextly/cached-read.ts"),
        join(REPO, "apps/playground/src/nextly/cached-read.ts"),
      ])
    );
  });

  for (const { file, tsconfig } of copies) {
    it(`${file.slice(REPO.length + 1)} is the blog's function`, () => {
      expect(codeOf(file)).toBe(codeOf(BLOG_CACHED_READ));
    });

    it(`${file.slice(REPO.length + 1)} imports a config its app has`, () => {
      expect(configResolves(file, tsconfig)).toBe(true);
    });
  }

  it("the playground's Cache Components off variant registers how Nextly starts the same way", () => {
    // The layout's one import resolves here with Cache Components off, so it
    // must register how Nextly starts as the Cache Components file does.
    const off = join(
      PLAYGROUND,
      "src/nextly/cached-read.cache-components-off.ts"
    );
    const source = readFileSync(off, "utf8");
    // No `server-only` marker: a CLI, cron or worker importing a query module
    // reaches this file, and the marker's Node entry throws there.
    expect(source).not.toMatch(/server-only/);
    expect(configResolves(off, join(PLAYGROUND, "tsconfig.json"))).toBe(true);
    expect(startBlock(source)).toBe(
      startBlock(readFileSync(BLOG_CACHED_READ, "utf8"))
    );
    expect(startBlock(source)).toContain(
      "registerNextlyStart(() => getNextly({ config }));"
    );
  });
});
