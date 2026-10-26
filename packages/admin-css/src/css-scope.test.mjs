/**
 * The CSS scoper.
 *
 * The admin mounts inside the host's document, so a rule that escapes
 * `.nextly-admin` restyles the host's page and a rule that is scoped when it
 * should not be stops working. Both failures are silent in the browser and
 * both have shipped, so the shapes Tailwind actually emits are pinned here.
 */

import { describe, expect, it } from "vitest";

import {
  confineVariantClasses,
  findUnconfinedVariants,
  findUnscopedRules,
  isScoped,
  prefixKeyframes,
  scopeCss,
  scopeSelector,
  splitTopLevel,
} from "./css-scope.mjs";

describe("scopeSelector", () => {
  it("puts the dark class on the wrapper, not under it", () => {
    // `.dark` is applied to the same element as `.nextly-admin`; scoping it as
    // a descendant produces a selector that can never match.
    expect(scopeSelector(".dark")).toBe(".nextly-admin.dark");
  });

  it("collapses document-root selectors onto the wrapper", () => {
    for (const root of [":root", "html", ":host", "body"]) {
      expect(scopeSelector(root)).toBe(".nextly-admin");
    }
  });

  it("scopes each selector of a grouped preflight rule", () => {
    expect(scopeSelector("*, ::after, ::before, ::backdrop")).toBe(
      ".nextly-admin *, .nextly-admin ::after, .nextly-admin ::before, .nextly-admin ::backdrop"
    );
    expect(scopeSelector("html, :host")).toBe(".nextly-admin, .nextly-admin");
  });

  it("leaves a nested variant alone", () => {
    // Tailwind emits variants as `&:where(...)` inside an already-scoped rule.
    expect(scopeSelector("&:where(.dark, .dark *)")).toBe(
      "&:where(.dark, .dark *)"
    );
  });

  it("keeps commas inside a functional pseudo-class", () => {
    expect(scopeSelector(":where(.foo, .bar)")).toBe(
      ".nextly-admin :where(.foo, .bar)"
    );
  });

  it("does not scope an @-rule", () => {
    expect(scopeSelector("@media (min-width: 40rem)")).toBe(
      "@media (min-width: 40rem)"
    );
  });

  it("leaves an already-scoped selector as it is", () => {
    expect(scopeSelector(".nextly-admin .card")).toBe(".nextly-admin .card");
  });
});

describe("splitTopLevel", () => {
  it("splits only where a comma separates selectors", () => {
    expect(splitTopLevel("a, b").map(s => s.trim())).toEqual(["a", "b"]);
    expect(splitTopLevel(":where(a, b)").length).toBe(1);
    expect(splitTopLevel("[data-x='a,b']").length).toBe(1);
  });
});

describe("scopeCss and @keyframes", () => {
  const frames = `@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.card {
  color: red;
}`;

  it("keeps every frame of a multi-frame animation", () => {
    // A frame scoped as a selector is invalid inside @keyframes, so the
    // minifier drops it and the animation silently loses that step.
    const out = scopeCss(frames);
    expect(out).not.toMatch(/\.nextly-admin (to|from)\b/);
    expect(out).toContain("to {");
    expect(out).toContain("from {");
  });

  it("still scopes the rule after the animation", () => {
    expect(scopeCss(frames)).toContain(".nextly-admin .card{");
  });

  it("keeps percentage frames", () => {
    const out = scopeCss(`@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
.box {
  color: blue;
}`);
    // The negative assertion alone would also hold if the frames were dropped
    // altogether, so pin each step to prove it survived unscoped.
    expect(out).not.toMatch(/\.nextly-admin \d+%/);
    expect(out).toContain("0%,");
    expect(out).toContain("100% {");
    expect(out).toContain("50% {");
    expect(out).toContain(".nextly-admin .box{");
  });

  it("handles an animation written on one line", () => {
    const out = scopeCss(
      "@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}\n.after{color:green}"
    );
    expect(out).not.toMatch(/\.nextly-admin (to|from)\b/);
    // The block closes on its own line, so what follows must still be scoped.
    expect(out).toContain(".nextly-admin .after{");
  });
});

