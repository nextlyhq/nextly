/**
 * A column a schema hook contributes to a Single's table is invisible to the
 * Single entry API in both directions.
 *
 * `extendTable` on a Single's table adds a real column there and marks it
 * hidden, so every `selectOne()` and every `update(..., { returning: "*" })`
 * on that table carries it, and every write payload that names it reaches it.
 * Its contributor writes it through `ctx.db`; the Single's read and write
 * responses must not return it, and a Single write must not set it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearActiveExtensionSchema,
  setActiveExtensionSchema,
} from "../../schema/extension/active-schema";
import { buildExtensionSchema } from "../../schema/extension/build-extension-schema";
import { col } from "../../schema/extension/dsl";
import { splitPendingChange } from "../services/apply-pending-change";
import { SingleEntryService } from "../services/single-entry-service";

import {
  createMockAdapter,
  createMockComponentDataService,
  createMockHookRegistry,
  createMockSingleRegistry,
  createSilentLogger,
  siteSettingsMeta,
} from "./single-test-helpers";

const TABLE = "single_site_settings";

async function activateContributedColumn(): Promise<void> {
  const schema = await buildExtensionSchema({
    dialect: "postgresql",
    coreTableNames: ["users", "media"],
    entities: [
      {
        name: TABLE,
        slug: "site-settings",
        entityKind: "single",
        columns: [
          { name: "id", kind: "varchar", nullable: false },
          { name: "site_name", kind: "text", nullable: true },
        ],
      },
    ],
    pluginPrefixes: new Map(),
    plugins: [],
    app: {
      owner: { kind: "app" },
      extend: [
        ({ schema: draft }) => {
          draft.extendTable(TABLE, {
            columns: { searchVector: col.text({ nullable: true }) },
          });
        },
      ],
    },
  });
  setActiveExtensionSchema("postgresql", schema);
}

function createService() {
  const adapter = createMockAdapter();
  const registry = createMockSingleRegistry();
  registry.registerSingle("site-settings", siteSettingsMeta());
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

describe("a column a schema hook contributed to a Single's table", () => {
  beforeEach(async () => {
    await activateContributedColumn();
  });

  afterEach(() => {
    clearActiveExtensionSchema();
  });

  it("is absent from a read, while the Single's own fields remain", async () => {
    const { service, adapter } = createService();
    adapter.selectOne.mockResolvedValue({
      id: "doc-1",
      siteName: "My Site",
      tagline: "Hello",
      search_vector: "my site hello",
    });

    const result = await service.get("site-settings");

    expect(result.success).toBe(true);
    expect(result.data?.siteName).toBe("My Site");
    expect(result.data?.tagline).toBe("Hello");
    expect(result.data).not.toHaveProperty("search_vector");
  });

  it("is absent from an update response, while the written field remains", async () => {
    const { service, adapter } = createService();
    adapter.selectOne.mockResolvedValue({
      id: "doc-1",
      siteName: "Old",
      search_vector: "old",
    });
    adapter.update.mockResolvedValue([
      {
        id: "doc-1",
        siteName: "New",
        search_vector: "new",
      },
    ]);

    const result = await service.update(
      "site-settings",
      { siteName: "New" },
      { overrideAccess: true }
    );

    expect(result.success).toBe(true);
    expect(result.data?.siteName).toBe("New");
    expect(result.data).not.toHaveProperty("search_vector");
  });

  it("is not written by an update that carries it, in either spelling", async () => {
    const { service, adapter } = createService();
    adapter.selectOne.mockResolvedValue({ id: "doc-1", siteName: "Old" });
    adapter.update.mockResolvedValue([{ id: "doc-1", siteName: "New" }]);

    const result = await service.update(
      "site-settings",
      { siteName: "New", searchVector: "a", search_vector: "b" },
      { overrideAccess: true }
    );

    expect(result.success).toBe(true);
    const [tableName, payload] = adapter.update.mock.calls[0];
    expect(tableName).toBe(TABLE);
    expect(payload.site_name).toBe("New");
    expect(payload).not.toHaveProperty("search_vector");
    expect(payload).not.toHaveProperty("searchVector");
  });

  it("is not written when a stored pending change carries it", () => {
    // A pending change is promoted into the live row by a later publish, so
    // it is a write payload too, and one saved before this rule may hold it.
    const { main } = splitPendingChange(
      { siteName: "Draft", searchVector: "from-draft" },
      TABLE,
      siteSettingsMeta().fields,
      null
    );

    expect(main.site_name).toBe("Draft");
    expect(main).not.toHaveProperty("search_vector");
  });
});
