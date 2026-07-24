/**
 * `buildDefaultDocument` must route a localized single's translatable defaults to
 * `localizedDefaults` (for the default-locale companion) and keep them OFF the
 * main-table insert — otherwise a localized field's default is stranded as null
 * until first written, and inserting it would target a non-existent main column.
 */
import { describe, it, expect } from "vitest";

import { SingleQueryService } from "../services/single-query-service";

import {
  createMockAdapter,
  createSilentLogger,
  createMockSingleRegistry,
  createMockHookRegistry,
  siteSettingsMeta,
} from "./single-test-helpers";

type Ctor = ConstructorParameters<typeof SingleQueryService>;
type SingleMeta = Parameters<SingleQueryService["buildDefaultDocument"]>[0];

function createQueryService(): SingleQueryService {
  return new SingleQueryService(
    createMockAdapter() as unknown as Ctor[0],
    createSilentLogger() as unknown as Ctor[1],
    createMockSingleRegistry() as unknown as Ctor[2],
    createMockHookRegistry() as unknown as Ctor[3],
    undefined,
    undefined,
    // Localization on with a default locale — buildDefaultDocument itself does
    // not read it, but it mirrors how the service is wired for a localized single.
    { defaultLocale: "en", locales: [{ code: "en" }] } as unknown as Ctor[6]
  );
}

describe("SingleQueryService.buildDefaultDocument", () => {
  it("routes a localized field's default to localizedDefaults, off the main insert", () => {
    const service = createQueryService();
    const meta = siteSettingsMeta({
      localized: true,
      status: true,
      fields: [
        {
          name: "siteName",
          type: "text",
          localized: true,
          defaultValue: "My Site",
        },
        { name: "region", type: "text", localized: false, defaultValue: "us" },
      ],
    });

    const { document, insertValues, localizedDefaults } =
      service.buildDefaultDocument(meta as unknown as SingleMeta);

    // The localized default is captured for the companion, not the main insert.
    expect(localizedDefaults).toMatchObject({ siteName: "My Site" });
    expect(insertValues).not.toHaveProperty("site_name");
    // ...but it is still resolved onto the in-memory default document.
    expect(document).toMatchObject({ siteName: "My Site" });

    // A non-localized field's default stays on the main insert.
    expect(insertValues).toMatchObject({ region: "us" });
    expect(localizedDefaults).not.toHaveProperty("region");
  });

  it("routes a localized title default to the companion", () => {
    const service = createQueryService();
    const meta = siteSettingsMeta({
      localized: true,
      // A single may localize its auto-injected title; when it does the column
      // lives on the companion, so its default must ride localizedDefaults.
      fields: [{ name: "title", type: "text", localized: true }],
    });

    const { insertValues, localizedDefaults } =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock meta
      service.buildDefaultDocument(meta as any);

    expect(localizedDefaults).toHaveProperty("title");
    expect(insertValues).not.toHaveProperty("title");
  });

  it("returns empty localizedDefaults for a non-localized single", () => {
    const service = createQueryService();
    const meta = siteSettingsMeta({
      fields: [{ name: "region", type: "text", defaultValue: "us" }],
    });

    const { insertValues, localizedDefaults } =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock meta
      service.buildDefaultDocument(meta as any);

    expect(localizedDefaults).toEqual({});
    expect(insertValues).toMatchObject({ region: "us" });
  });
});
