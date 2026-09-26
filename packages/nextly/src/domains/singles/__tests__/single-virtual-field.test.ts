/**
 * A virtual field on a Single stores nothing, so a Single write that carries
 * one — set by the caller, or computed on read and sent back — must succeed
 * without naming it in the row, and a stored pending change that carries it
 * must not promote it into the row either.
 *
 * The Single's own field (`siteName`) is the control in each case: it reaches
 * the row, so the virtual field's absence is the rule and not an empty payload.
 */
import { describe, expect, it } from "vitest";

import { splitPendingChange } from "../services/apply-pending-change";
import { SingleEntryService } from "../services/single-entry-service";

import {
  createMockAdapter,
  createMockComponentDataService,
  createMockHookRegistry,
  createMockSingleRegistry,
  createSilentLogger,
  siteSettingsMeta,
  textField,
} from "./single-test-helpers";

const TABLE = "single_site_settings";

const FIELDS = [
  textField("siteName"),
  { name: "displayTitle", type: "text" as const, virtual: true },
];

function createService() {
  const adapter = createMockAdapter();
  const registry = createMockSingleRegistry();
  registry.registerSingle(
    "site-settings",
    siteSettingsMeta({ fields: FIELDS })
  );
  const service = new SingleEntryService(
    adapter as unknown as ConstructorParameters<typeof SingleEntryService>[0],
    createSilentLogger(),
    registry as unknown as ConstructorParameters<typeof SingleEntryService>[2],
    createMockHookRegistry() as unknown as ConstructorParameters<
      typeof SingleEntryService
    >[3],
    createMockComponentDataService() as unknown as ConstructorParameters<
      typeof SingleEntryService
    >[4]
  );
  return { service, adapter };
}

describe("a virtual field on a Single", () => {
  it("is not named in the row an update writes", async () => {
    const { service, adapter } = createService();
    adapter.selectOne.mockResolvedValue({ id: "doc-1", siteName: "Old" });
    adapter.update.mockResolvedValue([{ id: "doc-1", siteName: "New" }]);

    const result = await service.update(
      "site-settings",
      { siteName: "New", displayTitle: "Computed" },
      { overrideAccess: true }
    );

    expect(result.success).toBe(true);
    const [tableName, payload] = adapter.update.mock.calls[0];
    expect(tableName).toBe(TABLE);
    expect(payload.site_name).toBe("New");
    expect(payload).not.toHaveProperty("display_title");
    expect(payload).not.toHaveProperty("displayTitle");
  });

  it("is not promoted from a stored pending change", () => {
    const { main } = splitPendingChange(
      { siteName: "Draft", displayTitle: "Computed" },
      TABLE,
      FIELDS,
      null
    );

    expect(main.site_name).toBe("Draft");
    expect(main).not.toHaveProperty("display_title");
    expect(main).not.toHaveProperty("displayTitle");
  });
});
