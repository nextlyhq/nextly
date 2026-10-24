// The deprecated-property audit: which keys it asks about, where, how it reads
// the answer, and the answers the compiler's language server gives on the
// shapes the audit exists for. Each server case is one an earlier, hand-written
// version of this audit had to get right, so each is asked of the server here.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditProject,
  deprecatedPropertiesIn,
  deprecatedPropertiesOf,
  deprecationIn,
  positionOf,
  writtenProperties,
} from "./deprecated-properties.mjs";
import { startLanguageServer } from "./language-server.mjs";

describe("writtenProperties", () => {
  it("names a key however the text spells it, and skips what must be evaluated", () => {
    const source =
      'take({ a: 1, "b": 2, ["c"]: 3, [4]: 4, d, e() {}, [key]: 5, ...rest });';
    expect(
      writtenProperties(source, "s.ts").map(property => property.name)
    ).toEqual(["a", "b", "c", "4", "d", "e"]);
  });

  it("reads a nested literal's keys as well as its parent's", () => {
    expect(
      writtenProperties("f({ outer: { inner: 1 } });", "s.ts").map(
        property => property.name
      )
    ).toEqual(["outer", "inner"]);
  });
});

describe("positionOf", () => {
  it("counts characters in UTF-16 units, as the protocol does", () => {
    // `😀` is two UTF-16 units and four UTF-8 bytes.
    const source = 'const s = "😀"; f({ key: 1 });';
    expect(positionOf(source, source.indexOf("key"))).toEqual({
      line: 0,
      character: 20,
    });
    const multiline = "a;\nf({ key: 1 });";
    expect(positionOf(multiline, multiline.indexOf("key"))).toEqual({
      line: 1,
      character: 4,
    });
  });
});

describe("deprecationIn", () => {
  const hover = tail => ({
    contents: {
      kind: "markdown",
      value: `\`\`\`typescript\n(property) Plugin.x?: string\n\`\`\`\n\n${tail}`,
    },
  });

  it("reads the note after the tag, up to the next tag", () => {
    expect(deprecationIn(hover("\n*@deprecated* — Prefer y"), "x")).toBe(
      "Prefer y"
    );
    expect(
      deprecationIn(hover("\n*@deprecated* — Use y.\n\n*@see* — y"), "x")
    ).toBe("Use y.");
    expect(
      deprecationIn(hover("\n*@deprecated* — Use y.\nGone in 1.0."), "x")
    ).toBe("Use y.\nGone in 1.0.");
    expect(deprecationIn(hover("\n*@deprecated*"), "x")).toBe("");
  });

  it("reads no tag as no deprecation", () => {
    expect(deprecationIn(hover(""), "x")).toBeUndefined();
  });

  it("refuses an empty answer rather than reading it as no tag", () => {
    expect(() => deprecationIn(null, "'x' at a.ts:1")).toThrow(
      /no hover for 'x' at a.ts:1/
    );
  });
});

/** The API the samples below write against. */
const API = `
export interface Plugin {
  /** @deprecated Prefer contributes.collections */
  collections?: string[];
  contributes?: { collections?: string[] };
  admin?: { order?: number };
  /**
   * @deprecated Use \`next\` instead.
   * Gone in 1.0.
   */
  multi?: number;
  /** @deprecated Use other. @see other */
  tagged?: number;
  other?: number;
}
export interface Legacy {
  kind: "legacy";
  /** @deprecated Prefer nu */
  old?: string;
}
export interface Current { kind: "current"; old?: string }
export interface A {
  /** @deprecated gone on A */
  both?: string;
  a?: 1;
}
export interface B { both?: string; b?: 1 }
export declare function plugin(p: Plugin): void;
export declare function arm(p: Legacy | Current): void;
export declare function either(p: A | B): void;
/** @deprecated Use plugin */
export declare function legacyPlugin(): void;
`;

