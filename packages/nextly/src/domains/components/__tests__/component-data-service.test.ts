import { describe, it, expect, beforeEach, vi } from "vitest";

import { ComponentDataService } from "../../../services/components/component-data-service";

import {
  createSilentLogger,
  createMockAdapter,
  createMockTxContext,
  createMockComponentRegistry,
  createMockRelationshipService,
  seoComponentField,
  repeatableComponentField,
  multiComponentField,
  seoComponentMeta,
  featureComponentMeta,
  heroComponentMeta,
  ctaComponentMeta,
} from "./component-test-helpers";

type ComponentDataTestCtx = {
  service: ComponentDataService;
  adapter: ReturnType<typeof createMockAdapter>;
  registry: ReturnType<typeof createMockComponentRegistry>;
  relationship: ReturnType<typeof createMockRelationshipService>;
};

function createCtx(
  adapterOverrides: Record<string, unknown> = {}
): ComponentDataTestCtx {
  const adapter = createMockAdapter(adapterOverrides);
  const registry = createMockComponentRegistry();
  const relationship = createMockRelationshipService();
  const logger = createSilentLogger();

  const service = new ComponentDataService(
    adapter as unknown as Parameters<typeof ComponentDataService>[0],
    logger,
    registry as unknown as Parameters<typeof ComponentDataService>[2],
    relationship as unknown as Parameters<typeof ComponentDataService>[3]
  );

  return { service, adapter, registry, relationship };
}

