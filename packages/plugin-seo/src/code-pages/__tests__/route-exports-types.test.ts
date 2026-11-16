/**
 * What the plugin hands a route to export as its own `generateStaticParams`
 * or `generateMetadata` passes the type check `next build` runs on a
 * TypeScript site.
 *
 * Next.js writes that check itself: `next typegen` generates
 * `.next/types/validator.ts`, which holds each route module to the shape
 * Next.js accepts for it (`AppPageConfig`). The type lives only in that
 * generated file, so the test generates it for a small app whose routes
 * export the plugin's helpers as its guide shows, and compiles the app with
 * it. A hand-written copy of the shape would pass the day it was written and
 * drift from Next.js after.
 *
 * The routes import the helpers from source, so the check reads the types
 * this package publishes before they are built.
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compile } from "../../../../../scripts/tsc-cli.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = resolve(HERE, "../../..");
const SOURCE = join(PACKAGE, "src");

/** A route module of the app, by its file under `app/`. */
const ROUTES: Record<string, (source: string) => string> = {
  "layout.tsx": () => `export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
  // A page built in code, its head from the plugin.
  "pricing/page.tsx":
    source => `import { seoMetadata } from "${source}/code-pages/metadata";

export const generateMetadata = () =>
  seoMetadata("/pricing", { metadata: { title: "Pricing" } });

export default function PricingPage() {
  return <h1>Pricing</h1>;
}
`,
  // A dynamic route declaring its pages, as the guide shows.
  "topics/[topic]/page.tsx":
    source => `import { seoMetadata } from "${source}/code-pages/metadata";
import { seoStaticParams } from "${source}/code-pages/static-params";

export const generateStaticParams = seoStaticParams("/topics/[topic]", () => [
  { topic: "guides" },
  { topic: "news" },
]);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  return seoMetadata(\`/topics/\${topic}\`);
}

export default async function TopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  return <h1>{topic}</h1>;
}
`,
  // The control: a route whose generateStaticParams returns a readonly
  // array, as seoStaticParams did, which Next.js's check must refuse.
  "control/[id]/page.tsx":
    () => `const PAGES: readonly { id: string }[] = [{ id: "one" }];

export async function generateStaticParams(): Promise<readonly { id: string }[]> {
  return PAGES;
}

export default async function ControlPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <h1>{id}</h1>;
}
`,
  // Params a site keeps as a constant, and a catch-all.
  "docs/[...slug]/page.tsx":
    source => `import { seoStaticParams } from "${source}/code-pages/static-params";

const PAGES = [{ slug: ["start", "install"] }] as const;

export const generateStaticParams = seoStaticParams(
  "/docs/[...slug]",
  async () => PAGES
);

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  return <h1>{slug.join("/")}</h1>;
}
`,
};

let app = "";

beforeAll(() => {
  // Inside the package, so `next`, `react` and their types resolve from its
  // own dependencies.
  app = mkdtempSync(join(PACKAGE, ".route-types-"));
  const source = (file: string) =>
    relative(dirname(join(app, "app", file)), SOURCE).replaceAll("\\", "/");
  for (const [file, write] of Object.entries(ROUTES)) {
    const path = join(app, "app", file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, write(source(file)));
  }
  writeFileSync(
    join(app, "tsconfig.json"),
    JSON.stringify({
      extends: "../tsconfig.json",
      compilerOptions: {
        rootDir: "..",
        isolatedDeclarations: false,
        types: ["node", "react"],
      },
      include: ["app/**/*", ".next/types/**/*.ts"],
      exclude: [],
    })
  );
  const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const typegen = spawnSync(process.execPath, [next, "typegen"], {
    cwd: app,
    encoding: "utf8",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (typegen.status !== 0) {
    throw new Error(`next typegen failed:\n${typegen.stdout}${typegen.stderr}`);
  }
}, 60_000);

afterAll(() => {
  if (app !== "") rmSync(app, { recursive: true, force: true });
});

describe("the plugin's route exports under Next.js's own route type check", () => {
  it("holds each route to Next.js's shape", () => {
    // The check reaches the routes at all: Next.js wrote one for each.
    const validator = readFileSync(
      join(app, ".next", "types", "validator.ts"),
      "utf8"
    );
    for (const route of [
      "/pricing",
      "/topics/[topic]",
      "/docs/[...slug]",
      "/control/[id]",
    ]) {
      expect(validator, route).toContain(`AppPageConfig<"${route}">`);
    }
  });

  it("refuses the control's readonly params, and no route export of the plugin's", () => {
    const diagnostics = compile(["-p", join(app, "tsconfig.json")], app);
    const isControl = (message: string) =>
      message.includes(`AppPageConfig<"/control/[id]">`);
    // The control moves: Next.js's own check refuses a readonly array, so a
    // compile that reported nothing could not pass here.
    const control = diagnostics.filter(each => isControl(each.message));
    expect(control.map(each => each.file)).toEqual([
      ".next/types/validator.ts",
    ]);
    expect(control[0]?.message).toContain("generateStaticParams");
    expect(control[0]?.message).toContain("readonly");
    expect(
      diagnostics
        .filter(each => !isControl(each.message))
        .map(each => `${each.file ?? ""}: ${each.message}`)
    ).toEqual([]);
  }, 60_000);
});
