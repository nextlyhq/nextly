/**
 * The authorization view is judged on complete data or not at all.
 *
 * A `custom` read rule is shown the document the caller would receive, and
 * field-group values live in their own tables rather than the main row. If the
 * service that loads them is missing, the rule sees those fields as empty and
 * reads that absence as permission — the same failure the depth floor and the
 * relationship completeness check exist to prevent. The strict pass therefore
 * refuses to judge rather than judging on a document it knows is short.
 *
 * `fieldGroupDataService` is always supplied by the DI graph, so this guards
 * the seam the optional constructor parameter leaves open.
 */

import { describe, expect, it } from "vitest";

import { SingleQueryService } from "../services/single-query-service";

import {
  componentFieldDef,
  createMockAdapter,
  createMockHookRegistry,
  createMockRBACService,
  createMockSingleRegistry,
  createSilentLogger,
  siteSettingsMeta,
  textField,
} from "./single-test-helpers";

type Ctor = ConstructorParameters<typeof SingleQueryService>;

/** Build the read service with NO field-group data service, as the seam allows. */
function createServiceWithoutFieldGroups(fields: Record<string, unknown>[]) {
  const registry = createMockSingleRegistry();
  registry.registerSingle("site-settings", {
    ...siteSettingsMeta(),
    fields,
  });

  const service = new SingleQueryService(
    createMockAdapter({}) as unknown as Ctor[0],
    createSilentLogger() as unknown as Ctor[1],
    registry as unknown as Ctor[2],
    createMockHookRegistry() as unknown as Ctor[3],
    // The parameter this test exists for.
    undefined,
    createMockRBACService(true) as unknown as Ctor[5]
  );

  // assembleStoredDocument is private; the strict flag it takes is what the
  // authorization view sets, and reaching it through a full custom-rule read
  // would test the rule engine rather than this guard.
  return service as unknown as {
    assembleStoredDocument(params: Record<string, unknown>): Promise<unknown>;
  };
}

function assembleParams(fields: Record<string, unknown>[], strict: boolean) {
  return {
    slug: "site-settings",
    singleMeta: { ...siteSettingsMeta(), fields },
    doc: { id: "doc1", siteName: "Nextly" },
    options: {},
    statusFilterValue: undefined,
    enforceRelatedFieldAccess: false,
    strict,
  };
}

describe("SingleQueryService — authorization view completeness", () => {
  it("refuses to judge a Single with field groups when their data cannot be loaded", async () => {
    const fields = [textField("siteName"), componentFieldDef("seo")];
    const service = createServiceWithoutFieldGroups(fields);

    await expect(
      service.assembleStoredDocument(assembleParams(fields, true))
    ).rejects.toThrow();
  });

  it("still assembles a Single that declares no field groups", async () => {
    // The guard is scoped to documents whose rule could actually be shown a
    // short field group; a Single without one loses nothing by the service
    // being absent, and must not start failing strict reads.
    const fields = [textField("siteName")];
    const service = createServiceWithoutFieldGroups(fields);

    await expect(
      service.assembleStoredDocument(assembleParams(fields, true))
    ).resolves.toBeDefined();
  });

  it("leaves a non-strict read alone even when field groups are declared", async () => {
    // Only the authorization view claims completeness. An ordinary read that
    // cannot populate a field group returns it empty, as it always has.
    const fields = [textField("siteName"), componentFieldDef("seo")];
    const service = createServiceWithoutFieldGroups(fields);

    await expect(
      service.assembleStoredDocument(assembleParams(fields, false))
    ).resolves.toBeDefined();
  });
});
