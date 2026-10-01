/**
 * A third-party plugin can name the runtime surfaces it is handed, importing
 * only from the SDK.
 *
 * Checked by the compiler (`check-types` covers test files): a type that is
 * not exported fails this file with TS2305 rather than at a plugin author's
 * desk. The one runtime assertion pins `UserEvents`, the value among them.
 */
import { describe, expect, it } from "vitest";

import type { ChallengeResolveResult, ChallengeViewProps } from "./admin";
import {
  UserEvents,
  type CompleteLoginOptions,
  type Decision,
  type PluginAuditApi,
  type PluginAuditDeclaration,
  type PluginAuthApi,
  type PluginCapabilities,
  type PluginDatabase,
  type PluginHookPointDeclaration,
  type PluginRouteRateLimit,
  type PluginSettingsApi,
  type UserCreatedPayload,
  type UserDeletedPayload,
} from "./index";

/** What a small payments plugin writes against these types. */
interface PaymentsSurface {
  settings: PluginSettingsApi<{ apiKey: string }>;
  audit: PluginAuditApi;
  auth: PluginAuthApi;
  db: PluginDatabase;
  login: CompleteLoginOptions;
  verdict: Decision;
  capabilities: PluginCapabilities;
  auditDeclaration: PluginAuditDeclaration;
  hookPoint: PluginHookPointDeclaration;
  rateLimit: PluginRouteRateLimit;
  created: UserCreatedPayload;
  deleted: UserDeletedPayload;
  view: ChallengeViewProps;
  answer: ChallengeResolveResult;
}

/**
 * A typed plugin writes merge patches: a nested partial, and `null` to
 * remove. Never called; the compiler is what checks it.
 */
function patchesCompile(
  api: PluginSettingsApi<{
    providers: Record<string, { clientId: string; clientSecret: string }>;
    port: number;
  }>
): void {
  void api.set({ providers: { github: null } });
  void api.set({ providers: { google: { clientId: "g" } }, port: null });
}

describe("the runtime types a plugin names", () => {
  it("are exported from the SDK, with the account event names", () => {
    const capabilities: PaymentsSurface["capabilities"] = {
      net: { outbound: ["api.stripe.com"] },
      auth: { login: false },
    };
    expect(capabilities.net?.outbound).toEqual(["api.stripe.com"]);
    expect(typeof patchesCompile).toBe("function");
    expect(UserEvents).toEqual({
      Created: "user.created",
      Deleted: "user.deleted",
    });
  });
});
