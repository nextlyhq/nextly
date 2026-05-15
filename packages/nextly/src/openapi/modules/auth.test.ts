import { describe, expect, it } from "vitest";

import { authModule } from "./auth";

describe("authModule", () => {
  it("is named 'auth'", () => {
    expect(authModule.name).toBe("auth");
  });

  it("emits an Auth tag", () => {
    expect(authModule.tag).toEqual({
      name: "Auth",
      description:
        "Login, logout, registration, token rotation, and password recovery.",
    });
  });

  it("declares the auth operations on /api/auth/*", () => {
    const summary = authModule.operations
      .map(o => `${o.method} ${o.path}`)
      .sort();
    expect(summary).toEqual([
      "GET /api/auth/csrf",
      "POST /api/auth/forgot-password",
      "POST /api/auth/login",
      "POST /api/auth/logout",
      "POST /api/auth/refresh",
      "POST /api/auth/register",
      "POST /api/auth/reset-password",
    ]);
  });

  it("operationIds follow the auth.<verb> pattern", () => {
    const ids = authModule.operations.map(o => o.operationId).sort();
    expect(ids).toEqual([
      "auth.csrf",
      "auth.forgotPassword",
      "auth.login",
      "auth.logout",
      "auth.refresh",
      "auth.register",
      "auth.resetPassword",
    ]);
  });

  describe("public endpoints (security: [])", () => {
    it.each([
      "/api/auth/login",
      "/api/auth/register",
      "/api/auth/forgot-password",
      "/api/auth/reset-password",
      "/api/auth/csrf",
    ])("%s has no security requirement", path => {
      const op = authModule.operations.find(o => o.path === path)!;
      expect(op.security).toEqual([]);
    });
  });

  describe("authenticated endpoints (any of bearer/cookie/apiKey)", () => {
    it.each(["/api/auth/logout", "/api/auth/refresh"])(
      "%s requires one of the three schemes",
      path => {
        const op = authModule.operations.find(o => o.path === path)!;
        expect(op.security).toEqual([
          { bearerAuth: [] },
          { cookieAuth: [] },
          { apiKeyAuth: [] },
        ]);
      }
    );
  });

  describe("POST /api/auth/login", () => {
    const op = authModule.operations.find(o => o.path === "/api/auth/login")!;

    it("requires a request body with LoginRequest schema", () => {
      expect(op.requestBody?.required).toBe(true);
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/LoginRequest",
      });
    });

    it("200 references LoginResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/LoginResponse",
      });
    });

    it("declares the canonical error responses (400/401/403/429/500)", () => {
      expect(op.responses["400"]).toEqual({
        $ref: "#/components/responses/ValidationError",
      });
      expect(op.responses["401"]).toEqual({
        $ref: "#/components/responses/Unauthorized",
      });
      expect(op.responses["403"]).toEqual({
        $ref: "#/components/responses/Forbidden",
      });
      expect(op.responses["429"]).toEqual({
        $ref: "#/components/responses/RateLimited",
      });
      expect(op.responses["500"]).toEqual({
        $ref: "#/components/responses/InternalServerError",
      });
    });
  });

  describe("POST /api/auth/logout", () => {
    const op = authModule.operations.find(o => o.path === "/api/auth/logout")!;

    it("200 references LogoutResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/LogoutResponse",
      });
    });
  });

  describe("POST /api/auth/refresh", () => {
    const op = authModule.operations.find(o => o.path === "/api/auth/refresh")!;

    it("has no request body — refresh-token cookie is the input", () => {
      expect(op.requestBody).toBeUndefined();
    });

    it("200 references RefreshResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/RefreshResponse",
      });
    });

    it("401 references Unauthorized", () => {
      expect(op.responses["401"]).toEqual({
        $ref: "#/components/responses/Unauthorized",
      });
    });
  });

  describe("POST /api/auth/register", () => {
    const op = authModule.operations.find(
      o => o.path === "/api/auth/register"
    )!;

    it("requires a RegisterRequest body", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/RegisterRequest",
      });
    });

    it("200 and 201 are both registered (silent-success and reveal-mode)", () => {
      expect(op.responses["200"]).toBeDefined();
      expect(op.responses["201"]).toBeDefined();
    });

    it("200 references RegisterSilentSuccessResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/RegisterSilentSuccessResponse",
      });
    });

    it("201 references RegisterCreatedResponse", () => {
      const schema = (
        op.responses["201"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/RegisterCreatedResponse",
      });
    });
  });

  describe("POST /api/auth/forgot-password", () => {
    const op = authModule.operations.find(
      o => o.path === "/api/auth/forgot-password"
    )!;

    it("requires a ForgotPasswordRequest body", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/ForgotPasswordRequest",
      });
    });

    it("200 references ForgotPasswordResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/ForgotPasswordResponse",
      });
    });
  });

  describe("POST /api/auth/reset-password", () => {
    const op = authModule.operations.find(
      o => o.path === "/api/auth/reset-password"
    )!;

    it("requires a ResetPasswordRequest body", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/ResetPasswordRequest",
      });
    });

    it("200 references ResetPasswordResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/ResetPasswordResponse",
      });
    });
  });

  describe("GET /api/auth/csrf", () => {
    const op = authModule.operations.find(o => o.path === "/api/auth/csrf")!;

    it("is a GET with no request body", () => {
      expect(op.method).toBe("GET");
      expect(op.requestBody).toBeUndefined();
    });

    it("200 references CsrfResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/CsrfResponse",
      });
    });

    it("declares the canonical public error responses", () => {
      expect(op.responses["400"]).toEqual({
        $ref: "#/components/responses/ValidationError",
      });
      expect(op.responses["403"]).toEqual({
        $ref: "#/components/responses/Forbidden",
      });
      expect(op.responses["429"]).toEqual({
        $ref: "#/components/responses/RateLimited",
      });
      expect(op.responses["500"]).toEqual({
        $ref: "#/components/responses/InternalServerError",
      });
    });
  });

  describe("registered schemas", () => {
    const schemas = authModule.schemas ?? {};

    it("registers every schema referenced by the operations", () => {
      const names = Object.keys(schemas).sort();
      expect(names).toEqual([
        "AuthUser",
        "CsrfResponse",
        "ForgotPasswordRequest",
        "ForgotPasswordResponse",
        "LoginRequest",
        "LoginResponse",
        "LogoutResponse",
        "RefreshResponse",
        "RegisterCreatedResponse",
        "RegisterRequest",
        "RegisterSilentSuccessResponse",
        "ResetPasswordRequest",
        "ResetPasswordResponse",
      ]);
    });

    it("LoginRequest requires email + password", () => {
      const schema = schemas.LoginRequest as {
        type?: string;
        required?: string[];
        properties?: Record<string, { format?: string }>;
      };
      expect(schema.type).toBe("object");
      expect(schema.required).toEqual(["email", "password"]);
      expect(schema.properties?.email?.format).toBe("email");
    });

    it("LoginResponse carries message + user + tokens + expiresAt", () => {
      const schema = schemas.LoginResponse as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(schema.required).toEqual([
        "message",
        "user",
        "accessToken",
        "refreshToken",
        "expiresAt",
      ]);
      expect(schema.properties?.user).toEqual({
        $ref: "#/components/schemas/AuthUser",
      });
    });

    it("AuthUser carries id + email + name + image + roleIds (no password)", () => {
      const schema = schemas.AuthUser as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(schema.required).toEqual(["id", "email"]);
      const propNames = Object.keys(schema.properties ?? {}).sort();
      expect(propNames).toEqual(["email", "id", "image", "name", "roleIds"]);
      expect(propNames).not.toContain("password");
      expect(propNames).not.toContain("passwordHash");
    });

    it("RegisterRequest requires email + password + name", () => {
      const schema = schemas.RegisterRequest as {
        required?: string[];
      };
      expect(schema.required).toEqual(["email", "password", "name"]);
    });

    it("RegisterSilentSuccessResponse carries just a message", () => {
      const schema = schemas.RegisterSilentSuccessResponse as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(schema.required).toEqual(["message"]);
      expect(Object.keys(schema.properties ?? {})).toEqual(["message"]);
    });

    it("ResetPasswordRequest requires token + newPassword", () => {
      const schema = schemas.ResetPasswordRequest as {
        required?: string[];
      };
      expect(schema.required).toEqual(["token", "newPassword"]);
    });

    it("expiresAt fields use format: 'date-time'", () => {
      const login = schemas.LoginResponse as {
        properties?: Record<string, { format?: string }>;
      };
      const refresh = schemas.RefreshResponse as {
        properties?: Record<string, { format?: string }>;
      };
      expect(login.properties?.expiresAt?.format).toBe("date-time");
      expect(refresh.properties?.expiresAt?.format).toBe("date-time");
    });
  });
});
