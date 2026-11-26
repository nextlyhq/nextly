/**
 * The initial version snapshot for an auto-created, versioned, localized Single
 * must record the seeded localized defaults ONLY when they were actually
 * persisted — i.e. when the companion `_locales` table physically exists and the
 * seed ran. When the companion is absent (dev-before-migrate) the seed no-ops,
 * so v1 must omit those defaults and stay untagged by locale; otherwise
 * restoring v1 resurrects translations that were never persisted or visible.
 */
import { beforeAll, describe, it, expect, vi } from "vitest";

import { SingleQueryService } from "../services/single-query-service";

import {
  createMockAdapter,
  createSilentLogger,
  createMockSingleRegistry,
  createMockHookRegistry,
  siteSettingsMeta,
} from "./single-test-helpers";
import { loadDialectTables } from "../../../database/dialect-tables";

// Each dialect's builders, which this file reaches; the unit setup loads only
// the run's own dialect, as an app's adapter would.
beforeAll(async () => {
  await Promise.all(
    ["postgresql", "mysql", "sqlite"].map(d => loadDialectTables(d))
  );
});

// Intercept the version write so the test asserts exactly the snapshot + locale
// the service hands to capture, without running real version persistence.
const { capturedCalls } = vi.hoisted(() => ({
  capturedCalls: [] as unknown[],
}));
vi.mock("../../versions/capture-in-tx", () => ({
  captureInTx: vi.fn(
    async (
      _tx: unknown,
      _capture: unknown,
      args: unknown
    ): Promise<unknown> => {
      capturedCalls.push(args);
      return { versionNo: 1 };
    }
  ),
}));

type Ctor = ConstructorParameters<typeof SingleQueryService>;
type SingleMeta = Parameters<SingleQueryService["createDefaultDocument"]>[0];
interface CapturedCall {
  parts: { parentRow: Record<string, unknown> };
  locale: string | null;
}

function createService(adapter: unknown): SingleQueryService {
  return new SingleQueryService(
    adapter as Ctor[0],
    createSilentLogger() as unknown as Ctor[1],
    createMockSingleRegistry() as unknown as Ctor[2],
    createMockHookRegistry() as unknown as Ctor[3],
    undefined,
    undefined,
    { defaultLocale: "en", locales: [{ code: "en" }] } as unknown as Ctor[6]
  );
}

// A versioned, localized Single whose localized `siteName` carries a default.
const meta = () =>
  siteSettingsMeta({
    localized: true,
    status: true,
    versions: { enabled: true, maxPerDoc: 20 },
    fields: [
      {
        name: "siteName",
        type: "text",
        localized: true,
        defaultValue: "My Site",
      },
      { name: "region", type: "text", localized: false, defaultValue: "us" },
    ],
  }) as unknown as SingleMeta;

describe("createDefaultDocument initial version + localized default seeding", () => {
  it("records the seeded default and tags the default locale when the companion exists", async () => {
    capturedCalls.length = 0;
    // The pre-transaction probe (SELECT 1 FROM …_locales) succeeds → companion
    // present; the in-transaction companion seed writes via tx.execute.
    const adapter = createMockAdapter({
      executeQuery: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue([]),
    });
    const service = createService(adapter);

    await service.createDefaultDocument(meta(), {
      captureInitialVersion: true,
    });

    expect(capturedCalls).toHaveLength(1);
    const call = capturedCalls[0] as CapturedCall;
    expect(call.parts.parentRow.siteName).toBe("My Site");
    expect(call.locale).toBe("en");
  });

  it("omits the seeded default and stays locale-untagged when the companion is absent", async () => {
    capturedCalls.length = 0;
    // The probe hits a not-yet-migrated table → missing-table error → companion
    // absent, so the seed no-ops and v1 must not carry the localized default.
    // The table is missing from the catalog too: the probe asks the catalog
    // instead of querying the table while the adapter reports a transaction
    // open in the calling flow, as this mock adapter does.
    const adapter = createMockAdapter({
      executeQuery: vi
        .fn()
        .mockRejectedValue(
          new Error('relation "single_site_settings_locales" does not exist')
        ),
      tableExists: vi.fn().mockResolvedValue(false),
      execute: vi.fn().mockResolvedValue([]),
    });
    const service = createService(adapter);

    await service.createDefaultDocument(meta(), {
      captureInitialVersion: true,
    });

    expect(capturedCalls).toHaveLength(1);
    const call = capturedCalls[0] as CapturedCall;
    expect(call.parts.parentRow).not.toHaveProperty("siteName");
    expect(call.locale).toBeNull();
    // The companion seed never ran, so nothing was written via tx.execute.
    expect(adapter.execute).not.toHaveBeenCalled();
  });
});
