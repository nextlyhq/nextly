/**
 * The files `generate:widget` writes: a declaration, a component for a view of
 * the widget's own, and a test, each complete enough to type-check, pass the
 * startup checks and draw with no edits.
 *
 * Each view kind is described once (`VIEWS`): the data a card of it draws
 * from, how a load reads that data from a collection, and its preview case.
 * The declaration, the component and the test are built from that one
 * description, so the three never disagree about the data.
 *
 * @module cli/commands/generate-widget/files
 */
import type { WidgetTarget } from "./id";

/** The views a scaffold can declare: core's five and a component of its own. */
export const WIDGET_VIEW_KINDS = [
  "figure",
  "list",
  "table",
  "bars",
  "series",
  "component",
] as const;

export type WidgetViewKind = (typeof WIDGET_VIEW_KINDS)[number];

export const isWidgetViewKind = (value: unknown): value is WidgetViewKind =>
  typeof value === "string" &&
  (WIDGET_VIEW_KINDS as readonly string[]).includes(value);

interface ViewSource {
  /** Sample data, as a TypeScript expression: the preview case and a static load. */
  sample: string;
  /** The load's body when it reads `settings.collection` through `services`. */
  fromCollection: string;
  /** What the card's title says the widget shows. */
  noun: string;
}

const VIEWS: Record<WidgetViewKind, ViewSource> = {
  figure: {
    sample: "{ total: 42 }",
    fromCollection:
      "return { total: await services.count(settings.collection) };",
    noun: "a number",
  },
  list: {
    sample: '{ items: [{ title: "First entry" }, { title: "Second entry" }] }',
    fromCollection:
      'const { items } = await services.find(settings.collection, { sort: "-createdAt", limit: 5 });\n    return { items };',
    noun: "a list",
  },
  table: {
    sample:
      '{ items: [{ title: "First entry", status: "published" }, { title: "Second entry", status: "draft" }] }',
    fromCollection:
      'const { items } = await services.find(settings.collection, { sort: "-createdAt", limit: 5 });\n    return { items };',
    noun: "a table",
  },
  bars: {
    sample:
      '{ buckets: [{ value: "draft", count: 3 }, { value: "published", count: 8 }] }',
    fromCollection:
      "const { buckets } = await services.groupBy(settings.collection);\n    return { buckets: [...buckets] };",
    noun: "bars",
  },
  series: {
    sample:
      '{ interval: "day" as const, points: [{ start: "2026-01-01", count: 2 }, { start: "2026-01-02", count: 5 }] }',
    fromCollection:
      'const { points, interval } = await services.timeseries(settings.collection, { range: "30d" });\n    return { points: [...points], interval };',
    noun: "a series",
  },
  component: {
    sample: '{ notes: ["Ship the release notes"] }',
    fromCollection:
      'const { items } = await services.find(settings.collection, { sort: "-createdAt", limit: 5 });\n    return { notes: items.map(item => String(item.title ?? item.id)) };',
    noun: "notes",
  },
};

export interface WidgetPlan {
  id: string;
  /** The id's name part, which names the files. */
  name: string;
  view: WidgetViewKind;
  /** Whether the widget reads from a collection the reader chooses. */
  collection: boolean;
  target: WidgetTarget;
}

