import { defineSingle, json } from "nextly/config";
import { describe, expect, it } from "vitest";

import { pageBuilder } from "./plugin";
import { siteStyleSingle } from "./site-style-storage";

/** A host no site in these tests allows. */
const TRACKER = "https://tracker.example/p.png";

/** One stored class carrying a url() at the base state and breakpoint. */
const CLASSES = [
  {
    id: "c1",
    slug: "card",
    orderIndex: 0,
    styles: { base: { base: { background: { url: TRACKER } } } },
  },
];

/**
 * The `validate` the Site Style single puts in front of a classes write.
 *
 * Reached through the field list rather than by calling the checker, because
 * what is being tested is the WIRING: a checker that judges perfectly and a
 * single that never hands it the policy produce identical unit tests and a
 * site that still serves the tracker.
 */
function classesValidate(single: {
  fields: readonly { name?: string; validate?: unknown }[];
}): (value: unknown) => string | true {
  const field = single.fields.find(f => f.name === "classes");
  if (field === undefined) throw new Error("no classes field on the single");
  if (typeof field.validate !== "function") {
    throw new Error("the classes field declares no validate");
  }
  return field.validate as (value: unknown) => string | true;
}

/**
 * The operations a config declares a code-defined rule for.
 *
 * This is the shape the RBAC service reads, not a second copy of its decision:
 * it looks up `codeAccess?.[operation]` and, whenever that is anything other
 * than `undefined`, answers from it and never reaches the permission lookup.
 * So the list of declared keys IS the list of operations that would bypass a
 * permission, whatever each rule goes on to return.
 */
function declaredRules(config: { access?: unknown }): string[] {
  const { access } = config;
  if (access === null || access === undefined) return [];
  if (typeof access !== "object") return ["<access is not an object>"];
  const rules = access as Record<string, unknown>;
  return Object.keys(rules).filter(name => rules[name] !== undefined);
}

describe("the Site Style single's access", () => {
  it("finds a declared rule on a single that has one", () => {
    // The positive control. Every assertion below is an ABSENCE, and an
    // absence is only evidence once the search is known to find the thing when
    // it is there — `defineSingle` validates and rebuilds its input, so a
    // version that dropped `access` on the floor would satisfy them all
    // forever.
    const control = defineSingle({
      slug: "control-single",
      label: { singular: "Control" },
      access: { read: () => true },
      fields: [json({ name: "payload" })],
    });

    expect(declaredRules(control)).toEqual(["read"]);
  });

  it("declares no code-defined rule, so a permission decides every operation", () => {
    // Not "declares no READ rule": a rule under any operation returns ahead of
    // the permission lookup, so naming one operation would guard one member of
    // the family and let the next one through.
    expect(declaredRules(siteStyleSingle())).toEqual([]);
  });

  it("keeps versions, which is what widens the read action past the document", () => {
    // Why the rule above is load-bearing rather than tidy. `versions: true` is
    // what gives this slug a version list, a version, a version diff and an
    // autosave recovery point — all of which the route resolves to the SAME
    // `read` action on the same slug. A permissive read rule would hand over
    // the edit history and unpublished in-progress work along with the
    // published document, and only the published document is emitted into a
    // public page.
    expect(siteStyleSingle().versions).toBe(true);
  });
});

describe("the Site Style single's class write gate", () => {
  it("refuses a stored class whose url() the policy disallows", () => {
    const verdict = classesValidate(
      siteStyleSingle({ mayFetchUrl: () => false })
    )(CLASSES);

    expect(verdict).not.toBe(true);
    expect(String(verdict)).toContain("does not allow");
  });

  it("accepts it when the policy allows the host", () => {
    // Separates "the single threaded the policy" from "the single refuses
    // every url()", which would pass the assertion above while consulting
    // nothing.
    expect(
      classesValidate(siteStyleSingle({ mayFetchUrl: () => true }))(CLASSES)
    ).toBe(true);
  });

  it("accepts it with no policy, the behaviour a site without remotePatterns keeps", () => {
    expect(classesValidate(siteStyleSingle())(CLASSES)).toBe(true);
  });
});

describe("the policy the plugin derives from remotePatterns", () => {
  /** The Site Style single as the plugin actually registers it. */
  function registeredSingle(opts: Parameters<typeof pageBuilder>[0]) {
    const singles = pageBuilder(opts).contributes?.singles;
    if (singles === undefined || singles.length === 0) {
      throw new Error("the plugin registered no singles");
    }
    return singles[0] as {
      fields: readonly { name?: string; validate?: unknown }[];
    };
  }

  it("refuses a class url() from a host the patterns do not name", () => {
    const verdict = classesValidate(
      registeredSingle({ remotePatterns: [{ hostname: "cdn.example.com" }] })
    )(CLASSES);

    expect(verdict).not.toBe(true);
    expect(String(verdict)).toContain("does not allow");
  });

  it("accepts one from a host they do name", () => {
    // The positive control for the derivation: the same patterns, a URL inside
    // them. Without it, a predicate that refused everything would satisfy the
    // test above.
    const allowed = [
      {
        ...CLASSES[0],
        styles: {
          base: {
            base: { background: { url: "https://cdn.example.com/a.png" } },
          },
        },
      },
    ];

    expect(
      classesValidate(
        registeredSingle({ remotePatterns: [{ hostname: "cdn.example.com" }] })
      )(allowed)
    ).toBe(true);
  });

  it("asks nothing when the host configured no patterns", () => {
    expect(classesValidate(registeredSingle({}))(CLASSES)).toBe(true);
  });
});
