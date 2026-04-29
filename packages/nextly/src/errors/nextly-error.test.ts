import { describe, it, expect } from "vitest";

import { NextlyError } from "./nextly-error";

describe("NextlyError", () => {
  describe("constructor and statusCode resolution", () => {
    it("derives statusCode from code via the canonical map", () => {
      const err = new NextlyError({
        code: "NOT_FOUND",
        publicMessage: "Not found.",
      });
      expect(err.statusCode).toBe(404);
    });

    it("respects an explicit statusCode override", () => {
      const err = new NextlyError({
        code: "NOT_FOUND",
        publicMessage: "Gone.",
        statusCode: 410,
      });
      expect(err.statusCode).toBe(410);
    });

    it("falls back to 500 for unknown plugin codes without statusCode", () => {
      const err = new NextlyError({
        code: "PLUGIN_FOO_BAR",
        publicMessage: "Foo.",
      });
      expect(err.statusCode).toBe(500);
    });

    it("uses the explicit statusCode for plugin codes that pass one", () => {
      const err = new NextlyError({
        code: "FORM_BUILDER_TEMPLATE_INVALID",
        statusCode: 422,
        publicMessage: "The form template is invalid.",
      });
      expect(err.code).toBe("FORM_BUILDER_TEMPLATE_INVALID");
      expect(err.statusCode).toBe(422);
    });

    it("stores messageKey when provided", () => {
      const err = new NextlyError({
        code: "NOT_FOUND",
        publicMessage: "Not found.",
        messageKey: "errors.notFound",
      });
      expect(err.messageKey).toBe("errors.notFound");
    });

    it("preserves cause", () => {
      const cause = new Error("inner");
      const err = new NextlyError({
        code: "INTERNAL_ERROR",
        publicMessage: "boom",
        cause,
      });
      expect(err.cause).toBe(cause);
    });

    it("uses publicMessage as Error.message for stack trace ergonomics", () => {
      const err = new NextlyError({
        code: "NOT_FOUND",
        publicMessage: "Not found.",
      });
      expect(err.message).toBe("Not found.");
    });

    it("name is 'NextlyError'", () => {
      const err = new NextlyError({
        code: "NOT_FOUND",
        publicMessage: "Not found.",
      });
      expect(err.name).toBe("NextlyError");
    });
  });

  describe("toResponseJSON", () => {
    it("omits logMessage, logContext, cause, and stack from response payload", () => {
      const err = new NextlyError({
        code: "NOT_FOUND",
        publicMessage: "Not found.",
        logMessage: "tenant boundary violation",
        logContext: { secret: "value" },
        cause: new Error("inner"),
      });
      const json = err.toResponseJSON("req_test");
      expect(json).toEqual({
        code: "NOT_FOUND",
        message: "Not found.",
        requestId: "req_test",
      });
      expect(json).not.toHaveProperty("logMessage");
      expect(json).not.toHaveProperty("logContext");
      expect(json).not.toHaveProperty("cause");
      expect(json).not.toHaveProperty("stack");
    });

    it("includes data in response when publicData provided", () => {
      const err = new NextlyError({
        code: "VALIDATION_ERROR",
        publicMessage: "Validation failed.",
        publicData: {
          errors: [
            { path: "email", code: "INVALID_FORMAT", message: "Invalid." },
          ],
        },
      });
      const json = err.toResponseJSON("req_test");
      expect(json.data).toEqual({
        errors: [
          { path: "email", code: "INVALID_FORMAT", message: "Invalid." },
        ],
      });
    });

    it("includes messageKey in response when set", () => {
      const err = new NextlyError({
        code: "NOT_FOUND",
        publicMessage: "Not found.",
        messageKey: "errors.notFound",
      });
      const json = err.toResponseJSON("req_test");
      expect(json.messageKey).toBe("errors.notFound");
    });
  });

  describe("toLogJSON", () => {
    it("includes everything for debugging", () => {
      const cause = new Error("inner");
      const err = new NextlyError({
        code: "NOT_FOUND",
        publicMessage: "Not found.",
        logMessage: "tenant boundary violation",
        logContext: { entity: "post", id: "p_99" },
        cause,
      });
      const json = err.toLogJSON("req_test");
      expect(json.code).toBe("NOT_FOUND");
      expect(json.requestId).toBe("req_test");
      expect(json.logMessage).toBe("tenant boundary violation");
      expect(json.logContext).toEqual({ entity: "post", id: "p_99" });
      expect(json.cause).toBeDefined();
    });

    it("serializes cause as { name, message, stack }", () => {
      const cause = new Error("inner boom");
      const err = new NextlyError({
        code: "INTERNAL_ERROR",
        publicMessage: "ouch",
        cause,
      });
      const json = err.toLogJSON("req_test");
      expect(json.cause).toEqual({
        name: "Error",
        message: "inner boom",
        stack: cause.stack,
      });
    });
  });
});

