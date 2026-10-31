/**
 * `generate:widget` without a build: the id it accepts, the registration edit
 * for each config shape (and the shapes it refuses to guess at), and the
 * command's run in a real temp directory, written, refused and dry.
 *
 * That the generated files type-check, boot and pass their own test is
 * `generate-widget.fixture.integration.test.ts`'s, in projects built from the
 * real templates.
 */
import { readFileSync } from "node:fs";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

import { parse } from "@babel/parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminExportEdit } from "../generate-widget/admin-export";
import {
  registrationEdit,
  slashRelative,
} from "../generate-widget/config-edit";
import { testSource } from "../generate-widget/files";
import { widgetId, type WidgetTarget } from "../generate-widget/id";
import { runGenerateWidget, type WidgetPrompter } from "../generate-widget/run";

/** The version of the nextly these tests run, which the SDK it adds must match. */
const NEXTLY_VERSION = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, "../../../../package.json"), "utf8")
  ) as { version: string }
).version;

const site: WidgetTarget = {
  kind: "site",
  root: "/app",
  configPath: "/app/nextly.config.ts",
};
const plugin: WidgetTarget = {
  kind: "plugin",
  root: "/plugin",
  packageName: "@acme/nextly-plugin-shop",
};

describe("the widget id", () => {
  it("places a bare name in the target's namespace", () => {
    expect(widgetId("open-orders", site)).toMatchObject({
      ok: true,
      id: "site/open-orders",
    });
    expect(widgetId("open-orders", plugin)).toMatchObject({
      ok: true,
      id: "nextly-plugin-shop/open-orders",
    });
  });

  it("refuses another namespace, naming the one to use", () => {
    const answer = widgetId("acme/open-orders", site);
    expect(answer).toEqual({
      ok: false,
      reason: expect.stringContaining('use "site/open-orders"'),
    });
  });

  it("refuses core's namespaces and a malformed id, explaining the form", () => {
    expect(widgetId("core/open-orders", site)).toMatchObject({ ok: false });
    expect(widgetId("Open Orders", site)).toEqual({
      ok: false,
      reason: expect.stringContaining("<namespace>/<name>"),
    });
  });

  it("refuses a name whose code would not be a TypeScript identifier", () => {
    expect(widgetId("2026-sales", site)).toEqual({
      ok: false,
      reason: expect.stringContaining('"2026Sales"'),
    });
    expect(widgetId("default", site)).toEqual({
      ok: false,
      reason: expect.stringContaining("reserved word"),
    });
    expect(widgetId("sales-2026", site)).toMatchObject({ ok: true });
  });

  it("gives a plugin named after a reserved namespace its scope in front, and says so", () => {
    for (const reserved of ["core", "collection", "single", "site"]) {
      const named: WidgetTarget = {
        kind: "plugin",
        root: "/plugin",
        packageName: `@acme/${reserved}`,
      };
      expect(widgetId("open-orders", named)).toMatchObject({
        ok: true,
        id: `acme-${reserved}/open-orders`,
      });
      const refused = widgetId(`${reserved}/open-orders`, named);
      if (refused.ok) throw new Error(`${reserved}/ was accepted`);
      expect(refused.reason).toContain(`use "acme-${reserved}/open-orders"`);
      expect(refused.reason).toContain(`"${reserved}", is reserved`);
    }
  });
});

