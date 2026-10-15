/**
 * Registering a plugin's kinds of signed-in person, and every refusal that
 * stops the app from starting on a kind that cannot work.
 */
import { afterEach, describe, expect, it } from "vitest";

import { auditLog as mysqlAuditLog } from "../../schemas/audit/mysql";
import { auditLog as postgresAuditLog } from "../../schemas/audit/postgres";
import { emailDeliveriesMysql } from "../../schemas/email-deliveries/mysql";
import { emailDeliveriesPg } from "../../schemas/email-deliveries/postgres";
import type { PluginDefinition } from "../plugin-context";
import { resolvePlugins } from "../resolve";

import {
  collectPrincipalKinds,
  getPrincipalKind,
  PRINCIPAL_KIND_MAX_LENGTH,
  publishPrincipalKinds,
} from "./registry";
import type { PrincipalKindDefinition } from "./types";

const resolve = async () => null;

const kind = (
  over: Partial<PrincipalKindDefinition> = {}
): PrincipalKindDefinition => ({
  name: "account",
  attributes: { verified: "boolean", plan: "string", visits: "number" },
  resolve,
  ...over,
});

const plugin = (
  name: string,
  principals: unknown[],
  over: Partial<PluginDefinition> = {}
): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: "*",
  contributes: { principals: principals as PrincipalKindDefinition[] },
  ...over,
});

/** The refusal's reason, or the failure to refuse. */
function reasonFor(plugins: PluginDefinition[]): unknown {
  try {
    collectPrincipalKinds(plugins);
  } catch (error) {
    const { code, logContext } = error as {
      code?: string;
      logContext?: { reason?: string };
    };
    return `${code}:${logContext?.reason}`;
  }
  return "not refused";
}

afterEach(() => publishPrincipalKinds(new Map()));

