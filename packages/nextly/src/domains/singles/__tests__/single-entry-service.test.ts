/**
 * SingleEntryService Contract Tests
 *
 * Captures the current behavior of SingleEntryService before it is
 * decomposed into SingleQueryService and SingleMutationService.
 * These tests must pass against both the monolithic and split
 * implementations to prove the decomposition is behavior-preserving.
 *
 * Covers:
 * - get(slug, options): registry lookup, RBAC, hooks, auto-creation,
 *   JSON deserialization, component data population, error handling
 * - update(slug, data, options): registry lookup, RBAC, hooks,
 *   upload normalization, JSON serialization, component data saving,
 *   hook mutations, error handling
 * - handleError / ServiceError translation
 */

import { describe, it, expect, beforeEach } from "vitest";

import { ServiceError, ServiceErrorCode } from "../../../errors";
import { SingleEntryService } from "../services/single-entry-service";

import {
  createMockAdapter,
  createSilentLogger,
  createMockSingleRegistry,
  createMockHookRegistry,
  createMockComponentDataService,
  createMockRBACService,
  siteSettingsMeta,
  textField,
  jsonField,
  componentFieldDef,
} from "./single-test-helpers";

// ============================================================
// Test Fixture
// ============================================================

type EntryTestCtx = {
  service: SingleEntryService;
  adapter: ReturnType<typeof createMockAdapter>;
  registry: ReturnType<typeof createMockSingleRegistry>;
  hookRegistry: ReturnType<typeof createMockHookRegistry>;
  componentDataService: ReturnType<typeof createMockComponentDataService>;
  rbac: ReturnType<typeof createMockRBACService>;
};

function createCtx(
  options: {
    adapterOverrides?: Record<string, unknown>;
    withRbac?: boolean;
  } = {}
): EntryTestCtx {
  const adapter = createMockAdapter(options.adapterOverrides ?? {});
  const registry = createMockSingleRegistry();
  const hookRegistry = createMockHookRegistry();
  const componentDataService = createMockComponentDataService();
  const rbac = createMockRBACService(true);
  const logger = createSilentLogger();

  const service = new SingleEntryService(
    adapter as unknown as Parameters<typeof SingleEntryService>[0],
    logger,
    registry as unknown as Parameters<typeof SingleEntryService>[2],
    hookRegistry as unknown as Parameters<typeof SingleEntryService>[3],
    componentDataService as unknown as Parameters<typeof SingleEntryService>[4],
    options.withRbac
      ? (rbac as unknown as Parameters<typeof SingleEntryService>[5])
      : undefined
  );

  return {
    service,
    adapter,
    registry,
    hookRegistry,
    componentDataService,
    rbac,
  };
}