describe("ComponentDataService", () => {
  let ctx: ComponentDataTestCtx;

  beforeEach(() => {
    ctx = createCtx();
    ctx.registry.registerComponent("seo", seoComponentMeta());
    ctx.registry.registerComponent("feature", featureComponentMeta());
    ctx.registry.registerComponent("hero", heroComponentMeta());
    ctx.registry.registerComponent("cta", ctaComponentMeta());
  });


  describe("saveComponentData (single component)", () => {
    it("inserts a new instance when none exists", async () => {
      ctx.adapter.select.mockResolvedValue([]); // no existing

      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [seoComponentField()],
        data: { seo: { metaTitle: "About Us" } },
      });

      expect(ctx.adapter.insert).toHaveBeenCalledTimes(1);
      const [tableName, row] = ctx.adapter.insert.mock.calls[0];
      expect(tableName).toBe("comp_seo");
      expect(row).toMatchObject({
        _parent_id: "entry-1",
        _parent_table: "dc_pages",
        _parent_field: "seo",
        _order: 0,
        _component_type: null,
        meta_title: "About Us",
      });
      expect(row.id).toBeDefined();
      expect(row.created_at).toBeDefined();
      expect(row.updated_at).toBeDefined();
    });

    it("updates an existing instance in-place (preserves id)", async () => {
      ctx.adapter.select.mockResolvedValue([
        {
          id: "seo-instance-1",
          _parent_id: "entry-1",
          _parent_table: "dc_pages",
          _parent_field: "seo",
          _order: 0,
          _component_type: null,
          meta_title: "Old Title",
        },
      ]);

      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [seoComponentField()],
        data: { seo: { metaTitle: "New Title" } },
      });

      expect(ctx.adapter.insert).not.toHaveBeenCalled();
      expect(ctx.adapter.update).toHaveBeenCalledTimes(1);
      const [tableName, updateData] = ctx.adapter.update.mock.calls[0];
      expect(tableName).toBe("comp_seo");
      expect(updateData).toMatchObject({ meta_title: "New Title" });
      expect(updateData.updated_at).toBeDefined();
    });

    it("skips component fields not in the data", async () => {
      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [seoComponentField()],
        data: { title: "Hello" }, // no seo
      });

      expect(ctx.adapter.select).not.toHaveBeenCalled();
      expect(ctx.adapter.insert).not.toHaveBeenCalled();
      expect(ctx.adapter.update).not.toHaveBeenCalled();
    });

    it("deletes existing data when the field value is explicitly null", async () => {
      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [seoComponentField()],
        data: { seo: null },
      });

      expect(ctx.adapter.delete).toHaveBeenCalledTimes(1);
      const [tableName] = ctx.adapter.delete.mock.calls[0];
      expect(tableName).toBe("comp_seo");
    });

    it("skips non-component fields", async () => {
      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [{ name: "title", type: "text" }],
        data: { title: "Hello" },
      });

      expect(ctx.adapter.insert).not.toHaveBeenCalled();
    });
  });


  describe("saveComponentData (repeatable component)", () => {
    it("inserts all new instances with ascending _order", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [repeatableComponentField()],
        data: {
          features: [
            { title: "First", description: "A" },
            { title: "Second", description: "B" },
            { title: "Third", description: "C" },
          ],
        },
      });

      expect(ctx.adapter.insert).toHaveBeenCalledTimes(3);
      const rows = ctx.adapter.insert.mock.calls.map(
        (c: unknown[]) => c[1] as Record<string, unknown>
      );
      expect(rows.map(r => r._order)).toEqual([0, 1, 2]);
      expect(rows.map(r => r._parent_field)).toEqual([
        "features",
        "features",
        "features",
      ]);
    });

    it("updates existing instances by id and preserves ids", async () => {
      ctx.adapter.select.mockResolvedValue([
        {
          id: "feat-a",
          _parent_id: "entry-1",
          _parent_table: "dc_pages",
          _parent_field: "features",
          _order: 0,
          _component_type: null,
          title: "Old A",
        },
        {
          id: "feat-b",
          _parent_id: "entry-1",
          _parent_table: "dc_pages",
          _parent_field: "features",
          _order: 1,
          _component_type: null,
          title: "Old B",
        },
      ]);

      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [repeatableComponentField()],
        data: {
          features: [
            { id: "feat-a", title: "New A" },
            { id: "feat-b", title: "New B" },
          ],
        },
      });

      expect(ctx.adapter.update).toHaveBeenCalledTimes(2);
      expect(ctx.adapter.insert).not.toHaveBeenCalled();
      expect(ctx.adapter.delete).not.toHaveBeenCalled();
    });

    it("deletes existing instances that are not present in incoming data", async () => {
      ctx.adapter.select.mockResolvedValue([
        {
          id: "feat-a",
          _parent_id: "entry-1",
          _parent_table: "dc_pages",
          _parent_field: "features",
          _order: 0,
          title: "A",
        },
        {
          id: "feat-b",
          _parent_id: "entry-1",
          _parent_table: "dc_pages",
          _parent_field: "features",
          _order: 1,
          title: "B",
        },
      ]);

      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [repeatableComponentField()],
        data: {
          features: [{ id: "feat-a", title: "A" }],
        },
      });

      expect(ctx.adapter.delete).toHaveBeenCalledTimes(1);
    });

    it("handles mixed create/update/delete correctly", async () => {
      ctx.adapter.select.mockResolvedValue([
        { id: "feat-a", _parent_id: "entry-1", _order: 0, title: "A" },
        { id: "feat-b", _parent_id: "entry-1", _order: 1, title: "B" },
      ]);

      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [repeatableComponentField()],
        data: {
          features: [
            { id: "feat-a", title: "A updated" }, // update
            { title: "New feature" }, // create
          ],
        },
      });

      expect(ctx.adapter.update).toHaveBeenCalledTimes(1);
      expect(ctx.adapter.insert).toHaveBeenCalledTimes(1);
      expect(ctx.adapter.delete).toHaveBeenCalledTimes(1);
    });

    it("warns and returns when data is not an array", async () => {
      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [repeatableComponentField()],
        data: { features: "not-an-array" },
      });

      expect(ctx.adapter.insert).not.toHaveBeenCalled();
      expect(ctx.adapter.update).not.toHaveBeenCalled();
    });
  });


  describe("saveComponentData (multi-component)", () => {
    it("inserts instances into the correct table based on _componentType", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [multiComponentField()],
        data: {
          layout: [
            { _componentType: "hero", heading: "Welcome" },
            { _componentType: "cta", label: "Buy" },
          ],
        },
      });

      expect(ctx.adapter.insert).toHaveBeenCalledTimes(2);
      const rows = ctx.adapter.insert.mock.calls.map((c: unknown[]) => ({
        table: c[0],
        row: c[1] as Record<string, unknown>,
      }));
      expect(rows[0].table).toBe("comp_hero");
      expect(rows[0].row._component_type).toBe("hero");
      expect(rows[0].row._order).toBe(0);
      expect(rows[1].table).toBe("comp_cta");
      expect(rows[1].row._component_type).toBe("cta");
      expect(rows[1].row._order).toBe(1);
    });

    it("skips instances with invalid _componentType (not in allowed components)", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [multiComponentField()],
        data: {
          layout: [
            { _componentType: "invalid-slug", heading: "X" },
            { _componentType: "hero", heading: "Valid" },
          ],
        },
      });

      expect(ctx.adapter.insert).toHaveBeenCalledTimes(1);
      expect(ctx.adapter.insert.mock.calls[0][0]).toBe("comp_hero");
    });

    it("skips instances missing _componentType", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [multiComponentField()],
        data: {
          layout: [{ heading: "Missing type" }],
        },
      });

      expect(ctx.adapter.insert).not.toHaveBeenCalled();
    });

    it("deletes removed instances across all component tables", async () => {
      // Existing in comp_hero
      ctx.adapter.select.mockImplementation(async (table: string) => {
        if (table === "comp_hero") {
          return [
            {
              id: "hero-1",
              _parent_id: "entry-1",
              _order: 0,
              _component_type: "hero",
              heading: "Old",
            },
          ];
        }
        if (table === "comp_cta") {
          return [
            {
              id: "cta-1",
              _parent_id: "entry-1",
              _order: 1,
              _component_type: "cta",
              label: "Old",
            },
          ];
        }
        return [];
      });

      await ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [multiComponentField()],
        data: {
          layout: [{ id: "hero-1", _componentType: "hero", heading: "New" }],
        },
      });

      // hero-1 should be updated, cta-1 should be deleted
      expect(ctx.adapter.update).toHaveBeenCalledTimes(1);
      expect(ctx.adapter.delete).toHaveBeenCalledTimes(1);
      expect(ctx.adapter.delete.mock.calls[0][0]).toBe("comp_cta");
    });
  });


  describe("saveComponentDataInTransaction", () => {
    it("uses the transaction context instead of the adapter", async () => {
      const tx = createMockTxContext({
        select: vi.fn().mockResolvedValue([]),
      });

      await ctx.service.saveComponentDataInTransaction(
        tx as unknown as Parameters<
          typeof ctx.service.saveComponentDataInTransaction
        >[0],
        {
          parentId: "entry-1",
          parentTable: "dc_pages",
          fields: [seoComponentField()],
          data: { seo: { metaTitle: "About" } },
        }
      );

      expect(tx.insert).toHaveBeenCalledTimes(1);
      expect(ctx.adapter.insert).not.toHaveBeenCalled();
    });
  });


  describe("deleteComponentData", () => {
    it("deletes all component instances for a parent across all component fields", async () => {
      await ctx.service.deleteComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [seoComponentField(), repeatableComponentField()],
      });

      expect(ctx.adapter.delete).toHaveBeenCalledTimes(2);
      const tables = ctx.adapter.delete.mock.calls.map((c: unknown[]) => c[0]);
      expect(tables).toContain("comp_seo");
      expect(tables).toContain("comp_feature");
    });

    it("deletes from all allowed tables for multi-component fields", async () => {
      await ctx.service.deleteComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [multiComponentField()],
      });

      expect(ctx.adapter.delete).toHaveBeenCalledTimes(2);
      const tables = ctx.adapter.delete.mock.calls.map((c: unknown[]) => c[0]);
      expect(tables).toContain("comp_hero");
      expect(tables).toContain("comp_cta");
    });

    it("ignores errors from missing component tables", async () => {
      ctx.adapter.delete.mockRejectedValueOnce(new Error("table missing"));

      await expect(
        ctx.service.deleteComponentData({
          parentId: "entry-1",
          parentTable: "dc_pages",
          fields: [seoComponentField()],
        })
      ).resolves.toBeUndefined();
    });

    it("skips non-component fields", async () => {
      await ctx.service.deleteComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [{ name: "title", type: "text" }],
      });

      expect(ctx.adapter.delete).not.toHaveBeenCalled();
    });
  });

  describe("deleteComponentDataInTransaction", () => {
    it("uses the transaction context instead of the adapter", async () => {
      const tx = createMockTxContext();

      await ctx.service.deleteComponentDataInTransaction(
        tx as unknown as Parameters<
          typeof ctx.service.deleteComponentDataInTransaction
        >[0],
        {
          parentId: "entry-1",
          parentTable: "dc_pages",
          fields: [seoComponentField()],
        }
      );

      expect(tx.delete).toHaveBeenCalledTimes(1);
      expect(ctx.adapter.delete).not.toHaveBeenCalled();
    });
  });


  describe("populateComponentData (single entry)", () => {
    it("populates a single (non-repeatable) component field as an object", async () => {
      ctx.adapter.select.mockResolvedValue([
        {
          id: "seo-1",
          _parent_id: "entry-1",
          _parent_table: "dc_pages",
          _parent_field: "seo",
          _order: 0,
          _component_type: null,
          meta_title: "Hello",
          meta_description: "World",
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
      ]);

      const result = await ctx.service.populateComponentData({
        entry: { id: "entry-1", title: "Page" },
        parentTable: "dc_pages",
        fields: [seoComponentField()],
      });

      expect(result.seo).toMatchObject({
        id: "seo-1",
        metaTitle: "Hello",
        metaDescription: "World",
      });
      // Internal columns should be stripped
      expect(result.seo).not.toHaveProperty("_parent_id");
      expect(result.seo).not.toHaveProperty("_parent_table");
      expect(result.seo).not.toHaveProperty("_parent_field");
      expect(result.seo).not.toHaveProperty("_order");
    });

    it("returns null for single component field when no instance exists", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      const result = await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [seoComponentField()],
      });

      expect(result.seo).toBeNull();
    });

    it("populates a repeatable component field as an array ordered by _order", async () => {
      ctx.adapter.select.mockResolvedValue([
        {
          id: "f1",
          _parent_id: "entry-1",
          _order: 0,
          title: "First",
        },
        {
          id: "f2",
          _parent_id: "entry-1",
          _order: 1,
          title: "Second",
        },
      ]);

      const result = await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [repeatableComponentField()],
      });

      expect(Array.isArray(result.features)).toBe(true);
      expect(result.features).toHaveLength(2);
      expect(
        (result.features as Array<{ id: string; title: string }>)[0]
      ).toMatchObject({
        id: "f1",
        title: "First",
      });
    });

    it("returns empty array for repeatable field when no instances exist", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      const result = await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [repeatableComponentField()],
      });

      expect(result.features).toEqual([]);
    });

    it("populates multi-component field with _componentType discriminator", async () => {
      ctx.adapter.select.mockImplementation(async (table: string) => {
        if (table === "comp_hero") {
          return [
            {
              id: "hero-1",
              _parent_id: "entry-1",
              _order: 0,
              _component_type: "hero",
              heading: "Hi",
            },
          ];
        }
        if (table === "comp_cta") {
          return [
            {
              id: "cta-1",
              _parent_id: "entry-1",
              _order: 1,
              _component_type: "cta",
              label: "Click",
            },
          ];
        }
        return [];
      });

      const result = await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [multiComponentField()],
      });

      expect(Array.isArray(result.layout)).toBe(true);
      expect(result.layout).toHaveLength(2);
      const layout = result.layout as Array<{ _componentType: string }>;
      expect(layout[0]._componentType).toBe("hero");
      expect(layout[1]._componentType).toBe("cta");
    });

    it("sorts multi-component results by _order across tables", async () => {
      ctx.adapter.select.mockImplementation(async (table: string) => {
        if (table === "comp_hero") {
          return [
            {
              id: "hero-1",
              _parent_id: "entry-1",
              _order: 2,
              _component_type: "hero",
              heading: "Third",
            },
          ];
        }
        if (table === "comp_cta") {
          return [
            {
              id: "cta-1",
              _parent_id: "entry-1",
              _order: 0,
              _component_type: "cta",
              label: "First",
            },
            {
              id: "cta-2",
              _parent_id: "entry-1",
              _order: 1,
              _component_type: "cta",
              label: "Second",
            },
          ];
        }
        return [];
      });

      const result = await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [multiComponentField()],
      });

      const layout = result.layout as Array<{ id: string }>;
      expect(layout.map(l => l.id)).toEqual(["cta-1", "cta-2", "hero-1"]);
    });

    it("returns entry unchanged when entry.id is missing", async () => {
      const entry = { title: "No id" };
      const result = await ctx.service.populateComponentData({
        entry,
        parentTable: "dc_pages",
        fields: [seoComponentField()],
      });

      expect(result).toBe(entry);
      expect(ctx.adapter.select).not.toHaveBeenCalled();
    });

    it("returns default value on populate failure", async () => {
      ctx.adapter.select.mockRejectedValue(new Error("table missing"));

      const result = await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [seoComponentField()],
      });

      // Single field default = null
      expect(result.seo).toBeNull();
    });

    it("returns empty array default on repeatable populate failure", async () => {
      ctx.adapter.select.mockRejectedValue(new Error("table missing"));

      const result = await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [repeatableComponentField()],
      });

      expect(result.features).toEqual([]);
    });

    it("respects select whitelist and skips non-selected fields", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [seoComponentField(), repeatableComponentField()],
        select: { seo: true }, // only seo, skip features
      });

      // Only seo table queried
      const tables = ctx.adapter.select.mock.calls.map((c: unknown[]) => c[0]);
      expect(tables).toContain("comp_seo");
      expect(tables).not.toContain("comp_feature");
    });

    it("populates all fields when select is not provided", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [seoComponentField(), repeatableComponentField()],
      });

      const tables = ctx.adapter.select.mock.calls.map((c: unknown[]) => c[0]);
      expect(tables).toContain("comp_seo");
      expect(tables).toContain("comp_feature");
    });

    it("parses JSON-type field values during deserialization", async () => {
      ctx.registry.registerComponent("seo", {
        ...seoComponentMeta(),
        fields: [
          { name: "metaTitle", type: "text" },
          { name: "keywords", type: "json" },
        ],
      });

      ctx.adapter.select.mockResolvedValue([
        {
          id: "seo-1",
          _parent_id: "entry-1",
          _order: 0,
          meta_title: "Hello",
          keywords: '["tag1","tag2"]',
        },
      ]);

      const result = await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [seoComponentField()],
      });

      expect((result.seo as Record<string, unknown>).keywords).toEqual([
        "tag1",
        "tag2",
      ]);
    });

    it("calls relationshipService.expandRelationships when service is available", async () => {
      ctx.adapter.select.mockResolvedValue([
        { id: "seo-1", _parent_id: "entry-1", _order: 0, meta_title: "X" },
      ]);

      await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [seoComponentField()],
        depth: 2,
      });

      expect(ctx.relationship.expandRelationships).toHaveBeenCalled();
    });

    it("skips relationship expansion when depth is 0", async () => {
      ctx.adapter.select.mockResolvedValue([
        { id: "seo-1", _parent_id: "entry-1", _order: 0, meta_title: "X" },
      ]);

      await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [seoComponentField()],
        depth: 0,
      });

      expect(ctx.relationship.expandRelationships).not.toHaveBeenCalled();
    });
  });


  describe("populateComponentDataMany (batch)", () => {
    it("populates multiple entries with one query per component field (N+1 prevention)", async () => {
      ctx.adapter.select.mockResolvedValue([
        {
          id: "seo-1",
          _parent_id: "entry-1",
          _order: 0,
          meta_title: "One",
        },
        {
          id: "seo-2",
          _parent_id: "entry-2",
          _order: 0,
          meta_title: "Two",
        },
      ]);

      const result = await ctx.service.populateComponentDataMany({
        entries: [
          { id: "entry-1", title: "Page 1" },
          { id: "entry-2", title: "Page 2" },
        ],
        parentTable: "dc_pages",
        fields: [seoComponentField()],
      });

      // One query for all entries (N+1 prevention)
      expect(ctx.adapter.select).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect((result[0].seo as Record<string, unknown>).metaTitle).toBe("One");
      expect((result[1].seo as Record<string, unknown>).metaTitle).toBe("Two");
    });

    it("returns entries unchanged when the entries array is empty", async () => {
      const result = await ctx.service.populateComponentDataMany({
        entries: [],
        parentTable: "dc_pages",
        fields: [seoComponentField()],
      });

      expect(result).toEqual([]);
      expect(ctx.adapter.select).not.toHaveBeenCalled();
    });

    it("applies default values to entries without matching component data", async () => {
      ctx.adapter.select.mockResolvedValue([
        { id: "seo-1", _parent_id: "entry-1", _order: 0, meta_title: "One" },
      ]);

      const result = await ctx.service.populateComponentDataMany({
        entries: [
          { id: "entry-1", title: "Page 1" },
          { id: "entry-2", title: "Page 2" }, // no data
        ],
        parentTable: "dc_pages",
        fields: [seoComponentField()],
      });

      expect(result[0].seo).toBeDefined();
      expect(result[1].seo).toBeNull(); // default for single mode
    });

    it("groups repeatable component data by parent id", async () => {
      ctx.adapter.select.mockResolvedValue([
        { id: "f1", _parent_id: "entry-1", _order: 0, title: "1a" },
        { id: "f2", _parent_id: "entry-1", _order: 1, title: "1b" },
        { id: "f3", _parent_id: "entry-2", _order: 0, title: "2a" },
      ]);

      const result = await ctx.service.populateComponentDataMany({
        entries: [{ id: "entry-1" }, { id: "entry-2" }],
        parentTable: "dc_pages",
        fields: [repeatableComponentField()],
      });

      expect((result[0].features as unknown[]).length).toBe(2);
      expect((result[1].features as unknown[]).length).toBe(1);
    });

    it("respects select whitelist in batch mode", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.populateComponentDataMany({
        entries: [{ id: "entry-1" }],
        parentTable: "dc_pages",
        fields: [seoComponentField(), repeatableComponentField()],
        select: { seo: true },
      });

      const tables = ctx.adapter.select.mock.calls.map((c: unknown[]) => c[0]);
      expect(tables).toContain("comp_seo");
      expect(tables).not.toContain("comp_feature");
    });

    it("filters out entries without ids before batch query", async () => {
      ctx.adapter.select.mockResolvedValue([]);

      await ctx.service.populateComponentDataMany({
        entries: [{ title: "No id" }, { id: "entry-1" }],
        parentTable: "dc_pages",
        fields: [seoComponentField()],
      });

      // Only one id passed to query
      const args = ctx.adapter.select.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const where = args.where as Record<string, unknown>;
      const andArr = where.and as Array<Record<string, unknown>>;
      const inCond = andArr.find(c => c.op === "IN");
      expect(inCond?.value).toEqual(["entry-1"]);
    });
  });


  describe("setRelationshipService", () => {
    it("allows late injection when not provided at construction", async () => {
      const registry = createMockComponentRegistry();
      registry.registerComponent("seo", seoComponentMeta());
      const adapter = createMockAdapter();
      adapter.select.mockResolvedValue([
        { id: "seo-1", _parent_id: "entry-1", _order: 0, meta_title: "X" },
      ]);

      const logger = createSilentLogger();
      const service = new ComponentDataService(
        adapter as unknown as Parameters<typeof ComponentDataService>[0],
        logger,
        registry as unknown as Parameters<typeof ComponentDataService>[2]
      );

      const lateRelationship = createMockRelationshipService();
      service.setRelationshipService(
        lateRelationship as unknown as Parameters<
          typeof service.setRelationshipService
        >[0]
      );

      await service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [seoComponentField()],
        depth: 2,
      });

      expect(lateRelationship.expandRelationships).toHaveBeenCalled();
    });

    it("does not overwrite an existing relationship service", async () => {
      // ctx already has a relationship service
      const other = createMockRelationshipService();
      ctx.service.setRelationshipService(
        other as unknown as Parameters<
          typeof ctx.service.setRelationshipService
        >[0]
      );

      ctx.adapter.select.mockResolvedValue([
        { id: "seo-1", _parent_id: "entry-1", _order: 0, meta_title: "X" },
      ]);

      await ctx.service.populateComponentData({
        entry: { id: "entry-1" },
        parentTable: "dc_pages",
        fields: [seoComponentField()],
        depth: 2,
      });

      expect(ctx.relationship.expandRelationships).toHaveBeenCalled();
      expect(other.expandRelationships).not.toHaveBeenCalled();
    });
  });
});