describe("findUnscopedRules", () => {
  it("reports a rule that escaped the wrapper", () => {
    expect(findUnscopedRules("html{color:red}")).toContain("html");
  });

  it("passes a scoped stylesheet", () => {
    expect(findUnscopedRules(".nextly-admin .card{color:red}")).toEqual([]);
  });

  it("flags an unscoped part of a mixed comma-separated selector list", () => {
    // The first part is scoped, the second escapes the wrapper; a whole-prelude
    // substring check would wrongly accept the rule.
    expect(
      findUnscopedRules(".nextly-admin .a, .leak{color:red}")
    ).toContain(".leak");
  });

  it("does not mistake keyframe steps for escaped rules", () => {
    expect(
      findUnscopedRules("@keyframes spin{from{opacity:0}to{opacity:1}}")
    ).toEqual([]);
  });

  it("looks inside conditional at-rules", () => {
    expect(
      findUnscopedRules("@media (min-width:40rem){html{color:red}}")
    ).toContain("html");
  });

  it("is not fooled by the banner comment before @layer", () => {
    expect(
      findUnscopedRules(
        "/*! tailwindcss v4 */\n@layer base{.nextly-admin a{color:red}}"
      )
    ).toEqual([]);
  });
});

describe("findUnconfinedVariants", () => {
  it("reports an unconfined dark variant reference by name", () => {
    // The rule's own subject is scoped, so only the ancestor reference inside
    // the :where reaches outside the wrapper — the shape the unscoped-rules
    // check passes and this gate exists to catch.
    const sel = ".nextly-admin .dark\\:border-border:where(.dark, .dark *)";
    expect(findUnconfinedVariants(`${sel}{border-color:red}`)).toEqual([sel]);
  });

  it("passes the confined form confineVariantClasses emits", () => {
    const css =
      ".nextly-admin .dark\\:border-border:where(.nextly-admin.dark,.nextly-admin.dark *){border-color:red}";
    expect(findUnconfinedVariants(css)).toEqual([]);
  });

  it("reports group- and peer-shaped references by name", () => {
    const group =
      ".nextly-admin .group-hover\\:x:is(:where(.group):hover *){color:blue}";
    const peer =
      ".nextly-admin .peer-checked\\:x:is(:where(.peer):checked ~ *){color:blue}";
    expect(findUnconfinedVariants(group + peer)).toEqual([
      ".nextly-admin .group-hover\\:x:is(:where(.group):hover *)",
      ".nextly-admin .peer-checked\\:x:is(:where(.peer):checked ~ *)",
    ]);
  });

  it("reports named group and peer markers, and passes them confined", () => {
    const unconfined =
      ".nextly-admin .group-hover\\/item\\:x:is(:where(.group\\/item):hover *){color:red}";
    expect(findUnconfinedVariants(unconfined)).toEqual([
      ".nextly-admin .group-hover\\/item\\:x:is(:where(.group\\/item):hover *)",
    ]);
    const confined = confineVariantClasses(unconfined);
    expect(confined).toContain(":where(.nextly-admin .group\\/item)");
    expect(findUnconfinedVariants(confined)).toEqual([]);
  });

  it("passes a marker compound the admin's own DOM carries", () => {
    // R-4's promise: a marker inside the wrapper is the in-admin styling
    // confinement keeps, not a leak.
    expect(
      findUnconfinedVariants(".nextly-admin .group:hover .a{color:red}")
    ).toEqual([]);
  });

  it("reports a bare dark ancestor compound before the scope", () => {
    // `.dark` at the top level of the selector: the subject is scoped, so the
    // unscoped-rules check passes it, but a host <html class="dark"> satisfies
    // the ancestor.
    expect(findUnconfinedVariants(".dark .nextly-admin .a{color:red}")).toEqual(
      [".dark .nextly-admin .a"]
    );
  });

  it("passes the scope's own dark token block", () => {
    // `.dark` ON the wrapper is the admin's dark theme, not an ancestor
    // reference.
    expect(findUnconfinedVariants(".nextly-admin.dark{--a:1}")).toEqual([]);
  });

  it("is not fooled by class names that merely start with a marker", () => {
    expect(findUnconfinedVariants(".nextly-admin .group-card .a{color:red}"))
      .toEqual([]);
    // The utility class `.dark\:x` is one class name whose text contains
    // "dark", not a dark: variant — the variant is the :where, tested above.
    expect(findUnconfinedVariants(".nextly-admin .dark\\:x{color:red}")).toEqual(
      []
    );
  });

  it("checks inside conditional at-rules", () => {
    expect(
      findUnconfinedVariants(
        "@media (min-width:40rem){.nextly-admin .a:where(.dark,.dark *){color:red}}"
      )
    ).toHaveLength(1);
  });

  it("finds nothing left after confineVariantClasses rewrote the sheet", () => {
    const css =
      ".nextly-admin .dark\\:x:where(.dark, .dark *){color:red}" +
      ".nextly-admin .group-hover\\:x:is(:where(.group):hover *){color:blue}" +
      ".nextly-admin .peer-disabled\\:x:is(:where(.peer):disabled *){color:green}";
    expect(findUnconfinedVariants(confineVariantClasses(css))).toEqual([]);
  });

  it("honours a custom scope", () => {
    const sel = ".nextly-ui .dark\\:x:where(.dark, .dark *)";
    expect(findUnconfinedVariants(`${sel}{color:red}`, ".nextly-ui")).toEqual([
      sel,
    ]);
    const confined = confineVariantClasses(`${sel}{color:red}`, ".nextly-ui");
    expect(findUnconfinedVariants(confined, ".nextly-ui")).toEqual([]);
  });
});

