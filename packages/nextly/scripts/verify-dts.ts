/**
 * verify-dts.ts
 *
 * Verifies that the bundled `.d.ts` produced by `rollup.dts.config.ts`
 * is complete and internally consistent.
 *
 * For each entry in `package.json` "exports" this script checks:
 *   1. The `.d.ts` file referenced by `exports.<key>.types` exists and is
 *      non-empty.
 *   2. The file contains at least one `export` statement (so it is not a
 *      placeholder or a file that rollup accidentally emitted empty).
 *   3. Every relative `import` / `export ... from` path in the bundled
 *      declaration resolves to a real file on disk. This catches the class
 *      of bugs where chunk references use the wrong extension, point at a
 *      path that was cleaned up, or drift from the physical chunk name.
 *
 * Usage:
 *   pnpm build                          # produce dist/
 *   npx tsx scripts/verify-dts.ts       # verify
 *
 * Exit codes:
 *   0  — all checks pass
 *   1  — one or more checks fail
 */

import { readFileSync, statSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");
const packageJsonPath = resolve(packageRoot, "package.json");

interface PackageExportValue {
  types?: string;
  import?: string;
}

interface PackageJson {
  exports?: Record<string, PackageExportValue>;
}

interface Failure {
  entry: string;
  file: string;
  message: string;
}

const MIN_DTS_SIZE_BYTES = 64;
/** A bundled entry must contain at least one `export` statement. */
const EXPORT_REGEX = /(^|\s)export\b/;
/**
 * Match relative import / export specifiers so we can verify their targets
 * exist on disk.
 */
const RELATIVE_SPECIFIER_REGEX =
  /(?:from|import|export\s*\*\s*from|export\s*\{[^}]*\}\s*from)\s*['"](\.\.?\/[^'"]+)['"]/g;

/**
 * Strip `/** ... *\/` block comments (and `//` line comments) so we do not
 * match relative paths inside JSDoc example code like
 * `* import { foo } from './bar';`.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function loadPackageExports(): Record<string, PackageExportValue> {
  const raw = readFileSync(packageJsonPath, "utf-8");
  const pkg = JSON.parse(raw) as PackageJson;
  if (!pkg.exports) {
    throw new Error("verify-dts: package.json has no 'exports' field");
  }
  return pkg.exports;
}

function verifyEntry(entry: string, value: PackageExportValue): Failure[] {
  const failures: Failure[] = [];
  const typesPath = value.types;
  if (!typesPath) {
    failures.push({
      entry,
      file: "-",
      message: "no 'types' field in exports entry",
    });
    return failures;
  }

  const absoluteDts = resolve(packageRoot, typesPath);

  if (!existsSync(absoluteDts)) {
    failures.push({
      entry,
      file: typesPath,
      message: "file does not exist",
    });
    return failures;
  }

  const stats = statSync(absoluteDts);
  if (stats.size < MIN_DTS_SIZE_BYTES) {
    failures.push({
      entry,
      file: typesPath,
      message: `file is too small (${stats.size} bytes)`,
    });
    return failures;
  }

  const content = readFileSync(absoluteDts, "utf-8");
  if (!EXPORT_REGEX.test(content)) {
    failures.push({
      entry,
      file: typesPath,
      message: "file contains no 'export' statement",
    });
  }

  const contentWithoutComments = stripComments(content);
  const baseDir = dirname(absoluteDts);
  const seen = new Set<string>();
  for (const match of contentWithoutComments.matchAll(
    RELATIVE_SPECIFIER_REGEX
  )) {
    const specifier = match[1];
    if (!specifier || seen.has(specifier)) continue;
    seen.add(specifier);

    const resolved = resolve(baseDir, specifier);
    if (existsSync(resolved)) continue;

    // Try common extension fallbacks in case rollup dropped the suffix.
    const candidates = [`${resolved}.d.ts`, `${resolved}/index.d.ts`];
    if (candidates.some(candidate => existsSync(candidate))) continue;

    failures.push({
      entry,
      file: typesPath,
      message: `unresolved relative specifier "${specifier}"`,
    });
  }

  return failures;
}

function main(): void {
  const exports = loadPackageExports();
  const entryCount = Object.keys(exports).length;

  console.log(
    `verify-dts: checking ${entryCount} entry point(s) from package.json exports...\n`
  );

  const allFailures: Failure[] = [];
  let okCount = 0;

  for (const [entry, value] of Object.entries(exports)) {
    const failures = verifyEntry(entry, value);
    if (failures.length === 0) {
      okCount += 1;
      console.log(`  OK: "${entry}" — ${value.types ?? "(no types)"}`);
    } else {
      for (const failure of failures) {
        console.error(
          `  FAIL: "${failure.entry}" (${failure.file}): ${failure.message}`
        );
      }
      allFailures.push(...failures);
    }
  }

  console.log(
    `\nSummary: ${okCount}/${entryCount} entry points verified, ${allFailures.length} failure(s)`
  );

  if (allFailures.length > 0) {
    console.error(
      "\nFAIL: verify-dts detected missing or broken bundled declarations."
    );
    process.exit(1);
  }

  console.log(
    "PASS: all bundled declarations are present and internally consistent."
  );
}

main();
