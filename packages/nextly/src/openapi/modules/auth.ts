/**
 * Built-in module: `/api/auth/*`.
 *
 * Mirrors the real auth router in `packages/nextly/src/auth/handlers/`:
 *
 *   POST /api/auth/login            — credential login, returns user + tokens
 *   POST /api/auth/logout           — clears refresh token and cookies
 *   POST /api/auth/refresh          — rotates refresh token, re-issues access
 *   POST /api/auth/register         — public signup (silent-success by default)
 *   POST /api/auth/forgot-password  — anti-enumeration password-reset request
 *   POST /api/auth/reset-password   — consume reset token, set new password
 *   GET  /api/auth/csrf             — issue a CSRF double-submit token
 *
 * `login`, `register`, `forgot-password`, `reset-password`, and `csrf`
 * are deliberately public (no security requirement). `logout` and `refresh`
 * accept any of the three configured auth schemes (bearer / cookie /
 * apiKey); in practice both rely on the refresh-token cookie, but the
 * envelope is the same as authenticated CRUD operations for consistency.
 *
 * Schema notes:
 *   - `AuthUser` is the lean user payload echoed by auth responses
 *     (id / email / name / image / roleIds). The full user schema lives
 *     in the `users` module; the pipeline lets later modules
 *     override schemas, so once `users` is registered its richer `User`
 *     supersedes nothing here — `AuthUser` is a distinct, narrower name
 *     by design.
 *   - CSRF tokens travel via cookie + (optional) body / header echo. The
 *     request body schemas accept an optional `csrfToken` to document
 *     the body-echo form without making it mandatory.
 *
 * @module nextly/openapi/modules/auth
 */

import { defineModule } from "../generator/define-module";
import type { OperationIR, SecurityRequirementIR } from "../ir/types";
import type { OpenAPISchema } from "../types";

const AUTHENTICATED_SECURITY: readonly SecurityRequirementIR[] = [
  { bearerAuth: [] },
  { cookieAuth: [] },
  { apiKeyAuth: [] },
];

const PUBLIC_SECURITY: readonly SecurityRequirementIR[] = [];

const CSRF_TOKEN_PROP: OpenAPISchema = {
  type: "string",
  description:
    "Optional CSRF token mirror. The double-submit cookie carries the " +
    "authoritative value; clients may also echo it in the body or " +
    "`x-csrf-token` header.",
};

const COMMON_PUBLIC_ERROR_RESPONSES = {
  "400": { $ref: "#/components/responses/ValidationError" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "429": { $ref: "#/components/responses/RateLimited" },
  "500": { $ref: "#/components/responses/InternalServerError" },
} as const;

const loginOp: OperationIR = {
  path: "/api/auth/login",
  method: "POST",
  versions: ["1.0"],
  operationId: "auth.login",
  tags: ["Auth"],
  summary: "Email + password login",
  description:
    "Verifies credentials and returns a session bundle (access token, " +
    "refresh token, expiry). Tokens travel both as HttpOnly cookies " +
    "(browser clients) and in the response body (SDK / mobile / CLI). " +
    "All failure legs collapse to AUTH_INVALID_CREDENTIALS per the " +
    "anti-enumeration response policy.",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/LoginRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Login succeeded.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/LoginResponse" },
        },
      },
    },
    "401": { $ref: "#/components/responses/Unauthorized" },
    ...COMMON_PUBLIC_ERROR_RESPONSES,
  },
  security: PUBLIC_SECURITY,
  extensions: {},
};

const logoutOp: OperationIR = {
  path: "/api/auth/logout",
  method: "POST",
  versions: ["1.0"],
  operationId: "auth.logout",
  tags: ["Auth"],
  summary: "Log out",
  description:
    "Revokes the refresh token associated with the current session and " +
    "clears the access / refresh / CSRF cookies. Silent success — body is " +
    "just `{ message }`.",
  parameters: [],
  responses: {
    "200": {
      description: "Logged out.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/LogoutResponse" },
        },
      },
    },
    "403": { $ref: "#/components/responses/Forbidden" },
    "500": { $ref: "#/components/responses/InternalServerError" },
  },
  security: AUTHENTICATED_SECURITY,
  extensions: {},
};