describe("the registration edit", () => {
  const edit = (text: string, kind: "site" | "plugin" = "site") =>
    registrationEdit({
      file: "/app/nextly.config.ts",
      text,
      parser: parse,
      kind,
      exportName: "openOrders",
      declarationPath: "/app/src/dashboard/open-orders.widget.ts",
    });
  const after = (text: string, kind?: "site" | "plugin") => {
    const answer = edit(text, kind);
    if (answer.kind !== "edit") throw new Error(answer.instructions);
    return answer.edits[0]!.after;
  };
  const IMPORT =
    'import { openOrders } from "./src/dashboard/open-orders.widget";';

  it("adds the admin block to a config that has none", () => {
    const text =
      'import { defineConfig } from "nextly/config";\n\nexport default defineConfig({\n  collections: [],\n});\n';
    const result = after(text);
    expect(result).toContain(IMPORT);
    expect(result).toContain(
      "admin: { dashboard: { widgets: [openOrders] } },"
    );
  });

  it("adds to each level the config already has", () => {
    expect(after("defineConfig({ admin: { brand: 1 } })")).toContain(
      "dashboard: { widgets: [openOrders] },"
    );
    expect(
      after("defineConfig({ admin: { dashboard: { defaultLayout: [] } } })")
    ).toContain("widgets: [openOrders],");
    expect(
      after("defineConfig({ admin: { dashboard: { widgets: [notes] } } })")
    ).toMatch(/widgets: \[\n\s+openOrders,notes\]/);
  });

  it("lists a plugin's widget under its contributions", () => {
    expect(
      after("definePlugin({ contributes: { collections: [] } })", "plugin")
    ).toContain("dashboard: { widgets: [openOrders] },");
  });

  it("lists it under defineConfig's own admin, never in a plugin option's widgets", () => {
    const pluginOption =
      "defineConfig({\n  plugins: [shop({ widgets: [] })],\n  collections: [],\n})";
    const result = after(pluginOption);
    expect(result).toContain("shop({ widgets: [] })");
    expect(result).toContain(
      "defineConfig({\n  admin: { dashboard: { widgets: [openOrders] } },"
    );
    // With the site's own list there too, that list is the one it reaches.
    expect(
      after(
        "defineConfig({ plugins: [shop({ widgets: [] })], admin: { dashboard: { widgets: [] } } })"
      )
    ).toMatch(
      /shop\(\{ widgets: \[\] \}\)[\s\S]*widgets: \[\n\s+openOrders,\]/
    );
  });

  it("leaves a config whose shape it cannot prove as it was, and says what to add", () => {
    for (const text of [
      // The admin block is a variable's.
      "defineConfig({ admin: adminOptions })",
      // A spread could already carry an admin block.
      "defineConfig({ ...base, collections: [] })",
      // A method, not a plain value, gives the admin block.
      "defineConfig({ admin() { return {}; } })",
      // Two configs: which one is the site's?
      "const a = defineConfig({}); const b = defineConfig({});",
      // No defineConfig call at all, or not one this file can parse.
      "export default config;",
      "defineConfig({ admin: { dashboard: { widgets: [ } } })",
    ]) {
      expect(edit(text), text).toEqual({
        kind: "manual",
        instructions: expect.stringContaining(
          "list openOrders in admin.dashboard.widgets"
        ),
      });
    }
  });

  it("says it could not read a file that does not parse, and leaves it as it was", () => {
    expect(
      edit("defineConfig({ admin: { dashboard: { widgets: [ } } })")
    ).toEqual({
      kind: "manual",
      instructions: expect.stringMatching(
        /^Could not read \/app\/nextly\.config\.ts \(.+\), so it was left as it was\. In it, add\n/
      ),
    });
  });

  it("reads TypeScript and JSX in a config as written", () => {
    const typed =
      'import type { Config } from "nextly";\nconst brand = (name: string) => <b>{name}</b>;\nexport default defineConfig({ admin: { brand } } satisfies Config);';
    // `satisfies` wraps the object: not a literal it may edit, but a file it read.
    expect(edit(typed)).toEqual({
      kind: "manual",
      instructions: expect.stringMatching(/^In \/app\/nextly\.config\.ts, add/),
    });
    expect(
      after(
        "const brand = (name: string): string => name;\ndefineConfig<Options>({ collections: [] as string[] })"
      )
    ).toContain("admin: { dashboard: { widgets: [openOrders] } },");
  });

  it("leaves a widget it already lists where it is", () => {
    const listed =
      'import { openOrders } from "./src/dashboard/open-orders.widget";\ndefineConfig({ admin: { dashboard: { widgets: [notes, openOrders] } } })';
    expect(after(listed)).toBe(listed);
  });

  it("reuses an import of the widget however it is written, and refuses a clashing one", () => {
    // Single quotes, a `.js` extension and other names beside it: the same import.
    const formatted =
      "import { notes, openOrders } from './src/dashboard/open-orders.widget.js';\ndefineConfig({ admin: { dashboard: { widgets: [notes] } } })";
    const result = after(formatted);
    expect(result.match(/\bopenOrders\b/g)).toHaveLength(2);
    expect(result).toMatch(/widgets: \[\n\s+openOrders,notes\]/);
    // The name taken by an import from somewhere else: left for the author.
    expect(
      edit(
        "import { openOrders } from './orders';\ndefineConfig({ collections: [] })"
      )
    ).toEqual({
      kind: "manual",
      instructions: expect.stringContaining(
        'openOrders is already imported from "./orders"'
      ),
    });
  });

  it("leaves a config that declares the widget's name itself as it was", () => {
    for (const text of [
      "const openOrders = defineCollection({ slug: 'orders' });\ndefineConfig({ collections: [openOrders] })",
      "export const openOrders = 1;\ndefineConfig({})",
      "const { openOrders } = presets;\ndefineConfig({})",
      "const [, { list: [openOrders] }] = presets;\ndefineConfig({})",
      "function openOrders() {}\ndefineConfig({})",
      "type openOrders = string;\ndefineConfig({})",
    ]) {
      expect(edit(text), text).toEqual({
        kind: "manual",
        instructions: expect.stringContaining(
          "openOrders is already declared, so it was left as it was. Import the widget under another name:"
        ),
      });
    }
    // A reference is not a declaration: the config is edited as usual.
    expect(after("defineConfig({});\nexport default openOrders;")).toContain(
      IMPORT
    );
  });

  it("reuses only the named import the generated declaration has, never a default or an alias of it", () => {
    for (const binding of [
      "openOrders",
      "{ legacyOrders as openOrders }",
      "* as openOrders",
      "type { openOrders }",
      "{ type openOrders }",
    ]) {
      const text = `import ${binding} from "./src/dashboard/open-orders.widget";\ndefineConfig({ admin: { dashboard: { widgets: [openOrders] } } })`;
      expect(edit(text), text).toEqual({
        kind: "manual",
        instructions: expect.stringContaining(
          `openOrders is imported from "./src/dashboard/open-orders.widget", but not as the named export openOrders the generated declaration has, so it was left as it was. Import it by that name instead:\n  ${IMPORT}`
        ),
      });
    }
    // The named import itself, aliased to its own name, is the one it needs.
    const own = `import { openOrders as openOrders } from "./src/dashboard/open-orders.widget";\ndefineConfig({ admin: { dashboard: { widgets: [openOrders] } } })`;
    expect(after(own)).toBe(own);
  });

  it("adds the import once, however often it runs", () => {
    const once = after("defineConfig({})");
    expect(once.split(IMPORT).length - 1).toBe(1);
  });
});

