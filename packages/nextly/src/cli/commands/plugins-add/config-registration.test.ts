/**
 * The edit `nextly plugins add` makes to a site's config: the import and the
 * entry in `plugins`, for each shape a config is written in, and the shapes it
 * refuses to guess at, which leave the file as it was.
 */
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

import {
  manualRegistrationLines,
  pluginRegistrationEdit,
  type PluginRegistrationInput,
} from "./config-registration";

const FILE = "/site/nextly.config.ts";

/** The edit for `text`, registering `seoPlugin` from `@acme/seo` with options. */
function edit(text: string, overrides: Partial<PluginRegistrationInput> = {}) {
  return pluginRegistrationEdit({
    file: FILE,
    text,
    parser: parse,
    packageName: "@acme/seo",
    exportName: "seoPlugin",
    localName: "seoPlugin",
    entry: local => `${local}({ siteUrl: "https://example.com" })`,
    ...overrides,
  });
}

/** The edited text, failing when the answer is not an edit. */
function edited(text: string, overrides?: Partial<PluginRegistrationInput>) {
  const answer = edit(text, overrides);
  if (answer.kind !== "edit") {
    throw new Error(`expected an edit, got ${JSON.stringify(answer)}`);
  }
  return answer.after;
}

const BLANK = `import { defineConfig } from "nextly/config";

export default defineConfig({
  // Add your collections here
  collections: [],

  typescript: {
    outputFile: "./src/types/generated/nextly-types.ts",
  },
});
`;

