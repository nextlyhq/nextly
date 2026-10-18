/**
 * A production boot refuses a configured plugin that has not been installed
 * on its database (PLUGIN_NOT_INSTALLED), so a scaffold's build script must
 * install every plugin its config registers, after migrating and before the
 * Next.js build, or the deployed app answers every request with a 500.
 *
 * Every config a template can give a project is checked, including any added
 * later, against a rule simpler than the generator's own: each plugin package
 * the config imports must be installed. So a template that gains a plugin its
 * build does not install fails here.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseConfig, ProjectType } from "../types";
import { configuredPlugins, generatePackageJson } from "../utils/template";

const TEMPLATES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates"
);

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

/**
 * Each config a template can copy into a project as its `nextly.config.ts`:
 * the template's own, and one per approach in its `configs/`. The plugin
 * template is a library whose build is `tsup`, with no production boot.
 */
async function templateConfigs(): Promise<
  { template: string; file: string }[]
> {
  const found: { template: string; file: string }[] = [];
  for (const template of await readdir(TEMPLATES)) {
    if (template === "plugin") continue;
    const dir = path.join(TEMPLATES, template);
    const names = await readdir(dir).catch(() => []);
    if (names.includes("nextly.config.ts")) {
      found.push({ template, file: path.join(dir, "nextly.config.ts") });
    }
    const configs = await readdir(path.join(dir, "configs")).catch(() => []);
    for (const name of configs.filter(name => name.endsWith(".config.ts"))) {
      found.push({ template, file: path.join(dir, "configs", name) });
    }
  }
  return found;
}

/** A template file's path under `templates/`, with `/` on every platform. */
const relative = (file: string) =>
  path.relative(TEMPLATES, file).split(path.sep).join("/");

/** Every plugin package a config imports, the SDK aside. */
const importedPlugins = (text: string) => [
  ...new Set(
    [...text.matchAll(/from\s+"(@nextlyhq\/plugin-[^"]+)"/g)]
      .map(found => found[1])
      .filter(pkg => pkg !== "@nextlyhq/plugin-sdk")
  ),
];

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** The build script a project scaffolded with `config` gets. */
async function buildScript(template: string, config: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "nextly-build-plugins-"));
  dirs.push(dir);
  await writeFile(path.join(dir, "nextly.config.ts"), config);
  const pkg = JSON.parse(
    await generatePackageJson(
      "app",
      sqlite,
      true,
      template as ProjectType,
      [],
      dir
    )
  );
  return String(pkg.scripts.build);
}

describe("a scaffold's build installs the plugins its config registers", () => {
  it("installs every plugin each template config imports, between migrating and building", async () => {
    const configs = await templateConfigs();
    expect(configs.length).toBeGreaterThan(1);

    const plugged: string[] = [];
    for (const { template, file } of configs) {
      const text = await readFile(file, "utf8");
      const steps = (await buildScript(template, text)).split(" && ");
      const installs = steps.filter(step =>
        step.startsWith("nextly plugins install ")
      );
      const wanted = importedPlugins(text);

      expect(installs, relative(file)).toEqual(
        wanted.map(pkg => `nextly plugins install ${pkg}`)
      );
      for (const install of installs) {
        expect(steps.indexOf(install)).toBeGreaterThan(
          steps.indexOf("nextly migrate")
        );
        expect(steps.indexOf(install)).toBeLessThan(
          steps.indexOf("next build")
        );
      }
      if (wanted.length > 0) plugged.push(relative(file));
    }
    // The blog's code-first config registers the form builder; if no config
    // registered a plugin, the check above would prove nothing.
    expect(plugged).toContain("blog/configs/codefirst.config.ts");
  });

  // The blog's visual config registers no plugin, and installing one it does
  // not configure would fail the build.
  it("installs nothing for a config that registers no plugin", async () => {
    const text = await readFile(
      path.join(TEMPLATES, "blog/configs/visual.config.ts"),
      "utf8"
    );
    expect(await buildScript("blog", text)).not.toContain("plugins install");
  });
});

describe("reading the plugins a config registers", () => {
  it("names a plugin imported and listed, under an alias too", () => {
    expect(
      configuredPlugins(
        'import { formBuilderPlugin as forms } from "@nextlyhq/plugin-form-builder";\nexport default defineConfig({ plugins: [forms] });\n'
      )
    ).toEqual(["@nextlyhq/plugin-form-builder"]);
  });

  // A bracket inside an element's options does not end the list, and either
  // quote and a default import are read as the compiler reads them.
  it("reads every plugin in a list with nested brackets, single quotes and a default import", () => {
    expect(
      configuredPlugins(
        [
          "import { formBuilderPlugin } from '@nextlyhq/plugin-form-builder';",
          'import seo from "@nextlyhq/plugin-seo";',
          "export default defineConfig({",
          '  plugins: [formBuilderPlugin({ fields: ["x"] }), seo()],',
          "});",
        ].join("\n")
      )
    ).toEqual(["@nextlyhq/plugin-form-builder", "@nextlyhq/plugin-seo"]);
  });

  // Read as no plugins, the build would install none the runtime registers,
  // so a list this cannot read in full stops the scaffold, naming the file.
  it.each([
    [
      "a variable",
      "const enabled = [formBuilderPlugin];\nexport default defineConfig({ plugins: enabled });",
    ],
    [
      "a call",
      "export default defineConfig({ plugins: list(formBuilderPlugin) });",
    ],
    [
      "a spread",
      "const base = [formBuilderPlugin];\nexport default defineConfig({ plugins: [...base] });",
    ],
  ])("refuses a plugins list held in %s, naming the file", (_how, body) => {
    expect(() =>
      configuredPlugins(
        `import { formBuilderPlugin } from "@nextlyhq/plugin-form-builder";\n${body}\n`,
        "templates/blog/configs/codefirst.config.ts"
      )
    ).toThrow(
      /^templates\/blog\/configs\/codefirst\.config\.ts sets `plugins` to something other than a list written in place/
    );
  });

  it("refuses a config it cannot parse", () => {
    expect(() => configuredPlugins("export default {")).toThrow();
  });

  it("leaves out a plugin imported but not listed, and the SDK", () => {
    expect(
      configuredPlugins(
        'import { formBuilderPlugin } from "@nextlyhq/plugin-form-builder";\nimport { definePlugin } from "@nextlyhq/plugin-sdk";\nexport default defineConfig({ plugins: [] });\n'
      )
    ).toEqual([]);
  });
});
