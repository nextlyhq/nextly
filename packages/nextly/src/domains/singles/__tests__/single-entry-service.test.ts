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

import { NextlyError } from "../../../errors";
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
    it("translates NextlyError into SingleResult with correct status", async () => {
      ctx.adapter.selectOne.mockRejectedValue(
        new NextlyError({
          code: "VALIDATION_ERROR",
          publicMessage: "bad field",
          statusCode: 400,
        })
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

    it("preserves a component validation error (400) the adapter wraps in the transaction", async () => {
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "Old",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      // The real adapter classifies a callback error (a component NextlyError)
      // as a database error, preserving the original on `.cause`. Simulate that
      // wrapping so the service must recover the 400 instead of reporting 500.
      const validationError = new NextlyError({
        code: "VALIDATION_ERROR",
        publicMessage: "bad component field",
        statusCode: 400,
      });
      ctx.adapter.transaction.mockRejectedValueOnce(
        Object.assign(new Error("database error"), { cause: validationError })
      );

      const result = await ctx.service.update("site-settings", {
        siteName: "New",
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.message).toBe("bad component field");
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

      // The component service should be called with the component data. The
      // single update now writes components inside a transaction, so the call
      // is saveComponentDataInTransaction(tx, params) — params is the 2nd arg.
      expect(
        ctx.componentDataService.saveComponentDataInTransaction
      ).toHaveBeenCalledTimes(1);
      const saveCall =
        ctx.componentDataService.saveComponentDataInTransaction.mock
          .calls[0][1];
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

      expect(
        ctx.componentDataService.saveComponentDataInTransaction
      ).not.toHaveBeenCalled();
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
    it("translates NextlyError into SingleResult with correct status", async () => {
      ctx.adapter.selectOne.mockRejectedValue(
        new NextlyError({
          code: "VALIDATION_ERROR",
          publicMessage: "bad input",
          statusCode: 400,
        })
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

  // ============================================================
  // update() — publish-transition access
  // ============================================================

  describe("update — publish transition access", () => {
    // A single with the draft/published lifecycle enabled. RBAC allows update
    // but denies the named lifecycle op, so only the transition gate can fail.
    const lifecycleCtx = (deny: "publish" | "unpublish") => {
      const ctx = createCtx({ withRbac: true });
      ctx.registry.registerSingle(
        "site-settings",
        siteSettingsMeta({ status: true })
      );
      ctx.rbac.checkAccess.mockImplementation((args: { operation: string }) =>
        Promise.resolve(args.operation !== deny)
      );
      ctx.adapter.update.mockResolvedValue([
        { id: "doc-1", siteName: "S", updated_at: "2026-02-01T00:00:00.000Z" },
      ]);
      return ctx;
    };

    it("denies a draft→published update without publish permission", async () => {
      const ctx = lifecycleCtx("publish");
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "S",
        status: "draft",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      const result = await ctx.service.update(
        "site-settings",
        { status: "published" },
        { user: { id: "u1" } }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it("denies unpublishing without the unpublish permission", async () => {
      const ctx = lifecycleCtx("unpublish");
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "S",
        status: "published",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      const result = await ctx.service.update(
        "site-settings",
        { status: "draft" },
        { user: { id: "u1" } }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it("gates a publish derived by a beforeUpdate hook, not just the body", async () => {
      // Secure-by-result: a hook the caller cannot see derives published from a
      // body that omits status; the publish permission is still required.
      const ctx = lifecycleCtx("publish");
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "S",
        status: "draft",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.hookRegistry.hasHooks.mockImplementation(
        (phase: string) => phase === "beforeUpdate"
      );
      ctx.hookRegistry.execute.mockResolvedValue({ status: "published" });

      const result = await ctx.service.update(
        "site-settings",
        { siteName: "Body omits status" },
        { user: { id: "u1" } }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it("does not gate a status change when the single has no lifecycle", async () => {
      // No `status: true` on the single → `status` is an ordinary field, so the
      // publish permission is never consulted. The single must be registered
      // (with `status` as a plain field) so update() reaches the gate instead of
      // short-circuiting on a 404 registry miss, which would make the assertion
      // vacuous.
      const ctx = createCtx({ withRbac: true });
      ctx.registry.registerSingle(
        "site-settings",
        siteSettingsMeta({
          fields: [textField("siteName"), textField("status")],
        })
      );
      ctx.rbac.checkAccess.mockImplementation((args: { operation: string }) =>
        Promise.resolve(args.operation !== "publish")
      );
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "S",
        status: "draft",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        { id: "doc-1", siteName: "S", updated_at: "2026-02-01T00:00:00.000Z" },
      ]);

      const result = await ctx.service.update(
        "site-settings",
        { status: "published" },
        { user: { id: "u1" } }
      );

      // The write reaches and passes the gate (no lifecycle to enforce), rather
      // than 404-ing on an unregistered single.
      expect(result.success).toBe(true);
      const publishConsulted = ctx.rbac.checkAccess.mock.calls.some(
        ([args]: [{ operation: string }]) => args.operation === "publish"
      );
      expect(publishConsulted).toBe(false);
    });

    it("bypasses the transition gate under overrideAccess", async () => {
      const ctx = lifecycleCtx("publish");
      ctx.adapter.selectOne.mockResolvedValue({
        id: "doc-1",
        siteName: "S",
        status: "draft",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      const result = await ctx.service.update(
        "site-settings",
        { status: "published" },
        { overrideAccess: true }
      );

      // Assert the intended success, not merely "not 403": a regression in the
      // overrideAccess bypass that returned 500 (or no status) would still pass a
      // `not.toBe(403)` check.
      expect(result.success).toBe(true);
    });

    it("does not commit the default when a first publish is denied", async () => {
      // No row yet → the update materializes the default INSIDE the write
      // transaction and enforces the publish transition against the row-locked
      // status there. When the transition is refused, the transaction throws and
      // rolls back — so the auto-created default never commits, WITHOUT a
      // compensating delete that could destroy a concurrent writer's row. (The
      // real no-row-left-behind guarantee is exercised on a live database in
      // publish-enforcement.integration.test.ts; this mock transaction has no
      // rollback to observe, so it asserts the denial and that no compensating
      // delete is issued.)
      const ctx = lifecycleCtx("publish");
      ctx.adapter.selectOne.mockResolvedValue(null);

      const result = await ctx.service.update(
        "site-settings",
        { status: "published" },
        { user: { id: "u1" } }
      );

      expect(result.statusCode).toBe(403);
      // The write is gated within a transaction (so the insert is rolled back on
      // denial), and no compensating delete is issued.
      expect(ctx.adapter.transaction).toHaveBeenCalled();
      expect(ctx.adapter.delete).not.toHaveBeenCalled();
    });

    it("persists the default and publishes when a first publish is allowed", async () => {
      // The mirror of the denial case: when the publish IS authorized, the
      // deferred default is inserted and the write proceeds, so a legitimate
      // first-time publish is not blocked by the authorize-before-create change.
      const ctx = lifecycleCtx("unpublish"); // deny unpublish, allow publish
      ctx.adapter.selectOne.mockResolvedValue(null);
      ctx.adapter.insert.mockResolvedValue({
        id: "new-id",
        siteName: "S",
        updated_at: "2026-01-01T00:00:00.000Z",
      });

      const result = await ctx.service.update(
        "site-settings",
        { status: "published" },
        { user: { id: "u1" } }
      );

      expect(result.success).toBe(true);
      // The default row was persisted (once), only after authorization.
      expect(ctx.adapter.insert).toHaveBeenCalledTimes(1);
      expect(ctx.adapter.delete).not.toHaveBeenCalled();
    });

    it("reuses a row a hook auto-created instead of inserting a duplicate", async () => {
      // A beforeUpdate hook that reads the Single via get() can auto-create the
      // row while `autoCreated` still reflects the earlier null read. The
      // deferred insert (now inside the update transaction) re-checks for a row
      // and reuses it, so the write does not leave two rows for the Single.
      const ctx = createCtx({ withRbac: true });
      ctx.registry.registerSingle("site-settings", siteSettingsMeta());
      // Pre-transaction read finds no row (so autoCreated); the in-transaction
      // read finds the row a hook created in the meantime.
      ctx.adapter.selectOne.mockResolvedValueOnce(null).mockResolvedValue({
        id: "hook-created",
        siteName: "S",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      ctx.adapter.update.mockResolvedValue([
        { id: "hook-created", siteName: "S2", updated_at: "2026-02-01" },
      ]);

      const result = await ctx.service.update(
        "site-settings",
        { siteName: "S2" },
        { overrideAccess: true }
      );

      expect(result.success).toBe(true);
      // No duplicate insert — the existing (hook-created) row was reused.
      expect(ctx.adapter.insert).not.toHaveBeenCalled();
    });

    it("does not let a super-admin-owned key bypass a stored rule on update", async () => {
      // The primary update gate must also receive the API-key scope, so the
      // session super-admin bypass does not apply to a scoped key — otherwise a
      // super-admin-owned, update-only key would skip the Single's stored rules.
      const ctx = createCtx({ withRbac: true });
      ctx.registry.registerSingle(
        "site-settings",
        siteSettingsMeta({ accessRules: { update: { type: "owner-only" } } })
      );
      // No document yet, so the owner-only rule has no ownership to compare and
      // fails closed — but only if the super-admin bypass did not fire first.
      ctx.adapter.selectOne.mockResolvedValue(null);

      const result = await ctx.service.update(
        "site-settings",
        { siteName: "x" },
        {
          user: { id: "admin-1", roles: ["super-admin"] },
          authenticatedScope: {
            actorType: "apiKey",
            permissions: ["update-site-settings"],
          },
        }
      );

      expect(result.statusCode).toBe(403);
    });
  });
});