describe("a custom scope", () => {
  // The same sheet is emitted for embedding outside the admin, where the root
  // class differs; preflight and the token block must follow the scope given.
  it("collapses document-root selectors onto the given scope", () => {
    expect(scopeSelector(":root", ".nextly-ui")).toBe(".nextly-ui");
    expect(scopeSelector("html", ".nextly-ui")).toBe(".nextly-ui");
    expect(scopeSelector("body", ".nextly-ui")).toBe(".nextly-ui");
  });

  it("puts the dark class on the scope root, not a descendant", () => {
    expect(scopeSelector(".dark", ".nextly-ui")).toBe(".nextly-ui.dark");
  });

  it("scopes each part of a grouped preflight selector", () => {
    expect(scopeSelector("*, ::after, ::before", ".nextly-ui")).toBe(
      ".nextly-ui *, .nextly-ui ::after, .nextly-ui ::before"
    );
  });

  it("leaves selectors already carrying the scope alone", () => {
    expect(scopeSelector(".nextly-ui .card", ".nextly-ui")).toBe(
      ".nextly-ui .card"
    );
  });

  it("scopes a whole sheet and reports nothing unscoped", () => {
    const out = scopeCss(":root{--nx-a:1}\n.card{color:red}", ".nextly-ui");
    expect(out).toContain(".nextly-ui{--nx-a:1}");
    expect(out).toContain(".nextly-ui .card{color:red}");
    expect(findUnscopedRules(out, ".nextly-ui")).toEqual([]);
  });

  it("still reports a leak when a rule escapes the given scope", () => {
    expect(findUnscopedRules(".nextly-ui .a, .leak{color:red}", ".nextly-ui"))
      .toHaveLength(1);
  });

  // A class that merely starts with the scope text is a different class, and an
  // attribute selector matching the scope as a substring is not constrained by
  // the wrapper at all. Both must be treated as unscoped, or they pass straight
  // through scoping and the leak check into the shipped sheet.
  it("does not mistake a longer class name for the scope", () => {
    expect(scopeSelector(".nextly-ui-card", ".nextly-ui")).toBe(
      ".nextly-ui .nextly-ui-card"
    );
    expect(
      findUnscopedRules(".nextly-ui-card{color:red}", ".nextly-ui")
    ).toEqual([".nextly-ui-card"]);
  });

  it("does not accept the scope appearing inside an attribute selector", () => {
    expect(
      findUnscopedRules('[class*=".nextly-ui"]{color:red}', ".nextly-ui")
    ).toEqual(['[class*=".nextly-ui"]']);
  });

  it("accepts the scope when the class ends at a boundary", () => {
    expect(isScoped(".nextly-ui.dark .card", ".nextly-ui")).toBe(true);
    expect(isScoped(".nextly-ui > .card", ".nextly-ui")).toBe(true);
    expect(isScoped(".nextly-uix", ".nextly-ui")).toBe(false);
  });

  // The scope class can appear in a selector without constraining the rule to
  // the wrapper: negated, or on a sibling the wrapper does not contain.
  it("rejects a negated scope", () => {
    expect(isScoped(":not(.nextly-ui)", ".nextly-ui")).toBe(false);
    expect(isScoped(".card:not(.nextly-ui)", ".nextly-ui")).toBe(false);
    expect(
      findUnscopedRules(":not(.nextly-ui){color:red}", ".nextly-ui")
    ).toEqual([":not(.nextly-ui)"]);
  });

  it("rejects a sibling of the wrapper", () => {
    expect(isScoped(".nextly-ui + .host", ".nextly-ui")).toBe(false);
    expect(isScoped(".nextly-ui ~ .host", ".nextly-ui")).toBe(false);
    expect(
      findUnscopedRules(".nextly-ui + .host{color:red}", ".nextly-ui")
    ).toEqual([".nextly-ui + .host"]);
  });

  it("accepts a sibling of an element already inside the wrapper", () => {
    // `.b` shares a parent with `.a`, and `.a` is inside, so `.b` is too. Only
    // a sibling of the wrapper itself escapes.
    expect(isScoped(".nextly-ui .a + .b", ".nextly-ui")).toBe(true);
    expect(isScoped(".nextly-ui .a ~ .b", ".nextly-ui")).toBe(true);
    expect(isScoped(".nextly-ui > .a + .b", ".nextly-ui")).toBe(true);
    expect(
      findUnscopedRules(".nextly-ui .a + .b{color:red}", ".nextly-ui")
    ).toEqual([]);
  });

  it("accepts descendant and child steps below the wrapper", () => {
    expect(isScoped(".nextly-ui > .card", ".nextly-ui")).toBe(true);
    expect(isScoped(".nextly-ui .a > .b", ".nextly-ui")).toBe(true);
    // A sibling BEFORE the scope is fine: the subject is still inside it.
    expect(isScoped(".host + .nextly-ui .card", ".nextly-ui")).toBe(true);
  });

  it("keeps combinators inside :is()/:where() out of the structural check", () => {
    expect(isScoped(".nextly-ui .a:is(.x + .y)", ".nextly-ui")).toBe(true);
  });

  // Tailwind escapes arbitrary variants into the class name, so `~`, `[` and
  // `:not(` can appear as literal characters that are not structure.
  it("reads escaped characters in a class name as literals", () => {
    const cmdk =
      ".nextly-ui .\\[\\&_\\[cmdk-group\\]\\:not\\(\\[hidden\\]\\)_\\~\\[cmdk-group\\]\\]\\:pt-0";
    expect(isScoped(cmdk, ".nextly-ui")).toBe(true);
    expect(findUnscopedRules(`${cmdk}{color:red}`, ".nextly-ui")).toEqual([]);
  });

  it("does not read an escaped class as the scope itself", () => {
    expect(isScoped(".nextly-ui\\~x", ".nextly-ui")).toBe(false);
  });

  it("confines dark and group variants to the scope", () => {
    const css =
      ".nextly-ui .dark\\:bg-x:where(.dark, .dark *){color:red}" +
      ".nextly-ui .group-hover\\:x:is(:where(.group):hover *){color:blue}";
    const out = confineVariantClasses(css, ".nextly-ui");

    expect(out).toContain(":where(.nextly-ui.dark,.nextly-ui.dark *)");
    expect(out).toContain(":where(.nextly-ui .group)");
    // No bare ancestor reference is left for the host to satisfy.
    expect(out).not.toContain(":where(.dark, .dark *)");
    expect(out).not.toContain(":where(.group)");
  });

  // Named variants (`group-hover/item:`) reference `.group\/item`. The leak
  // check cannot see these — the rule's own compound is scoped, so the ancestor
  // reference is the only part that reaches outside the wrapper.
  it("confines named group and peer markers", () => {
    const css =
      ".nextly-ui .group-hover\\/item\\:underline:is(:where(.group\\/item):hover *){color:red}" +
      ".nextly-ui .peer-checked\\/field\\:font-bold:is(:where(.peer\\/field):checked ~ *){color:blue}";
    const out = confineVariantClasses(css, ".nextly-ui");

    expect(out).toContain(":where(.nextly-ui .group\\/item)");
    expect(out).toContain(":where(.nextly-ui .peer\\/field)");
    expect(out).not.toContain(":where(.group\\/item)");
    expect(out).not.toContain(":where(.peer\\/field)");
  });

  it("namespaces keyframe names and the references to them", () => {
    const css = [
      "@keyframes spin{to{transform:rotate(360deg)}}",
      ".nextly-ui .a{animation:spin 1s linear infinite}",
      ".nextly-ui{--animate-spin:spin 1s linear infinite}",
      ".nextly-ui .b{animation-name:spin}",
    ].join("\n");
    const out = prefixKeyframes(css, "nx-");

    expect(out).toContain("@keyframes nx-spin");
    expect(out).toContain("animation:nx-spin 1s linear infinite");
    expect(out).toContain("--animate-spin:nx-spin 1s linear infinite");
    expect(out).toContain("animation-name:nx-spin");
    // No bare reference survives to collide with a host animation.
    expect(out).not.toMatch(/(^|[\s,:]) spin(?=$|[\s,;}])/);
  });

  it("leaves identifiers that merely share a keyframe name alone", () => {
    const css = [
      "@keyframes spin{to{opacity:1}}",
      ".nextly-ui .a{content:'spin';transition:spin 1s}",
    ].join("\n");
    const out = prefixKeyframes(css, "nx-");

    expect(out).toContain("content:'spin'");
    expect(out).toContain("transition:spin 1s");
  });

  it("keeps a var() reference intact while namespacing the token value", () => {
    const out = prefixKeyframes(
      "@keyframes pulse{to{opacity:1}}\n.nextly-ui .a{animation:var(--animate-pulse)}",
      "nx-"
    );
    expect(out).toContain("animation:var(--animate-pulse)");
  });

  it("scopes the unscoped half of a partially scoped selector list", () => {
    expect(scopeCss(".nextly-ui .a, .b{color:red}", ".nextly-ui")).toContain(
      ".nextly-ui .a, .nextly-ui .b{"
    );
  });
});
