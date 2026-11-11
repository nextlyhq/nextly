/**
 * `nextly plugins add`, run as a shell runs it, in sites made from the
 * templates' own configs, on SQLite as a new project starts: the blank
 * template given the first-party form builder, which declares nothing and is
 * registered by the plugin definition it exports; and the blog template
 * given a plugin that declares a function asking for the site's production
 * address, refused without it and registered with it. In each, the command
 * leaves the config registering the plugin, the build installing it, and the
 * database recording it installed, which a production start requires.
 *
 * The packages are linked into each project from this checkout, as the
 * registry would install them, and the run uses `--skip-install`: the package
 * manager's part is `add.test.ts`'s. Building the Next.js app itself is not
 * run here; the config the build loads is, by every step after the edit.
 */
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";

const REPO = resolve(import.meta.dirname, "../../../../../..");
const TEMPLATES = join(REPO, "templates");

/** The workspace packages a site from the templates has installed. */
const LINKED = [
  ["nextly", "packages/nextly"],
  ["@nextlyhq/adapter-sqlite", "packages/adapter-sqlite"],
  ["@nextlyhq/plugin-form-builder", "packages/plugin-form-builder"],
  ["@nextlyhq/plugin-sdk", "packages/plugin-sdk"],
] as const;

/** A plugin package that declares a function asking for the site's address. */
const NOTES = {
  manifest: {
    name: "@acme/notes",
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
    nextly: {
      plugin: {
        export: "notesPlugin",
        call: true,
        options: {
          siteUrl: {
            description: "The site's production address",
            format: "url",
          },
        },
      },
    },
  },
  entry: `export function notesPlugin(options) {
  if (!options || !options.siteUrl) throw new Error("siteUrl is required");
  return { name: "@acme/notes", version: "1.0.0", nextly: "*" };
}
`,
};

/** The environment a new SQLite project's .env gives it. */
const ENV = {
  DB_DIALECT: "sqlite",
  DATABASE_URL: "file:./data/nextly.db",
  NEXTLY_SECRET: "plugins-add-test-only".padEnd(40, "-"),
  NODE_ENV: "development",
};

/** A site with the template's config, its build script, and the packages linked. */
async function site(root: string, config: string, build: string) {
  await mkdir(join(root, "data"), { recursive: true });
  await cp(config, join(root, "nextly.config.ts"));
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "site", private: true, scripts: { build } }, null, 2)}\n`
  );
  for (const [name, source] of LINKED) {
    const at = join(root, "node_modules", name);
    await mkdir(dirname(at), { recursive: true });
    await symlink(join(REPO, source), at, "dir");
  }
}

/** The plugin states the database records, by plugin, from its schema ledger. */
function recordedInstalls(root: string): string[] {
  const fromAdapter = createRequire(
    join(REPO, "packages/adapter-sqlite/package.json")
  );
  const Database = fromAdapter("better-sqlite3") as new (path: string) => {
    prepare(sql: string): { all(): Record<string, unknown>[] };
    close(): void;
  };
  const db = new Database(join(root, "data", "nextly.db"));
  try {
    // Read whole, so the check does not depend on the ledger's column names.
    return db
      .prepare("SELECT * FROM nextly_schema_events")
      .all()
      .map(row => Object.values(row).join(" "))
      .filter(row => row.includes("plugin_lifecycle"));
  } finally {
    db.close();
  }
}

const nextly = (args: string[], cwd: string) =>
  runNextly([...args, "--non-interactive"], cwd, ENV);

describe("nextly plugins add in sites made from the templates", () => {
  let base: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "nextly-plugins-add-sites-"));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it(
    "adds the form builder to the blank template's site",
    async () => {
      const root = join(base, "blank");
      await site(
        root,
        join(TEMPLATES, "blank/nextly.config.ts"),
        "nextly migrate && next build"
      );
      const migrated = await nextly(["migrate"], root);
      expect(migrated.status, migrated.stderr).toBe(0);

      const added = await nextly(
        ["plugins", "add", "@nextlyhq/plugin-form-builder", "--skip-install"],
        root
      );
      expect(added.status, added.stdout + added.stderr).toBe(0);

      const config = await readFile(join(root, "nextly.config.ts"), "utf8");
      expect(config).toContain(
        `import { formBuilderPlugin } from "@nextlyhq/plugin-form-builder";`
      );
      expect(config).toContain("plugins: [formBuilderPlugin],");
      const manifest = JSON.parse(
        await readFile(join(root, "package.json"), "utf8")
      ) as { scripts: { build: string } };
      expect(manifest.scripts.build).toBe(
        "nextly migrate && nextly plugins install @nextlyhq/plugin-form-builder && next build"
      );
      expect(recordedInstalls(root).join("\n")).toContain(
        "@nextlyhq/plugin-form-builder"
      );
    },
    NEXTLY_RUN_TIMEOUT * 3
  );

  it(
    "adds a plugin that asks for the production address to the blog template's site, only with it",
    async () => {
      const root = join(base, "blog");
      await site(
        root,
        join(TEMPLATES, "blog/configs/codefirst.config.ts"),
        "nextly migrate && nextly plugins install @nextlyhq/plugin-form-builder && next build"
      );
      await cp(join(TEMPLATES, "blog/src"), join(root, "src"), {
        recursive: true,
      });
      const notes = join(root, "node_modules", "@acme", "notes");
      await mkdir(notes, { recursive: true });
      await writeFile(
        join(notes, "package.json"),
        JSON.stringify(NOTES.manifest)
      );
      await writeFile(join(notes, "index.js"), NOTES.entry);
      const migrated = await nextly(["migrate"], root);
      expect(migrated.status, migrated.stderr).toBe(0);
      const before = await readFile(join(root, "nextly.config.ts"), "utf8");

      const without = await nextly(
        ["plugins", "add", "@acme/notes", "--skip-install"],
        root
      );
      expect(without.status).toBe(1);
      expect(without.stdout + without.stderr).toContain(
        "(PLUGIN_OPTION_MISSING)"
      );
      expect(await readFile(join(root, "nextly.config.ts"), "utf8")).toBe(
        before
      );

      const added = await nextly(
        [
          "plugins",
          "add",
          "@acme/notes",
          "--skip-install",
          "--option",
          "siteUrl=https://example.com",
        ],
        root
      );
      expect(added.status, added.stdout + added.stderr).toBe(0);
      const config = await readFile(join(root, "nextly.config.ts"), "utf8");
      expect(config).toContain(`import { notesPlugin } from "@acme/notes";`);
      expect(config).toContain(
        `plugins: [formBuilderPlugin, notesPlugin({ siteUrl: "https://example.com" })],`
      );
      const manifest = JSON.parse(
        await readFile(join(root, "package.json"), "utf8")
      ) as { scripts: { build: string } };
      expect(manifest.scripts.build).toBe(
        "nextly migrate && nextly plugins install @nextlyhq/plugin-form-builder && nextly plugins install @acme/notes && next build"
      );
      expect(recordedInstalls(root).join("\n")).toContain("@acme/notes");
    },
    NEXTLY_RUN_TIMEOUT * 4
  );
});
