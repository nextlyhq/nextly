/**
 * The builder gate is a security control: it is what keeps the schema-builder's
 * DDL endpoints from answering in production. The route classification is
 * therefore exercised through the real `parseRestRoute` rather than against
 * hand-written {service, method} pairs — a literal pair would restate the set
 * it is checking and stay green if a method name ever drifted from the parser.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { parseRestRoute } from "../../route-handler/route-parser";
import {
  isBuilderEnabled,
  isBuilderRoute,
  requireBuilderEnabled,
} from "../builder-access";
import {
  builderDisabledError,
  isProductionRuntime,
  refuseSchemaChangeInProduction,
  showBuilderProductionNotice,
} from "../builder-refusal";

const mockGetHandlerConfig = vi.fn();
vi.mock("../../route-handler/auth-handler", () => ({
  getHandlerConfig: () => mockGetHandlerConfig(),
}));

/** Build the config shape `isBuilderEnabled` reads, leaving the rest absent. */
function configWithShowBuilder(showBuilder: boolean | undefined) {
  return { admin: { branding: { showBuilder } } };
}

/** Route classification for a request, via the parser the dispatcher uses. */
function classify(path: string, httpMethod: string): boolean {
  const segments = path.split("/").filter(Boolean);
  const { service, method } = parseRestRoute(segments, httpMethod);
  if (!service || !method)
    throw new Error(`unparsed route: ${httpMethod} /${segments.join("/")}`);
  return isBuilderRoute(service, method);
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  mockGetHandlerConfig.mockReturnValue(null);
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  vi.clearAllMocks();
});

describe("isBuilderEnabled", () => {
  it("is off in production when the host says nothing", () => {
    process.env.NODE_ENV = "production";
    expect(isBuilderEnabled()).toBe(false);
  });

  it("is on outside production when the host says nothing", () => {
    process.env.NODE_ENV = "development";
    expect(isBuilderEnabled()).toBe(true);
  });

  // Schema reaches production only through migrations, so no setting turns the builder on there.
  it("stays off in production when the host turns it on", () => {
    process.env.NODE_ENV = "production";
    mockGetHandlerConfig.mockReturnValue(configWithShowBuilder(true));
    expect(isBuilderEnabled()).toBe(false);
  });

  it("honours an explicit opt-in outside production", () => {
    process.env.NODE_ENV = "development";
    mockGetHandlerConfig.mockReturnValue(configWithShowBuilder(true));
    expect(isBuilderEnabled()).toBe(true);
  });

  it("is on in the test environment when the host says nothing", () => {
    process.env.NODE_ENV = "test";
    expect(isBuilderEnabled()).toBe(true);
  });

  it("honours an explicit opt-out over the development default", () => {
    process.env.NODE_ENV = "development";
    mockGetHandlerConfig.mockReturnValue(configWithShowBuilder(false));
    expect(isBuilderEnabled()).toBe(false);
  });

  it("falls back to the environment when the flag is absent", () => {
    process.env.NODE_ENV = "production";
    mockGetHandlerConfig.mockReturnValue(configWithShowBuilder(undefined));
    expect(isBuilderEnabled()).toBe(false);
  });

  it("falls back to the environment when branding is absent entirely", () => {
    process.env.NODE_ENV = "production";
    mockGetHandlerConfig.mockReturnValue({ admin: {} });
    expect(isBuilderEnabled()).toBe(false);
  });

  it("treats a non-boolean flag as unset rather than truthy", () => {
    process.env.NODE_ENV = "production";
    mockGetHandlerConfig.mockReturnValue(
      configWithShowBuilder("yes" as unknown as boolean)
    );
    expect(isBuilderEnabled()).toBe(false);
  });
});