describe("NextlyError factories", () => {
  it("invalidCredentials returns 401 with safe message", () => {
    const err = NextlyError.invalidCredentials({
      logContext: { email: "x", reason: "user-not-found" },
    });
    expect(err.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(err.statusCode).toBe(401);
    expect(err.publicMessage).toBe("Invalid email or password.");
    expect(err.logContext).toEqual({ email: "x", reason: "user-not-found" });
  });

  it("authRequired returns 401 with generic message", () => {
    const err = NextlyError.authRequired();
    expect(err.code).toBe("AUTH_REQUIRED");
    expect(err.statusCode).toBe(401);
    expect(err.publicMessage).toBe("Authentication required.");
  });

  it("notFound returns 404 with generic message", () => {
    const err = NextlyError.notFound({
      logContext: { entity: "post", id: "p_99" },
    });
    expect(err.code).toBe("NOT_FOUND");
    expect(err.statusCode).toBe(404);
    expect(err.publicMessage).toBe("Not found.");
    expect(err.logContext).toEqual({ entity: "post", id: "p_99" });
  });

  it("forbidden returns 403", () => {
    const err = NextlyError.forbidden();
    expect(err.code).toBe("FORBIDDEN");
    expect(err.statusCode).toBe(403);
    expect(err.publicMessage).toBe(
      "You don't have permission to perform this action."
    );
  });

  it("validation returns 400 with errors[] in publicData", () => {
    const err = NextlyError.validation({
      errors: [
        {
          path: "email",
          code: "INVALID_FORMAT",
          message: "Must be a valid email address.",
        },
      ],
      logContext: { rejectedValue: "@nope" },
    });
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.statusCode).toBe(400);
    expect(err.publicMessage).toBe("Validation failed.");
    expect(err.publicData).toEqual({
      errors: [
        {
          path: "email",
          code: "INVALID_FORMAT",
          message: "Must be a valid email address.",
        },
      ],
    });
    expect(err.logContext).toEqual({ rejectedValue: "@nope" });
  });

  it("conflict returns 409", () => {
    const err = NextlyError.conflict({ reason: "version" });
    expect(err.code).toBe("CONFLICT");
    expect(err.statusCode).toBe(409);
    expect(err.logContext).toMatchObject({ reason: "version" });
  });

  it("duplicate returns 409 with generic message", () => {
    const err = NextlyError.duplicate({
      logContext: { entity: "user", field: "email" },
    });
    expect(err.code).toBe("DUPLICATE");
    expect(err.statusCode).toBe(409);
    expect(err.publicMessage).toBe("Resource already exists.");
  });

  it("rateLimited returns 429 with retryAfter in publicData", () => {
    const err = NextlyError.rateLimited({ retryAfterSeconds: 60 });
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.statusCode).toBe(429);
    expect(err.publicData).toEqual({ retryAfterSeconds: 60 });
  });

  it("rateLimited without retryAfter has undefined publicData", () => {
    const err = NextlyError.rateLimited();
    expect(err.publicData).toBeUndefined();
  });

  it("internal preserves cause and uses generic message", () => {
    const cause = new Error("boom");
    const err = NextlyError.internal({ cause });
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.statusCode).toBe(500);
    expect(err.publicMessage).toBe("An unexpected error occurred.");
    expect(err.cause).toBe(cause);
  });
});

describe("Brand interoperability via cross-realm symbol", () => {
  it("NextlyError.is recognises a foreign-realm class that stamps the same Symbol.for brand", () => {
    // Simulates a separately-bundled module instance of NextlyError or a
    // plugin-defined error: stamping the brand by Symbol.for with the
    // canonical key is the supported integration point.
    const NEXTLY_ERROR_BRAND = Symbol.for("@revnixhq/nextly/NextlyError");
    class ForeignBranded extends Error {
      readonly code = "NOT_FOUND";
      static {
        (ForeignBranded.prototype as unknown as Record<symbol, unknown>)[
          NEXTLY_ERROR_BRAND
        ] = true;
      }
    }
    const err = new ForeignBranded("thing not found");
    expect(NextlyError.is(err)).toBe(true);
    expect(NextlyError.isCode(err, "NOT_FOUND")).toBe(true);
    expect(NextlyError.isNotFound(err)).toBe(true);
  });
});

describe("NextlyError type guards", () => {
  it("is identifies NextlyError instances structurally", () => {
    const err = NextlyError.notFound();
    expect(NextlyError.is(err)).toBe(true);
    expect(NextlyError.is(new Error("plain"))).toBe(false);
    expect(NextlyError.is(null)).toBe(false);
    expect(NextlyError.is(undefined)).toBe(false);
    expect(NextlyError.is({ code: "NOT_FOUND" })).toBe(false);
  });

  it("is recognises subclass instances via the brand on the prototype chain", () => {
    class MyPluginError extends NextlyError {
      constructor() {
        super({
          code: "FORM_BUILDER_TEMPLATE_INVALID",
          publicMessage: "The form template is invalid.",
          statusCode: 422,
        });
        this.name = "MyPluginError";
      }
    }
    const err = new MyPluginError();
    expect(NextlyError.is(err)).toBe(true);
  });

  it("is recognises instances created via Symbol.for from another module instance", () => {
    // Simulate an error coming from a duplicated copy of @revnixhq/nextly:
    // the brand is registered globally via Symbol.for, so both copies share it.
    const brand = Symbol.for("@revnixhq/nextly/NextlyError");
    const fauxOtherCopyInstance = Object.create(null) as Record<
      symbol,
      unknown
    >;
    fauxOtherCopyInstance[brand] = true;
    expect(NextlyError.is(fauxOtherCopyInstance)).toBe(true);
  });

  it("isCode narrows by code", () => {
    const err = NextlyError.notFound();
    expect(NextlyError.isCode(err, "NOT_FOUND")).toBe(true);
    expect(NextlyError.isCode(err, "FORBIDDEN")).toBe(false);
  });

  it("specialised guards work for each kind", () => {
    expect(NextlyError.isNotFound(NextlyError.notFound())).toBe(true);
    expect(
      NextlyError.isValidation(NextlyError.validation({ errors: [] }))
    ).toBe(true);
    expect(NextlyError.isAuthRequired(NextlyError.authRequired())).toBe(true);
    expect(NextlyError.isForbidden(NextlyError.forbidden())).toBe(true);
    expect(NextlyError.isConflict(NextlyError.conflict())).toBe(true);
    expect(NextlyError.isRateLimited(NextlyError.rateLimited())).toBe(true);
    expect(NextlyError.isNotFound(NextlyError.forbidden())).toBe(false);
  });
});