describe("SingleEntryService", () => {
  let ctx: EntryTestCtx;

  beforeEach(() => {
    ctx = createCtx();
    ctx.registry.registerSingle("site-settings", siteSettingsMeta());
  });

  // ============================================================
  // get() — not found
  // ============================================================

  describe("get — registry lookup", () => {
    it("returns 404 when single is not in the registry", async () => {
      ctx.registry.getSingleBySlug.mockResolvedValue(null);

      const result = await ctx.service.get("missing");

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.message).toContain("missing");
    });
  });

  // ============================================================
  // get() — happy path (document exists)
  // ============================================================

  describe("get — document exists", () => {
    it("returns deserialized document from adapter", async () => {
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "My Site",
        tagline: "Hello",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      const result = await ctx.service.get("site-settings");

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.data?.id).toBe("doc-1");
      expect(result.data?.siteName).toBe("My Site");
      expect(ctx.adapter.selectOne).toHaveBeenCalledWith(
        "single_site_settings",
        {}
      );
    });

    it("deserializes JSON fields defined in the schema", async () => {
      ctx.registry.registerSingle("site-settings", {
        ...siteSettingsMeta(),
        fields: [textField("siteName"), jsonField("settings")],
      });
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "My Site",
        settings: JSON.stringify({ theme: "dark" }),
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      const result = await ctx.service.get("site-settings");

      expect(result.success).toBe(true);
      expect(result.data?.settings).toEqual({ theme: "dark" });
    });

    it("populates component data when a ComponentDataService is provided", async () => {
      ctx.registry.registerSingle("site-settings", {
        ...siteSettingsMeta(),
        fields: [textField("siteName"), componentFieldDef("seo", "seo")],
      });
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "My Site",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.componentDataService.populateComponentData.mockImplementation(
        async ({ entry }: { entry: Record<string, unknown> }) => ({
          ...entry,
          seo: { metaTitle: "SEO Title" },
        })
      );

      const result = await ctx.service.get("site-settings");

      expect(ctx.componentDataService.populateComponentData).toHaveBeenCalled();
      expect(result.data?.seo).toEqual({ metaTitle: "SEO Title" });
    });
  });

  // ============================================================
  // get() — auto-creation
  // ============================================================

  describe("get — auto-creation", () => {
    it("inserts a default document when none exists", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null); // no document
      ctx.adapter.insert.mockResolvedValue({
        id: "new-doc",
        siteName: "",
        tagline: "",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      const result = await ctx.service.get("site-settings");

      expect(ctx.adapter.insert).toHaveBeenCalledTimes(1);
      const [tableName, defaults] = ctx.adapter.insert.mock.calls[0];
      expect(tableName).toBe("single_site_settings");
      expect(defaults).toMatchObject({
        title: "Site Settings",
        slug: "site-settings",
      });
      expect(defaults.id).toBeDefined();
      expect(defaults.created_at).toBeDefined();
      expect(defaults.updated_at).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe("new-doc");
    });

    it("applies field default values on auto-creation", async () => {
      ctx.registry.registerSingle("site-settings", {
        ...siteSettingsMeta(),
        fields: [
          { name: "siteName", type: "text", defaultValue: "Default Site" },
          { name: "tagline", type: "text" },
        ],
      });
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue({
        id: "new-doc",
        siteName: "Default Site",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      await ctx.service.get("site-settings");

      const defaults = ctx.adapter.insert.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(defaults.site_name).toBe("Default Site");
    });
  });

  // ============================================================
  // get() — hooks
  // ============================================================

  describe("get — hooks", () => {
    it("invokes beforeOperation when hooks exist for that phase", async () => {
      ctx.hookRegistry.hasHooks.mockImplementation(
        (phase: string) => phase === "beforeOperation"
      );
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "X",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      await ctx.service.get("site-settings");

      expect(ctx.hookRegistry.executeBeforeOperation).toHaveBeenCalledTimes(1);
      const call = ctx.hookRegistry.executeBeforeOperation.mock.calls[0][0];
      expect(call.collection).toBe("single:site-settings");
      expect(call.operation).toBe("read");
    });

    it("invokes beforeRead hooks when present", async () => {
      ctx.hookRegistry.hasHooks.mockImplementation(
        (phase: string) => phase === "beforeRead"
      );
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      await ctx.service.get("site-settings");

      const calls = ctx.hookRegistry.execute.mock.calls;
      expect(calls.some((c: unknown[]) => c[0] === "beforeRead")).toBe(true);
    });

    it("applies transform returned from afterRead hook", async () => {
      ctx.hookRegistry.hasHooks.mockImplementation(
        (phase: string) => phase === "afterRead"
      );
      ctx.hookRegistry.execute.mockResolvedValue({
        id: "doc-1",
        siteName: "Transformed",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "Original",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      const result = await ctx.service.get("site-settings");

      expect(result.data?.siteName).toBe("Transformed");
    });
  });

  // ============================================================
  // get() — RBAC
  // ============================================================

  describe("get — RBAC", () => {
    it("bypasses RBAC check when overrideAccess is true", async () => {
      ctx = createCtx({ withRbac: true });
      ctx.registry.registerSingle("site-settings", siteSettingsMeta());
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      const result = await ctx.service.get("site-settings", {
        overrideAccess: true,
        user: { id: "u1" },
      });

      expect(result.success).toBe(true);
      expect(ctx.rbac.checkAccess).not.toHaveBeenCalled();
    });

    it("skips RBAC check when no user is provided", async () => {
      ctx = createCtx({ withRbac: true });
      ctx.registry.registerSingle("site-settings", siteSettingsMeta());
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      await ctx.service.get("site-settings");

      expect(ctx.rbac.checkAccess).not.toHaveBeenCalled();
    });

    it("denies with 403 when RBAC reports access denied", async () => {
      ctx = createCtx({ withRbac: true });
      ctx.registry.registerSingle("site-settings", siteSettingsMeta());
      ctx.rbac.checkAccess.mockResolvedValue(false);

      const result = await ctx.service.get("site-settings", {
        user: { id: "u1" },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(ctx.adapter.selectOne).not.toHaveBeenCalled();
    });

    it("fails secure (500) when RBAC check throws", async () => {
      ctx = createCtx({ withRbac: true });
      ctx.registry.registerSingle("site-settings", siteSettingsMeta());
      ctx.rbac.checkAccess.mockRejectedValue(new Error("boom"));

      const result = await ctx.service.get("site-settings", {
        user: { id: "u1" },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
    });

    it("calls RBAC with operation='read'", async () => {
      ctx = createCtx({ withRbac: true });
      ctx.registry.registerSingle("site-settings", siteSettingsMeta());
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      await ctx.service.get("site-settings", { user: { id: "u1" } });

      expect(ctx.rbac.checkAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "read",
          resource: "site-settings",
          userId: "u1",
        })
      );
    });
  });

  // ============================================================
  // get() — error translation
  // ============================================================

  describe("get — error handling", () => {
    it("translates ServiceError into SingleResult with correct status", async () => {
      ctx.adapter.selectOne.mockRejectedValue(
        new ServiceError(ServiceErrorCode.VALIDATION_ERROR, "bad field")
      );

      const result = await ctx.service.get("site-settings");

      expect(result.success).toBe(false);
      expect(result.message).toBe("bad field");
    });

    it("translates plain Error into 500", async () => {
      ctx.adapter.selectOne.mockRejectedValue(new Error("db exploded"));

      const result = await ctx.service.get("site-settings");

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.message).toBe("db exploded");
    });
  });

  // ============================================================
  // update() — not found
  // ============================================================

  describe("update — registry lookup", () => {
    it("returns 404 when single is not in the registry", async () => {
      ctx.registry.getSingleBySlug.mockResolvedValue(null);

      const result = await ctx.service.update("missing", { siteName: "New" });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
    });
  });

  // ============================================================
  // update() — happy path
  // ============================================================

  describe("update — happy path", () => {
    it("updates the document and returns deserialized result", async () => {
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "Old",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        {
          id: "doc-1",
          siteName: "New",
          updated_at: "2026-02-01T00:00:00.000Z",
        },
      ]);

      const result = await ctx.service.update("site-settings", {
        siteName: "New",
      });

      expect(result.success).toBe(true);
      expect(result.data?.siteName).toBe("New");
      const [tableName, payload] = ctx.adapter.update.mock.calls[0];
      expect(tableName).toBe("single_site_settings");
      expect(payload.site_name).toBe("New");
      expect(payload.updated_at).toBeDefined();
    });

    it("auto-creates the document if missing before updating", async () => {
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue({
        id: "new-doc",
        siteName: "",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        {
          id: "new-doc",
          siteName: "Set",
          updated_at: "2026-02-01T00:00:00.000Z",
        },
      ]);

      const result = await ctx.service.update("site-settings", {
        siteName: "Set",
      });

      expect(ctx.adapter.insert).toHaveBeenCalledTimes(1);
      expect(ctx.adapter.update).toHaveBeenCalledTimes(1);
      expect(result.data?.siteName).toBe("Set");
    });

    it("removes id and createdAt from the update payload", async () => {
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        { id: "doc-1", updated_at: "2026-02-01T00:00:00.000Z" },
      ]);

      await ctx.service.update("site-settings", {
        id: "should-be-stripped",
        createdAt: new Date(),
        siteName: "Keep",
      });

      const payload = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(payload.id).toBeUndefined();
      expect(payload.created_at).toBeUndefined();
      expect(payload.createdAt).toBeUndefined();
      expect(payload.site_name).toBe("Keep");
    });

    it("returns 500 when the adapter reports zero updated rows", async () => {
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([]);

      const result = await ctx.service.update("site-settings", {
        siteName: "X",
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
    });
  });

  // ============================================================
  // update() — JSON field serialization
  // ============================================================

  describe("update — JSON serialization", () => {
    it("serializes JSON fields to strings before storage", async () => {
      ctx.registry.registerSingle("site-settings", {
        ...siteSettingsMeta(),
        fields: [jsonField("settings")],
      });
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        settings: "{}",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        {
          id: "doc-1",
          settings: JSON.stringify({ theme: "dark" }),
          updated_at: "2026-02-01T00:00:00.000Z",
        },
      ]);

      await ctx.service.update("site-settings", {
        settings: { theme: "dark" },
      });

      const payload = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(payload.settings).toBe(JSON.stringify({ theme: "dark" }));
    });
  });

  // ============================================================
  // update() — upload field normalization
  // ============================================================

  describe("update — upload field normalization", () => {
    it("extracts id from populated single upload object", async () => {
      ctx.registry.registerSingle("site-settings", {
        ...siteSettingsMeta(),
        fields: [{ name: "logo", type: "upload" }],
      });
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        logo: "media-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        {
          id: "doc-1",
          logo: "media-2",
          updated_at: "2026-02-01T00:00:00.000Z",
        },
      ]);

      await ctx.service.update("site-settings", {
        logo: {
          id: "media-2",
          url: "/uploads/logo.png",
          filename: "logo.png",
        },
      });

      const payload = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(payload.logo).toBe("media-2");
    });

    it("extracts ids from populated hasMany upload array", async () => {
      ctx.registry.registerSingle("site-settings", {
        ...siteSettingsMeta(),
        fields: [{ name: "gallery", type: "upload", hasMany: true }],
      });
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        {
          id: "doc-1",
          updated_at: "2026-02-01T00:00:00.000Z",
        },
      ]);

      await ctx.service.update("site-settings", {
        gallery: [
          { id: "media-1", url: "/a.png" },
          "media-2",
          { id: "media-3", url: "/c.png" },
        ],
      });

      const payload = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      // hasMany uploads are treated as JSON fields, so ids get serialized
      // into a JSON-array string after normalization.
      expect(payload.gallery).toBe(
        JSON.stringify(["media-1", "media-2", "media-3"])
      );
    });
  });

  // ============================================================
  // update() — component data
  // ============================================================

  describe("update — component data", () => {
    it("extracts component fields and saves them via ComponentDataService", async () => {
      ctx.registry.registerSingle("site-settings", {
        ...siteSettingsMeta(),
        fields: [textField("siteName"), componentFieldDef("seo", "seo")],
      });
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "Old",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        {
          id: "doc-1",
          siteName: "New",
          updated_at: "2026-02-01T00:00:00.000Z",
        },
      ]);

      await ctx.service.update("site-settings", {
        siteName: "New",
        seo: { metaTitle: "Hello" },
      });

      // The main update payload should NOT contain the component field
      const payload = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(payload.seo).toBeUndefined();

      // The component service should be called with the component data
      expect(ctx.componentDataService.saveComponentData).toHaveBeenCalledTimes(
        1
      );
      const saveCall =
        ctx.componentDataService.saveComponentData.mock.calls[0][0];
      expect(saveCall.parentTable).toBe("single_site_settings");
      expect(saveCall.data).toEqual({ seo: { metaTitle: "Hello" } });
    });

    it("does not call saveComponentData when no component fields are present", async () => {
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "Old",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        {
          id: "doc-1",
          siteName: "New",
          updated_at: "2026-02-01T00:00:00.000Z",
        },
      ]);

      await ctx.service.update("site-settings", { siteName: "New" });

      expect(ctx.componentDataService.saveComponentData).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // update() — hooks
  // ============================================================

  describe("update — hooks", () => {
    it("invokes beforeOperation for update operations", async () => {
      ctx.hookRegistry.hasHooks.mockImplementation(
        (phase: string) => phase === "beforeOperation"
      );
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        {
          id: "doc-1",
          siteName: "New",
          updated_at: "2026-02-01T00:00:00.000Z",
        },
      ]);

      await ctx.service.update("site-settings", { siteName: "New" });

      expect(ctx.hookRegistry.executeBeforeOperation).toHaveBeenCalledTimes(1);
      const call = ctx.hookRegistry.executeBeforeOperation.mock.calls[0][0];
      expect(call.operation).toBe("update");
      expect(call.collection).toBe("single:site-settings");
    });

    it("applies transform returned from beforeUpdate hook", async () => {
      ctx.hookRegistry.hasHooks.mockImplementation(
        (phase: string) => phase === "beforeUpdate"
      );
      ctx.hookRegistry.execute.mockResolvedValue({
        siteName: "Modified by hook",
      });
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        {
          id: "doc-1",
          siteName: "Modified by hook",
          updated_at: "2026-02-01T00:00:00.000Z",
        },
      ]);

      await ctx.service.update("site-settings", { siteName: "Original" });

      const payload = ctx.adapter.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(payload.site_name).toBe("Modified by hook");
    });

    it("applies transform returned from afterUpdate hook", async () => {
      ctx.hookRegistry.hasHooks.mockImplementation(
        (phase: string) => phase === "afterUpdate"
      );
      ctx.hookRegistry.execute.mockResolvedValue({
        id: "doc-1",
        siteName: "After transform",
        updatedAt: "2026-02-01T00:00:00.000Z",
      });
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        {
          id: "doc-1",
          siteName: "Original",
          updated_at: "2026-02-01T00:00:00.000Z",
        },
      ]);

      const result = await ctx.service.update("site-settings", {
        siteName: "Whatever",
      });

      expect(result.data?.siteName).toBe("After transform");
    });
  });

  // ============================================================
  // update() — RBAC
  // ============================================================

  describe("update — RBAC", () => {
    it("denies with 403 when RBAC reports access denied", async () => {
      ctx = createCtx({ withRbac: true });
      ctx.registry.registerSingle("site-settings", siteSettingsMeta());
      ctx.rbac.checkAccess.mockResolvedValue(false);

      const result = await ctx.service.update(
        "site-settings",
        { siteName: "X" },
        { user: { id: "u1" } }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(ctx.adapter.update).not.toHaveBeenCalled();
    });

    it("calls RBAC with operation='update'", async () => {
      ctx = createCtx({ withRbac: true });
      ctx.registry.registerSingle("site-settings", siteSettingsMeta());
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        {
          id: "doc-1",
          updated_at: "2026-02-01T00:00:00.000Z",
        },
      ]);

      await ctx.service.update(
        "site-settings",
        { siteName: "X" },
        { user: { id: "u1" } }
      );

      expect(ctx.rbac.checkAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "update",
          resource: "site-settings",
          userId: "u1",
        })
      );
    });
  });

  // ============================================================
  // update() — error translation
  // ============================================================

  describe("update — error handling", () => {
    it("translates ServiceError into SingleResult with correct status", async () => {
      ctx.adapter.selectOne.mockRejectedValue(
        new ServiceError(ServiceErrorCode.VALIDATION_ERROR, "bad input")
      );

      const result = await ctx.service.update("site-settings", {});

      expect(result.success).toBe(false);
      expect(result.message).toBe("bad input");
    });

    it("translates plain Error into 500", async () => {
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockRejectedValue(new Error("db exploded"));

      const result = await ctx.service.update("site-settings", {
        siteName: "X",
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.message).toBe("db exploded");
    });
  });
});
