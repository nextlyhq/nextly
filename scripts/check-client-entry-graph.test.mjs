import { describe, expect, it } from "vitest";

import {
  DATABASE_PACKAGE_PATTERN,
  classifyEntries,
  clientFiles,
  databaseReach,
  declaresUseClient,
  findViolations,
  parseValueImports,
  resolveRelative,
  sourceFileForExport,
  stripTypeOnly,
  traceExternals,
} from "./check-client-entry-graph.mjs";

/**
 * The file system is injected rather than read. The subject is the rule, and a test that walked the
 * real tree would change its verdict whenever an unrelated module gained an import.
 */
const fakeIo = files => ({
  read: file => {
    if (!(file in files)) throw new Error(`ENOENT ${file}`);
    return files[file];
  },
  exists: file => file in files,
  readdir: dir =>
    [
      ...new Set(
        Object.keys(files)
          .filter(f => f.startsWith(`${dir}/`))
          .map(f => f.slice(dir.length + 1).split("/")[0])
      ),
    ],
  isDirectory: path => !(path in files),
});

describe("what counts as loading a package", () => {
  it("keeps an import that names a type beside a value", () => {
    // 🔴 `import { sql, type SQL }` still executes the module. Treating the `type` keyword as
    // governing the whole clause would erase a real runtime edge and report a leak as clean.
    expect(parseValueImports(`import { sql, type SQL } from "drizzle-orm";`)).toEqual([
      "drizzle-orm",
    ]);
  });

  it("drops an import that carries only types", () => {
    expect(parseValueImports(`import type { SQL } from "drizzle-orm";`)).toEqual([]);
    expect(parseValueImports(`export type { SQL } from "drizzle-orm";`)).toEqual([]);
  });

  it("finds a bare side-effect import and a re-export", () => {
    expect(
      parseValueImports(`import "./styles.css";\nexport { a } from "./a";`)
    ).toEqual(["./styles.css", "./a"]);
  });

  it("leaves a value re-export alone while stripping the type one beside it", () => {
    const source = `export type { A } from "./a";\nexport { b } from "./b";`;
    expect(stripTypeOnly(source)).not.toContain("./a");
    expect(parseValueImports(source)).toEqual(["./b"]);
  });
});

describe("recognising a client module", () => {
  it("accepts the directive at the top of the file", () => {
    expect(declaresUseClient(`"use client";\nimport x from "y";`)).toBe(true);
  });

  it("accepts a directive behind a doc comment", () => {
    // 🔴 The directive must be the first STATEMENT, not the first line. Files that open with a doc
    // block are ordinary here, and anchoring on byte zero skips every one of them.
    expect(declaresUseClient(`/**\n * A component.\n */\n\n"use client";\n`)).toBe(true);
    expect(declaresUseClient(`// a note\n"use client";\n`)).toBe(true);
  });

  it("rejects a file that merely mentions the string later", () => {
    expect(declaresUseClient(`import x from "y";\nconst t = '"use client"';`)).toBe(false);
  });

  it("rejects a file whose opening comment never closes", () => {
    expect(declaresUseClient(`/* unterminated\n"use client";`)).toBe(false);
  });
});

describe("which packages mean a database", () => {
  it.each(["drizzle-orm", "drizzle-orm/pg-core", "@nextlyhq/adapter-drizzle", "pg", "postgres", "mysql2", "better-sqlite3"])(
    "flags %s",
    name => expect(DATABASE_PACKAGE_PATTERN.test(name)).toBe(true)
  );

  it.each(["pg-boss", "postgres-array", "pgpass", "react", "nextly/config"])(
    "leaves %s alone",
    name => expect(DATABASE_PACKAGE_PATTERN.test(name)).toBe(false)
  );
});

