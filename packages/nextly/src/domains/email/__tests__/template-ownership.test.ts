/**
 * Who owns a template, and when two versions count as the same.
 */
import { describe, expect, it } from "vitest";

import type { EmailTemplateVersion } from "../../../schemas/email-templates/types";
import { BUILT_IN_TEMPLATES } from "../services/templates";
import {
  absentPluginFor,
  buildTemplateOwnerRegistry,
  isProtectedOwner,
  ownerOf,
  sameVersion,
  versionDigest,
} from "../template-ownership";

const version = (
  htmlContent: string,
  extra: Partial<EmailTemplateVersion> = {}
): EmailTemplateVersion => ({
  subject: "Subject",
  htmlContent,
  plainTextContent: null,
  preheader: null,
  ...extra,
});

describe("sameVersion", () => {
  it("ignores line endings and trailing spaces outside <pre>", () => {
    expect(
      sameVersion(
        version("<p>A</p>\n<p>B</p>"),
        version("<p>A</p>   \r\n<p>B</p>\t")
      )
    ).toBe(true);
  });

  it("keeps trailing spaces inside <pre>, where a reader sees them", () => {
    expect(
      sameVersion(
        version("<pre>\nline one\nline two\n</pre>"),
        version("<pre>\nline one  \nline two\n</pre>")
      )
    ).toBe(false);
  });

  it("keeps trailing spaces in the plain-text body", () => {
    expect(
      sameVersion(
        version("<p/>", { plainTextContent: "Hello  \nthere" }),
        version("<p/>", { plainTextContent: "Hello\nthere" })
      )
    ).toBe(false);
  });

  it("treats an empty optional field as a missing one", () => {
    expect(
      sameVersion(version("<p/>", { preheader: "" }), version("<p/>"))
    ).toBe(true);
  });

  it("sees a real change", () => {
    expect(sameVersion(version("<p>A</p>"), version("<p>B</p>"))).toBe(false);
    expect(versionDigest(version("<p>A</p>"))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the owner registry", () => {
  const plugin = {
    name: "@acme/plugin-orders",
    templates: [
      {
        slug: "orders-paid",
        name: "Paid",
        subject: "Paid",
        htmlContent: "<p>Paid</p>",
      },
      // A plugin cannot take over one of core's slugs.
      {
        slug: "welcome",
        name: "Hijack",
        subject: "x",
        htmlContent: "<p>x</p>",
      },
    ],
  };

  it("registers core first and reports a plugin's clashing slug", () => {
    const { registry, conflicts } = buildTemplateOwnerRegistry({
      builtIns: BUILT_IN_TEMPLATES,
      plugins: [plugin],
      codeTemplates: { passwordReset: () => ({ subject: "s", html: "h" }) },
      complete: true,
    });

    expect(registry.owned.get("welcome")?.owner).toEqual({ kind: "core" });
    expect(registry.owned.get("orders-paid")?.owner).toEqual({
      kind: "plugin",
      name: "@acme/plugin-orders",
    });
    expect(conflicts).toEqual([
      {
        slug: "welcome",
        kept: { kind: "core" },
        ignored: "@acme/plugin-orders",
      },
    ]);
    expect([...registry.setInCode]).toEqual(["password-reset"]);
  });

  it("reads a stored owner, and a plugin's template as not installed when it isn't running", () => {
    const { registry } = buildTemplateOwnerRegistry({
      builtIns: BUILT_IN_TEMPLATES,
      plugins: [plugin],
      complete: true,
    });
    const stored = (
      ownerKind: string | null,
      ownerName: string | null = null
    ) => ({
      ownerKind,
      ownerName,
    });

    expect(
      ownerOf("orders-paid", stored("plugin", "@acme/plugin-orders"), registry)
    ).toEqual({
      kind: "plugin",
      name: "@acme/plugin-orders",
      installed: true,
    });
    expect(
      ownerOf(
        "accounts-reset-password",
        stored("plugin", "@nextlyhq/plugin-accounts"),
        registry
      )
    ).toEqual({
      kind: "plugin",
      name: "@nextlyhq/plugin-accounts",
      installed: false,
    });
    expect(ownerOf("newsletter", stored("site"), registry)).toEqual({
      kind: "site",
    });
    // Not reconciled yet: read from the registry, so core is never the site's.
    expect(ownerOf("password-reset", stored(null), registry)).toEqual({
      kind: "core",
    });
  });

  it("refuses to call a plugin's template deletable before the running plugins are known", () => {
    const { registry } = buildTemplateOwnerRegistry({
      builtIns: BUILT_IN_TEMPLATES,
      plugins: [],
      complete: false,
    });
    const owner = ownerOf(
      "accounts-reset-password",
      { ownerKind: "plugin", ownerName: "@nextlyhq/plugin-accounts" },
      registry
    );
    expect(owner).toMatchObject({ installed: true });
    expect(isProtectedOwner(owner)).toBe(true);
  });

  it("reads a running plugin as the owner of a slug stored as the site's or another plugin's, before reconciliation", () => {
    const { registry } = buildTemplateOwnerRegistry({
      builtIns: BUILT_IN_TEMPLATES,
      plugins: [plugin],
      complete: true,
    });
    const installed = {
      kind: "plugin",
      name: "@acme/plugin-orders",
      installed: true,
    };
    for (const stored of [
      { ownerKind: "site", ownerName: null },
      { ownerKind: "plugin", ownerName: "@other/plugin-shop" },
    ]) {
      const owner = ownerOf("orders-paid", stored, registry);
      expect(owner).toEqual(installed);
      expect(isProtectedOwner(owner)).toBe(true);
    }
    // The control: with the running plugins unknown, the stored owner stands.
    const { registry: early } = buildTemplateOwnerRegistry({
      builtIns: BUILT_IN_TEMPLATES,
      plugins: [plugin],
      complete: false,
    });
    expect(
      ownerOf("orders-paid", { ownerKind: "site", ownerName: null }, early)
    ).toEqual({ kind: "site" });
  });

  it("recognises a first-party plugin's leftover template by its slug", () => {
    expect(absentPluginFor("accounts-verify-address")).toBe(
      "@nextlyhq/plugin-accounts"
    );
    expect(absentPluginFor("newsletter-welcome")).toBeNull();
    // Only the plugin's own slugs: a site's template sharing the prefix is the site's.
    expect(absentPluginFor("accounts-newsletter")).toBeNull();
  });
});
