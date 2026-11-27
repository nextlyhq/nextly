/**
 * Proves `catalog.test-d.ts` says what it claims.
 *
 * The file is compiled twice beside the real modules: as written, where no
 * diagnostic may remain (so every `@ts-expect-error` is used), and with every
 * directive blanked out, where each directive's line must report exactly the
 * diagnostic the directive names and no other line may report anything. A
 * directive that only hid a typo, a bad import or a different error fails the
 * second compile, which `@ts-expect-error` alone cannot show. The approach is
 * the one `packages/nextly/src/domains/workflows/__tests__/compile-errors.test.ts`
 * uses.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { compile, listedFiles } from "../../../../scripts/tsc-cli.mjs";

// Paths in `/` form on every platform, as TypeScript names a file.
const { dirname, join } = posix;
const here = dirname(fileURLToPath(import.meta.url).replaceAll("\\", "/"));
const packageRoot = join(here, "..", "..");

const DIRECTIVE = /\/\/ @ts-expect-error (TS\d+)\s*$/;

interface Expected {
  /** The line the directive guards (1-based). */
  line: number;
  code: string;
}

interface Found {
  line: number | undefined;
  code: string;
  message: string;
}

const written = readFileSync(join(here, "catalog.test-d.ts"), "utf8");
const lines = written.split("\n");

/** Each directive's expected diagnostic, on the line after it. */
const expected: Expected[] = lines.flatMap((text, index) => {
  const match = DIRECTIVE.exec(text);
  return match?.[1] ? [{ line: index + 2, code: match[1] }] : [];
});

/** The file with each directive blanked, so every line keeps its number. */
const stripped = lines
  .map(text => (DIRECTIVE.test(text) ? "//" : text))
  .join("\n");

let byFile = new Map<string, Found[]>();

const AS_WRITTEN = join(
  packageRoot,
  "src",
  "__tests__",
  "catalog-as-written.ts"
);
const STRIPPED = join(packageRoot, "src", "__tests__", "catalog-stripped.ts");

beforeAll(() => {
  // Written to a directory of their own inside the package's `.turbo`, which
  // git and every scan ignore, laid out like `src` and merged with it by
  // `rootDirs`, so `../index.js` reaches the real module. The package's own
  // config is extended, so they compile as `check-types` would compile them.
  const parent = join(packageRoot, ".turbo");
  mkdirSync(parent, { recursive: true });
  const scratch = mkdtempSync(join(parent, "catalog-contract-")).replaceAll(
    "\\",
    "/"
  );
  const mirror = (path: string) =>
    join(scratch, posix.relative(packageRoot, path));
  const files = new Map([
    [AS_WRITTEN, written],
    [STRIPPED, stripped],
  ]);
  try {
    for (const [path, text] of files) {
      mkdirSync(dirname(mirror(path)), { recursive: true });
      writeFileSync(mirror(path), text, { flag: "wx" });
    }
    const config = join(scratch, "tsconfig.json");
    writeFileSync(
      config,
      JSON.stringify({
        extends: join(packageRoot, "tsconfig.json"),
        compilerOptions: {
          rootDir: packageRoot,
          rootDirs: [join(scratch, "src"), join(packageRoot, "src")],
        },
        files: [...files.keys()].map(mirror),
        include: [],
      }),
      { flag: "wx" }
    );
    const listed = new Set(listedFiles(config));
    for (const path of files.keys()) {
      if (!listed.has(mirror(path))) throw new Error(`Not compiled: ${path}`);
    }
    const diagnostics = compile(["-p", config], scratch);
    const fromScratch = (file: string) =>
      /^([A-Za-z]:)?\//.test(file) ? file : join(scratch, file);
    byFile = new Map(
      [...files.keys()].map(path => [
        path,
        diagnostics
          .filter(d => d.file && fromScratch(d.file) === mirror(path))
          .map(d => ({ line: d.line, code: d.code, message: d.message })),
      ])
    );
    // A diagnostic about another file (the real modules) is a broken build,
    // not a result for either case.
    const elsewhere = diagnostics.filter(
      d =>
        !d.file || ![...files.keys()].map(mirror).includes(fromScratch(d.file))
    );
    if (elsewhere.length > 0) {
      throw new Error(
        `Unexpected diagnostics outside the cases:\n${elsewhere
          .map(d => `${d.file ?? ""}(${d.line ?? ""}) ${d.code} ${d.message}`)
          .join("\n")}`
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 180_000);

describe("the catalog's compile-time contract", () => {
  it("finds the directives it is meant to check", () => {
    expect(expected.length).toBe(14);
  });

  it("compiles as written, every directive used", () => {
    expect(byFile.get(AS_WRITTEN)).toEqual([]);
  });

  it("fails each refused line, and only those, for the named reason", () => {
    const found = (byFile.get(STRIPPED) ?? []).map(d => ({
      line: d.line,
      code: d.code,
    }));
    expect(found).toEqual(expected);
  });
});