describe("walking an entry's graph", () => {
  const files = {
    "/p/src/entry.ts": `export { t } from "./mid";`,
    "/p/src/mid.ts": `import { sql } from "drizzle-orm";\nexport const t = sql;`,
    "/p/src/clean.ts": `import type { X } from "drizzle-orm";\nexport const n = 1;`,
  };

  it("follows relative imports transitively to the package behind them", () => {
    const { externals } = traceExternals("/p/src/entry.ts", fakeIo(files));
    expect(databaseReach(externals)).toEqual(["drizzle-orm"]);
  });

  it("does not follow a type-only edge", () => {
    const { externals } = traceExternals("/p/src/clean.ts", fakeIo(files));
    expect(databaseReach(externals)).toEqual([]);
  });

  it("reports an import it could not resolve rather than calling it clean", () => {
    // 🔴 An unresolved import is an unwalked subtree. Reporting it as reaching nothing is how a
    // guard passes over the one thing it exists to find.
    const { unresolved } = traceExternals(
      "/p/src/broken.ts",
      fakeIo({ "/p/src/broken.ts": `import "./missing";` })
    );
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toContain("./missing");
  });

  it("terminates on a cycle", () => {
    const { visited } = traceExternals(
      "/p/a.ts",
      fakeIo({ "/p/a.ts": `import "./b";`, "/p/b.ts": `import "./a";` })
    );
    expect(visited.size).toBe(2);
  });

  it("resolves a directory import through its index", () => {
    const io = fakeIo({ "/p/a.ts": "", "/p/dir/index.ts": "" });
    expect(resolveRelative("/p/a.ts", "./dir", io.exists)).toBe("/p/dir/index.ts");
  });
});

describe("mapping a published subpath to its source", () => {
  it("reads the source the built file is emitted from", () => {
    const io = fakeIo({ "/p/src/a/b.ts": "" });
    expect(sourceFileForExport("./dist/a/b.mjs", "/p", io.exists)).toBe("/p/src/a/b.ts");
  });

  it("answers null when no source stands behind the artefact", () => {
    expect(sourceFileForExport("./dist/gone.mjs", "/p", fakeIo({}).exists)).toBeNull();
  });

  it("reports an unmappable subpath instead of passing it", () => {
    // A subpath this cannot read is a subpath the run proves nothing about, and silence would read
    // as a clean result.
    const { unmapped, safe, unsafe } = classifyEntries(
      { exports: { "./ghost": { import: "./dist/ghost.mjs" } } },
      "/p",
      fakeIo({})
    );
    expect(unmapped).toEqual(["nextly/ghost"]);
    expect(safe.size + unsafe.size).toBe(0);
  });

  it("splits the safe subpaths from the ones that reach a database", () => {
    const { safe, unsafe } = classifyEntries(
      {
        exports: {
          "./config": { import: "./dist/config.mjs" },
          "./runtime": { import: "./dist/runtime.mjs" },
        },
      },
      "/p",
      fakeIo({
        "/p/src/config.ts": `export const c = 1;`,
        "/p/src/runtime.ts": `import { sql } from "drizzle-orm";\nexport const r = sql;`,
      })
    );
    expect([...safe.keys()]).toEqual(["nextly/config"]);
    expect([...unsafe.keys()]).toEqual(["nextly/runtime"]);
    expect(unsafe.get("nextly/runtime")).toEqual(["drizzle-orm"]);
  });
});

describe("the rule itself", () => {
  const unsafe = new Map([["nextly/runtime", ["drizzle-orm"]]]);

  it("fails a client module that imports a database-reaching subpath", () => {
    const { violations, importSites } = findViolations(
      [["/a/Client.tsx", `"use client";\nimport { r } from "nextly/runtime";`]],
      unsafe
    );
    expect(importSites).toBe(1);
    expect(violations).toEqual([
      { file: "/a/Client.tsx", specifier: "nextly/runtime", reach: ["drizzle-orm"] },
    ]);
  });

  it("passes a client module that imports a safe subpath", () => {
    const { violations, importSites } = findViolations(
      [["/a/Client.tsx", `"use client";\nimport { c } from "nextly/config";`]],
      unsafe
    );
    expect(importSites).toBe(1);
    expect(violations).toEqual([]);
  });

  it("ignores a type-only import of a database-reaching subpath", () => {
    // Erased before anything runs, so it cannot put the ORM in a bundle.
    const { violations, importSites } = findViolations(
      [["/a/Client.tsx", `"use client";\nimport type { R } from "nextly/runtime";`]],
      unsafe
    );
    expect(importSites).toBe(0);
    expect(violations).toEqual([]);
  });

  it("does not count a package that merely starts with the same letters", () => {
    const { importSites } = findViolations(
      [["/a/Client.tsx", `"use client";\nimport x from "nextly-extra";`]],
      unsafe
    );
    expect(importSites).toBe(0);
  });

  it("collects only the client modules in a tree", () => {
    const found = clientFiles(
      "/src",
      fakeIo({
        "/src/Client.tsx": `"use client";\n`,
        "/src/server.ts": `export const s = 1;`,
        "/src/nested/Also.tsx": `/** doc */\n"use client";\n`,
      })
    );
    expect(found.map(([file]) => file).sort()).toEqual(["/src/Client.tsx", "/src/nested/Also.tsx"]);
  });
});