describe("collectPrincipalKinds", () => {
  it("names a kind by the plugin's slug and the kind's own name", () => {
    const kinds = collectPrincipalKinds([plugin("@acme/accounts", [kind()])]);
    const registered = kinds.get("acme-accounts:account");
    expect(registered?.plugin).toBe("@acme/accounts");
    expect(registered?.name).toBe("account");
    expect(registered?.attributes).toEqual({
      verified: "boolean",
      plan: "string",
      visits: "number",
    });
  });

  it("keeps the attributes it was given, whatever the plugin changes later", () => {
    const definition = kind();
    const kinds = collectPrincipalKinds([plugin("accounts", [definition])]);
    (definition.attributes as Record<string, string>).verified = "string";
    expect(kinds.get("accounts:account")?.attributes.verified).toBe("boolean");
  });

  it("skips a disabled plugin, even one whose kind would be refused", () => {
    const kinds = collectPrincipalKinds([
      plugin("accounts", [kind({ name: "Bad Name" })], { enabled: false }),
    ]);
    expect(kinds.size).toBe(0);
  });

  it.each([
    ["an uppercase letter", "Account"],
    ["a leading digit", "1account"],
    ["an underscore", "my_account"],
    ["33 characters", `a${"b".repeat(32)}`],
    ["nothing", ""],
  ])("refuses a kind name with %s", (_label, name) => {
    expect(reasonFor([plugin("accounts", [kind({ name })])])).toBe(
      "PLUGIN_RESOLUTION_ERROR:principal-kind-invalid"
    );
  });

  it("accepts a kind name of 32 characters, the longest allowed", () => {
    // The control for the 33-character refusal: a bound one too tight would
    // refuse both.
    const name = `a${"b".repeat(31)}`;
    expect(reasonFor([plugin("accounts", [kind({ name })])])).toBe(
      "not refused"
    );
  });

  it("refuses a kind whose full name is longer than the audit columns hold", () => {
    // The full name is stored in bounded varchar columns on PostgreSQL and
    // MySQL. A longer one fails every audit write naming such a person, and
    // audit writes are fail-safe, so the record would be lost in silence.
    const max = PRINCIPAL_KIND_MAX_LENGTH;
    const pluginName = "a".repeat(max - ":account".length + 1);
    expect(`${pluginName}:account`.length).toBe(max + 1);
    expect(reasonFor([plugin(pluginName, [kind()])])).toBe(
      "PLUGIN_RESOLUTION_ERROR:principal-kind-invalid"
    );
  });

  it("accepts a kind whose full name is exactly as long as the audit columns", () => {
    // The control: an off-by-one at the bound would refuse the last legal name.
    const max = PRINCIPAL_KIND_MAX_LENGTH;
    const pluginName = "a".repeat(max - ":account".length);
    expect(reasonFor([plugin(pluginName, [kind()])])).toBe("not refused");
  });

  it("reads its bound from the narrowest column that stores a kind", () => {
    // Derived, not restated: a column narrowed later tightens the bound.
    const widths = [
      postgresAuditLog.actorKind,
      postgresAuditLog.actorPrincipalKind,
      postgresAuditLog.targetPrincipalKind,
      mysqlAuditLog.actorKind,
      mysqlAuditLog.actorPrincipalKind,
      mysqlAuditLog.targetPrincipalKind,
      emailDeliveriesPg.principalKind,
      emailDeliveriesMysql.principalKind,
    ].map(column => (column as { length?: number }).length);
    expect(widths.every(width => typeof width === "number")).toBe(true);
    expect(PRINCIPAL_KIND_MAX_LENGTH).toBe(Math.min(...(widths as number[])));
  });

  it("refuses a kind with no resolver", () => {
    const definition = { name: "account", attributes: {} };
    expect(reasonFor([plugin("accounts", [definition])])).toBe(
      "PLUGIN_RESOLUTION_ERROR:principal-kind-invalid"
    );
  });

  it("refuses a lookup that is not a function", () => {
    const definition = { ...kind(), lookup: "users" };
    expect(reasonFor([plugin("accounts", [definition])])).toBe(
      "PLUGIN_RESOLUTION_ERROR:principal-kind-invalid"
    );
  });

  it.each([
    ["an attribute type core does not know", { joined: "date" }],
    ["attributes that are not an object", ["verified"]],
    ["an attribute name that reaches the prototype", { __proto__x: "string" }],
    ["an attribute name with a dash", { "is-verified": "boolean" }],
  ])("refuses %s", (_label, attributes) => {
    const definition = { ...kind(), attributes };
    expect(reasonFor([plugin("accounts", [definition])])).toBe(
      "PLUGIN_RESOLUTION_ERROR:principal-kind-invalid"
    );
  });

  it("refuses one plugin registering a name twice", () => {
    expect(reasonFor([plugin("accounts", [kind(), kind()])])).toBe(
      "PLUGIN_RESOLUTION_ERROR:principal-kind-collision"
    );
  });

  it("refuses two plugins whose names reduce to one slug, naming both", () => {
    let owners: unknown;
    try {
      collectPrincipalKinds([
        plugin("@acme/accounts", [kind()]),
        plugin("acme_accounts", [kind()]),
      ]);
    } catch (error) {
      owners = (error as { logContext?: { owners?: unknown } }).logContext
        ?.owners;
    }
    expect(owners).toEqual(["@acme/accounts", "acme_accounts"]);
  });

  it("lets two plugins register the same name, each under its own slug", () => {
    const kinds = collectPrincipalKinds([
      plugin("shop", [kind()]),
      plugin("forum", [kind()]),
    ]);
    expect([...kinds.keys()]).toEqual(["shop:account", "forum:account"]);
  });
});

describe("resolution", () => {
  it("publishes the kinds, so recognition finds them by name", () => {
    resolvePlugins([plugin("accounts", [kind()])], { coreVersion: "1.0.0" });
    expect(getPrincipalKind("accounts:account")?.plugin).toBe("accounts");
  });

  it("refuses to start on a kind that cannot work", () => {
    expect(() =>
      resolvePlugins([plugin("accounts", [kind({ name: "Account" })])], {
        coreVersion: "1.0.0",
      })
    ).toThrow(/Plugin configuration is invalid/i);
  });
});