describe("isBuilderRoute", () => {
  // Every schema-mutating route the parser can produce. If the parser renames a
  // method and the gate's list is not updated, the route stops being recognised
  // and these fail — which is the drift this table exists to catch.
  it.each([
    ["POST", "/collections"],
    ["PATCH", "/collections/posts"],
    ["DELETE", "/collections/posts"],
    ["POST", "/collections/schema/posts/preview"],
    ["POST", "/collections/schema/posts/apply"],
    ["POST", "/singles"],
    ["DELETE", "/singles/homepage"],
    ["PATCH", "/singles/homepage/schema"],
    ["POST", "/singles/schema/homepage/preview"],
    ["POST", "/singles/schema/homepage/apply"],
    ["POST", "/field-groups"],
    ["PATCH", "/field-groups/hero"],
    ["DELETE", "/field-groups/hero"],
    ["POST", "/field-groups/schema/hero/preview"],
    ["POST", "/field-groups/schema/hero/apply"],
    // Rewrites the stored definition, so it is builder surface exactly as the apply is. Absence
    // from the guarded set is SILENT — the route simply answers in production — which is why this
    // table is the join between the parser and `BUILDER_METHODS` rather than two lists that agree
    // by hand until one of them gains a method.
    ["POST", "/field-groups/schema/hero/reconcile"],
  ])("gates %s %s", (httpMethod, path) => {
    expect(classify(path, httpMethod)).toBe(true);
  });

  // Reads stay open everywhere: a deployed site still lists its collections to
  // manage entries. Entry CRUD is content, not schema, and must never be gated.
  it.each([
    ["GET", "/collections"],
    ["GET", "/collections/posts"],
    ["GET", "/collections/schema/posts"],
    ["GET", "/collections/posts/entries"],
    ["POST", "/collections/posts/entries"],
    ["PATCH", "/collections/posts/entries/1"],
    ["DELETE", "/collections/posts/entries/1"],
    ["GET", "/singles"],
    ["GET", "/singles/homepage"],
    ["PATCH", "/singles/homepage"],
    ["GET", "/singles/homepage/schema"],
    ["GET", "/field-groups"],
    ["GET", "/field-groups/hero"],
    ["GET", "/users"],
    ["POST", "/users"],
  ])("leaves %s %s open", (httpMethod, path) => {
    expect(classify(path, httpMethod)).toBe(false);
  });

  it("does not gate an unknown service", () => {
    expect(isBuilderRoute("media", "createMedia")).toBe(false);
  });

  it("does not match a method borrowed from another service", () => {
    expect(isBuilderRoute("collections", "createComponent")).toBe(false);
  });

  it("is not fooled by inherited object properties", () => {
    expect(isBuilderRoute("constructor", "toString")).toBe(false);
  });
});

describe("isProductionRuntime", () => {
  it("answers from NODE_ENV as it is at the call, not as it was first read", () => {
    process.env.NODE_ENV = "production";
    expect(isProductionRuntime()).toBe(true);
    process.env.NODE_ENV = "development";
    expect(isProductionRuntime()).toBe(false);
    process.env.NODE_ENV = "production";
    expect(isProductionRuntime()).toBe(true);
  });

  it.each(["development", "test", ""])("is false under NODE_ENV=%j", value => {
    process.env.NODE_ENV = value;
    expect(isProductionRuntime()).toBe(false);
  });
});

describe("builderDisabledError", () => {
  it.each(["production", "turned-off"] as const)(
    "carries its own code and a 403 (%s)",
    reason => {
      const err = builderDisabledError("create-collection", reason);
      expect(err.code).toBe("BUILDER_DISABLED");
      expect(err.statusCode).toBe(403);
    }
  );

  // In production no switch turns the builder back on, so naming one would send the reader to a
  // setting that does nothing there.
  it("in production, names migrations and no switch", () => {
    const message = builderDisabledError(
      "create-collection",
      "production"
    ).publicMessage;
    expect(message).toContain("migration");
    expect(message).not.toContain("showBuilder");
  });

  it("where showBuilder turned it off, names the switch", () => {
    expect(
      builderDisabledError("create-collection", "turned-off").publicMessage
    ).toContain("showBuilder");
  });

  it("keeps the operation out of the response body", () => {
    const json = builderDisabledError(
      "create-collection",
      "turned-off"
    ).toResponseJSON("req-1");
    expect(json).toEqual({
      code: "BUILDER_DISABLED",
      message: expect.stringContaining("showBuilder"),
      requestId: "req-1",
    });
  });
});