describe("the admin entry's export of a plugin's card", () => {
  const FILE = "/plugin/src/admin/index.ts";
  const LINE = 'export { OpenOrdersCard } from "./open-orders-card";';
  const exportEdit = (text: string) =>
    adminExportEdit({
      file: FILE,
      text,
      parser: parse,
      exportName: "OpenOrdersCard",
      componentPath: "/plugin/src/admin/open-orders-card.tsx",
    });

  it("adds the export to an entry without it", () => {
    expect(exportEdit("export {};\n")).toEqual({
      kind: "edit",
      edit: {
        path: FILE,
        before: "export {};\n",
        after: `export {};\n${LINE}\n`,
      },
    });
  });

  it("keeps the card's export however it is written", () => {
    for (const text of [
      LINE,
      "export { OpenOrdersCard } from './open-orders-card.js';\n",
      "export {\n  NotesCard,\n  OpenOrdersCard,\n} from './open-orders-card'\n",
    ]) {
      const answer = exportEdit(text);
      expect(answer, text).toEqual({
        kind: "edit",
        edit: { path: FILE, before: text, after: text },
      });
    }
  });

  it("leaves an entry that exports the name from anything else as it was, and says why", () => {
    for (const [text, from] of [
      [
        'export { OpenOrdersCard } from "./legacy-card";\n',
        'from "./legacy-card"',
      ],
      [
        'export { Old as OpenOrdersCard } from "./open-orders-card";\n',
        'from "./open-orders-card"',
      ],
      [
        'export * as OpenOrdersCard from "./open-orders-card";\n',
        'from "./open-orders-card"',
      ],
      [
        "export const OpenOrdersCard = () => null;\n",
        "by a declaration of its own",
      ],
      [
        'import { Card } from "./card";\nexport { Card as OpenOrdersCard };\n',
        "by the file itself",
      ],
    ] as const) {
      expect(exportEdit(text), text).toEqual({
        kind: "manual",
        instructions: `In ${FILE}, OpenOrdersCard is already exported ${from}, so it was left as it was. The dashboard loads the card by that name: free it, then add\n  ${LINE}`,
      });
    }
  });
});

