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

    const { insertValues, localizedDefaults } = service.buildDefaultDocument(
      meta as unknown as SingleMeta
    );

    expect(localizedDefaults).toHaveProperty("title");
    expect(insertValues).not.toHaveProperty("title");
  });

  it("preserves the seeded title/slug for the required system identity fields", () => {
    const service = createQueryService();
    // Mirror defineSingle's auto-injected system fields: `title` and `slug` are
    // required text fields with no defaultValue. The required type-default ("")
    // must NOT overwrite the label/slug seeded onto the default document, or the
    // auto-created row persists an empty title/slug.
    const meta = siteSettingsMeta({
      fields: [
        { name: "title", type: "text", required: true },
        { name: "slug", type: "text", required: true },
      ],
    });

    const { document, insertValues } = service.buildDefaultDocument(
      meta as unknown as SingleMeta
    );

    expect(insertValues.title).toBe("Site Settings");
    expect(insertValues.slug).toBe("site-settings");
    expect(document.title).toBe("Site Settings");
    expect(document.slug).toBe("site-settings");
  });

  it("keeps the system title seed when a same-named field emits no column", () => {
    const service = createQueryService();
    // A column-less field named `title` (a component) does not suppress the
    // system text title column, so the seeded label must still reach the insert
    // rather than being dropped as a no-column field.
    const meta = siteSettingsMeta({
      fields: [{ name: "title", type: "component", required: true }],
    });

    const { insertValues } = service.buildDefaultDocument(
      meta as unknown as SingleMeta
    );

    expect(insertValues.title).toBe("Site Settings");
  });

  it("uses the field's own type default when title is redefined as a non-text column", () => {
    const service = createQueryService();
    // A user redefining `title` as a number column must get its numeric default,
    // not the label string — inserting a string into a number column would fail.
    const meta = siteSettingsMeta({
      fields: [{ name: "title", type: "number", required: true }],
    });

    const { insertValues } = service.buildDefaultDocument(
      meta as unknown as SingleMeta
    );

    expect(insertValues.title).toBe(0);
  });

  it("evaluates a function defaultValue before routing it to the companion", () => {
    const service = createQueryService();
    // A localized field may carry a function default `(data) => value`. It must
    // be evaluated, not copied as a function object (which a companion upsert
    // cannot bind), now that localized defaults flow through this path.
    const meta = siteSettingsMeta({
      localized: true,
      fields: [
        {
          name: "siteName",
          type: "text",
          localized: true,
          defaultValue: () => "Computed",
        },
      ],
    });

    const { document, localizedDefaults } = service.buildDefaultDocument(
      meta as unknown as SingleMeta
    );

    expect(localizedDefaults.siteName).toBe("Computed");
    expect(document.siteName).toBe("Computed");
  });

  it("drops a localized field that emits no storage column from the defaults", () => {
    const service = createQueryService();
    // A `component` field is localized here but emits no companion column
    // (its descriptor is "skip"). Its default must not be routed to a phantom
    // companion or main column, which would fail the auto-create upsert.
    const meta = siteSettingsMeta({
      localized: true,
      fields: [
        {
          name: "siteName",
          type: "text",
          localized: true,
          defaultValue: "My Site",
        },
        { name: "hero", type: "component", localized: true, required: true },
      ],
    });

    const { localizedDefaults, insertValues } = service.buildDefaultDocument(
      meta as unknown as SingleMeta
    );

    expect(localizedDefaults).toHaveProperty("siteName");
    expect(localizedDefaults).not.toHaveProperty("hero");
    expect(insertValues).not.toHaveProperty("hero");
  });

  it("returns empty localizedDefaults for a non-localized single", () => {
    const service = createQueryService();
    const meta = siteSettingsMeta({
      fields: [{ name: "region", type: "text", defaultValue: "us" }],
    });

    const { insertValues, localizedDefaults } = service.buildDefaultDocument(
      meta as unknown as SingleMeta
    );

    expect(localizedDefaults).toEqual({});
    expect(insertValues).toMatchObject({ region: "us" });
  });
});