describe("requireBuilderEnabled", () => {
  it("throws where the builder is disabled", () => {
    process.env.NODE_ENV = "production";
    expect(() => requireBuilderEnabled("create-collection")).toThrowError(
      expect.objectContaining({ code: "BUILDER_DISABLED" })
    );
  });

  it("throws the production refusal in production, even when the host turns the builder on", () => {
    process.env.NODE_ENV = "production";
    mockGetHandlerConfig.mockReturnValue(configWithShowBuilder(true));
    expect(() => requireBuilderEnabled("create-collection")).toThrowError(
      expect.objectContaining({
        code: "BUILDER_DISABLED",
        publicMessage: builderDisabledError("x", "production").publicMessage,
      })
    );
  });

  it("throws the switch's refusal where showBuilder turned it off", () => {
    process.env.NODE_ENV = "development";
    mockGetHandlerConfig.mockReturnValue(configWithShowBuilder(false));
    expect(() => requireBuilderEnabled("create-collection")).toThrowError(
      expect.objectContaining({
        code: "BUILDER_DISABLED",
        publicMessage: builderDisabledError("x", "turned-off").publicMessage,
      })
    );
  });

  it("passes where the builder is enabled", () => {
    process.env.NODE_ENV = "development";
    expect(() => requireBuilderEnabled("create-collection")).not.toThrow();
  });
});

/**
 * The refusal for schema saves made in code (the Direct API, a plugin's service): production
 * alone decides it. `showBuilder` is an admin setting, so it does not reach a save made in code.
 */
describe("refuseSchemaChangeInProduction", () => {
  it.each([true, false, undefined])(
    "refuses in production whatever showBuilder says (%s)",
    showBuilder => {
      process.env.NODE_ENV = "production";
      mockGetHandlerConfig.mockReturnValue(configWithShowBuilder(showBuilder));
      expect(() =>
        refuseSchemaChangeInProduction("fieldGroups.create")
      ).toThrowError(
        expect.objectContaining({
          code: "BUILDER_DISABLED",
          publicMessage: builderDisabledError("x", "production").publicMessage,
        })
      );
    }
  );

  it("passes in development even where showBuilder turned the builder off", () => {
    process.env.NODE_ENV = "development";
    mockGetHandlerConfig.mockReturnValue(configWithShowBuilder(false));
    expect(() =>
      refuseSchemaChangeInProduction("fieldGroups.create")
    ).not.toThrow();
  });
});

describe("showBuilderProductionNotice", () => {
  it("is owed by a production start that finds showBuilder: true", () => {
    const notice = showBuilderProductionNotice(
      configWithShowBuilder(true),
      true
    );
    expect(notice).toContain("showBuilder");
    expect(notice).toContain("no effect in production");
    expect(notice).toContain("migrations");
  });

  it.each([
    ["a production start with showBuilder false", false, true],
    ["a production start with showBuilder unset", undefined, true],
    ["a development start with showBuilder true", true, false],
  ] as const)("is not owed by %s", (_label, showBuilder, production) => {
    expect(
      showBuilderProductionNotice(
        configWithShowBuilder(showBuilder),
        production
      )
    ).toBeNull();
  });

  it("is not owed for a config with no admin block", () => {
    expect(showBuilderProductionNotice({}, true)).toBeNull();
    expect(showBuilderProductionNotice(null, true)).toBeNull();
  });
});

/**
 * The guarded set names dispatcher methods by STRING, so it can drift from them silently.
 *
 * A renamed dispatcher method leaves a dead entry behind, and `isBuilderRoute` answers false for
 * the new name — the endpoint simply starts responding in production, with nothing red anywhere.
 * The route table above catches a method someone forgot to GUARD; this catches a method someone
 * renamed and guarded under its old name, which the table cannot see because the route still parses.
 *
 * Derived from the registry rather than restated: a second hand-written list would need the same
 * maintenance as the first and would agree with it right up until the moment it mattered.
 */
describe("the builder-guarded set stays joined to the dispatcher", () => {
  it("names only methods the component dispatcher actually has", async () => {
    const { COMPONENTS_METHODS } = await import(
      "../../dispatcher/handlers/component-dispatcher"
    );
    const { isBuilderRoute } = await import("../builder-access");

    const guarded = [
      "createComponent",
      "updateComponent",
      "deleteComponent",
      "previewComponentSchemaChanges",
      "applyComponentSchemaChanges",
      "reconcileComponent",
      "previewComponentReconcile",
    ].filter(method => isBuilderRoute("field-groups", method));

    // The population first: an empty list would satisfy every assertion below while proving that
    // the guard recognises nothing at all.
    expect(guarded.length).toBeGreaterThan(0);
    for (const method of guarded) {
      expect(Object.keys(COMPONENTS_METHODS)).toContain(method);
    }
  });
});
