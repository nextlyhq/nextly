/**
 * `generate:widget` without a build: the id it accepts, the registration edit
 * for each config shape (and the shapes it refuses to guess at), and the
 * command's run in a real temp directory, written, refused and dry.
 *
 * That the generated files type-check, boot and pass their own test is
 * `generate-widget.fixture.integration.test.ts`'s, in projects built from the
 * real templates.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registrationEdit } from "../generate-widget/config-edit";
import { widgetId, type WidgetTarget } from "../generate-widget/id";
import { runGenerateWidget, type WidgetPrompter } from "../generate-widget/run";

const site: WidgetTarget = {
  kind: "site",
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
});

describe("the registration edit", () => {
  const edit = (text: string, kind: "site" | "plugin" = "site") =>
    registrationEdit({
      file: "/app/nextly.config.ts",
      text,
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

  it("leaves a config it cannot read plainly as it was, and says what to add", () => {
    // Two `widgets: [` could be the dashboard's or a plugin option's.
    const twice =
      "defineConfig({ plugins: [shop({ widgets: [] })], admin: { dashboard: { widgets: [] } } })";
    expect(edit(twice)).toEqual({
      kind: "manual",
      instructions: expect.stringContaining(
        "list openOrders in admin.dashboard.widgets"
      ),
    });
    // No defineConfig call to anchor on at all.
    expect(edit("export default config;").kind).toBe("manual");
  });

  it("adds the import once, however often it runs", () => {
    const once = after("defineConfig({})");
    expect(once.split(IMPORT).length - 1).toBe(1);
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
  const asSite = () => writeFile(join(dir, "nextly.config.ts"), CONFIG);
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

  it("says where to edit, how to preview and how to run the test", async () => {
    await asSite();
    const result = await runGenerateWidget(dir, { id: "open-orders" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.nextSteps.join("\n")).toMatch(
      /src\/dashboard\/open-orders\.widget\.ts[\s\S]*\/admin\/dev\/widget-previews[\s\S]*vitest run src\/dashboard\/open-orders\.widget\.test\.ts/
    );
  });

  it("in a plugin, exports a component view from its admin entry", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "@acme/shop",
        keywords: ["nextly", "nextly-plugin"],
      })
    );
    await mkdir(join(dir, "src", "admin"), { recursive: true });
    await writeFile(
      join(dir, "src", "plugin.ts"),
      'import { definePlugin } from "@nextlyhq/plugin-sdk";\n\nexport const shop = () =>\n  definePlugin({\n    name: "@acme/shop",\n    contributes: {\n      collections: [],\n    },\n  });\n'
    );
    await writeFile(join(dir, "src", "admin", "index.ts"), "export {};\n");
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
    ).toContain('export { OpenOrdersCard } from "./open-orders";');
    expect(await readFile(join(dir, "src", "plugin.ts"), "utf8")).toContain(
      "dashboard: { widgets: [openOrders] },"
    );
  });
});
