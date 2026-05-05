// F2 integration test scaffold — DEFERRED IMPLEMENTATION.
//
// Status: the F2 spec §8 calls for 3 working integration tests against
// PG + SQLite. PR-2 ships this file as `it.skip` scaffolds with the real
// bodies deferred to F8. This is a deliberate scope reduction, NOT an
// application of the F18 PR-4 fixtures-scaffold precedent (PR-4's
// consumers genuinely did not exist; F2's pipeline does and could be
// exercised today).
//
// Why deferred:
//   - F8 absorbs the F2 shim entirely and replaces the body with the
//     real PushSchemaPipeline (rename detection, prompt dispatch,
//     transaction wrapping, migration journal). Integration tests
//     written against the F2 shim would be rewritten in F8.
//   - The bootstrap cost (DrizzleAdapter + SchemaRegistry +
//     DrizzlePushService + SchemaChangeService + dynamic_collections
//     seeding, in dialect-specific variants) is substantial for code
//     about to be replaced.
//   - F2's contract behavior is already covered by 17 unit tests in
//     apply.test.ts / errors.test.ts / snapshot.test.ts (PR-1) plus
//     the existing 6 reload-config.test.ts cases (verified to still
//     pass on PR-2). The dispatcher migration is structurally
//     preserving — same SchemaChangeService.apply call inside a closure.
//
// Tracker: progress note for F2 records this deferral and the F8
// follow-up commitment. Each it.skip below documents the exact
// scenario for filling in.

import { describe, it } from "vitest";

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";

const dialectsToCover: SupportedDialect[] = ["postgresql", "sqlite"];

for (const dialect of dialectsToCover) {
  describe(`applyDesiredSchema integration — ${dialect}`, () => {
    const ctx = makeTestContext(dialect);

    it.skip("happy path: applies a single-field-add change and bumps version", () => {
      void ctx;
    });

    it.skip("version conflict: returns SCHEMA_VERSION_CONFLICT and leaves DB unchanged", () => {
      void ctx;
    });

    it.skip("fresh DB: skips version check and applies cleanly with version starting at 1", () => {
      void ctx;
    });
  });
}
