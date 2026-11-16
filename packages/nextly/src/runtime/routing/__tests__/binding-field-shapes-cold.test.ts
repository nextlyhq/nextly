/**
 * The first field-shapes call on a cold process, where the instance is made
 * lazily by that call: its rules are told the language it asked for, as every
 * later call's are. The languages come from the booted instance's registry,
 * which knows none before the boot.
 *
 * The boot is stood in for by registering a two-language configuration, and
 * the source, the visitor gate and the rule runner by stand-ins whose one
 * field rule reads the language its frame tells it. The frame itself, and the
 * order it is opened in, are the code under test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SanitizedLocalizationConfig } from "../../../domains/i18n/config/types";

const boot = vi.hoisted(() => ({ calls: 0 }));

// Hoisted with the mocks that read it, which run before this module body.
const LOCALIZATION = vi.hoisted(
  (): SanitizedLocalizationConfig => ({
    locales: [
      { code: "en", label: "English", rtl: false, fallbackLocale: [] },
      { code: "fr", label: "Français", rtl: false, fallbackLocale: [] },
    ],
    defaultLocale: "en",
    fallback: false,
  })
);

// The lazily made instance: nothing is registered until the first call
// boots it.
vi.mock("../../../init", async () => {
  const { container } = await import("../../../di/container");
  return {
    getCachedNextly: vi.fn(async () => {
      boot.calls += 1;
      if (!container.has("config")) {
        container.registerSingleton("config", () => ({
          localization: LOCALIZATION,
        }));
      }
      return {};
    }),
  };
});

vi.mock("../declared-fields", () => ({
  expandedFields: vi.fn(async () => [
    { name: "title", type: "text" },
    { name: "frenchNote", type: "text" },
    { name: "everyLanguageNote", type: "text" },
  ]),
  hiddenFieldPaths: vi.fn(async () => new Set<string>()),
}));

vi.mock("../../../auth/access/route-gate-adapters", () => ({
  routeVisitorVerdict: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("../../../auth/code-access", () => ({
  getRBACService: vi.fn(() => ({})),
}));

// The rule runner hands a field rule the language its frame holds, as the
// real one does through the rule context.
vi.mock("../../../shared/lib/field-level-registry", async () => {
  const { currentRuleLanguage } = await import(
    "../../../auth/access/rule-language"
  );
  type Rule = (language: {
    locale?: string;
    locales: readonly string[];
  }) => boolean;
  const rules: Record<string, { access: { read: Rule } }> = {
    // Readable only when the rules are told French.
    frenchNote: { access: { read: ({ locale }) => locale === "fr" } },
    // Readable only when the rules are told French among every language.
    everyLanguageNote: {
      access: { read: ({ locales }) => locales.includes("fr") },
    },
  };
  return {
    callerAccessGrants: vi.fn(() => undefined),
    fieldRuleTarget: vi.fn(() => ({})),
    getFieldFunctions: vi.fn(() => rules),
    readableWithoutEntry: vi.fn(async (field: { access: { read: Rule } }) =>
      field.access.read(currentRuleLanguage())
    ),
  };
});

import { container } from "../../../di/container";
import { bindingFieldShapes } from "../binding-field-shapes";

afterEach(() => {
  container.clear();
  boot.calls = 0;
});

const namesOf = async (
  options?: Parameters<typeof bindingFieldShapes>[1]
): Promise<string[]> =>
  ((await bindingFieldShapes({ collection: "posts" }, options)) ?? []).map(
    shape => shape.name
  );

describe("bindingFieldShapes on a cold process", () => {
  it("tells the first call's rules the language it asked for", async () => {
    // The control: nothing is booted before the call.
    expect(container.has("config")).toBe(false);
    const first = await namesOf({ locale: "fr" });
    expect(boot.calls).toBeGreaterThan(0);
    expect(first).toContain("frenchNote");
    // And the first call answers as a later one does.
    expect(await namesOf({ locale: "fr" })).toEqual(first);
  });

  it("tells the first call's rules every configured language when it names none", async () => {
    expect(container.has("config")).toBe(false);
    const first = await namesOf();
    expect(first).toContain("everyLanguageNote");
    expect(first).not.toContain("frenchNote");
    expect(await namesOf()).toEqual(first);
  });

  it("CONTROL: a language the rules do not allow leaves both fields out", async () => {
    // English alone: neither French nor every language, so the stand-in
    // rules can refuse, and the two fields above are their doing.
    expect(await namesOf({ locale: "en" })).toEqual(["title"]);
  });
});
