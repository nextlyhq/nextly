/**
 * The child's half of a nesting rule, and the ONE implementation of it.
 *
 * Driven through the real registry wherever a definition is involved, rather
 * than through a hand-written source that restates what the registry would have
 * answered. A stub reproduces the resolution instead of observing it, so it
 * keeps passing after the registry changes what a definition means.
 */
import { afterEach, describe, expect, it } from "vitest";

import { canBeRoot, canNest, canNestInSlot } from "./nesting";
import type { NestingSource } from "./nesting";
import { clearBlocks, registerBlocks, registryNestingSource } from "./registry";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

afterEach(() => {
  clearBlocks();
});

describe("canNest", () => {
  it("permits a block that declares no parent to sit anywhere", () => {
    registerBlocks([{ ...base, name: "acme/free" }] as never, {
      source: "acme",
    });
    const source = registryNestingSource();

    expect(canNest("acme/free", "core/columns", source).allowed).toBe(true);
    expect(canNest("acme/free", "acme/anything", source).allowed).toBe(true);
    expect(canBeRoot("acme/free", source).allowed).toBe(true);
  });

  it("permits a declared parent and refuses every other container", () => {
    registerBlocks(
      [{ ...base, name: "acme/column", parent: ["core/columns"] }] as never,
      { source: "acme" }
    );
    const source = registryNestingSource();

    // The positive half FIRST. A rule that refused everything would satisfy
    // every refusal below while making the block unplaceable, and the two are
    // the same output at each individual assertion.
    expect(canNest("acme/column", "core/columns", source)).toEqual({
      allowed: true,
    });
    expect(canNest("acme/column", "core/container", source)).toEqual({
      allowed: false,
      reason: "wrong-parent",
      // The refusal carries the restriction that produced it, so a caller
      // explaining it never has to ask the source a second time.
      permitted: ["core/columns"],
    });
  });

  it("permits any of several declared parents", () => {
    registerBlocks(
      [
        {
          ...base,
          name: "acme/cell",
          parent: ["core/columns", "acme/grid"],
        },
      ] as never,
      { source: "acme" }
    );
    const source = registryNestingSource();

    expect(canNest("acme/cell", "core/columns", source).allowed).toBe(true);
    expect(canNest("acme/cell", "acme/grid", source).allowed).toBe(true);
    expect(canNest("acme/cell", "acme/other", source).allowed).toBe(false);
  });

  it("restricts the DIRECT container only, not an ancestor", () => {
    // `parent` names what a block may be a direct child of. A block permitted
    // under a container is not thereby permitted two levels beneath one, and
    // reading the rule as "somewhere below" would admit exactly the arrangement
    // a column-style block declares itself to forbid.
    registerBlocks(
      [{ ...base, name: "acme/column", parent: ["core/columns"] }] as never,
      { source: "acme" }
    );
    const source = registryNestingSource();

    expect(canNest("acme/column", "core/container", source)).toEqual({
      allowed: false,
      reason: "wrong-parent",
      // The refusal carries the restriction that produced it, so a caller
      // explaining it never has to ask the source a second time.
      permitted: ["core/columns"],
    });
  });

  it("treats a type the registry does not hold as unrestricted", () => {
    // An unregistered type is reported as an unknown block by the type lookup.
    // Refusing its placement as well would describe a missing registration as a
    // layout mistake, and would make an unknown block unplaceable rather than
    // merely undrawn.
    const source = registryNestingSource();

    expect(canNest("acme/never-registered", "core/columns", source)).toEqual({
      allowed: true,
    });
    expect(canBeRoot("acme/never-registered", source)).toEqual({
      allowed: true,
    });
  });
});

describe("canBeRoot", () => {
  it("refuses a block that restricts its parents, with its own reason", () => {
    // Top level is a position, not an exemption from being positioned. The
    // reason differs from `wrong-parent` because the remedy does: no container
    // on screen satisfies this one, so advice to aim at a different container
    // cannot be followed.
    registerBlocks(
      [{ ...base, name: "acme/column", parent: ["core/columns"] }] as never,
      { source: "acme" }
    );
    const source = registryNestingSource();

    expect(canBeRoot("acme/column", source)).toEqual({
      allowed: false,
      reason: "restricted-at-root",
      permitted: ["core/columns"],
    });
  });
});

describe("a source that answers outside the registry's shape", () => {
  // The source is caller-supplied and may hand back anything. These assert on
  // the RULE's tolerance rather than on the registry, so they build the source
  // directly — there is no registration that produces these answers.

  it("reads an empty list as no restriction rather than as nowhere", () => {
    // Registration already refuses an empty `parent`, so reaching the rule with
    // one means the definition bypassed registration. Read literally it would
    // fail every placement of that block with a rule no position satisfies, and
    // nothing in the failure would name the declaration.
    const source: NestingSource = { parentsOf: () => [] };

    expect(canNest("acme/x", "core/columns", source).allowed).toBe(true);
    expect(canBeRoot("acme/x", source).allowed).toBe(true);
  });

  it("reads a non-array answer as no restriction", () => {
    const source = {
      parentsOf: () => "core/columns" as unknown as readonly string[],
    };

    // A bare string is iterable, so a reader spreading it produces
    // one-character names and every real placement is refused. Ignored here
    // rather than obeyed: registration is where that declaration is rejected
    // with a message naming it.
    expect(canNest("acme/x", "core/columns", source).allowed).toBe(true);
  });
});

describe("canNestInSlot — the parent's half of the rule", () => {
  const source: NestingSource = {
    parentsOf: () => undefined,
    slotAllowOf: (parent, slot) =>
      parent === "core/accordion" && slot === "children"
        ? ["core/accordion-item"]
        : parent === "core/box" && slot === "wide"
          ? ["core/*"]
          : undefined,
  };

  it("admits a type the slot names", () => {
    expect(
      canNestInSlot("core/accordion-item", "core/accordion", "children", source)
        .allowed
    ).toBe(true);
  });

  it("REFUSES a type the slot does not name, carrying the permitted set", () => {
    const verdict = canNestInSlot(
      "core/heading",
      "core/accordion",
      "children",
      source
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("not-allowed-in-slot");
    // The permitted set travels, because the caller explaining the refusal is
    // the only place it is still known.
    expect(verdict.permitted).toEqual(["core/accordion-item"]);
  });

  it("admits any member of a namespace an entry ends `/*` on", () => {
    expect(
      canNestInSlot("core/heading", "core/box", "wide", source).allowed
    ).toBe(true);
  });

  it("binds the wildcard to the SEPARATOR, so `core/*` refuses `coreevil/x`", () => {
    // A prefix test without the `/` admits this, and the name is close enough
    // to read past in a review.
    expect(
      canNestInSlot("coreevil/banner", "core/box", "wide", source).allowed
    ).toBe(false);
  });

  it("admits anything when the slot declares no allow-list", () => {
    // The control for every refusal above: a rule that refused by default would
    // pass those and make every undeclared slot unfillable.
    expect(
      canNestInSlot("core/heading", "core/section", "children", source).allowed
    ).toBe(true);
  });

  it("admits anything when the source predates `slotAllowOf` entirely", () => {
    // An older caller supplying only `parentsOf` keeps the behaviour it had.
    expect(
      canNestInSlot("core/heading", "core/accordion", "children", {
        parentsOf: () => undefined,
      }).allowed
    ).toBe(true);
  });
});
