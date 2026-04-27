// Public exports for the schema apply pipeline.
//
// Two entry-point shapes coexist intentionally during the F2 shim era:
//
//   1. The factory `createApplyDesiredSchema(deps)` from ./apply.js — used
//      by today's in-process callers (init/reload-config.ts and the UI
//      dispatcher). They construct per-call factories with locally-resolved
//      services so existing test seams (resolver-pattern + vi.hoisted spies
//      on schemaChangeService.apply) keep working without DI mocking, and
//      the dispatcher can capture per-call state (resolutions, the freshly
//      bumped version) via closure.
//
//   2. The DI-bound `applyDesiredSchema` re-exported below — positioned for
//      future external / plugin / integration-test callers that want a
//      zero-wiring entry point. Resolves services from the DI container at
//      first call and caches.
//
// F8 absorbs both call sites' factory wiring into the unified pipeline
// (the body of `createApplyDesiredSchema` becomes the real PushSchemaPipeline
// instead of the SchemaChangeService.apply shim), at which point the
// dual-entry-point seam can be collapsed. See progress tracker for the
// follow-up plan.

import {
  getCollectionRegistryFromDI,
  getSchemaChangeServiceFromDI,
} from "../../../dispatcher/helpers/di.js";

import {
  createApplyDesiredSchema,
  type AnyDesiredResource,
  type ApplyDesiredSchemaDeps,
  type ApplyDesiredSchemaFn,
} from "./apply.js";

export type {
  DesiredCollection,
  DesiredComponent,
  DesiredSchema,
  DesiredSingle,
} from "./types.js";

export type { SchemaApplyErrorCode } from "./errors.js";

export type { ApplyResult, AnyDesiredResource } from "./apply.js";

export {
  buildDesiredSchemaFromRegistry,
  buildDesiredSchemaFromRegistryAsync,
  type DesiredSchemaOverrides,
} from "./snapshot.js";

// Lazy DI binding — the deps object is built on first call so the
// DI container has finished registration before resolution.
let cached: ApplyDesiredSchemaFn | null = null;

export const applyDesiredSchema: ApplyDesiredSchemaFn = (
  desired,
  source,
  ctx
) => {
  cached ??= createApplyDesiredSchema(buildProductionDeps());
  return cached(desired, source, ctx);
};

/**
 * Test-only: reset the cached binding so a subsequent applyDesiredSchema
 * call re-resolves DI. Used by integration tests that swap the container.
 * @internal
 */
export function _resetApplyDesiredSchemaForTests(): void {
  cached = null;
}

function buildProductionDeps(): ApplyDesiredSchemaDeps {
  return {
    async applySingleResource(resource: AnyDesiredResource, source, _channel) {
      // F2 only ships the collection apply path. iterateResources in
      // apply.ts already filters singles + components out of the loop,
      // so this branch should not fire in normal operation. The defensive
      // throw catches a future regression where iterateResources changes
      // before applySingleResource is updated.
      if (resource.kind !== "collection") {
        throw new Error(
          `applyDesiredSchema: ${resource.kind} apply is not yet supported in F2 (collections only). ` +
            `Singles and components land in F8.`
        );
      }

      const schemaChangeService = getSchemaChangeServiceFromDI();
      const registry = getCollectionRegistryFromDI();
      if (!schemaChangeService || !registry) {
        throw new Error(
          "applyDesiredSchema: required services not registered in DI container"
        );
      }

      const current = await registry.getCollectionBySlug(resource.slug);
      const currentFields = current?.fields ?? [];
      const currentSchemaVersion = current?.schemaVersion ?? 0;

      const result = await schemaChangeService.apply(
        resource.slug,
        resource.tableName,
        // FieldConfig and FieldDefinition are structurally compatible but
        // nominally distinct; cast through unknown bridges the gap.
        currentFields as unknown as Parameters<
          typeof schemaChangeService.apply
        >[2],
        resource.fields as unknown as Parameters<
          typeof schemaChangeService.apply
        >[3],
        currentSchemaVersion,
        registry as unknown as Parameters<typeof schemaChangeService.apply>[5],
        undefined,
        { source }
      );

      if (!result.success) {
        // Surface as a thrown error so the pipeline's classifyError
        // turns it into the discriminated failure shape.
        const detail = result.error ? `: ${result.error}` : "";
        throw new Error(`${result.message}${detail}`);
      }

      // SchemaChangeService.apply does not expose statementsExecuted /
      // renamesApplied today. F2 reports placeholder zeros; F3 will
      // replace this callback with a richer call that returns these.
      return {
        success: true,
        statementsExecuted: 0,
        renamesApplied: 0,
      };
    },

    async readSchemaVersionForSlug(slug: string): Promise<number | null> {
      const registry = getCollectionRegistryFromDI();
      if (!registry) return null;
      const record = await registry.getCollectionBySlug(slug);
      const v = record?.schemaVersion;
      return typeof v === "number" ? v : null;
    },

    async readNewSchemaVersionsForSlugs(
      slugs: string[]
    ): Promise<Record<string, number>> {
      if (slugs.length === 0) return {};
      const registry = getCollectionRegistryFromDI();
      if (!registry) return {};
      const out: Record<string, number> = {};
      for (const slug of slugs) {
        const record = await registry.getCollectionBySlug(slug);
        const v = record?.schemaVersion;
        if (typeof v === "number") out[slug] = v;
      }
      return out;
    },
  };
}