const refreshOp: OperationIR = {
  path: "/api/auth/refresh",
  method: "POST",
  versions: ["1.0"],
  operationId: "auth.refresh",
  tags: ["Auth"],
  summary: "Rotate refresh token",
  description:
    "Reads the refresh-token cookie, consumes it (single-use rotation), " +
    "and issues a fresh access + refresh pair. Re-fetches roles from the " +
    "DB so newly granted / revoked permissions take effect within one " +
    "access-token TTL.",
  parameters: [],
  responses: {
    "200": {
      description: "Tokens rotated.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RefreshResponse" },
        },
      },
    },
    "401": { $ref: "#/components/responses/Unauthorized" },
    "500": { $ref: "#/components/responses/InternalServerError" },
  },
  security: AUTHENTICATED_SECURITY,
  extensions: {},
};

const registerOp: OperationIR = {
  path: "/api/auth/register",
  method: "POST",
  versions: ["1.0"],
  operationId: "auth.register",
  tags: ["Auth"],
  summary: "Register a new account",
  description:
    "Creates a user account. By default returns a generic " +
    "`silent-success` message (200) regardless of whether the email was " +
    "available — this eliminates account enumeration. Deployments that " +
    "opt into `auth.revealRegistrationConflict` get a 201 + the created " +
    "user on success and a 409 DUPLICATE on email collision.",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/RegisterRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Silent-success (default).",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/RegisterSilentSuccessResponse",
          },
        },
      },
    },
    "201": {
      description:
        "Account created. Only returned when `revealRegistrationConflict` " +
        "is enabled on the deployment.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RegisterCreatedResponse" },
        },
      },
    },
    "409": { $ref: "#/components/responses/Conflict" },
    ...COMMON_PUBLIC_ERROR_RESPONSES,
  },
  security: PUBLIC_SECURITY,
  extensions: {},
};

const forgotPasswordOp: OperationIR = {
  path: "/api/auth/forgot-password",
  method: "POST",
  versions: ["1.0"],
  operationId: "auth.forgotPassword",
  tags: ["Auth"],
  summary: "Request a password-reset link",
  description:
    "Always returns 200 with a generic message regardless of whether the " +
    "email matches a real account. The reset email (when applicable) " +
    "contains a single-use token consumed by `POST /api/auth/reset-password`.",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ForgotPasswordRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Generic silent-success message.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ForgotPasswordResponse" },
        },
      },
    },
    ...COMMON_PUBLIC_ERROR_RESPONSES,
  },
  security: PUBLIC_SECURITY,
  extensions: {},
};

const resetPasswordOp: OperationIR = {
  path: "/api/auth/reset-password",
  method: "POST",
  versions: ["1.0"],
  operationId: "auth.resetPassword",
  tags: ["Auth"],
  summary: "Consume a password-reset token",
  description:
    "Sets a new password using a previously-issued reset token. Every " +
    "token-related failure (expired, unknown, already used) collapses " +
    "into a single INVALID_INPUT response so consumers cannot enumerate " +
    "valid tokens. Successful reset revokes all refresh tokens for the " +
    "account, forcing re-login on every device.",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ResetPasswordRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Password reset.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ResetPasswordResponse" },
        },
      },
    },
    ...COMMON_PUBLIC_ERROR_RESPONSES,
  },
  security: PUBLIC_SECURITY,
  extensions: {},
};

const csrfOp: OperationIR = {
  path: "/api/auth/csrf",
  method: "GET",
  versions: ["1.0"],
  operationId: "auth.csrf",
  tags: ["Auth"],
  summary: "Issue a CSRF token",
  description:
    "Returns a fresh CSRF token and sets the matching `nextly_csrf` " +
    "double-submit cookie. Browser clients call this before any mutating " +
    "request, then echo the token back via the `x-csrf-token` header or " +
    "the `csrfToken` body field so the server can verify cookie ↔ value " +
    "agreement. Public and side-effect-free apart from the cookie.",
  parameters: [],
  responses: {
    "200": {
      description: "Token issued (also set as the `nextly_csrf` cookie).",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/CsrfResponse" },
        },
      },
    },
    ...COMMON_PUBLIC_ERROR_RESPONSES,
  },
  security: PUBLIC_SECURITY,
  extensions: {},
};

const AuthUser: OpenAPISchema = {
  type: "object",
  required: ["id", "email"],
  properties: {
    id: { type: "string", description: "Stable user identifier." },
    email: { type: "string", format: "email" },
    name: { type: ["string", "null"] },
    image: {
      type: ["string", "null"],
      format: "uri",
      description: "Avatar URL; null when the user has no avatar set.",
    },
    roleIds: {
      type: "array",
      items: { type: "string" },
      description: "Role IDs the user is currently a member of.",
    },
  },
  description:
    "Lean user payload returned by auth responses. The full user " +
    "representation (with timestamps, custom fields, etc.) lives in the " +
    "users module under `User`.",
};