describe("the project paths it prints and writes", () => {
  it("spells them with forward slashes on Windows too", () => {
    // Windows' own path syntax, so the separator it prints is tested here.
    expect(
      slashRelative(
        "C:\\app",
        "C:\\app\\src\\dashboard\\open-orders.widget.test.ts",
        win32
      )
    ).toBe("src/dashboard/open-orders.widget.test.ts");
    expect(
      slashRelative(
        "C:\\plugin\\src\\admin",
        "C:\\plugin\\src\\widgets\\open-orders.widget.ts",
        win32
      )
    ).toBe("../widgets/open-orders.widget.ts");
    // And this system's, which the command uses when given none.
    expect(
      slashRelative("/app", "/app/src/dashboard/open-orders.widget.ts")
    ).toBe("src/dashboard/open-orders.widget.ts");
  });
});

describe("the test it writes", () => {
  const plan = (view: "figure" | "component", collection: boolean) => ({
    id: "site/open-orders",
    name: "open-orders",
    view,
    collection,
    target: site,
  });

  it("for a collection, stores an entry and asks the load for what it reads", () => {
    const text = testSource(plan("figure", true));
    expect(text).toContain('slug: "articles",');
    expect(text).toContain(
      'await t.nextly.create({ collection: "articles", data: { title: "First entry", stage: "draft" } });'
    );
    expect(text).toContain('settings: { collection: "articles" }');
    expect(text).toContain(
      'expect(answer).toMatchObject({ state: "ready", data: { total: 1 } });'
    );
  });

  it("for a component view, draws the card with the component it wrote", () => {
    const text = testSource(plan("component", false));
    expect(text).toContain(
      'import { OpenOrdersCard } from "./open-orders-card";'
    );
    expect(text).toContain("component: OpenOrdersCard,");
    expect(text).toContain(
      'expect(html).toContain("<li>Ship the release notes</li>");'
    );
  });
});