describe("deprecatedPropertiesIn, asked of the compiler's language server", () => {
  let dir = "";
  let server;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "deprecated-properties-"));
    writeFileSync(join(dir, "api.ts"), API);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          target: "es2022",
        },
        include: ["*.ts"],
      })
    );
    server = startLanguageServer({ cwd: dir });
    await server.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(dir).href,
      capabilities: {
        textDocument: { hover: { contentFormat: ["markdown"] } },
      },
    });
    server.notify("initialized", {});
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Two samples beside the API: one writes a deprecated property, one does not. */
  function projectFiles() {
    const first = join(dir, "by-file-1.ts");
    const second = join(dir, "by-file-2.ts");
    writeFileSync(
      first,
      'import { plugin } from "./api";\n\nplugin({ collections: [] });\n'
    );
    writeFileSync(second, 'import { plugin } from "./api";\nplugin({});\n');
    return [first, second];
  }

  let count = 0;
  /** What the audit reports for `body`, written in a sample beside the API. */
  async function reported(body) {
    count += 1;
    const file = join(dir, `sample-${String(count)}.ts`);
    const source = `import { plugin, arm, either } from "./api";\nconst collections = ["x"];\n${body}\n`;
    writeFileSync(file, source);
    return (await deprecatedPropertiesIn(server, file, source)).map(
      ({ name, note }) => [name, note]
    );
  }

  it.each([
    ["an identifier key", "plugin({ collections: [] });"],
    ["a quoted key", 'plugin({ "collections": [] });'],
    ["a computed literal key", 'plugin({ ["collections"]: [] });'],
    ["a shorthand key", "plugin({ collections });"],
  ])("reports a deprecated property written as %s", async (_, body) => {
    expect(await reported(body)).toEqual([
      ["collections", "Prefer contributes.collections"],
    ]);
  });

  it("judges a nested literal against its own property, and a sibling against its own", async () => {
    expect(
      await reported(
        "plugin({ contributes: { collections: [] }, admin: { order: 1 } });"
      )
    ).toEqual([]);
  });

  it("reports nothing for a literal with no declared shape", async () => {
    expect(await reported("const loose = { collections: [] };")).toEqual([]);
  });

  it("answers for the union arm the literal's discriminant selects", async () => {
    expect(await reported('arm({ kind: "legacy", old: "x" });')).toEqual([
      ["old", "Prefer nu"],
    ]);
    expect(await reported('arm({ kind: "current", old: "x" });')).toEqual([]);
  });

  it("reports nothing where the union leaves an arm that does not deprecate it", async () => {
    expect(await reported('either({ both: "x" });')).toEqual([]);
  });

  it("audits every file of a project, answering by file and line", async () => {
    const [first, second] = projectFiles();
    const found = await auditProject(dir, [first, second]);
    expect(
      Object.fromEntries(
        Object.entries(found).map(([file, list]) => [
          file,
          list.map(({ name, line }) => [name, line]),
        ])
      )
    ).toEqual({ [first]: [["collections", 3]], [second]: [] });
  }, 60_000);

  it("answers the same as its own process, for a caller that cannot wait", async () => {
    const files = projectFiles();
    expect(deprecatedPropertiesOf(dir, files)).toEqual(
      await auditProject(dir, files)
    );
  }, 60_000);

  it("throws when the audit fails, rather than answering", () => {
    expect(() =>
      deprecatedPropertiesOf(dir, [join(dir, "no-such-sample.ts")])
    ).toThrow(/the audit failed \(1\): .*no-such-sample\.ts/s);
  }, 60_000);

  it("is asked because the compiler reports none of these itself", async () => {
    // The control, and the whole reason this audit exists. The compiler's own
    // deprecation diagnostics name a deprecated FUNCTION, and nothing for a
    // deprecated property written in an object literal, which is what a
    // documented example most often gets wrong.
    count += 1;
    const file = join(dir, `sample-${String(count)}.ts`);
    const source =
      'import { plugin, legacyPlugin } from "./api";\nplugin({ collections: [] });\nlegacyPlugin();\n';
    writeFileSync(file, source);
    const uri = pathToFileURL(file).href;
    server.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "typescript", version: 1, text: source },
    });
    const { items } = await server.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    server.notify("textDocument/didClose", { textDocument: { uri } });
    const deprecatedOnLine = line =>
      items.some(
        d => d.range.start.line === line - 1 && /deprecated/.test(d.message)
      );
    // The call on line 3 is reported, so the server does report deprecations.
    expect(deprecatedOnLine(3)).toBe(true);
    // The property on line 2 is not, so only the audit can find it.
    expect(deprecatedOnLine(2)).toBe(false);
    expect(
      (await deprecatedPropertiesIn(server, file, source)).map(d => d.name)
    ).toEqual(["collections"]);
  });

  it("carries a note across lines, and ends it at the next tag", async () => {
    expect(await reported("plugin({ multi: 1, tagged: 2 });")).toEqual([
      ["multi", "Use `next` instead.\nGone in 1.0."],
      ["tagged", "Use other."],
    ]);
  });
});
