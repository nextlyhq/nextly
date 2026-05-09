// Production-wiring assertion (I1 from F4 PR 2 review).
//
// Catches the regression class "a future refactor accidentally reverts a
// production call site to noopRenameDetector". The integration test in
// pushschema-pipeline.integration.test.ts asserts the detector contract
// end-to-end but constructs its own pipeline locally - it does NOT verify
// production wiring. This test does.
//
// Approach: source-text scan. Each file in PRODUCTION_CALLERS must NOT
// import noopRenameDetector and MUST import + use RegexRenameDetector.
// Brittle to wholesale rewrites but cheap and catches the exact regression
// the review surfaced (collection-dispatcher.ts shipped F4 PR 2 still on
// the noop because the spec under-counted call sites).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_ROOT = resolve(__dirname, "../../../../..");

// All production sites that construct a PushSchemaPipeline with deps must
// wire RegexRenameDetector, not noopRenameDetector.
const PRODUCTION_CALLERS = [
  "src/domains/schema/pipeline/index.ts",
  "src/init/reload-config.ts",
  "src/dispatcher/handlers/collection-dispatcher.ts",
];

describe("F4 production wiring", () => {
  for (const relPath of PRODUCTION_CALLERS) {
    describe(relPath, () => {
      const source = readFileSync(resolve(SRC_ROOT, relPath), "utf-8");

      it("does NOT import noopRenameDetector", () => {
        // Allow the literal string in comments (e.g., explaining the
        // migration); only fail on real import statements.
        const importLine = source
          .split("\n")
          .find(
            line =>
              line.includes("noopRenameDetector") &&
              !line.trimStart().startsWith("//")
          );
        expect(importLine).toBeUndefined();
      });

      it("imports RegexRenameDetector", () => {
        expect(source).toMatch(
          /import\s+\{[^}]*\bRegexRenameDetector\b[^}]*\}\s+from/
        );
      });

      it("instantiates RegexRenameDetector at the renameDetector dep slot", () => {
        // `renameDetector: new RegexRenameDetector()` (whitespace-tolerant)
        expect(source).toMatch(
          /renameDetector:\s*new\s+RegexRenameDetector\(\)/
        );
      });
    });
  }
});