const LoginRequest: OpenAPISchema = {
  type: "object",
  required: ["email", "password"],
  properties: {
    email: { type: "string", format: "email" },
    password: { type: "string" },
    csrfToken: CSRF_TOKEN_PROP,
  },
};

const LoginResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "user", "accessToken", "refreshToken", "expiresAt"],
  properties: {
    message: { type: "string", example: "Logged in." },
    user: { $ref: "#/components/schemas/AuthUser" },
    accessToken: {
      type: "string",
      description: "Signed JWT. Also set as an HttpOnly cookie.",
    },
    refreshToken: {
      type: "string",
      description:
        "Single-use refresh token. Also set as an HttpOnly cookie; surface " +
        "in the body for non-cookie clients only.",
    },
    expiresAt: {
      type: "string",
      format: "date-time",
      description: "Absolute expiry of the access token (JWT exp claim).",
    },
  },
};

const LogoutResponse: OpenAPISchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string", example: "Logged out." },
  },
};

const RefreshResponse: OpenAPISchema = {
  type: "object",
  required: ["user", "accessToken", "refreshToken", "expiresAt"],
  properties: {
    user: { $ref: "#/components/schemas/AuthUser" },
    accessToken: { type: "string" },
    refreshToken: { type: "string" },
    expiresAt: { type: "string", format: "date-time" },
  },
  description:
    "Silent rotation — no `message` field, mirrors the wire shape the " +
    "handler emits via respondData().",
};

const RegisterRequest: OpenAPISchema = {
  type: "object",
  required: ["email", "password", "name"],
  properties: {
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 8 },
    name: { type: "string", minLength: 1, maxLength: 100 },
    csrfToken: CSRF_TOKEN_PROP,
  },
};

const RegisterSilentSuccessResponse: OpenAPISchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: {
      type: "string",
      example: "If this email is available, we've sent a confirmation link.",
      description:
        "Generic anti-enumeration message — identical on real success and " +
        "swallowed-conflict paths.",
    },
  },
};

const RegisterCreatedResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "user"],
  properties: {
    message: { type: "string", example: "Account created." },
    user: {
      type: "object",
      required: ["id", "email"],
      properties: {
        id: { type: "string" },
        email: { type: "string", format: "email" },
        name: { type: ["string", "null"] },
      },
    },
  },
  description:
    "Only emitted when `auth.revealRegistrationConflict` is enabled.",
};

const ForgotPasswordRequest: OpenAPISchema = {
  type: "object",
  required: ["email"],
  properties: {
    email: { type: "string", format: "email" },
    redirectPath: {
      type: "string",
      description:
        "Optional post-reset redirect. Must be a relative path under " +
        "`/admin` or an absolute URL on the deployment's " +
        "`ALLOWED_REDIRECT_HOSTS` allowlist; invalid values are silently " +
        "ignored.",
    },
    csrfToken: CSRF_TOKEN_PROP,
  },
};

const ForgotPasswordResponse: OpenAPISchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: {
      type: "string",
      example:
        "If an account exists for this email, a password reset link has been sent.",
    },
  },
};

const ResetPasswordRequest: OpenAPISchema = {
  type: "object",
  required: ["token", "newPassword"],
  properties: {
    token: {
      type: "string",
      description: "Single-use token from the password-reset email.",
    },
    newPassword: { type: "string", minLength: 8 },
    csrfToken: CSRF_TOKEN_PROP,
  },
};

const ResetPasswordResponse: OpenAPISchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string", example: "Password reset." },
  },
};

const CsrfResponse: OpenAPISchema = {
  type: "object",
  required: ["token"],
  properties: {
    token: {
      type: "string",
      description:
        "Fresh CSRF token: 32 random bytes, hex-encoded (64 chars). The " +
        "same value is set as the `nextly_csrf` cookie; echo it on " +
        "mutating requests via the `x-csrf-token` header or the body " +
        "`csrfToken` field.",
      example:
        "3f8a1c9e0b7d4f2a6e5c8b1d0a9f7e3c2b4d6a8f1e0c9b7d5a3f2e1c0b9d8a7f",
    },
  },
};

export const authModule = defineModule({
  name: "auth",
  tag: {
    name: "Auth",
    description:
      "Login, logout, registration, token rotation, and password recovery.",
  },
  operations: [
    loginOp,
    logoutOp,
    refreshOp,
    registerOp,
    forgotPasswordOp,
    resetPasswordOp,
    csrfOp,
  ],
  schemas: {
    AuthUser,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    RefreshResponse,
    RegisterRequest,
    RegisterSilentSuccessResponse,
    RegisterCreatedResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
    CsrfResponse,
  },
});