/** `open-orders` → `OpenOrders`. */
function pascalCase(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** `open-orders` → `openOrders`. */
export function camelCase(name: string): string {
  const pascal = pascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** `open-orders` → `Open orders`. */
function titleOf(name: string): string {
  const words = name.split("-").filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the package a widget is declared with is called in each target. */
function sdkModule(target: WidgetTarget): string {
  return target.kind === "site" ? "nextly" : "@nextlyhq/plugin-sdk";
}

/** The component's name and where the declaration says to find it. */
export function componentRef(plan: WidgetPlan): {
  exportName: string;
  path: string;
} {
  const exportName = `${pascalCase(plan.name)}Card`;
  return plan.target.kind === "site"
    ? { exportName, path: `./src/dashboard/${plan.name}#${exportName}` }
    : {
        exportName,
        path: `${plan.target.packageName}/admin#${exportName}`,
      };
}

function loadBody(plan: WidgetPlan, source: ViewSource): string {
  return plan.collection
    ? `async ({ settings, services }) => {\n    ${source.fromCollection}\n  }`
    : `async () => (${source.sample})`;
}

/** The declaration file's source. */
export function declarationSource(plan: WidgetPlan): string {
  const source = VIEWS[plan.view];
  const exported = camelCase(plan.name);
  const imports = plan.collection
    ? `import { defineWidget, setting } from "${sdkModule(plan.target)}";`
    : `import { defineWidget } from "${sdkModule(plan.target)}";`;
  const view =
    plan.view === "component"
      ? `{ component: "${componentRef(plan).path}" }`
      : `"${plan.view}"`;
  const lines = [
    imports,
    "",
    `/** ${titleOf(plan.name)}: generated by \`nextly generate:widget\`; make it yours. */`,
    `export const ${exported} = defineWidget({`,
    `  id: "${plan.id}",`,
    `  title: "${titleOf(plan.name)}",`,
    `  description: "Shows ${source.noun} on the dashboard.",`,
    "  size: { default: { w: 6, h: 3 } },",
    ...(plan.collection
      ? [
          '  settings: { collection: setting.collection({ label: "Collection" }) },',
        ]
      : []),
    `  load: ${loadBody(plan, source)},`,
    `  view: ${view},`,
    ...(plan.view === "component"
      ? ["  isEmpty: data => data.notes.length === 0,"]
      : []),
    "  // What the development preview page draws the card's ready state from.",
    `  preview: [{ name: "Sample", data: ${source.sample} }],`,
    "});",
    "",
  ];
  return lines.join("\n");
}

/** The component file's source, for `--view component`. */
export function componentSource(plan: WidgetPlan): string {
  const { exportName } = componentRef(plan);
  const declaration =
    plan.target.kind === "site"
      ? `./${plan.name}.widget`
      : `../widgets/${plan.name}.widget`;
  return [
    '"use client";',
    "",
    'import type { WidgetProps } from "@nextlyhq/plugin-sdk/widgets";',
    "",
    `import type { ${camelCase(plan.name)} } from "${declaration}";`,
    "",
    `/** Draws ${titleOf(plan.name).toLowerCase()}: the data its load answered. */`,
    `export function ${exportName}({ data }: WidgetProps<typeof ${camelCase(plan.name)}>) {`,
    "  return (",
    "    <ul>",
    "      {data.notes.map(note => (",
    "        <li key={note}>{note}</li>",
    "      ))}",
    "    </ul>",
    "  );",
    "}",
    "",
  ].join("\n");
}

/**
 * The test file's source: the load answered as the instance's administrator,
 * through the dashboard's own route, and the card drawn in the admin's frame.
 *
 * It boots the widget the way a site config declares it (`widgets`), whoever
 * ships it, so a plugin's test needs no host config. It draws with
 * `react-dom/server`, which every target has, so it runs in a plain Node test
 * environment.
 */
export function testSource(plan: WidgetPlan): string {
  const source = VIEWS[plan.view];
  const exported = camelCase(plan.name);
  const loadCase = plan.collection
    ? [
        `it("asks for its collection before it has one", async () => {`,
        `  const answer = await runWidgetLoad(t, ${exported}, { as: { id: adminId } });`,
        `  expect(answer.state).toBe("needs-setting");`,
        "});",
      ]
    : [
        `it("answers its data for the instance's administrator", async () => {`,
        `  const answer = await runWidgetLoad(t, ${exported}, { as: { id: adminId } });`,
        `  expect(answer).toEqual({ state: "ready", data: ${source.sample} });`,
        "});",
      ];
  return [
    'import { createTestNextly, runWidgetLoad, type TestNextly } from "@nextlyhq/plugin-sdk/testing";',
    'import { renderWidgetCard } from "@nextlyhq/plugin-sdk/testing/admin";',
    'import { renderToStaticMarkup } from "react-dom/server";',
    'import { afterAll, beforeAll, expect, it } from "vitest";',
    "",
    `import { ${exported} } from "./${plan.name}.widget";`,
    "",
    "let t: TestNextly;",
    "let adminId: string;",
    "",
    "beforeAll(async () => {",
    `  t = await createTestNextly({ widgets: [${exported}] });`,
    "  // The first user an instance stores is its super administrator.",
    "  const admin = await t.nextly.users.create({",
    '    email: "admin@example.com",',
    '    password: "Password123!",',
    '    data: { name: "Admin", isActive: true },',
    "  });",
    "  adminId = admin.item.id;",
    "});",
    "",
    "afterAll(async () => {",
    "  await t.destroy();",
    "});",
    "",
    ...loadCase,
    "",
    `it("draws its preview case in the dashboard's card", () => {`,
    "  const html = renderToStaticMarkup(",
    `    renderWidgetCard(${exported}, { state: "ready", data: ${source.sample} })`,
    "  );",
    `  expect(html).toContain("${titleOf(plan.name)}");`,
    "});",
    "",
  ].join("\n");
}
