import { describe, expect, it } from "vitest";

import {
  DATABASE_PACKAGE_PATTERN,
  buildWorkspaceIndex,
  makeResolver,
  parseModule,
  pickImportTarget,
  resolveFile,
  sourceForSubpath,
  summariseViolations,
  walkClientClosure,
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
  readdir: dir => [
    ...new Set(
      Object.keys(files)
        .filter(f => f.startsWith(`${dir}/`))
        .map(f => f.slice(dir.length + 1).split("/")[0])
    ),
  ],
  isDirectory: path => !(path in files) && Object.keys(files).some(f => f.startsWith(`${path}/`)),
});

describe("reading a module", () => {
  it("ignores an import written inside a string", () => {
    // 🔴 This repository has a module whose job is to PRINT an import for a reader. A pattern over
    // source text reports it as a real one, which fails the build over generated example code.
    const source = [
      '"use client";',
      "const lines = [`import { getNextly } from \"nextly\";`];",
      'const also = \'import x from "drizzle-orm"\';',
      "export { lines, also };",
    ].join("\n");
    expect(parseModule(source).specifiers).toEqual([]);
  });

  it("keeps an import that names a type beside a value", () => {
    expect(parseModule('import { sql, type SQL } from "drizzle-orm";').specifiers).toEqual([
      "drizzle-orm",
    ]);
  });

  it("drops an import that carries only types", () => {
    // Erased before anything runs, so it cannot put code in a bundle.
    expect(parseModule('import type { SQL } from "drizzle-orm";').specifiers).toEqual([]);
    expect(parseModule('export type { SQL } from "drizzle-orm";').specifiers).toEqual([]);
  });

  it("sees a value re-export and a bare side-effect import", () => {
    expect(
      parseModule('import "./styles.css";\nexport { a } from "./a";').specifiers
    ).toEqual(["./styles.css", "./a"]);
  });

  it("sees a dynamic import", () => {
    // A lazily loaded module is still in the bundle graph.
    expect(parseModule('const f = () => import("./lazy");').specifiers).toEqual(["./lazy"]);
  });

  it("recognises the directive behind a doc comment", () => {
    // 🔴 The directive must be the first STATEMENT, not the first line.
    expect(parseModule('/**\n * A component.\n */\n\n"use client";\n').isClient).toBe(true);
    expect(parseModule('// a note\n"use client";\n').isClient).toBe(true);
  });

  it("does not treat a later mention of the string as the directive", () => {
    expect(parseModule('import x from "y";\nconst t = \'"use client"\';').isClient).toBe(false);
  });

  it("parses TSX without treating a generic as a comparison", () => {
    const source = '"use client";\nimport { a } from "./a";\nexport const C = () => <div>{a}</div>;';
    const parsed = parseModule(source, "C.tsx");
    expect(parsed.isClient).toBe(true);
    expect(parsed.specifiers).toEqual(["./a"]);
  });
});

describe("which packages mean a database", () => {
  it.each([
    "drizzle-orm",
    "drizzle-orm/pg-core",
    "@nextlyhq/adapter-drizzle",
    "pg",
    "postgres",
    "mysql2",
    "better-sqlite3",
  ])("flags %s", name => expect(DATABASE_PACKAGE_PATTERN.test(name)).toBe(true));

  it.each(["pg-boss", "postgres-array", "pgpass", "react", "nextly/config"])(
    "leaves %s alone",
    name => expect(DATABASE_PACKAGE_PATTERN.test(name)).toBe(false)
  );
});

describe("finding a module on disk", () => {
  it("prefers a file over a directory of the same name", () => {
    const io = fakeIo({ "/p/a.ts": "", "/p/a/index.ts": "" });
    expect(resolveFile("/p/a", io.exists)).toBe("/p/a.ts");
  });

  it("resolves a directory through its index", () => {
    const io = fakeIo({ "/p/dir/index.ts": "" });
    expect(resolveFile("/p/dir", io.exists)).toBe("/p/dir/index.ts");
  });

  it("resolves a NodeNext .js specifier to the .ts beside it", () => {
    // 🔴 Under NodeNext the author writes the extension the OUTPUT will have. Treating these as
    // missing stops the walk at the first such module and leaves everything past it unexamined.
    const io = fakeIo({ "/p/banner.ts": "" });
    expect(resolveFile("/p/banner.js", io.exists)).toBe("/p/banner.ts");
  });

  it("answers null when nothing exists", () => {
    expect(resolveFile("/p/missing", fakeIo({}).exists)).toBeNull();
  });
});

