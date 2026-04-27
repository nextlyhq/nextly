// F2 integration test scaffold for the applyDesiredSchema pipeline.
//
// PR-2 ships this file as a documented scaffold (mirroring the F18 PR-4
// fixtures pattern: shipped empty + README, filled in by F4/F8 when the
// real consumers land).
//
// Why not real implementations now: F2's pipeline body is a thin shim
// over the existing SchemaChangeService.apply. F8 absorbs the shim
// entirely and replaces the body with the proper PushSchemaPipeline
// (rename detection, prompt dispatch, transaction wrapping, migration
// journal). Integration tests written against the F2 shim would be
// rewritten in F8. Unit tests in apply.test.ts cover the contract
// surface; existing reload-config.test.ts covers the HMR migration
// mechanically; the UI dispatcher's migration is structurally
// preserving (same SchemaChangeService.apply call inside a closure).
//
// What this file documents: the three scenarios from the F2 spec §8
// that the F8 PushSchemaPipeline must satisfy when its real body
// lands. Each it.skip below points to a TODO with the filling-in plan.

import { describe, it } from "vitest";

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db.js";

const dialectsToCover: SupportedDialect[] = ["postgresql", "sqlite"];

for (const dialect of dialectsToCover) {
  describe(`applyDesiredSchema integration — ${dialect}`, () => {
    const ctx = makeTestContext(dialect);

    it.skip("happy path: applies a single-field-add change and bumps version", () => {
      // TODO(F8): bootstrap minimal Nextly stack against ctx.url:
      //   1. createPostgresAdapter / createSqliteAdapter pointing at ctx.url
      //   2. SchemaRegistry + registerStaticSchemas (dialect-specific
      //      dynamic_collections, dynamic_singles, dynamic_components)
      //   3. DrizzlePushService + SchemaChangeService instances
      //   4. Seed dynamic_collections with one row for slug "posts"
      //      tableName "<ctx.prefix>_dc_posts" schemaVersion 1 fields [{ title }]
      //   5. Call createApplyDesiredSchema with deps wrapping the real services
      //   6. Apply a snapshot adding a `body` field
      //   7. Assert result.success === true, newSchemaVersions.posts === 2
      //   8. Verify the column exists via raw db introspection
      void ctx;
    });

    it.skip("version conflict: returns SCHEMA_VERSION_CONFLICT and leaves DB unchanged", () => {
      // TODO(F8): same bootstrap as above, then:
      //   - Seed dynamic_collections.comments with schemaVersion 1
      //   - Call apply with ctx.schemaVersions = { comments: 0 }
      //   - Assert result.success === false, error.code === "SCHEMA_VERSION_CONFLICT"
      //   - Verify the second column was NOT added (introspect the table)
      void ctx;
    });

    it.skip("fresh DB: skips version check and applies cleanly with version starting at 1", () => {
      // TODO(F8): same bootstrap, then:
      //   - Empty dynamic_collections table
      //   - Apply a snapshot with one collection "tags"
      //   - Even if caller passes ctx.schemaVersions = { tags: 99 },
      //     pipeline ignores because no row exists
      //   - Assert result.success === true, newSchemaVersions.tags === 1
      void ctx;
    });
  });
}