describe("registering a plugin in nextly.config.ts", () => {
  it("adds the import and a plugins list to a config that has none", () => {
    expect(edited(BLANK)).toBe(`import { defineConfig } from "nextly/config";
import { seoPlugin } from "@acme/seo";

export default defineConfig({
  plugins: [seoPlugin({ siteUrl: "https://example.com" })],
  // Add your collections here
  collections: [],

  typescript: {
    outputFile: "./src/types/generated/nextly-types.ts",
  },
});
`);
  });

  it("appends to a list written on one line", () => {
    const text = `import { defineConfig } from "nextly/config";
import { formBuilderPlugin } from "@nextlyhq/plugin-form-builder";

export default defineConfig({
  plugins: [formBuilderPlugin],
});
`;
    expect(edited(text)).toBe(`import { defineConfig } from "nextly/config";
import { formBuilderPlugin } from "@nextlyhq/plugin-form-builder";
import { seoPlugin } from "@acme/seo";

export default defineConfig({
  plugins: [formBuilderPlugin, seoPlugin({ siteUrl: "https://example.com" })],
});
`);
  });

  it("appends on a line of its own to a list written one entry per line", () => {
    const withComma = `import { defineConfig } from "nextly/config";
import { a } from "a";

export default defineConfig({
  plugins: [
    a(),
  ],
});
`;
    expect(edited(withComma)).toContain(
      `  plugins: [
    a(),
    seoPlugin({ siteUrl: "https://example.com" }),
  ],`
    );
    const withoutComma = withComma.replace("a(),", "a()");
    expect(edited(withoutComma)).toContain(
      `  plugins: [
    a(),
    seoPlugin({ siteUrl: "https://example.com" })
  ],`
    );
  });

  it("fills an empty list", () => {
    const text = `import { defineConfig } from "nextly/config";
export default defineConfig({ plugins: [] });
`;
    expect(edited(text)).toContain(
      `defineConfig({ plugins: [seoPlugin({ siteUrl: "https://example.com" })] })`
    );
  });

  it("puts the import at the top of a file with none", () => {
    const text = `export default defineConfig({ plugins: [] });\n`;
    expect(
      edited(text).startsWith(`import { seoPlugin } from "@acme/seo";\n`)
    ).toBe(true);
  });

  it("uses an import the file already has, under the name it gives it", () => {
    const text = `import { defineConfig } from "nextly/config";
import { seoPlugin as seo } from "@acme/seo";

export default defineConfig({ plugins: [] });
`;
    const after = edited(text);
    expect(after).toContain(
      `plugins: [seo({ siteUrl: "https://example.com" })]`
    );
    expect(after.match(/from "@acme\/seo"/g)).toHaveLength(1);
  });

  it("imports a default export under the name it is given", () => {
    const after = edited(BLANK, {
      exportName: "default",
      localName: "seo",
      entry: local => local,
    });
    expect(after).toContain(`import seo from "@acme/seo";`);
    expect(after).toContain(`plugins: [seo],`);
  });

  it("leaves a config that already lists the plugin as it is", () => {
    const asCall = `import { defineConfig } from "nextly/config";
import { seoPlugin } from "@acme/seo";
export default defineConfig({ plugins: [seoPlugin({ siteUrl: "https://a.test" })] });
`;
    expect(edit(asCall)).toEqual({ kind: "listed", local: "seoPlugin" });
    const asValue = `import { defineConfig } from "nextly/config";
import seo from "@acme/seo";
export default defineConfig({ plugins: [seo] });
`;
    expect(
      edit(asValue, {
        exportName: "default",
        localName: "seo",
        entry: local => local,
      })
    ).toEqual({ kind: "listed", local: "seo" });
  });

  it("does not take another plugin from the same package for this one", () => {
    const text = `import { defineConfig } from "nextly/config";
import { authPlugin } from "@acme/seo";
export default defineConfig({ plugins: [authPlugin] });
`;
    expect(edited(text)).toContain(
      `plugins: [authPlugin, seoPlugin({ siteUrl: "https://example.com" })]`
    );
  });

  it("does not count a type-only import or an option as the plugin listed", () => {
    const typeOnly = `import { defineConfig } from "nextly/config";
import type { seoPlugin } from "@acme/seo";
import { other } from "other";
export default defineConfig({ plugins: [other({ seoPlugin: 1 })] });
`;
    expect(edit(typeOnly).kind).toBe("manual");
    const option = `import { defineConfig } from "nextly/config";
import { fields } from "@acme/seo";
import { other } from "other";
export default defineConfig({ plugins: [other({ fields })] });
`;
    expect(edit(option).kind).toBe("edit");
  });

  it("says to import a default export as one", () => {
    const answer = edit(`export default {};\n`, {
      exportName: "default",
      localName: "seo",
      entry: local => local,
    });
    expect(answer).toMatchObject({
      kind: "manual",
      lines: [`import seo from "@acme/seo";`, `plugins: [seo]`],
    });
    expect(
      manualRegistrationLines({
        packageName: "@acme/seo",
        exportName: "default",
        localName: "seo",
        entry: local => local,
      })
    ).toEqual([`import seo from "@acme/seo";`, `plugins: [seo]`]);
  });

  it.each([
    [
      "a name the file declares itself",
      `import { defineConfig } from "nextly/config";
const seoPlugin = 1;
export default defineConfig({ plugins: [] });
`,
    ],
    [
      "a name imported from another package",
      `import { defineConfig } from "nextly/config";
import { seoPlugin } from "other-seo";
export default defineConfig({ plugins: [] });
`,
    ],
    [
      "a list held in a variable",
      `import { defineConfig } from "nextly/config";
const plugins = [];
export default defineConfig({ plugins });
`,
    ],
    [
      "a list with a spread",
      `import { defineConfig } from "nextly/config";
export default defineConfig({ plugins: [...more] });
`,
    ],
    [
      "a spread that could carry the list",
      `import { defineConfig } from "nextly/config";
export default defineConfig({ ...base });
`,
    ],
    [
      "two defineConfig calls",
      `import { defineConfig } from "nextly/config";
export const a = defineConfig({});
export default defineConfig({});
`,
    ],
    ["no defineConfig call", `export default {};\n`],
    ["a file that does not parse", `export default defineConfig({`],
  ])("leaves %s as it was and says what to add", (_, text) => {
    const answer = edit(text);
    expect(answer.kind).toBe("manual");
    if (answer.kind !== "manual") return;
    expect(answer.lines).toEqual([
      `import { seoPlugin } from "@acme/seo";`,
      `plugins: [seoPlugin({ siteUrl: "https://example.com" })]`,
    ]);
    expect(answer.reason.length).toBeGreaterThan(0);
  });
});