describe("running the command", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nextly-generate-widget-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const CONFIG =
    'import { defineConfig } from "nextly/config";\n\nexport default defineConfig({\n  collections: [],\n});\n';
  // A site's manifest as the blank scaffold writes it: nextly, no SDK.
  const MANIFEST = `${JSON.stringify(
    { name: "app", dependencies: { nextly: NEXTLY_VERSION } },
    null,
    4
  )}\n`;
  const asSite = async () => {
    await writeFile(join(dir, "nextly.config.ts"), CONFIG);
    await writeFile(join(dir, "package.json"), MANIFEST);
  };
  const exists = (path: string) =>
    access(path).then(
      () => true,
      () => false
    );
  const declaration = () =>
    join(dir, "src", "dashboard", "open-orders.widget.ts");

  it("writes a figure, its test, and lists it in the site config", async () => {
    await asSite();
    const result = await runGenerateWidget(dir, { id: "open-orders" });
    expect(result).toMatchObject({ ok: true, written: true, manual: [] });
    expect(await readFile(declaration(), "utf8")).toContain('view: "figure"');
    expect(
      await readFile(
        join(dir, "src", "dashboard", "open-orders.widget.test.ts"),
        "utf8"
      )
    ).toContain("runWidgetLoad(t, openOrders");
    expect(await readFile(join(dir, "nextly.config.ts"), "utf8")).toContain(
      "widgets: [openOrders]"
    );
  });

  it("writes nothing over a file that exists, and names it", async () => {
    await asSite();
    await runGenerateWidget(dir, { id: "open-orders" });
    await writeFile(declaration(), "// mine\n");
    const configBefore = await readFile(join(dir, "nextly.config.ts"), "utf8");
    const result = await runGenerateWidget(dir, {
      id: "open-orders",
      view: "list",
    });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining(declaration()),
    });
    expect(await readFile(declaration(), "utf8")).toBe("// mine\n");
    expect(await readFile(join(dir, "nextly.config.ts"), "utf8")).toBe(
      configBefore
    );
  });

  it("overwrites them with --force", async () => {
    await asSite();
    await runGenerateWidget(dir, { id: "open-orders" });
    await writeFile(declaration(), "// mine\n");
    await runGenerateWidget(dir, {
      id: "open-orders",
      view: "list",
      force: true,
    });
    expect(await readFile(declaration(), "utf8")).toContain('view: "list"');
  });

  it("lists a widget generated again with --force once, and edits nothing else", async () => {
    await asSite();
    await runGenerateWidget(dir, { id: "open-orders" });
    const config = await readFile(join(dir, "nextly.config.ts"), "utf8");
    const manifest = await readFile(join(dir, "package.json"), "utf8");
    const again = await runGenerateWidget(dir, {
      id: "open-orders",
      force: true,
    });
    expect(again).toMatchObject({ ok: true, edits: [], manual: [] });
    expect(await readFile(join(dir, "nextly.config.ts"), "utf8")).toBe(config);
    expect(await readFile(join(dir, "package.json"), "utf8")).toBe(manifest);
    // Its import and its one place in the list.
    expect(config.match(/\bopenOrders\b/g)).toHaveLength(2);
  });

  it("generates again with --force over a config its formatter rewrote, adding nothing", async () => {
    await asSite();
    await runGenerateWidget(dir, { id: "open-orders" });
    const configFile = join(dir, "nextly.config.ts");
    // As a formatter preferring single quotes leaves it.
    const formatted = (await readFile(configFile, "utf8")).replaceAll('"', "'");
    await writeFile(configFile, formatted);
    const again = await runGenerateWidget(dir, {
      id: "open-orders",
      force: true,
    });
    expect(again).toMatchObject({ ok: true, edits: [] });
    expect(await readFile(configFile, "utf8")).toBe(formatted);
  });

  it("edits the config the root CLI's --config names", async () => {
    await asSite();
    await mkdir(join(dir, "conf"), { recursive: true });
    await writeFile(join(dir, "conf", "site.config.ts"), CONFIG);
    const result = await runGenerateWidget(dir, {
      id: "open-orders",
      configPath: "conf/site.config.ts",
    });
    if (!result.ok) throw new Error(result.reason);
    expect(
      await readFile(join(dir, "conf", "site.config.ts"), "utf8")
    ).toContain("widgets: [openOrders]");
    // The config the search would have found is not the one it edits.
    expect(await readFile(join(dir, "nextly.config.ts"), "utf8")).toBe(CONFIG);
    expect(
      await runGenerateWidget(dir, {
        id: "open-orders",
        configPath: "conf/missing.config.ts",
      })
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("which --config names"),
    });
  });

  it("refuses a --config outside the project, through a link or not, and writes nothing", async () => {
    await asSite();
    const outside = await mkdtemp(
      join(tmpdir(), "nextly-generate-widget-other-")
    );
    try {
      await writeFile(join(outside, "nextly.config.ts"), CONFIG);
      await symlink(
        join(outside, "nextly.config.ts"),
        join(dir, "linked.config.ts")
      );
      for (const configPath of [
        join(outside, "nextly.config.ts"),
        "linked.config.ts",
      ]) {
        expect(
          await runGenerateWidget(dir, { id: "open-orders", configPath }),
          configPath
        ).toEqual({
          ok: false,
          reason: expect.stringContaining(
            `which is outside this project (${dir})`
          ),
        });
      }
      expect(await readFile(join(outside, "nextly.config.ts"), "utf8")).toBe(
        CONFIG
      );
      expect(await exists(join(outside, "src"))).toBe(false);
      expect(await exists(join(dir, "src"))).toBe(false);
      expect(await readFile(join(dir, "package.json"), "utf8")).toBe(MANIFEST);
      // A link that stays inside the project is followed.
      await symlink(join(dir, "nextly.config.ts"), join(dir, "here.config.ts"));
      expect(
        await runGenerateWidget(dir, {
          id: "open-orders",
          configPath: "here.config.ts",
        })
      ).toMatchObject({ ok: true });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses to switch a widget between its own component and a core view with --force, naming what to remove", async () => {
    await asPlugin();
    await runGenerateWidget(dir, { id: "open-orders", view: "component" });
    const component = join(dir, "src", "admin", "open-orders-card.tsx");
    const declarationFile = join(
      dir,
      "src",
      "widgets",
      "open-orders.widget.ts"
    );
    const before = await readFile(declarationFile, "utf8");
    const toFigure = await runGenerateWidget(dir, {
      id: "open-orders",
      view: "figure",
      force: true,
    });
    expect(toFigure).toEqual({
      ok: false,
      reason: expect.stringContaining(
        `remove ${component} and the line \`export { OpenOrdersCard } from "./open-orders-card";\` in ${join(dir, "src", "admin", "index.ts")} first`
      ),
    });
    // Nothing removed or rewritten for the author.
    expect(await exists(component)).toBe(true);
    expect(await readFile(declarationFile, "utf8")).toBe(before);
    // And the other way: a core view rewritten around a component.
    await runGenerateWidget(dir, { id: "closed-orders", view: "figure" });
    expect(
      await runGenerateWidget(dir, {
        id: "closed-orders",
        view: "component",
        force: true,
      })
    ).toEqual({
      ok: false,
      reason: expect.stringContaining(
        `remove ${join(dir, "src", "widgets", "closed-orders.widget.ts")} and ${join(dir, "src", "widgets", "closed-orders.widget.test.ts")} first`
      ),
    });
  });

  it("adds the SDK and the SQLite adapter its test needs to a site without them, at nextly's version, and says to install", async () => {
    await asSite();
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const result = await runGenerateWidget(dir, { id: "open-orders" });
    if (!result.ok) throw new Error(result.reason);
    const manifest = await readFile(join(dir, "package.json"), "utf8");
    // The file's own four-space indentation, and the rest of it as it was.
    expect(manifest).toBe(
      `${JSON.stringify(
        {
          name: "app",
          dependencies: { nextly: NEXTLY_VERSION },
          devDependencies: {
            "@nextlyhq/plugin-sdk": NEXTLY_VERSION,
            "@nextlyhq/adapter-sqlite": NEXTLY_VERSION,
          },
        },
        null,
        4
      )}\n`
    );
    expect(result.nextSteps[0]).toBe(
      "Install what it added to package.json (@nextlyhq/plugin-sdk, @nextlyhq/adapter-sqlite): pnpm install"
    );
  });

  it("adds the SQLite adapter its test boots on to a site on PostgreSQL", async () => {
    await asSite();
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "app",
        dependencies: {
          nextly: NEXTLY_VERSION,
          "@nextlyhq/adapter-postgres": NEXTLY_VERSION,
          "@nextlyhq/plugin-sdk": NEXTLY_VERSION,
        },
      })
    );
    const result = await runGenerateWidget(dir, { id: "open-orders" });
    if (!result.ok) throw new Error(result.reason);
    const manifest = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8")
    ) as { devDependencies?: Record<string, string> };
    expect(manifest.devDependencies).toEqual({
      "@nextlyhq/adapter-sqlite": NEXTLY_VERSION,
    });
    expect(result.nextSteps[0]).toContain(
      "Install what it added to package.json (@nextlyhq/adapter-sqlite): "
    );
  });

  it("leaves a manifest that already has what the test needs alone", async () => {
    await asSite();
    const withSdk = `${JSON.stringify({ name: "app", devDependencies: { "@nextlyhq/plugin-sdk": "1.0.0", "@nextlyhq/adapter-sqlite": "1.0.0" } }, null, 2)}\n`;
    await writeFile(join(dir, "package.json"), withSdk);
    const result = await runGenerateWidget(dir, { id: "open-orders" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.edits.map(edit => edit.path)).toEqual([
      join(dir, "nextly.config.ts"),
    ]);
    expect(await readFile(join(dir, "package.json"), "utf8")).toBe(withSdk);
    expect(result.nextSteps.join("\n")).not.toContain("Install what it added");
  });

  it("writes nothing on a dry run, and shows what it would", async () => {
    await asSite();
    const result = await runGenerateWidget(dir, {
      id: "open-orders",
      dryRun: true,
    });
    expect(result).toMatchObject({ ok: true, written: false });
    if (!result.ok) return;
    expect(result.files.map(f => f.path)).toContain(declaration());
    expect(result.edits[0]!.after).toContain("widgets: [openOrders]");
    expect(await readFile(join(dir, "nextly.config.ts"), "utf8")).toBe(CONFIG);
    await expect(readFile(declaration(), "utf8")).rejects.toThrow();
  });

  it("on a dry run, says what it would add to package.json rather than to install what it added", async () => {
    await asSite();
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const result = await runGenerateWidget(dir, {
      id: "open-orders",
      dryRun: true,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(await readFile(join(dir, "package.json"), "utf8")).toBe(MANIFEST);
    expect(result.nextSteps[0]).toBe(
      "Run it without --dry-run to add @nextlyhq/plugin-sdk, @nextlyhq/adapter-sqlite to package.json, then install them: pnpm install"
    );
    expect(result.nextSteps.join("\n")).not.toContain("Install what it added");
  });

  it("asks for what the flags left out on a terminal, and only then", async () => {
    await asSite();
    const prompter: WidgetPrompter = {
      id: vi.fn(async () => "open-orders"),
      view: vi.fn(async () => "bars" as const),
      collection: vi.fn(async () => true),
    };
    await runGenerateWidget(dir, {}, prompter);
    const text = await readFile(declaration(), "utf8");
    expect(text).toContain('view: "bars"');
    expect(text).toContain('setting.collection({ label: "Collection" })');
    // Off a terminal there is no one to ask: a missing id is named.
    expect(await runGenerateWidget(dir, {})).toEqual({
      ok: false,
      reason: expect.stringContaining(
        "nextly generate:widget <namespace>/<name>"
      ),
    });
  });

  it("names the views it can write when given another", async () => {
    await asSite();
    expect(
      await runGenerateWidget(dir, { id: "open-orders", view: "pie" })
    ).toEqual({
      ok: false,
      reason: expect.stringContaining(
        "figure, list, table, bars, series, component"
      ),
    });
  });

  it("prints paths from where it ran, with a config in src/", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "nextly.config.ts"), CONFIG);
    await writeFile(join(dir, "package.json"), MANIFEST);
    await mkdir(join(dir, "node_modules", "vitest"), { recursive: true });
    const result = await runGenerateWidget(dir, { id: "open-orders" });
    if (!result.ok) throw new Error(result.reason);
    const run = result.nextSteps.find(step => step.startsWith("Run its test"));
    // Vitest is found in the project the command ran in, and the path it
    // prints is the generated test's, from there.
    const printed = /^Run its test: npx vitest run (\S+)$/.exec(run ?? "")?.[1];
    expect(printed, run).toBeDefined();
    expect(await exists(join(dir, printed!))).toBe(true);
    expect(printed!.endsWith("open-orders.widget.test.ts")).toBe(true);
  });

  it("says where to edit, how to preview and how to run the test", async () => {
    await asSite();
    const result = await runGenerateWidget(dir, { id: "open-orders" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.nextSteps.join("\n")).toMatch(
      /src\/dashboard\/open-orders\.widget\.ts[\s\S]*\/admin\/dev\/widget-previews[\s\S]*vitest run src\/dashboard\/open-orders\.widget\.test\.ts/
    );
  });

  // A plugin as its scaffold writes one: the SDK among its devDependencies.
  const asPlugin = async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "@acme/shop",
        keywords: ["nextly", "nextly-plugin"],
        devDependencies: {
          "@nextlyhq/plugin-sdk": NEXTLY_VERSION,
          "@nextlyhq/adapter-sqlite": NEXTLY_VERSION,
        },
      })
    );
    await mkdir(join(dir, "src", "admin"), { recursive: true });
    await writeFile(
      join(dir, "src", "plugin.ts"),
      'import { definePlugin } from "@nextlyhq/plugin-sdk";\n\nexport const shop = () =>\n  definePlugin({\n    name: "@acme/shop",\n    contributes: {\n      collections: [],\n    },\n  });\n'
    );
    await writeFile(join(dir, "src", "admin", "index.ts"), "export {};\n");
  };

  it("in a plugin, exports a component view from its admin entry", async () => {
    await asPlugin();
    const result = await runGenerateWidget(dir, {
      id: "open-orders",
      view: "component",
    });
    expect(result).toMatchObject({ ok: true, manual: [] });
    expect(
      await readFile(
        join(dir, "src", "widgets", "open-orders.widget.ts"),
        "utf8"
      )
    ).toContain('component: "@acme/shop/admin#OpenOrdersCard"');
    expect(
      await readFile(join(dir, "src", "admin", "index.ts"), "utf8")
    ).toContain('export { OpenOrdersCard } from "./open-orders-card";');
    expect(await readFile(join(dir, "src", "plugin.ts"), "utf8")).toContain(
      "dashboard: { widgets: [openOrders] },"
    );
  });

  it("generates a component again with --force over an admin entry its formatter rewrote, adding nothing", async () => {
    await asPlugin();
    await runGenerateWidget(dir, { id: "open-orders", view: "component" });
    const index = join(dir, "src", "admin", "index.ts");
    const formatted = (await readFile(index, "utf8")).replaceAll('"', "'");
    await writeFile(index, formatted);
    const again = await runGenerateWidget(dir, {
      id: "open-orders",
      view: "component",
      force: true,
    });
    expect(again).toMatchObject({ ok: true, edits: [], manual: [] });
    expect(await readFile(index, "utf8")).toBe(formatted);
  });

  it("leaves an admin entry exporting the card's name from another module as it was, and says what to do", async () => {
    await asPlugin();
    const index = join(dir, "src", "admin", "index.ts");
    const taken = 'export { OpenOrdersCard } from "./legacy-card";\n';
    await writeFile(index, taken);
    const result = await runGenerateWidget(dir, {
      id: "open-orders",
      view: "component",
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.manual).toEqual([
      expect.stringContaining(
        'OpenOrdersCard is already exported from "./legacy-card", so it was left as it was.'
      ),
    ]);
    expect(await readFile(index, "utf8")).toBe(taken);
  });

  it("never names a plugin's component after a module beside it", async () => {
    await asPlugin();
    // A component named `index` would be imported from "./index", which is the
    // admin entry itself; the card has a name of its own.
    const result = await runGenerateWidget(dir, {
      id: "index",
      view: "component",
    });
    if (!result.ok) throw new Error(result.reason);
    expect(await exists(join(dir, "src", "admin", "index-card.tsx"))).toBe(
      true
    );
    expect(
      await readFile(join(dir, "src", "admin", "index.ts"), "utf8")
    ).toContain('export { IndexCard } from "./index-card";');
    // A module already holding the card's name would still win its import.
    await writeFile(join(dir, "src", "admin", "open-orders-card.ts"), "");
    expect(
      await runGenerateWidget(dir, {
        id: "open-orders",
        view: "component",
        force: true,
      })
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("open-orders-card.ts would be imported"),
    });
  });
});