describe("reading an export map", () => {
  it("resolves the flat condition shape", () => {
    expect(pickImportTarget({ types: "./d.d.ts", import: "./d.mjs" })).toBe("./d.mjs");
  });

  it("resolves the nested condition shape", () => {
    // Packages here use both, and reading only the first level fails the run on the other.
    expect(pickImportTarget({ import: { types: "./d.d.ts", default: "./d.mjs" } })).toBe("./d.mjs");
  });

  it("resolves a bare string target", () => {
    expect(pickImportTarget("./theme.css")).toBe("./theme.css");
  });

  it("answers null for a shape it cannot read", () => {
    expect(pickImportTarget({ require: "./d.cjs" })).toBeNull();
    expect(pickImportTarget(undefined)).toBeNull();
  });

  it("maps a built subpath back to its source", () => {
    const io = fakeIo({ "/p/src/a/b.ts": "" });
    expect(
      sourceForSubpath({ exports: { "./b": { import: "./dist/a/b.mjs" } } }, "/p", "./b", io.exists)
    ).toBe("/p/src/a/b.ts");
  });

  it("ends the walk at a stylesheet rather than failing on it", () => {
    // An asset carries no imports and cannot reach a driver.
    expect(
      sourceForSubpath({ exports: { "./s.css": "./dist/s.css" } }, "/p", "./s.css", fakeIo({}).exists)
    ).toEqual({ asset: true });
  });

  it("answers null when no source stands behind the artefact", () => {
    expect(
      sourceForSubpath({ exports: { "./g": { import: "./dist/g.mjs" } } }, "/p", "./g", fakeIo({}).exists)
    ).toBeNull();
  });
});

describe("resolving a specifier", () => {
  const files = {
    "/repo/packages/admin/package.json": '{"name":"@nextlyhq/admin"}',
    "/repo/packages/admin/src/a.ts": "",
    "/repo/packages/admin/src/deep/b.ts": "",
    "/repo/packages/ui/package.json": '{"name":"@nextlyhq/ui","exports":{".":{"import":{"default":"./dist/index.mjs"}}}}',
    "/repo/packages/ui/src/index.ts": "",
    "/repo/packages/adapter-drizzle/package.json": '{"name":"@nextlyhq/adapter-drizzle","exports":{".":{"import":"./dist/index.mjs"}}}',
    "/repo/packages/adapter-drizzle/src/index.ts": "",
  };
  const io = fakeIo(files);
  const workspace = buildWorkspaceIndex("/repo/packages", io);
  const resolveSpecifier = makeResolver({
    adminSrc: "/repo/packages/admin/src",
    workspace,
    exists: io.exists,
  });

  it("indexes every workspace package by the name it is imported as", () => {
    expect([...workspace.keys()].sort()).toEqual([
      "@nextlyhq/adapter-drizzle",
      "@nextlyhq/admin",
      "@nextlyhq/ui",
    ]);
  });

  it("follows a relative import", () => {
    expect(resolveSpecifier("/repo/packages/admin/src/a.ts", "./deep/b")).toEqual({
      kind: "file",
      file: "/repo/packages/admin/src/deep/b.ts",
    });
  });

  it("follows the admin alias", () => {
    expect(resolveSpecifier("/repo/packages/admin/src/deep/b.ts", "@admin/a")).toEqual({
      kind: "file",
      file: "/repo/packages/admin/src/a.ts",
    });
  });

  it("crosses into a workspace package through its export map", () => {
    // 🔴 Stopping at the package boundary would let any leak hide one hop outside the admin.
    expect(resolveSpecifier("/repo/packages/admin/src/a.ts", "@nextlyhq/ui")).toEqual({
      kind: "file",
      file: "/repo/packages/ui/src/index.ts",
    });
  });

  it("reports a database workspace package as the answer rather than walking it", () => {
    expect(resolveSpecifier("/repo/packages/admin/src/a.ts", "@nextlyhq/adapter-drizzle")).toEqual({
      kind: "external",
      name: "@nextlyhq/adapter-drizzle",
    });
  });

  it("treats an unknown package as external", () => {
    expect(resolveSpecifier("/repo/packages/admin/src/a.ts", "react")).toEqual({
      kind: "external",
      name: "react",
    });
  });

  it("reports a relative import that resolves to nothing", () => {
    expect(resolveSpecifier("/repo/packages/admin/src/a.ts", "./gone")).toEqual({
      kind: "unresolved",
      specifier: "./gone",
    });
  });
});

