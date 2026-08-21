import { defineSingle, json } from "nextly/config";
import { describe, expect, it } from "vitest";

import { siteStyleSingle } from "./site-style-storage";

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