describe("walking the client closure", () => {
  const build = files => {
    const io = fakeIo(files);
    const workspace = buildWorkspaceIndex("/repo/packages", io);
    return {
      io,
      resolveSpecifier: makeResolver({
        adminSrc: "/repo/packages/admin/src",
        workspace,
        exists: io.exists,
      }),
    };
  };

  it("finds a database package several hops past the directive", () => {
    // 🔴 The case this rule exists for. A client entry importing a helper, where the helper imports
    // the server entry, puts the whole server graph in the browser bundle — and a check that reads
    // only the files carrying the directive sees none of it.
    const files = {
      "/repo/packages/admin/package.json": '{"name":"@nextlyhq/admin"}',
      "/repo/packages/admin/src/Entry.tsx": '"use client";\nimport { h } from "./helper";\nexport { h };',
      "/repo/packages/admin/src/helper.ts": 'import { deep } from "./deep";\nexport const h = deep;',
      "/repo/packages/admin/src/deep.ts": 'import { sql } from "drizzle-orm";\nexport const deep = sql;',
    };
    const { io, resolveSpecifier } = build(files);
    const { violations, unresolved } = walkClientClosure({
      entries: ["/repo/packages/admin/src/Entry.tsx"],
      resolveSpecifier,
      read: io.read,
    });

    expect(unresolved).toEqual([]);
    expect(violations).toHaveLength(1);
    expect(violations[0].package).toBe("drizzle-orm");
    expect(violations[0].chain).toEqual([
      "/repo/packages/admin/src/deep.ts",
      "/repo/packages/admin/src/helper.ts",
      "/repo/packages/admin/src/Entry.tsx",
    ]);
  });

  it("says nothing about a server module the client never reaches", () => {
    const files = {
      "/repo/packages/admin/package.json": '{"name":"@nextlyhq/admin"}',
      "/repo/packages/admin/src/Entry.tsx": '"use client";\nexport const a = 1;',
      "/repo/packages/admin/src/server.ts": 'import { sql } from "drizzle-orm";\nexport const s = sql;',
    };
    const { io, resolveSpecifier } = build(files);
    const { violations } = walkClientClosure({
      entries: ["/repo/packages/admin/src/Entry.tsx"],
      resolveSpecifier,
      read: io.read,
    });
    expect(violations).toEqual([]);
  });

  it("reports an import it could not resolve rather than calling it clean", () => {
    // 🔴 An unresolved import is an unwalked subtree.
    const files = {
      "/repo/packages/admin/package.json": '{"name":"@nextlyhq/admin"}',
      "/repo/packages/admin/src/Entry.tsx": '"use client";\nimport "./missing";',
    };
    const { io, resolveSpecifier } = build(files);
    const { unresolved } = walkClientClosure({
      entries: ["/repo/packages/admin/src/Entry.tsx"],
      resolveSpecifier,
      read: io.read,
    });
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].specifier).toBe("./missing");
  });

  it("terminates on a cycle", () => {
    const files = {
      "/repo/packages/admin/package.json": '{"name":"@nextlyhq/admin"}',
      "/repo/packages/admin/src/a.ts": '"use client";\nimport "./b";',
      "/repo/packages/admin/src/b.ts": 'import "./a";',
    };
    const { io, resolveSpecifier } = build(files);
    const { visited } = walkClientClosure({
      entries: ["/repo/packages/admin/src/a.ts"],
      resolveSpecifier,
      read: io.read,
    });
    expect(visited.size).toBe(2);
  });
});

describe("reporting", () => {
  it("keeps the shortest path to each package and drops the rest", () => {
    // One leaked entry reaches hundreds of modules across a handful of drivers. Printing every path
    // buries the one fact that matters under repetitions of it.
    const summary = summariseViolations([
      { package: "drizzle-orm", chain: ["a", "b", "c", "d"] },
      { package: "drizzle-orm", chain: ["a", "b"] },
      { package: "pg", chain: ["x", "y", "z"] },
    ]);
    expect(summary).toHaveLength(2);
    expect(summary.map(v => v.package)).toEqual(["drizzle-orm", "pg"]);
    expect(summary[0].chain).toEqual(["a", "b"]);
  });
});
