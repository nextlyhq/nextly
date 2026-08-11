import { describe, expect, it } from "vitest";

import type { StyleValues } from "../document";
import { ISSUE_CODES } from "../validation";
import { checkColorValue, checkCssValue, checkUrlValue } from "./css-value";
import {
  MAX_SITE_ISSUES,
  MAX_STYLE_ISSUES,
  MAX_STYLE_ISSUE_PATH_BYTES,
  memoizeTokenLookup,
  newStyleIssueBudget,
  speculativeBudget,
  validateStyleValues,
} from "./validate-style-value";

/** Validate one style-values record at the document root, strictly. */
function check(values: StyleValues) {
  return validateStyleValues(values, "/styles", "strict");
}

function codes(values: StyleValues): string[] {
  return check(values).map(issue => issue.code);
}

describe("a design token reference is checked against the site", () => {
  const tokens = {
    kindOf: (name: string) =>
      name === "color.primary"
        ? ("color" as const)
        : name === "space.4"
          ? ("dimension" as const)
          : undefined,
  };
  const strict = (values: StyleValues, ctx?: typeof tokens) =>
    validateStyleValues(values, "/styles", "strict", undefined, false, ctx);

  it("says nothing at all when no site context was supplied", () => {
    // A check that fires only once a lookup appears would mean defining a
    // site's FIRST token invalidates every other reference already in storage.
    // Not being given the data means not answering.
    expect(strict({ color: { $token: "nope.nothing" } })).toEqual([]);
    expect(strict({ color: { $token: "color.primary" } })).toEqual([]);
  });

  it("accepts a token the site defines with the kind the value takes", () => {
    expect(strict({ color: { $token: "color.primary" } }, tokens)).toEqual([]);
    expect(strict({ gap: { $token: "space.4" } }, tokens)).toEqual([]);
  });

  it("warns, and never errors, when the site defines no such token", () => {
    const issues = strict({ color: { $token: "color.nope" } }, tokens);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("unknown-token");
    // Asserted in STRICT mode on purpose: an unresolved token costs one
    // declaration, so renaming a token must never make stored documents
    // unpublishable. A later change that escalates this fails here.
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.path).toBe("/styles/color");
  });

  it("warns when the token exists but is the wrong kind", () => {
    const issues = strict({ gap: { $token: "color.primary" } }, tokens);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("token-kind-mismatch");
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.message).toContain("color");
  });

  it("keeps refusing a token where the value takes only literals", () => {
    // Decidable from the catalog alone, so it stays an error and needs no
    // site context: no configuration makes this leaf accept a token.
    const issues = strict({ display: { $token: "color.primary" } }, tokens);
    expect(issues[0]?.code).toBe("token-not-allowed");
    expect(issues[0]?.severity).toBe("error");
  });

  it("stays a warning where the catalog lists the value two ways", () => {
    // `fontWeight` is a keyword OR a number. The keyword arm forbids tokens
    // outright and reports an error; the number arm accepts one and reports the
    // unresolved name as a warning. Both land on the same path, so a selection
    // that ranked them only by depth would return the refusal and block a
    // publish over a value the site can simply define.
    const issues = strict({ fontWeight: { $token: "weight.bold" } }, tokens);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("unknown-token");
    expect(issues[0]?.severity).toBe("warning");
  });

  it("reaches a token nested inside a composite", () => {
    const issues = strict(
      { padding: { blockStart: { $token: "space.nope" } } },
      tokens
    );
    expect(issues[0]?.code).toBe("unknown-token");
    expect(issues[0]?.path).toBe("/styles/padding/blockStart");
  });
});

describe("a union says which kinds it really accepts", () => {
  it("names every arm's kinds, not the first one to refuse", () => {
    // `lineHeight` takes a number OR a dimension token. Reporting the first
    // refusing arm's list would tell an author the property takes only numbers
    // and steer them away from a spelling that works.
    const issues = validateStyleValues(
      { lineHeight: { $token: "brand.primary" } },
      "/styles",
      "strict",
      undefined,
      false,
      { kindOf: () => "color" as const }
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("token-kind-mismatch");
    expect(issues[0]?.message).toContain("number");
    expect(issues[0]?.message).toContain("dimension");
  });
});

describe("the union token shortcut respects the checks around it", () => {
  it("refuses a malformed reference rather than warning about its kind", () => {
    // A reference stands in for the whole value, so anything beside `$token` is
    // data a reader discards in silence. Taking the kind shortcut first would
    // let that through with a warning where the leaf refuses it outright.
    const issues = validateStyleValues(
      { lineHeight: { $token: "x", extra: true } },
      "/styles",
      "strict",
      undefined,
      false,
      { kindOf: () => "color" as const }
    );
    expect(issues.map(i => i.severity)).toEqual(["error"]);
  });

  it("asks the caller's lookup once per name, however often it is consulted", () => {
    // A union asks before choosing an arm, each arm asks while being tried, and
    // the winning arm asks again when it is re-run. `kindOf` is the caller's
    // code and may be expensive, and whether a name resolves cannot change
    // inside one run.
    let asked = 0;
    validateStyleValues(
      { lineHeight: { $token: "gone" } },
      "/styles",
      "strict",
      newStyleIssueBudget(),
      false,
      {
        kindOf: () => {
          asked += 1;
          return undefined;
        },
      }
    );
    expect(asked).toBe(1);
  });

  it("does not call the lookup once name checking has stopped", () => {
    // `kindOf` is the caller's code. A run that has already said it stopped
    // checking names must stop calling it, not call it and discard the answer.
    let asked = 0;
    const budget = newStyleIssueBudget(200, 50_000, 0);
    validateStyleValues(
      { lineHeight: { $token: "x" } },
      "/styles",
      "strict",
      budget,
      false,
      {
        kindOf: () => {
          asked += 1;
          return "color" as const;
        },
      }
    );
    expect(asked).toBe(0);
  });

  it("stops asking the lookup before a union arm is chosen, not only after", () => {
    // The lookup allowance is distinct from the reporting allowance: a name the
    // run has not yet answered costs the caller, and the run may keep room to
    // REPORT while having no room left to ASK. The leaf reference honours that
    // distinction; the union shortcut must too, or a token on `lineHeight` calls
    // `kindOf` past the cap and the caller is billed for an answer the run was
    // meant to stop requesting.
    let asked = 0;
    const budget = newStyleIssueBudget(200, 50_000, 50, 50_000, 0);
    validateStyleValues(
      { lineHeight: { $token: "x" } },
      "/styles",
      "strict",
      budget,
      false,
      {
        kindOf: () => {
          asked += 1;
          return "color" as const;
        },
      }
    );
    expect(asked).toBe(0);
  });
});

describe("a budget that predates the site allowance", () => {
  it("bounds name resolution it never knew it had", () => {
    // The structural half of this shape has been public since it shipped, so a
    // caller can legitimately hand back an object carrying only those fields.
    // The site allowance is missing from such an object, and an allowance read
    // as `undefined` bounds nothing: `undefined <= 0` is false, and charging it
    // reaches NaN, which is never spent either. Filling it in is what keeps the
    // bound, and validation reports rather than throwing on the way.
    const legacy = { remaining: 200, pathBytes: 50_000, truncated: false };
    const styles: Record<string, unknown> = { color: { $token: "gone" } };
    const issues = validateStyleValues(
      styles,
      "/styles",
      "strict",
      legacy as never,
      false,
      { kindOf: () => undefined }
    );
    // One warning, and the allowance it came out of now exists on the object.
    expect(issues.map(i => i.code)).toEqual(["unknown-token"]);
    // Read through ONE optional view. The allowance is absent from the legacy
    // shape by construction, so a required view of it describes a type the
    // object could never have had.
    const filled = legacy as { siteRemaining?: number };
    expect(typeof filled.siteRemaining).toBe("number");
    expect(filled.siteRemaining).toBe(MAX_SITE_ISSUES - 1);
  });
});

describe("the site allowance bounds what name resolution reports", () => {
  const nothingResolves = { kindOf: () => undefined };
  /** A run whose site allowance holds exactly `n` findings. */
  const withSiteRoom = (n: number) => newStyleIssueBudget(200, 50_000, n);

  it("says it stopped only when a reference really went unchecked", () => {
    // One unknown token spends the last slot; what follows is a literal, so
    // nothing more was skipped and there is nothing to announce. Claiming
    // otherwise would report unresolved names on a document that has none.
    const budget = withSiteRoom(1);
    const issues = validateStyleValues(
      { color: { $token: "gone" }, textAlign: "start", display: "block" },
      "/styles",
      "strict",
      budget,
      false,
      nothingResolves
    );
    expect(issues.map(i => i.code)).toEqual(["unknown-token"]);
  });

  it("says it stopped when the next reference is the one skipped", () => {
    const budget = withSiteRoom(1);
    const issues = validateStyleValues(
      { color: { $token: "gone" }, backgroundColor: { $token: "also-gone" } },
      "/styles",
      "strict",
      budget,
      false,
      nothingResolves
    );
    expect(issues.map(i => i.code)).toEqual([
      "unknown-token",
      "site-issues-truncated",
    ]);
    // Reported where the skipped reference is, not at the document root.
    expect(issues[1]?.path).toBe("/styles/backgroundColor");
    expect(issues[1]?.severity).toBe("warning");
  });

  it("holds inside a composite, not only between properties", () => {
    // One property is a whole composite. An allowance charged only when the
    // property returns lets every token-bearing side of a box report first,
    // which is not a bound.
    const budget = withSiteRoom(1);
    const issues = validateStyleValues(
      {
        padding: {
          blockStart: { $token: "a" },
          blockEnd: { $token: "b" },
          inlineStart: { $token: "c" },
          inlineEnd: { $token: "d" },
        },
      },
      "/styles",
      "strict",
      budget,
      false,
      nothingResolves
    );
    expect(issues.map(i => i.code)).toEqual([
      "unknown-token",
      "site-issues-truncated",
    ]);
  });

  it("gates a speculative arm while keeping nothing it spends", () => {
    // Both halves matter and they pull in opposite directions. Handing an arm
    // no allowance stops it billing anything, and also stops it stopping: a
    // composite arm walks every key it was given and would build an issue for
    // each one before anything looked at the result. Handing it the real
    // allowance bounds it and lets a discarded arm spend.
    //
    // Tested here rather than through the returned issues because the waste is
    // transient: the winning arm is re-run against the real budget either way,
    // so the reported issues are identical and only the work differs.
    const real = newStyleIssueBudget(5, 100, 3, 50);
    const speculative = speculativeBudget(real);
    expect(speculative?.remaining).toBe(5);
    expect(speculative?.pathBytes).toBe(100);
    expect(speculative?.siteRemaining).toBe(3);
    if (speculative === undefined) throw new Error("expected a budget");
    speculative.remaining -= 5;
    speculative.truncated = true;
    speculative.siteRemaining -= 3;
    speculative.siteTruncated = true;
    expect(real.remaining).toBe(5);
    expect(real.truncated).toBe(false);
    expect(real.siteRemaining).toBe(3);
    expect(real.siteTruncated).toBe(false);
  });

  it("keeps the reported issues bounded whichever arm wins", () => {
    const corners: Record<string, string> = {};
    for (let i = 0; i < 5000; i += 1) corners[`corner${i}`] = "1px";
    const issues = validateStyleValues(
      { borderRadius: corners },
      "/styles",
      "strict",
      newStyleIssueBudget()
    );
    expect(issues.length).toBeLessThanOrEqual(MAX_STYLE_ISSUES + 1);
  });

  it("charges a union once, not once per arm it tried", () => {
    // `lineHeight` is a union whose arms both take a token. Trying an arm is
    // speculative; spending the allowance is not. Billing per arm would empty
    // the allowance faster than the document uses it, and a discarded arm's
    // truncation marker would suppress the one a later reference was going to
    // get.
    const budget = withSiteRoom(2);
    const issues = validateStyleValues(
      { lineHeight: { $token: "gone" }, color: { $token: "also-gone" } },
      "/styles",
      "strict",
      budget,
      false,
      nothingResolves
    );
    expect(issues.map(i => i.code)).toEqual(["unknown-token", "unknown-token"]);
    expect(issues.map(i => i.path)).toEqual([
      "/styles/lineHeight",
      "/styles/color",
    ]);
  });

  it("leaves structural checking untouched once it has stopped", () => {
    // The whole point of a separate allowance: running out of room to talk
    // about names must not cost the checks that decide whether the document is
    // valid at all.
    const budget = withSiteRoom(0);
    const issues = validateStyleValues(
      { color: { $token: "gone" }, textAlign: "sideways" },
      "/styles",
      "strict",
      budget,
      false,
      nothingResolves
    );
    expect(issues.some(i => i.code === "style-issues-truncated")).toBe(false);
    const structural = issues.filter(i => i.severity === "error");
    expect(structural).toHaveLength(1);
    expect(structural[0]?.path).toBe("/styles/textAlign");
  });
});

describe("unknown properties", () => {
  it("is an error under strict validation", () => {
    const issues = validateStyleValues({ nope: "1px" }, "/styles", "strict");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("unknown-style-property");
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.path).toBe("/styles/nope");
  });

  it("is a warning under forgiving validation, so a newer document still renders", () => {
    const issues = validateStyleValues({ nope: "1px" }, "/styles", "forgiving");
    expect(issues[0]?.severity).toBe("warning");
  });

  it("escapes a property name that would corrupt the JSON-Pointer", () => {
    const issues = check({ "a/b~c": "1px" });
    expect(issues[0]?.path).toBe("/styles/a~1b~0c");
  });
});

describe("keyword leaves", () => {
  it("accepts a listed value", () => {
    expect(codes({ textAlign: "start" })).toEqual([]);
  });

  it("refuses an unlisted value and lists the alternatives", () => {
    const issues = check({ textAlign: "left" });
    expect(issues[0]?.code).toBe("invalid-style-value");
    expect(issues[0]?.suggestion).toContain("start");
  });

  it("refuses a non-string", () => {
    expect(codes({ display: 3 })).toEqual(["invalid-style-value"]);
  });
});

describe("dimension leaves", () => {
  it("accepts a length, a percentage, and a calc expression", () => {
    expect(codes({ width: "16px" })).toEqual([]);
    expect(codes({ width: "50%" })).toEqual([]);
    expect(codes({ width: "clamp(1rem, 5vw, 3rem)" })).toEqual([]);
  });

  it("accepts the number zero, the one number that is a complete length", () => {
    expect(codes({ gap: 0 })).toEqual([]);
  });

  it("refuses a bare non-zero number, which would emit a value browsers drop", () => {
    const issues = check({ gap: 10 });
    expect(issues[0]?.code).toBe("invalid-style-value");
    expect(issues[0]?.suggestion).toContain("2rem");
  });
});

describe("number leaves", () => {
  it("enforces the declared bounds", () => {
    expect(codes({ opacity: 0.5 })).toEqual([]);
    expect(codes({ opacity: 1 })).toEqual([]);
    expect(codes({ opacity: 1.5 })).toEqual(["invalid-style-value"]);
    expect(codes({ opacity: -0.1 })).toEqual(["invalid-style-value"]);
  });

  it("enforces whole numbers where the property requires them", () => {
    expect(codes({ position: { zIndex: 3 } })).toEqual([]);
    expect(codes({ position: { zIndex: 3.5 } })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("refuses a non-finite number", () => {
    expect(codes({ opacity: Number.NaN })).toEqual(["invalid-style-value"]);
  });
});

describe("composite shapes", () => {
  it("accepts a subset of logical sides", () => {
    expect(codes({ padding: { inlineStart: "2rem" } })).toEqual([]);
  });

  it("refuses an unknown side and points at it", () => {
    const issues = check({ padding: { left: "2rem" } });
    expect(issues[0]?.code).toBe("invalid-style-value");
    expect(issues[0]?.path).toBe("/styles/padding/left");
    expect(issues[0]?.suggestion).toContain("inlineStart");
  });

  it("refuses a scalar where an object is required", () => {
    expect(codes({ padding: "2rem" })).toEqual(["invalid-style-value"]);
  });

  it("validates nested composites down to the leaf", () => {
    expect(codes({ border: { width: { blockStart: "1px" } } })).toEqual([]);
    const issues = check({ border: { width: { blockStart: 4 } } });
    expect(issues[0]?.path).toBe("/styles/border/width/blockStart");
  });

  it("refuses an unknown field of an object property", () => {
    const issues = check({ background: { srcset: "x.png" } });
    expect(issues[0]?.path).toBe("/styles/background/srcset");
  });

  it("refuses an object that is not a plain record", () => {
    // These carry no own enumerable keys, so a walk over one finds nothing to
    // complain about and reports it clean. Storage then puts the document
    // through JSON, where a Date becomes a string and a Map becomes `{}`, and
    // the same validator refuses on the next read what it just accepted.
    expect(codes({ margin: new Date() as never })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ background: new Map() as never })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ position: /x/ as never })).toEqual(["invalid-style-value"]);
  });

  it("refuses a token reference that is not a plain record", () => {
    // An array or a Date decorated with `$token` reads as a reference and then
    // serializes to `[]` or a string, losing the token on the way to storage.
    const decorated = Object.assign([], { $token: "color.primary" });
    expect(codes({ color: decorated as never })).toEqual([
      "invalid-style-value",
    ]);
    const dated = Object.assign(new Date(), { $token: "color.primary" });
    expect(codes({ color: dated as never })).toEqual(["invalid-style-value"]);
    expect(codes({ color: { $token: "color.primary" } })).toEqual([]);
  });

  it("accepts a record with no prototype, which JSON leaves alone", () => {
    const sides = Object.create(null) as StyleValues;
    sides.inlineStart = "2rem";
    expect(codes({ padding: sides })).toEqual([]);
  });
});

describe("union shapes", () => {
  it("accepts either variant", () => {
    expect(codes({ borderRadius: "4px" })).toEqual([]);
    expect(codes({ borderRadius: { startStart: "4px" } })).toEqual([]);
    expect(codes({ lineHeight: 1.5 })).toEqual([]);
    expect(codes({ lineHeight: "24px" })).toEqual([]);
    expect(codes({ fontWeight: "bold" })).toEqual([]);
    expect(codes({ fontWeight: 700 })).toEqual([]);
  });

  it("refuses a value no variant accepts", () => {
    expect(codes({ borderRadius: true as never })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ fontWeight: "heavy" })).toEqual(["invalid-style-value"]);
  });
});

describe("token references", () => {
  it("are accepted where the leaf declares token kinds", () => {
    expect(codes({ backgroundColor: { $token: "color.primary" } })).toEqual([]);
    expect(codes({ padding: { blockStart: { $token: "space.4" } } })).toEqual(
      []
    );
  });

  it("are refused where the property takes literals only", () => {
    const issues = check({ display: { $token: "layout.block" } });
    expect(issues[0]?.code).toBe("token-not-allowed");
    expect(issues[0]?.message).toContain("layout.block");
  });
});

describe("values that parse but are still unsafe", () => {
  it("refuses characters that would end the declaration or close the style element", () => {
    expect(checkCssValue("red; color: blue")).toBe("unsafe-characters");
    expect(checkCssValue("red } .x {")).toBe("unsafe-characters");
    // A quoted CSS string parses cleanly while carrying a closing style tag,
    // so parsing alone would let this reach the page.
    expect(checkCssValue('"</style><script>x</script>"')).toBe(
      "unsafe-characters"
    );
  });

  it("refuses a value that is not CSS at all", () => {
    expect(checkCssValue("!!")).toBe("unparsable");
    expect(checkCssValue("   ")).toBe("unparsable");
  });

  it("accepts current CSS a stale grammar would reject", () => {
    // These are the measured reason grammar matching is not used as the gate.
    expect(checkCssValue("oklch(70% 0.1 200)")).toBeNull();
    expect(checkCssValue("color-mix(in oklab, red, blue)")).toBeNull();
    expect(checkCssValue("clamp(1rem, 5vw, 3rem)")).toBeNull();
  });

  it("surfaces unsafe values through validation", () => {
    expect(codes({ color: "red; }" })).toEqual(["invalid-style-value"]);
    expect(codes({ filter: "blur(3px)" })).toEqual([]);
  });
});

describe("url safety", () => {
  it("allows http, https, and paths that carry no scheme", () => {
    expect(checkUrlValue("https://cdn.example.com/a.png")).toBeNull();
    expect(checkUrlValue("http://example.com/a.png")).toBeNull();
    expect(checkUrlValue("/media/a.png")).toBeNull();
    expect(checkUrlValue("a.png")).toBeNull();
    expect(checkUrlValue("//cdn.example.com/a.png")).toBeNull();
  });

  it("refuses every scheme outside the allowlist, not just the known-bad ones", () => {
    expect(checkUrlValue("javascript:alert(1)")).toBe("unsafe-url-scheme");
    expect(checkUrlValue("JavaScript:alert(1)")).toBe("unsafe-url-scheme");
    expect(checkUrlValue("  javascript:alert(1)")).toBe("unsafe-url-scheme");
    expect(checkUrlValue("data:image/svg+xml,<svg/>")).toBe(
      "unsafe-url-scheme"
    );
    expect(checkUrlValue("vbscript:msgbox")).toBe("unsafe-url-scheme");
    expect(checkUrlValue("file:///etc/passwd")).toBe("unsafe-url-scheme");
  });

  it("refuses characters that would break out of url()", () => {
    expect(checkUrlValue('a.png") ; x:url("b')).toBe("unsafe-url-characters");
    expect(checkUrlValue("a.png\n")).toBe("unsafe-url-characters");
    expect(checkUrlValue("a\\22 .png")).toBe("unsafe-url-characters");
  });

  it("applies the same allowlist to a url nested in a free-form value", () => {
    // Several properties reach the same CSS property by either route:
    // `backgroundGradient` and `background.url` both emit `background-image`,
    // so a scheme refused on one must be refused on the other.
    expect(checkCssValue('url("javascript:alert(1)")')).toBe(
      "unsafe-url-scheme"
    );
    expect(checkCssValue("url(data:text/html,x)")).toBe("unsafe-url-scheme");
    expect(
      checkCssValue('linear-gradient(red, blue), url("data:text/html,x")')
    ).toBe("unsafe-url-scheme");
    expect(checkCssValue('image-set(url("javascript:alert(1)") 1x)')).toBe(
      "unsafe-url-scheme"
    );
  });

  it("sees through CSS escapes, which the parser decodes", () => {
    // Written raw these read as `\6a avascript:` and `java\73 cript:`; checking
    // the original text would miss both, checking the parsed value does not.
    expect(checkCssValue('url("\\6a avascript:alert(1)")')).toBe(
      "unsafe-url-scheme"
    );
    expect(checkCssValue("url('java\\73 cript:alert(1)')")).toBe(
      "unsafe-url-scheme"
    );
  });

  it("reads a fallback in the context it will stand in for", () => {
    // An unset custom property hands its fallback straight to the function
    // around it, so a bare string there is loaded exactly as a written-out one
    // would be. Re-parsing the fallback on its own loses that.
    expect(checkCssValue('image-set(var(--img, "javascript:foo") 1x)')).toBe(
      "unsafe-url-scheme"
    );
    expect(checkCssValue('image(var(--i, "data:text/html,x"))')).toBe(
      "unsafe-url-scheme"
    );
    // The same string outside a URL context is ordinary text.
    expect(checkCssValue('var(--font, "javascript:foo")')).toBeNull();
    expect(
      checkCssValue('image-set(var(--img, "/media/a.png") 1x)')
    ).toBeNull();
  });

  it("stops the url context at a function that is not one", () => {
    // `type()` names a MIME type inside `image-set()`, not a resource to
    // fetch, so the context the image function establishes must not carry
    // into it. A string there is text, however much it looks like a scheme.
    expect(checkCssValue('image-set("a.png" type("javascript:x"))')).toBeNull();
    // The sibling string is still a URL, so the context itself is intact.
    expect(checkCssValue('image-set("javascript:x" type("image/png"))')).toBe(
      "unsafe-url-scheme"
    );
  });

  it("still accepts the urls a page legitimately needs", () => {
    expect(checkCssValue('url("https://cdn.example.com/a.png")')).toBeNull();
    // An SVG filter reference carries no scheme and must keep working.
    expect(checkCssValue("url(#svg-blur)")).toBeNull();
    expect(checkCssValue('url("/media/a.png")')).toBeNull();
  });

  it("surfaces a nested unsafe url through validation of a gradient", () => {
    const issues = check({ backgroundGradient: 'url("javascript:alert(1)")' });
    expect(issues[0]?.code).toBe("invalid-style-value");
    expect(issues[0]?.path).toBe("/styles/backgroundGradient");
    expect(issues[0]?.suggestion).toContain("http");
  });

  it("surfaces an unsafe url through validation, with a usable suggestion", () => {
    const issues = check({ background: { url: "javascript:alert(1)" } });
    expect(issues[0]?.code).toBe("invalid-style-value");
    expect(issues[0]?.path).toBe("/styles/background/url");
    expect(issues[0]?.suggestion).toContain("http");
  });
});

describe("style-tag delimiters in a dedicated url", () => {
  it("are refused even when nothing else about the url looks hostile", () => {
    // The HTML parser closes a style element at `</style>` whatever the CSS
    // quoting says, so the tag-breakout guard has to cover urls too and not
    // only the free-form values that already screen for it.
    expect(checkUrlValue("x</style><script src=y>")).toBe(
      "unsafe-url-characters"
    );
    expect(checkUrlValue("a.png</style>")).toBe("unsafe-url-characters");
  });

  it("surfaces through validation of a url property", () => {
    const issues = check({ background: { url: "a.png</style>" } });
    expect(issues[0]?.code).toBe("invalid-style-value");
    expect(issues[0]?.path).toBe("/styles/background/url");
  });
});

describe("dimension strings are lengths, not merely valid CSS", () => {
  it("refuses values that parse but measure nothing", () => {
    // "10" is the same mistake as the bare number 10, written as a string;
    // both emit a declaration the browser discards.
    expect(codes({ width: "10" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "red" })).toEqual(["invalid-style-value"]);
    expect(codes({ padding: { blockStart: "bogus" } })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("accepts measurements, functions, and the sizing keywords", () => {
    for (const value of [
      "2rem",
      "50%",
      "0",
      "calc(1px + 1em)",
      "clamp(1rem, 5vw, 3rem)",
      "var(--site-space-4)",
      "auto",
      "max-content",
    ]) {
      expect(codes({ width: value }), value).toEqual([]);
    }
  });

  it("takes one radius as a scalar and the rest per corner", () => {
    // The four-value shorthand is PHYSICAL (top-left … bottom-left) and does
    // not flip with writing direction, so it has no place in a catalog whose
    // storage keys are logical. Per-corner is the expressive form.
    expect(codes({ borderRadius: "4px" })).toEqual([]);
    expect(codes({ borderRadius: "4px 8px" })).toEqual(["invalid-style-value"]);
    expect(
      codes({ borderRadius: { startStart: "4px", endEnd: "8px" } })
    ).toEqual([]);
  });
});

describe("untrusted text in messages", () => {
  it("bounds a token name the way every other branch bounds a value", () => {
    const issues = check({ display: { $token: "x".repeat(500) } });
    expect(issues[0]?.code).toBe("token-not-allowed");
    expect(issues[0]?.message.length).toBeLessThan(250);
  });
});

describe("composite keys that exist on every object", () => {
  it("are reported as unknown fields rather than resolved from the prototype", () => {
    // `toString` and friends are ordinary JSON keys. Looking them up on a plain
    // object answers from the prototype, which would hand a function to the
    // shape walker; validation must report them, never throw.
    for (const key of [
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
    ]) {
      const issues = check({ padding: { [key]: "1px" } });
      expect(
        issues.map(issue => issue.code),
        key
      ).toEqual(["invalid-style-value"]);
    }
  });

  it("does not throw for a top-level property named like a prototype member", () => {
    expect(() => check({ toString: "1px" })).not.toThrow();
    expect(codes({ toString: "1px" })).toEqual(["unknown-style-property"]);
  });
});

describe("functions in a length", () => {
  it("accepts the ones that can produce a length", () => {
    for (const value of [
      "calc(1px + 1em)",
      "clamp(1rem, 5vw, 3rem)",
      "min(10px, 2em)",
      "max(10px, 2em)",
      "var(--site-space-4)",
      "env(safe-area-inset-block-start)",
    ]) {
      expect(codes({ width: value }), value).toEqual([]);
    }
  });

  it("refuses the ones that cannot", () => {
    for (const value of ["rgb(1 2 3)", "rotate(20deg)", "foo()", "blur(3px)"]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });
});

describe("control characters in a url", () => {
  it("are refused, because a browser strips them before reading the scheme", () => {
    // `java\tscript:` reaches the browser as `javascript:`, so a check that
    // only looked for a literal scheme would wave it through.
    expect(checkUrlValue("data\t:text/html;base64,WA==")).toBe(
      "unsafe-url-characters"
    );
    expect(checkUrlValue("java\tscript:alert1")).toBe("unsafe-url-characters");
    expect(checkUrlValue("a.png\u0000")).toBe("unsafe-url-characters");
  });

  it("surfaces through validation", () => {
    expect(codes({ background: { url: "data\t:text/html,x" } })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("contents of a length-producing function", () => {
  it("are checked, not just the function name", () => {
    for (const value of [
      "calc(rgb(1 2 3))",
      "calc(1px + red)",
      "min(rgb(1 2 3), 2px)",
    ]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("still allow multipliers and nested math", () => {
    for (const value of [
      "calc(2 * 1px)",
      "calc(100% - 2rem)",
      "calc(min(10px, 2em) + 1rem)",
      "clamp(1rem, calc(5vw + 1px), 3rem)",
    ]) {
      expect(codes({ width: value }), value).toEqual([]);
    }
  });

  it("does not inspect what a custom property resolves to", () => {
    expect(codes({ width: "var(--x, anything-at-all)" })).toEqual([]);
  });
});

describe("color leaves take colors", () => {
  it("refuses values that are valid CSS but not colors", () => {
    for (const value of [
      "16px",
      "rotate(2deg)",
      "url(https://x/y)",
      "banana",
    ]) {
      expect(codes({ color: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("accepts hex, named colors, keywords, and color functions", () => {
    for (const value of [
      "#fff",
      "#ff8800cc",
      "red",
      "rebeccapurple",
      "currentColor",
      "transparent",
      "rgb(1 2 3)",
      "hsl(200 50% 50%)",
      "oklch(70% 0.1 200)",
      "color-mix(in oklab, red, blue)",
      "light-dark(white, black)",
      "var(--site-color-primary)",
    ]) {
      expect(codes({ backgroundColor: value }), value).toEqual([]);
    }
  });

  it("leaves free-form values unrestricted, which is what they are for", () => {
    expect(codes({ filter: "blur(3px)" })).toEqual([]);
    expect(codes({ transform: "rotate(2deg)" })).toEqual([]);
  });
});

describe("deeply nested values", () => {
  it("are refused before anything recursive touches them", () => {
    const deep = `${"calc(".repeat(1200)}1px${")".repeat(1200)}`;
    expect(checkCssValue(deep)).toBe("too-deeply-nested");
    expect(() => check({ width: deep })).not.toThrow();
    expect(codes({ width: deep })).toEqual(["invalid-style-value"]);
  });

  it("leaves ordinary nesting alone", () => {
    expect(checkColorValue("color-mix(in oklab, rgb(1 2 3), blue)")).toBeNull();
    expect(codes({ width: "calc(min(10px, max(2em, 1rem)) + 1px)" })).toEqual(
      []
    );
  });
});

describe("dimension units", () => {
  it("refuses units that do not measure distance", () => {
    for (const value of ["20deg", "2s", "1fr", "96dpi", "1khz", "3turn"]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("accepts the length units, including container and viewport ones", () => {
    for (const value of [
      "16px",
      "2rem",
      "1.5em",
      "10cqw",
      "50dvh",
      "2.5cm",
      "12pt",
      "3ch",
    ]) {
      expect(codes({ width: value }), value).toEqual([]);
    }
  });

  it("applies the same rule inside a math function", () => {
    expect(codes({ width: "calc(1px + 20deg)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(1px + 2rem)" })).toEqual([]);
  });
});

describe("hex colors", () => {
  it("refuses tokens that are not hex in a legal length", () => {
    for (const value of ["#xyz", "#12", "#12345", "#1234567"]) {
      expect(codes({ color: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("accepts the three, four, six, and eight digit forms", () => {
    for (const value of ["#fff", "#ffff", "#ff8800", "#ff8800cc", "#ABCDEF"]) {
      expect(codes({ color: value }), value).toEqual([]);
    }
  });
});

describe("urls written as strings", () => {
  it("are checked inside image-set, which takes its url as a string", () => {
    // The parser gives these no Url node, so a walk looking only for urls
    // passes straight over the scheme.
    for (const value of [
      'image-set("javascript:alert1" 1x)',
      'image-set("data:text/html,x" 1x)',
      '-webkit-image-set("javascript:alert1" 1x)',
      'src("javascript:alert1")',
    ]) {
      expect(checkCssValue(value), value).toBe("unsafe-url-scheme");
    }
  });

  it("leaves ordinary image-set values and font names alone", () => {
    expect(checkCssValue('image-set("/media/a.png" 1x)')).toBeNull();
    expect(
      checkCssValue('image-set("https://cdn.example.com/a.png" 2x)')
    ).toBeNull();
    expect(codes({ fontFamily: '"Helvetica Neue", sans-serif' })).toEqual([]);
  });

  it("surfaces through validation of a gradient", () => {
    expect(
      codes({ backgroundGradient: 'image-set("javascript:alert1" 1x)' })
    ).toEqual(["invalid-style-value"]);
  });
});

describe("square-bracket nesting", () => {
  it("is bounded like parenthesis nesting", () => {
    const deep = `${"[".repeat(1200)}${"]".repeat(1200)}`;
    expect(checkCssValue(deep)).toBe("too-deeply-nested");
    expect(() => check({ width: deep })).not.toThrow();
  });

  it("leaves a grid line-name list alone", () => {
    expect(
      codes({ gridTemplateColumns: "[full-start] 1fr [full-end]" })
    ).toEqual([]);
  });
});

describe("urls written as strings in image()", () => {
  it("are checked, since an image source may be a string", () => {
    expect(checkCssValue('image("javascript:alert1")')).toBe(
      "unsafe-url-scheme"
    );
    expect(checkCssValue('image("data:text/html,x")')).toBe(
      "unsafe-url-scheme"
    );
  });

  it("leaves an ordinary image() alone", () => {
    expect(checkCssValue('image("/media/a.png")')).toBeNull();
  });
});

describe("keywords belong to the property, not to lengths in general", () => {
  it("refuses a keyword the property does not take", () => {
    // `padding: auto` and `font-size: none` are discarded by the browser.
    expect(codes({ padding: { blockStart: "auto" } })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ fontSize: "none" })).toEqual(["invalid-style-value"]);
    expect(codes({ borderRadius: "auto" })).toEqual(["invalid-style-value"]);
  });

  it("accepts the keyword each property actually takes", () => {
    expect(codes({ margin: { blockStart: "auto" } })).toEqual([]);
    expect(codes({ width: "auto" })).toEqual([]);
    expect(codes({ width: "max-content" })).toEqual([]);
    expect(codes({ maxWidth: "none" })).toEqual([]);
    expect(codes({ gap: "normal" })).toEqual([]);
    expect(codes({ letterSpacing: "normal" })).toEqual([]);
    expect(codes({ fontSize: "larger" })).toEqual([]);
    expect(codes({ border: { width: { blockStart: "thin" } } })).toEqual([]);
    expect(codes({ position: { inset: { blockStart: "auto" } } })).toEqual([]);
  });

  it("accepts the CSS-wide keywords everywhere", () => {
    for (const value of ["inherit", "initial", "unset", "revert"]) {
      expect(codes({ padding: { blockStart: value } }), value).toEqual([]);
    }
  });
});

describe("issue volume", () => {
  it("is bounded, so a large malformed map cannot amplify the response", () => {
    const many: Record<string, unknown> = {};
    for (let index = 0; index < 5000; index += 1) many[`k${index}`] = "1px";
    const budget = newStyleIssueBudget();
    const issues = validateStyleValues(many, "/styles", "strict", budget);
    expect(issues.length).toBeLessThanOrEqual(MAX_STYLE_ISSUES + 1);
    expect(issues.at(-1)?.code).toBe("style-issues-truncated");
  });

  it("reports everything when the map fits inside the budget", () => {
    const issues = validateStyleValues(
      { nope: "1px", alsoNope: "1px" },
      "/styles",
      "strict",
      newStyleIssueBudget()
    );
    expect(issues.map(issue => issue.code)).toEqual([
      "unknown-style-property",
      "unknown-style-property",
    ]);
  });
});

describe("how many measurements a property takes", () => {
  it("refuses a second measurement on a scalar property", () => {
    // `width: 4px 8px` is discarded whole by the browser.
    expect(codes({ width: "4px 8px" })).toEqual(["invalid-style-value"]);
    expect(codes({ fontSize: "4px 8px" })).toEqual(["invalid-style-value"]);
    expect(codes({ padding: { blockStart: "4px 8px" } })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("accepts the shorthand that legitimately carries more", () => {
    expect(codes({ gap: "4px 8px" })).toEqual([]);
  });

  it("refuses a third value on a two-part shorthand", () => {
    expect(codes({ gap: "4px 8px 12px" })).toEqual(["invalid-style-value"]);
  });
});

describe("functions whose result is never a length", () => {
  it("are refused even though their arguments are lengths", () => {
    expect(codes({ width: "sign(1px)" })).toEqual(["invalid-style-value"]);
  });

  it("leaves the ones that preserve their argument type", () => {
    expect(codes({ width: "abs(-1px)" })).toEqual([]);
    expect(codes({ width: "round(1.5px, 1px)" })).toEqual([]);
  });
});

describe("CSS-wide keywords on keyword properties", () => {
  it("are accepted, as they are on lengths and colors", () => {
    expect(codes({ display: "inherit" })).toEqual([]);
    expect(codes({ textAlign: "initial" })).toEqual([]);
    expect(codes({ position: { type: "unset" } })).toEqual([]);
    expect(codes({ objectFit: "revert" })).toEqual([]);
  });

  it("still refuses a keyword that is neither", () => {
    expect(codes({ display: "sideways" })).toEqual(["invalid-style-value"]);
  });
});

describe("the issue budget reaches composites too", () => {
  it("bounds a single object holding very many keys", () => {
    const sides: Record<string, unknown> = {};
    for (let index = 0; index < 5000; index += 1) sides[`s${index}`] = "1px";
    const budget = newStyleIssueBudget();
    const issues = validateStyleValues(
      { padding: sides },
      "/styles",
      "strict",
      budget
    );
    expect(issues.length).toBeLessThanOrEqual(MAX_STYLE_ISSUES + 1);
    // A composite that stops early must say so, not return a short list that
    // reads as complete.
    expect(issues.at(-1)?.code).toBe("style-issues-truncated");
  });

  it("bounds path text inside a composite, not only between properties", () => {
    // The run is charged when a walk RETURNS, so a composite that only asked
    // the budget would build every field's issue first. `background` under a
    // long breakpoint id is the shape that reaches hundreds of megabytes from
    // a document inside the byte cap.
    const longKey = "b".repeat(200_000);
    const fields: Record<string, unknown> = {};
    for (let index = 0; index < 199; index += 1) fields[`nope${index}`] = "x";
    const budget = newStyleIssueBudget();
    const issues = validateStyleValues(
      { background: fields },
      `/nodes/0/styles/base/${longKey}`,
      "strict",
      budget
    );
    const totalPathBytes = issues.reduce(
      (sum, issue) => sum + issue.path.length,
      0
    );
    expect(totalPathBytes).toBeLessThan(2_000_000);
    expect(issues.at(-1)?.code).toBe("style-issues-truncated");
  });

  it("bounds the total path text, not only the number of issues", () => {
    // A pointer repeats every key above it. One very long key is therefore
    // copied into every issue beneath it, so a document inside the byte cap
    // can produce output hundreds of times its own size: counting issues
    // alone bounds the question and not the answer.
    const longKey = "b".repeat(200_000);
    const values: Record<string, unknown> = {};
    for (let index = 0; index < 199; index += 1) values[`nope${index}`] = "1px";
    const budget = newStyleIssueBudget();
    const issues = validateStyleValues(
      values,
      `/nodes/0/styles/base/${longKey}`,
      "strict",
      budget
    );
    const totalPathBytes = issues.reduce(
      (sum, issue) => sum + issue.path.length,
      0
    );
    // Without a path allowance this is 199 x 200 kB of pointer text.
    expect(totalPathBytes).toBeLessThan(2_000_000);
    expect(issues.at(-1)?.code).toBe("style-issues-truncated");
  });
});

describe("stopping early fails closed", () => {
  it("reports truncation as an error, so a caller keeping only errors still refuses the write", () => {
    // A write path that filters warnings would otherwise see a clean result for
    // a document whose remaining values were never inspected.
    const values: Record<string, unknown> = {};
    for (let index = 0; index < MAX_STYLE_ISSUES; index += 1) {
      values[`k${index}`] = "1px";
    }
    values.backgroundGradient = 'url("javascript:alert1")';
    const issues = validateStyleValues(
      values,
      "/styles",
      "forgiving",
      newStyleIssueBudget()
    );
    expect(issues.some(issue => issue.severity === "error")).toBe(true);
    expect(issues.some(issue => issue.code === "style-issues-truncated")).toBe(
      true
    );
  });
});

describe("comment delimiters", () => {
  it("are refused, since the parser treats them as trivia", () => {
    expect(checkCssValue("red /*")).toBe("unsafe-characters");
    expect(checkCssValue("red */")).toBe("unsafe-characters");
    expect(codes({ color: "red /*" })).toEqual(["invalid-style-value"]);
  });
});

describe("value size", () => {
  it("is bounded, since a broad value is as costly to parse as a deep one", () => {
    const wide = Array.from({ length: 4000 }, () => "1px").join(" ");
    expect(checkCssValue(wide)).toBe("too-long");
  });
});

describe("keyword case", () => {
  it("is ignored, as CSS ignores it", () => {
    expect(codes({ textAlign: "START" })).toEqual([]);
    expect(codes({ display: "BLOCK" })).toEqual([]);
    expect(codes({ containerType: "INLINE-SIZE" })).toEqual([]);
    expect(codes({ textAlign: "Start" })).toEqual([]);
  });
});

describe("negative and percentage measurements", () => {
  it("are refused where the property does not take them", () => {
    expect(codes({ padding: { blockStart: "-1px" } })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ gap: "-1px" })).toEqual(["invalid-style-value"]);
    expect(codes({ letterSpacing: "10%" })).toEqual(["invalid-style-value"]);
    expect(codes({ border: { width: { blockStart: "50%" } } })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("are accepted where they are meaningful", () => {
    expect(codes({ margin: { blockStart: "-1px" } })).toEqual([]);
    expect(codes({ letterSpacing: "-0.02em" })).toEqual([]);
    expect(codes({ width: "50%" })).toEqual([]);
    expect(codes({ padding: { blockStart: "5%" } })).toEqual([]);
    // The sign of one term says nothing about a math result.
    expect(codes({ padding: { blockStart: "calc(100% - 10px)" } })).toEqual([]);
  });
});

describe("stray operators in a length", () => {
  it("are refused", () => {
    expect(codes({ width: "1px," })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "1px /" })).toEqual(["invalid-style-value"]);
    expect(codes({ gap: "1px / 2px" })).toEqual(["invalid-style-value"]);
  });

  it("including every slash form a corner radius used to allow", () => {
    for (const value of ["4px / 8px", "/ 1px", "1px /", "1px / / 2px"]) {
      expect(codes({ borderRadius: value }), value).toEqual([
        "invalid-style-value",
      ]);
    }
  });
});

describe("values a stricter model used to refuse", () => {
  it("accepts a fractional variable-font weight", () => {
    expect(codes({ fontWeight: 450.5 })).toEqual([]);
  });

  it("accepts auto to reset the stacking order", () => {
    expect(codes({ position: { zIndex: "auto" } })).toEqual([]);
    expect(codes({ position: { zIndex: 3 } })).toEqual([]);
  });
});

describe("keywords and operators inside math functions", () => {
  it("refuses a property keyword as an operand", () => {
    // `auto` is a complete value, not a number to compute with.
    for (const value of ["calc(auto)", "min(auto, 2px)", "calc(inherit)"]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("refuses an operator that separates nothing", () => {
    for (const value of ["calc(1px,)", "calc(/ 1px)", "min(1px,)"]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("leaves well-formed math alone", () => {
    for (const value of [
      "calc(1px + 2em)",
      "min(1px, 2em)",
      "clamp(1rem, 5vw, 3rem)",
      "calc(min(10px, 2em) * 2)",
    ]) {
      expect(codes({ width: value }), value).toEqual([]);
    }
  });
});

describe("CSS-wide keywords on numeric properties", () => {
  it("are accepted, so a later state can reset an earlier value", () => {
    for (const value of ["inherit", "initial", "unset", "revert"]) {
      expect(codes({ opacity: value }), value).toEqual([]);
    }
    expect(codes({ position: { zIndex: "inherit" } })).toEqual([]);
  });

  it("still refuses a non-numeric string", () => {
    expect(codes({ opacity: "half" })).toEqual(["invalid-style-value"]);
  });
});

describe("system colors", () => {
  it("are accepted, since forced-colors modes are expressed with them", () => {
    for (const value of [
      "Canvas",
      "CanvasText",
      "LinkText",
      "ButtonFace",
      "AccentColor",
      "Highlight",
    ]) {
      expect(codes({ color: value }), value).toEqual([]);
    }
  });
});

describe("identifiers a math function's own grammar requires", () => {
  it("are accepted for the function that defines them", () => {
    expect(codes({ width: "round(up, 10px, 1px)" })).toEqual([]);
    expect(codes({ width: "round(nearest, 10px, 1px)" })).toEqual([]);
    expect(codes({ width: "anchor-size(width)" })).toEqual([]);
  });

  it("do not leak into functions that do not define them", () => {
    expect(codes({ width: "calc(up)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "min(width, 2px)" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("operands and operators alternate", () => {
  it("refuses two operands with nothing between them", () => {
    expect(codes({ width: "calc(1px 2px)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "min(1px 2px)" })).toEqual(["invalid-style-value"]);
  });

  it("refuses a function with no argument at all", () => {
    expect(codes({ width: "calc()" })).toEqual(["invalid-style-value"]);
  });
});

describe("parenthesised terms in a length", () => {
  it("are accepted, following the same rules as the expression around them", () => {
    expect(codes({ width: "calc((1px + 2px) * 3)" })).toEqual([]);
    expect(codes({ width: "calc(2 * (1px + 2em))" })).toEqual([]);
  });

  it("are still held to those rules", () => {
    expect(codes({ width: "calc((1px 2px) * 3)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc((red) * 3)" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("issue codes", () => {
  it("are all declared in the shared code table", () => {
    const emitted = [
      ...codes({ nope: "1px" }),
      ...codes({ textAlign: "left" }),
      ...codes({ display: { $token: "x" } }),
    ];
    for (const code of emitted) {
      expect(Object.keys(ISSUE_CODES)).toContain(code);
    }
  });
});

describe("a CSS-wide keyword is the whole value", () => {
  it("is accepted on its own where the property takes several measurements", () => {
    expect(codes({ gap: "inherit" })).toEqual([]);
    expect(codes({ gap: "1px 2px" })).toEqual([]);
  });

  it("is refused beside another measurement, which paints nothing at all", () => {
    for (const value of [
      "inherit 1px",
      "1px unset",
      "revert 2px",
      "1px initial",
    ]) {
      expect(codes({ gap: value }), value).toEqual(["invalid-style-value"]);
    }
  });
});

describe("operators around a color", () => {
  it("are refused, since no color syntax takes one at the top level", () => {
    for (const value of ["red,", "/ red", "red +", "#fff,", "red blue"]) {
      expect(codes({ color: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("does not refuse the operators inside a color function", () => {
    expect(codes({ color: "rgb(1, 2, 3)" })).toEqual([]);
    expect(codes({ color: "rgb(1 2 3 / 50%)" })).toEqual([]);
    expect(codes({ color: "color-mix(in srgb, red 50%, blue)" })).toEqual([]);
  });
});

describe("functions that produce a length without arithmetic", () => {
  it("accepts the argument grammars they define, rather than reading them as maths", () => {
    expect(codes({ width: "anchor-size(--hero width)" })).toEqual([]);
    expect(codes({ width: "anchor-size(--hero width, 10px)" })).toEqual([]);
    expect(codes({ width: "fit-content(20%)" })).toEqual([]);
  });

  it("still refuses a function that never produces a length", () => {
    expect(codes({ width: "rotate(2deg)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "sign(1px)" })).toEqual(["invalid-style-value"]);
  });
});

describe("the size cap applies to a dedicated url too", () => {
  it("refuses a url past the per-value limit", () => {
    const long = `https://example.com/${"a".repeat(9000)}`;
    expect(checkUrlValue(long)).toBe("too-long");
    expect(codes({ background: { url: long } })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("accepts one comfortably inside it", () => {
    const ok = `https://example.com/${"a".repeat(100)}`;
    expect(codes({ background: { url: ok } })).toEqual([]);
  });
});

describe("parentheses inside a url the parser has already delimited", () => {
  it("are accepted, being ordinary characters in a quoted path", () => {
    expect(checkCssValue('url("https://example.com/photo(1).png")')).toBeNull();
    expect(checkCssValue('image-set("photo(1).png" 1x)')).toBeNull();
    expect(codes({ backgroundGradient: 'url("a/photo(1).png")' })).toEqual([]);
  });

  it("are still refused in a raw url, where they would close the function", () => {
    expect(checkUrlValue("a(b).png")).toBe("unsafe-url-characters");
    expect(codes({ background: { url: "a(b).png" } })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("does not relax the quote, backslash or scheme rules for a quoted url", () => {
    expect(checkUrlValue('a"b', "quoted")).toBe("unsafe-url-characters");
    expect(checkUrlValue("a\\b", "quoted")).toBe("unsafe-url-characters");
    expect(checkUrlValue("javascript:alert(1)", "quoted")).toBe(
      "unsafe-url-scheme"
    );
    expect(checkCssValue('url("\\6a avascript:alert(1)")')).toBe(
      "unsafe-url-scheme"
    );
  });
});

describe("an unbounded key from the document", () => {
  it("is bounded in the message, and located exactly by the path", () => {
    // Only the MESSAGE bounds an untrusted key. A path is a location, and one
    // that has been shortened or had a segment dropped either resolves to
    // nothing or to the wrong value.
    const key = "z".repeat(5000);
    const issues = check({ [key]: "1px" });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe(`/styles/${key}`);
    expect(issues[0]?.message.length).toBeLessThan(200);
  });

  it("does the same when the key names a part of a composite", () => {
    const key = "z".repeat(5000);
    const issues = check({ background: { [key]: "1px" } });
    expect(issues[0]?.path).toBe(`/styles/background/${key}`);
    expect(issues[0]?.message.length).toBeLessThan(200);
  });

  it("leaves a key short enough to resolve untouched", () => {
    expect(check({ nope: "1px" })[0]?.path).toBe("/styles/nope");
  });

  it("carries the key whole, so the path locates it exactly", () => {
    // Shortening the token makes the path resolve to nothing; dropping it
    // makes descendants resolve to the WRONG value, one level up. Pointing
    // somewhere incorrect is worse than pointing somewhere large, so the key
    // is carried; the MESSAGE is what stays bounded.
    const key = "z".repeat(200);
    const issues = check({ [key]: "1px" });
    expect(issues[0]?.path).toBe(`/styles/${key}`);
    expect(issues[0]?.message.length).toBeLessThan(200);
  });
});

describe("escaped and quoted brackets in the nesting count", () => {
  it("refuses a value whose real depth hides behind escaped closers", () => {
    // An escaped `)` closes nothing, so counting it as a closer undercounts the
    // depth and lets a value through that then exhausts the stack while being
    // walked. Refusing is the point; not throwing is the larger point.
    const hidden = `${"f(\\)".repeat(1500)}1${")".repeat(1500)}`;
    expect(hidden.length).toBeLessThan(8192);
    expect(checkCssValue(hidden)).toBe("too-deeply-nested");
    expect(codes({ backgroundGradient: hidden })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("does not count brackets inside a quoted string as nesting", () => {
    // Past the depth cap on a raw count, so this passes only because the
    // brackets are recognised as text rather than as nesting.
    const quoted = `url("a${"(".repeat(40)}b")`;
    expect(checkCssValue(quoted)).toBeNull();
  });

  it("still refuses genuinely deep nesting", () => {
    const deep = `${"calc(".repeat(40)}1px${")".repeat(40)}`;
    expect(checkCssValue(deep)).toBe("too-deeply-nested");
  });
});

describe("how many arguments a math function takes", () => {
  it("refuses a count or separator the function does not accept", () => {
    for (const value of [
      "calc(1px, 2px)",
      "clamp(1px)",
      "clamp(1px, 2px)",
      "abs(1px, 2px)",
      "mod(1px)",
      "min()",
    ]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("accepts every arity those functions really have", () => {
    for (const value of [
      "clamp(1rem, 2vw, 3rem)",
      "min(1px)",
      "min(1px, 2px, 3px)",
      "max(1px,2px)",
      "abs(1px)",
      "mod(4px, 3px)",
      "rem(4px, 3px)",
      "round(up, 10px, 1px)",
      "round(10px, 1px)",
      "calc(1px + 2px)",
      "calc((1px + 2px) * 3)",
      "clamp(1rem, calc(1vw + 1px), 3rem)",
    ]) {
      expect(codes({ width: value }), value).toEqual([]);
    }
  });
});

describe("surrounding whitespace on a keyword value", () => {
  it("is accepted, as it already is on a length or a color", () => {
    expect(codes({ display: " block " })).toEqual([]);
    expect(codes({ gridAutoFlow: " row dense " })).toEqual([]);
    expect(codes({ textAlign: " start " })).toEqual([]);
    expect(codes({ display: "inherit " })).toEqual([]);
  });

  it("does not turn whitespace alone into a value", () => {
    expect(codes({ display: "   " })).toEqual(["invalid-style-value"]);
    expect(codes({ display: " nope " })).toEqual(["invalid-style-value"]);
  });
});

describe("functions that belong to one kind of property", () => {
  it("accepts a sizing function on the properties that take a size", () => {
    for (const property of [
      "width",
      "height",
      "minWidth",
      "minHeight",
      "maxWidth",
      "maxHeight",
    ]) {
      expect(codes({ [property]: "fit-content(10px)" }), property).toEqual([]);
    }
  });

  it("refuses it where a browser would discard the declaration", () => {
    for (const property of ["gap", "borderRadius", "fontSize", "lineHeight"]) {
      expect(codes({ [property]: "fit-content(10px)" }), property).toEqual([
        "invalid-style-value",
      ]);
    }
    expect(codes({ padding: { blockStart: "fit-content(10px)" } })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("length-producing functions beyond the four arithmetic ones", () => {
  it("accepts a hypotenuse, which is a length when its arguments are", () => {
    expect(codes({ width: "hypot(3px, 4px)" })).toEqual([]);
    expect(codes({ width: "hypot(3px)" })).toEqual([]);
    expect(codes({ width: "calc(hypot(3px, 4px) + 1px)" })).toEqual([]);
  });

  it("still holds it to having an argument", () => {
    expect(codes({ width: "hypot()" })).toEqual(["invalid-style-value"]);
  });
});

describe("grouping parentheses", () => {
  it("are refused standing alone, where they are not value syntax", () => {
    for (const value of ["(1px)", "((1px))", "(1px + 2px)"]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("are still accepted inside a math expression", () => {
    expect(codes({ width: "calc((1px + 2px) * 3)" })).toEqual([]);
    expect(codes({ width: "calc(2 * (1px + 2em))" })).toEqual([]);
    expect(codes({ width: "min((1px + 1px), 3px)" })).toEqual([]);
  });
});

describe("surrounding whitespace on a numeric property", () => {
  it("does not hide a CSS-wide keyword, as it does not on other leaf kinds", () => {
    expect(codes({ opacity: " inherit " })).toEqual([]);
    expect(codes({ opacity: " REVERT-LAYER " })).toEqual([]);
    expect(codes({ position: { zIndex: " inherit " } })).toEqual([]);
  });

  it("does not turn a non-keyword string into a number", () => {
    expect(codes({ opacity: " nope " })).toEqual(["invalid-style-value"]);
    expect(codes({ opacity: " 0.5 " })).toEqual(["invalid-style-value"]);
  });
});

describe("a math expression whose result type is not knowable here", () => {
  it("is accepted, because refusing it would refuse valid CSS elsewhere", () => {
    // `line-height` takes a bare number, so `calc(2)` is a real declaration on
    // it. A rule that refused unitless arithmetic on length properties would
    // have to know that, and being wrong about it rejects working CSS rather
    // than merely passing a value the browser drops.
    expect(codes({ lineHeight: "calc(2)" })).toEqual([]);
    expect(codes({ width: "calc(2 * 1px)" })).toEqual([]);
    expect(codes({ width: "calc(var(--x) * 2)" })).toEqual([]);
  });
});

describe("functions that belong to one family of properties", () => {
  it("accepts an anchor on the properties an anchor positions", () => {
    expect(
      codes({ position: { inset: { blockStart: "anchor(--hero bottom)" } } })
    ).toEqual([]);
  });

  it("accepts an intrinsic-size calculation where a size belongs", () => {
    expect(codes({ width: "calc-size(auto, size + 1rem)" })).toEqual([]);
    expect(codes({ maxHeight: "calc-size(auto, size + 1rem)" })).toEqual([]);
  });

  it("keeps each of them off the properties they mean nothing on", () => {
    expect(codes({ gap: "anchor(--hero bottom)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ gap: "calc-size(auto, size + 1rem)" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("a keyword property that takes one value per axis", () => {
  it("accepts the two-keyword shorthand where the property has one", () => {
    expect(codes({ overflow: "hidden auto" })).toEqual([]);
    expect(codes({ overflow: "hidden" })).toEqual([]);
  });

  it("refuses more keywords than the property takes, or an unknown one", () => {
    expect(codes({ overflow: "hidden auto clip" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ overflow: "hidden nope" })).toEqual(["invalid-style-value"]);
  });

  it("does not let a single-value property take two", () => {
    expect(codes({ display: "block flex" })).toEqual(["invalid-style-value"]);
  });

  it("still reads a two-word vocabulary entry as the one value it is", () => {
    expect(codes({ gridAutoFlow: "row dense" })).toEqual([]);
    expect(codes({ gridAutoFlow: "  row   dense  " })).toEqual([]);
  });

  it("keeps a CSS-wide keyword standing alone", () => {
    expect(codes({ overflow: "inherit" })).toEqual([]);
    expect(codes({ overflow: "inherit hidden" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("the size cap applies before a value is normalised", () => {
  it("refuses an oversized string that trimming would shrink to a keyword", () => {
    const padded = `${" ".repeat(9000)}block`;
    expect(codes({ display: padded })).toEqual(["invalid-style-value"]);
    expect(codes({ opacity: `${" ".repeat(9000)}inherit` })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("still accepts the same keywords at a sane length", () => {
    expect(codes({ display: "  block  " })).toEqual([]);
    expect(codes({ opacity: "  inherit  " })).toEqual([]);
  });
});

describe("percentages where the property's grammar has them", () => {
  it("accepts a percentage word spacing", () => {
    expect(codes({ wordSpacing: "10%" })).toEqual([]);
    expect(codes({ wordSpacing: "1px" })).toEqual([]);
  });

  it("still refuses one where the property takes a length only", () => {
    expect(codes({ letterSpacing: "10%" })).toEqual(["invalid-style-value"]);
  });
});

describe("colors chosen by a function", () => {
  it("accepts a contrast-derived color", () => {
    expect(checkColorValue("contrast-color(red)")).toBeNull();
    expect(codes({ color: "contrast-color(red)" })).toEqual([]);
  });
});

describe("a background repeat per axis", () => {
  it("accepts the two-keyword form the property really has", () => {
    for (const value of ["repeat no-repeat", "space round", "repeat repeat"]) {
      expect(codes({ background: { repeat: value } }), value).toEqual([]);
    }
  });

  it("still accepts a single keyword and refuses an unknown one", () => {
    expect(codes({ background: { repeat: "no-repeat" } })).toEqual([]);
    expect(codes({ background: { repeat: "repeat nope" } })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ background: { repeat: "repeat no-repeat space" } })).toEqual(
      ["invalid-style-value"]
    );
  });
});

describe("keys a document did not put there", () => {
  it("are not read from the prototype by the style walk", () => {
    // A lazily enumerated object walks inherited enumerable keys too, so a
    // crafted prototype would otherwise be validated as if it were content.
    const crafted = Object.create({ inheritedKey: "1px" }) as Record<
      string,
      unknown
    >;
    crafted.display = "block";
    expect(codes(crafted as never)).toEqual([]);
  });

  it("are refused along with the composite carrying them", () => {
    const parts = Object.create({ inheritedSide: "1px" }) as Record<
      string,
      unknown
    >;
    parts.blockStart = "1rem";
    expect(codes({ padding: parts } as never)).toEqual(["invalid-style-value"]);
  });
});

describe("keywords that name every axis at once", () => {
  it("accepts them standing alone", () => {
    expect(codes({ background: { repeat: "repeat-x" } })).toEqual([]);
    expect(codes({ background: { repeat: "repeat-y" } })).toEqual([]);
  });

  it("refuses them paired with anything, which browsers discard", () => {
    for (const value of [
      "repeat-x repeat-y",
      "repeat-x no-repeat",
      "no-repeat repeat-x",
    ]) {
      expect(codes({ background: { repeat: value } }), value).toEqual([
        "invalid-style-value",
      ]);
    }
  });

  it("leaves the pairable keywords pairing", () => {
    expect(codes({ background: { repeat: "repeat no-repeat" } })).toEqual([]);
    expect(codes({ background: { repeat: "space round" } })).toEqual([]);
  });
});

describe("clearing a value a property normally states as a URL", () => {
  it("accepts the keyword that clears it, and the CSS-wide resets", () => {
    for (const value of ["none", "initial", "unset", "inherit", "  none  "]) {
      expect(codes({ background: { url: value } }), value).toEqual([]);
    }
  });

  it("still judges anything else as a URL, with URL guidance", () => {
    expect(
      codes({ background: { url: "https://cdn.example.com/a.png" } })
    ).toEqual([]);
    const issues = check({ background: { url: "javascript:alert(1)" } });
    expect(issues[0]?.code).toBe("invalid-style-value");
    expect(issues[0]?.suggestion).toContain("http");
  });

  it("does not let the keyword shortcut skip the size cap", () => {
    expect(codes({ background: { url: `${" ".repeat(9000)}none` } })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("blend modes the platform ships", () => {
  it("accepts the additive ones", () => {
    expect(codes({ mixBlendMode: "plus-lighter" })).toEqual([]);
    expect(codes({ mixBlendMode: "plus-darker" })).toEqual([]);
  });

  it("still refuses one that is not a blend mode", () => {
    expect(codes({ mixBlendMode: "nope" })).toEqual(["invalid-style-value"]);
  });
});

describe("whitespace CSS does not treat as whitespace", () => {
  const NBSP = " ";
  const EM_SPACE = " ";

  it("is refused, because the parser keeps it inside the identifier", () => {
    expect(codes({ display: `block${NBSP}` })).toEqual(["invalid-style-value"]);
    expect(codes({ display: `${EM_SPACE}block` })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ gridAutoFlow: `row${NBSP}dense` })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ opacity: `${NBSP}inherit` })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("does not stop real CSS whitespace being normalised", () => {
    expect(codes({ display: " block " })).toEqual([]);
    expect(codes({ display: "\tblock\n" })).toEqual([]);
    expect(codes({ display: "\fblock\r" })).toEqual([]);
    expect(codes({ gridAutoFlow: "row\tdense" })).toEqual([]);
    expect(codes({ opacity: " inherit " })).toEqual([]);
    expect(codes({ background: { url: "  none  " } })).toEqual([]);
  });

  it("leaves a url leaf accepting the value, as a path rather than a keyword", () => {
    // Both readings accept this, so validation cannot tell them apart; what
    // changes is which one the compiler is told it has. The keyword shortcut
    // still may not skip the checks that follow it.
    expect(codes({ background: { url: `${NBSP}none` } })).toEqual([]);
    expect(codes({ background: { url: `${NBSP}javascript:x` } })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("a slant given as an angle", () => {
  it("is storable, which a closed keyword set cannot express", () => {
    expect(codes({ fontStyle: "oblique 10deg" })).toEqual([]);
    expect(codes({ fontStyle: "oblique -5deg" })).toEqual([]);
  });

  it("leaves the plain keywords working", () => {
    for (const value of ["normal", "italic", "oblique"]) {
      expect(codes({ fontStyle: value }), value).toEqual([]);
    }
  });

  it("still refuses a value that is not CSS at all", () => {
    expect(codes({ fontStyle: "oblique; color: red" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("operands a math expression defines for itself", () => {
  it("accepts the CSS math constants", () => {
    expect(codes({ width: "calc(pi * 1px)" })).toEqual([]);
    expect(codes({ width: "calc(e * 1rem)" })).toEqual([]);
    expect(codes({ width: "calc(infinity * 1px)" })).toEqual([]);
  });

  it("does not let them stand as a whole value, or admit other identifiers", () => {
    expect(codes({ width: "pi" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "calc(nope * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(auto)" })).toEqual(["invalid-style-value"]);
  });
});

describe("a dimension taken from an attribute", () => {
  it("is accepted, since the declared unit makes the result one", () => {
    expect(codes({ width: "attr(data-width px, 0px)" })).toEqual([]);
    expect(codes({ width: "attr(data-width px)" })).toEqual([]);
  });
});

describe("alignment keywords that resolve against the flex direction", () => {
  it("are accepted, being direction-relative rather than physical", () => {
    for (const property of ["justifyContent", "alignItems", "alignContent"]) {
      for (const value of ["flex-start", "flex-end"]) {
        expect(codes({ [property]: value }), `${property}: ${value}`).toEqual(
          []
        );
      }
    }
  });

  it("does not admit the physical ones alongside them", () => {
    for (const property of ["justifyContent", "alignItems", "alignContent"]) {
      expect(codes({ [property]: "left" }), property).toEqual([
        "invalid-style-value",
      ]);
      expect(codes({ [property]: "right" }), property).toEqual([
        "invalid-style-value",
      ]);
    }
  });
});

describe("vocabularies that were missing a standard member", () => {
  it("accepts the case transforms CJK text needs", () => {
    expect(codes({ textTransform: "full-width" })).toEqual([]);
    expect(codes({ textTransform: "full-size-kana" })).toEqual([]);
    expect(codes({ textTransform: "uppercase" })).toEqual([]);
  });

  it("accepts a hidden border, which is not the same as none", () => {
    expect(codes({ border: { style: "hidden" } })).toEqual([]);
    expect(codes({ border: { style: "none" } })).toEqual([]);
  });

  it("still refuses a value in neither vocabulary", () => {
    expect(codes({ textTransform: "nope" })).toEqual(["invalid-style-value"]);
    expect(codes({ border: { style: "nope" } })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("alignment values built from the box-alignment grammar", () => {
  it("accepts a position with either overflow-safety keyword", () => {
    expect(codes({ alignItems: "safe center" })).toEqual([]);
    expect(codes({ alignItems: "unsafe center" })).toEqual([]);
    expect(codes({ justifyContent: "safe center" })).toEqual([]);
    expect(codes({ alignContent: "unsafe end" })).toEqual([]);
  });

  it("accepts the self-relative positions where the property takes them", () => {
    expect(codes({ alignItems: "self-start" })).toEqual([]);
    expect(codes({ alignItems: "self-end" })).toEqual([]);
    expect(codes({ alignItems: "safe self-start" })).toEqual([]);
  });

  it("accepts a baseline taken from either end, and normal", () => {
    expect(codes({ alignItems: "first baseline" })).toEqual([]);
    expect(codes({ alignItems: "last baseline" })).toEqual([]);
    expect(codes({ alignContent: "first baseline" })).toEqual([]);
    expect(codes({ justifyContent: "normal" })).toEqual([]);
  });

  it("keeps the physical values out, prefixed or not", () => {
    for (const property of ["alignItems", "justifyContent", "alignContent"]) {
      for (const value of ["left", "right", "safe left", "unsafe right"]) {
        expect(codes({ [property]: value }), `${property}: ${value}`).toEqual([
          "invalid-style-value",
        ]);
      }
    }
  });

  it("does not let two positions pair up", () => {
    expect(codes({ alignItems: "self-start self-end" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("values a closed vocabulary had simply missed", () => {
  it("accepts the table and list-marker display modes", () => {
    for (const value of ["table", "inline-table", "table-cell", "list-item"]) {
      expect(codes({ display: value }), value).toEqual([]);
    }
  });

  it("accepts either ordering of the unordered grid-flow grammar", () => {
    expect(codes({ gridAutoFlow: "dense row" })).toEqual([]);
    expect(codes({ gridAutoFlow: "dense column" })).toEqual([]);
    expect(codes({ gridAutoFlow: "row dense" })).toEqual([]);
  });

  it("accepts alignment resolved against the parent's direction", () => {
    expect(codes({ textAlign: "match-parent" })).toEqual([]);
  });

  it("still refuses a value in none of those vocabularies", () => {
    expect(codes({ display: "nope" })).toEqual(["invalid-style-value"]);
    expect(codes({ gridAutoFlow: "dense dense" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("an attribute value has to declare a usable type", () => {
  it("refuses the forms that cannot produce a measurement", () => {
    // No type at all is a string, and a declared angle is not a length;
    // browsers discard both where a width belongs.
    expect(codes({ width: "attr(title)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "attr(data-angle deg)" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("keeps the forms that do", () => {
    expect(codes({ width: "attr(data-width px, 0px)" })).toEqual([]);
    expect(codes({ width: "attr(data-width px)" })).toEqual([]);
  });
});

describe("math functions whose result is a number", () => {
  it("are legal operands in arithmetic that produces a length", () => {
    expect(codes({ width: "calc(sqrt(4) * 1px)" })).toEqual([]);
    expect(codes({ width: "calc(sign(1px) * 10px)" })).toEqual([]);
    expect(codes({ width: "calc(pow(2,3) * 1px)" })).toEqual([]);
  });

  it("are still not lengths on their own", () => {
    expect(codes({ width: "sqrt(4)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "sign(1px)" })).toEqual(["invalid-style-value"]);
  });
});

describe("transformations that compose", () => {
  it("accepts them together, in either order", () => {
    for (const value of [
      "uppercase full-width",
      "full-width uppercase",
      "full-width full-size-kana",
      "uppercase full-width full-size-kana",
    ]) {
      expect(codes({ textTransform: value }), value).toEqual([]);
    }
  });

  it("still refuses two that exclude each other, or one repeated", () => {
    expect(codes({ textTransform: "uppercase lowercase" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ textTransform: "full-width full-width" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("keeps the single keywords working", () => {
    for (const value of ["none", "uppercase", "full-width"]) {
      expect(codes({ textTransform: value }), value).toEqual([]);
    }
  });
});

describe("ruby formatting roles", () => {
  it("are storable, having no equivalent among the other display modes", () => {
    for (const value of ["ruby", "ruby-base", "ruby-text"]) {
      expect(codes({ display: value }), value).toEqual([]);
    }
  });
});

describe("case folding follows CSS, not JavaScript", () => {
  it("refuses a keyword whose case differs outside ASCII", () => {
    // U+212A KELVIN SIGN lowercases to `k` in JavaScript and stays a distinct
    // identifier in CSS, so the browser discards the declaration.
    expect(codes({ display: "blocK" })).toEqual(["invalid-style-value"]);
    expect(codes({ textAlign: "Keep" })).toEqual(["invalid-style-value"]);
  });

  it("still folds ASCII case, which CSS does", () => {
    expect(codes({ display: "BLOCK" })).toEqual([]);
    expect(codes({ display: "BlOcK" })).toEqual([]);
    expect(codes({ width: "10PX" })).toEqual([]);
    expect(codes({ color: "RED" })).toEqual([]);
    expect(codes({ background: { url: "NONE" } })).toEqual([]);
  });

  it("does not fold a unit outside ASCII into a real one", () => {
    expect(codes({ width: "10pK" })).toEqual(["invalid-style-value"]);
  });
});

describe("an elliptical logical corner", () => {
  it("takes a horizontal and a vertical radius", () => {
    expect(codes({ borderRadius: { startStart: "10px 20px" } })).toEqual([]);
    expect(codes({ borderRadius: { endEnd: "10% 20%" } })).toEqual([]);
  });

  it("still takes one value, and still refuses three", () => {
    expect(codes({ borderRadius: { startStart: "10px" } })).toEqual([]);
    expect(codes({ borderRadius: { startStart: "1px 2px 3px" } })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("arguments of a number-producing function", () => {
  it("are held to the function's arity", () => {
    for (const value of [
      "calc(sqrt() * 1px)",
      "calc(exp() * 1px)",
      "calc(pow(2) * 1px)",
      "calc(pow(2,3,4) * 1px)",
    ]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("may not be a measurement, since these take bare numbers", () => {
    expect(codes({ width: "calc(sqrt(1px) * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("except for the one that reports a sign, which takes any numeric", () => {
    expect(codes({ width: "calc(sign(1px) * 1px)" })).toEqual([]);
  });

  it("still accepts the well-formed calls", () => {
    for (const value of [
      "calc(sqrt(4) * 1px)",
      "calc(pow(2,3) * 1px)",
      "calc(log(8) * 1px)",
      "calc(log(8,2) * 1px)",
      "calc(sqrt(calc(4)) * 1px)",
    ]) {
      expect(codes({ width: value }), value).toEqual([]);
    }
  });
});

describe("a transform that combines with nothing", () => {
  it("is accepted on its own", () => {
    expect(codes({ textTransform: "math-auto" })).toEqual([]);
  });

  it("is refused beside a transform it excludes", () => {
    expect(codes({ textTransform: "math-auto uppercase" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("what each number-producing function will take", () => {
  it("accepts an angle where the function is defined over one", () => {
    expect(codes({ width: "calc(sin(45deg) * 1px)" })).toEqual([]);
    expect(codes({ width: "calc(tan(1turn) * 1px)" })).toEqual([]);
    expect(codes({ width: "calc(cos(0.5) * 1px)" })).toEqual([]);
  });

  it("accepts any numeric for the one that only reports a sign", () => {
    expect(codes({ width: "calc(sign(50%) * 1px)" })).toEqual([]);
    expect(codes({ width: "calc(sign(1em) * 1px)" })).toEqual([]);
  });

  it("refuses a measurement where the function takes a bare number", () => {
    expect(codes({ width: "calc(sqrt(1px) * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(sqrt(45deg) * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("refuses a length where the function takes an angle or a number", () => {
    expect(codes({ width: "calc(sin(1px) * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("baseline alignment written either way round", () => {
  it("accepts both serialisations of the unordered grammar", () => {
    for (const value of [
      "baseline",
      "first baseline",
      "last baseline",
      "baseline first",
      "baseline last",
    ]) {
      expect(codes({ alignItems: value }), value).toEqual([]);
      expect(codes({ alignContent: value }), value).toEqual([]);
    }
  });

  it("does not accept the preference on its own or doubled", () => {
    expect(codes({ alignItems: "first" })).toEqual(["invalid-style-value"]);
    expect(codes({ alignItems: "first last" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("a font size that scales with script level", () => {
  it("is storable, having no equivalent among the sizes", () => {
    expect(codes({ fontSize: "math" })).toEqual([]);
    expect(codes({ fontSize: "16px" })).toEqual([]);
  });
});

describe("url schemes cannot be reached by a different spelling", () => {
  it("refuses an escaped function name, which CSS reads as url", () => {
    expect(checkCssValue('u\\72l("javascript:alert(1)")')).toBe(
      "unsafe-url-scheme"
    );
    expect(checkCssValue('u\\72l("data:image/png,AAAA")')).toBe(
      "unsafe-url-scheme"
    );
    expect(checkCssValue('\\69mage("javascript:x")')).toBe("unsafe-url-scheme");
    expect(checkCssValue('U\\52L("javascript:x")')).toBe("unsafe-url-scheme");
  });

  it("refuses one hidden in a custom property's fallback", () => {
    // The fallback is stored unparsed, so nothing inside it was ever walked,
    // and it is what the browser uses whenever the property is absent.
    expect(checkCssValue('var(--m, url("javascript:alert(1)"))')).toBe(
      "unsafe-url-scheme"
    );
    expect(checkCssValue('var(--m, image("javascript:x"))')).toBe(
      "unsafe-url-scheme"
    );
    expect(checkCssValue('var(--a, var(--b, url("javascript:x")))')).toBe(
      "unsafe-url-scheme"
    );
  });

  it("leaves the allowed spellings and schemes alone", () => {
    expect(checkCssValue('u\\72l("https://x/a.png")')).toBeNull();
    expect(checkCssValue('var(--ok, url("https://x/a.png"))')).toBeNull();
    expect(checkCssValue("var(--x, 1px)")).toBeNull();
  });
});

describe("a rounding strategy is the leading argument", () => {
  it("is refused anywhere else", () => {
    expect(codes({ width: "round(1px, up)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "round(up + 1px, 1px)" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("still works where it belongs", () => {
    expect(codes({ width: "round(up, 10px, 1px)" })).toEqual([]);
    expect(codes({ width: "round(nearest, 10px, 1px)" })).toEqual([]);
    expect(codes({ width: "round(10px, 1px)" })).toEqual([]);
  });
});

describe("functions whose result is an angle", () => {
  it("are operands where an angle is wanted", () => {
    expect(codes({ width: "calc(sin(asin(0.5)) * 10px)" })).toEqual([]);
    expect(codes({ width: "calc(tan(atan2(1, 1)) * 10px)" })).toEqual([]);
    expect(codes({ width: "calc(cos(acos(0.5)) * 1px)" })).toEqual([]);
  });

  it("are not values, nor operands where a number is wanted", () => {
    expect(codes({ width: "asin(0.5)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "calc(asin(0.5) * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(sqrt(asin(0.5)) * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("are held to their arity", () => {
    expect(codes({ width: "calc(sin(atan2(1)) * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("the issue budget spans nested composites", () => {
  it("counts what a walk produced above a level, not only at it", () => {
    // A composite nested inside a composite was handed the whole allowance
    // again, so a value one level deeper reported past the cap.
    const outer: Record<string, unknown> = {};
    for (let index = 0; index < 199; index += 1) outer[`f${index}`] = "1px";
    const inset: Record<string, unknown> = {};
    for (let index = 0; index < 300; index += 1) inset[`s${index}`] = "1px";
    outer.inset = inset;
    const budget = newStyleIssueBudget();
    const issues = validateStyleValues(
      { position: outer } as never,
      "/styles",
      "strict",
      budget
    );
    expect(issues.length).toBeLessThanOrEqual(MAX_STYLE_ISSUES + 1);
    expect(issues.some(issue => issue.code === "style-issues-truncated")).toBe(
      true
    );
  });

  it("leaves a well-formed composite untouched", () => {
    const budget = newStyleIssueBudget();
    expect(
      validateStyleValues(
        { padding: { blockStart: "1rem" } } as never,
        "/styles",
        "strict",
        budget
      )
    ).toEqual([]);
    expect(budget.remaining).toBe(MAX_STYLE_ISSUES);
  });
});

describe("an unquoted url argument is read as CSS reads it", () => {
  it("refuses a scheme hidden behind an escaped colon", () => {
    // Neither the function name nor the argument is a token this recognised
    // before: an escaped name never becomes a Url node, and an unquoted
    // argument is a run of identifiers rather than a string.
    expect(checkCssValue("u\\72l(data\\3a image/png,AAAA)")).toBe(
      "unsafe-url-scheme"
    );
    expect(checkCssValue("url(data\\3a image/png,AAAA)")).toBe(
      "unsafe-url-scheme"
    );
    expect(checkCssValue("u\\72l(javascript\\3a alert(1))")).not.toBeNull();
  });

  it("leaves ordinary unquoted urls alone", () => {
    expect(checkCssValue("url(a.png)")).toBeNull();
    expect(checkCssValue("url(/media/a.png)")).toBeNull();
    expect(checkCssValue("url(https://x/a.png)")).toBeNull();
  });
});

describe("a functional attribute type", () => {
  it("is only the one CSS defines", () => {
    expect(codes({ width: "attr(data-width foo())" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "attr(data-width var(--x))" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("still accepts a declared unit", () => {
    expect(codes({ width: "attr(data-width px)" })).toEqual([]);
  });
});

describe("arithmetic operators are written as CSS requires", () => {
  it("refuses a comma where an operator belongs", () => {
    expect(codes({ width: "calc((1px, 2px))" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("requires whitespace on both sides of plus and minus", () => {
    for (const value of [
      "calc(1px+ 2px)",
      "calc(1px +2px)",
      "calc(1px+2px)",
      "calc(1px- 2px)",
    ]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("does not require it of multiplication or division", () => {
    expect(codes({ width: "calc(1px*2)" })).toEqual([]);
    expect(codes({ width: "calc(1px/2)" })).toEqual([]);
  });

  it("leaves the well-spaced expressions working", () => {
    for (const value of [
      "calc(1px + 2px)",
      "calc(1px - 2px)",
      "calc((1px + 2px) * 3)",
      "clamp(1rem, 2vw, 3rem)",
      "round(up, 10px, 1px)",
    ]) {
      expect(codes({ width: value }), value).toEqual([]);
    }
  });
});

describe("a rounding interval is optional too", () => {
  it("accepts the form that rounds to the default interval", () => {
    expect(codes({ width: "calc(round(1.2) * 1px)" })).toEqual([]);
    expect(codes({ width: "round(10px)" })).toEqual([]);
    expect(codes({ width: "round(up, 10px)" })).toEqual([]);
  });

  it("still refuses a strategy out of place, or too many arguments", () => {
    expect(codes({ width: "round(1px, up)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "round(1px, 2px, 3px, 4px)" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("the angle function that relates two values", () => {
  it("takes any numeric type, as long as it is given two", () => {
    expect(codes({ width: "calc(sin(atan2(1px, 1px)) * 10px)" })).toEqual([]);
    expect(codes({ width: "calc(sin(atan2(1, 1)) * 10px)" })).toEqual([]);
  });

  it("does not loosen the ones defined over a bare number", () => {
    expect(codes({ width: "calc(sin(asin(1px)) * 10px)" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("is still held to its arity", () => {
    expect(codes({ width: "calc(sin(atan2(1)) * 10px)" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("containers that answer a scroll-state query", () => {
  it("accepts the type alone and combined with a size type", () => {
    for (const value of [
      "scroll-state",
      "inline-size scroll-state",
      "scroll-state inline-size",
      "size scroll-state",
    ]) {
      expect(codes({ containerType: value }), value).toEqual([]);
    }
  });

  it("keeps the two size types mutually exclusive", () => {
    expect(codes({ containerType: "inline-size size" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("leaves the plain types working", () => {
    for (const value of ["normal", "size", "inline-size"]) {
      expect(codes({ containerType: value }), value).toEqual([]);
    }
  });
});

describe("the contain size keyword", () => {
  it("is accepted where a size belongs", () => {
    for (const property of [
      "width",
      "height",
      "minWidth",
      "minHeight",
      "maxWidth",
      "maxHeight",
    ]) {
      expect(codes({ [property]: "contain" }), property).toEqual([]);
    }
  });

  it("is not a length everywhere", () => {
    expect(codes({ gap: "contain" })).toEqual(["invalid-style-value"]);
  });
});

describe("the whole shape of an attribute reference", () => {
  it("refuses a name that is not one, or arguments that are not there", () => {
    for (const value of [
      "attr(1 px)",
      "attr(data-width px,)",
      "attr(data-width px, 1px, 2px)",
      "attr(data-width px extra)",
      "attr(, 1px)",
    ]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("accepts the forms the grammar really has", () => {
    expect(codes({ width: "attr(data-width px)" })).toEqual([]);
    expect(codes({ width: "attr(data-width px, 0px)" })).toEqual([]);
  });
});

describe("two operands of one function are the same kind of quantity", () => {
  it("refuses a pair that measures different things", () => {
    for (const value of [
      "calc(sin(atan2(1px, 1s)) * 10px)",
      "calc(sin(atan2(1px, 1)) * 10px)",
      "calc(sin(atan2(1deg, 1px)) * 10px)",
    ]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("accepts a pair that measures the same thing in different units", () => {
    expect(codes({ width: "calc(sin(atan2(1px, 1em)) * 10px)" })).toEqual([]);
    expect(codes({ width: "calc(sin(atan2(1s, 1ms)) * 10px)" })).toEqual([]);
    expect(codes({ width: "calc(sin(atan2(1, 1)) * 10px)" })).toEqual([]);
    // A percentage on a length property IS a length, so this pair agrees.
    expect(codes({ width: "calc(sin(atan2(1px, 50%)) * 10px)" })).toEqual([]);
  });

  it("asks nothing when either side is not a literal", () => {
    // A custom property or an expression is not knowable here, so the
    // comparison abstains rather than guessing at what it resolves to.
    expect(codes({ width: "calc(sin(atan2(var(--x), 1px)) * 10px)" })).toEqual(
      []
    );
    expect(
      codes({ width: "calc(sin(atan2(1px, calc(1px + 1px))) * 10px)" })
    ).toEqual([]);
  });

  it("asks nothing about a unit it does not recognise", () => {
    // Comparing unit STRINGS would call `1s` and `1ms` incompatible, so the
    // comparison is by category; a unit in no category abstains rather than
    // being treated as its own.
    expect(codes({ width: "calc(sin(atan2(1px, 1zz)) * 10px)" })).toEqual([]);
  });
});

describe("an escape terminated by a line ending", () => {
  it("refuses a scheme hidden behind a CRLF terminator", () => {
    // CSS collapses CRLF to one newline before tokenising, so the browser
    // consumes both as the escape terminator and reads `url`; consuming only
    // the carriage return leaves the name unrecognised and the URL unchecked.
    expect(checkCssValue('u\\72\r\nl("javascript:alert(1)")')).toBe(
      "unsafe-url-scheme"
    );
    expect(checkCssValue('u\\72\rl("javascript:x")')).toBe("unsafe-url-scheme");
    expect(checkCssValue('u\\72\nl("javascript:x")')).toBe("unsafe-url-scheme");
  });

  it("still lets the same spelling through with an allowed scheme", () => {
    expect(checkCssValue('u\\72\r\nl("https://x/a.png")')).toBeNull();
  });
});

describe("what an attribute falls back to", () => {
  it("has to be a value the property could take", () => {
    // The fallback is what the browser substitutes when the attribute is
    // missing, so a time or a colour there is discarded exactly as it would be
    // written out directly.
    expect(codes({ width: "attr(data-width px, 2s)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "attr(data-width px, red)" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("accepts one the property could take", () => {
    expect(codes({ width: "attr(data-width px, 0px)" })).toEqual([]);
    expect(codes({ width: "attr(data-width px, 50%)" })).toEqual([]);
    expect(codes({ width: "attr(data-width px)" })).toEqual([]);
  });
});

describe("a keyword spelled with escapes", () => {
  it("is the keyword CSS reads, not the characters stored", () => {
    expect(codes({ display: "bl\\6f ck" })).toEqual([]);
    expect(codes({ display: "\\62 lock" })).toEqual([]);
    expect(codes({ display: "BL\\4f CK" })).toEqual([]);
  });

  it("does not let an escape smuggle in a second value", () => {
    expect(codes({ display: "bl\\6f ck extra" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("a fallback is held to the property it stands in for", () => {
  it("refuses one the property itself would refuse", () => {
    expect(codes({ width: "attr(data-width px, -1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(
      codes({ border: { width: { blockStart: "attr(x px, 10%)" } } })
    ).toEqual(["invalid-style-value"]);
  });

  it("accepts one the property allows, on a property that allows it", () => {
    expect(codes({ width: "attr(data-width px, 1px)" })).toEqual([]);
    expect(codes({ margin: { blockStart: "attr(x px, -1px)" } })).toEqual([]);
  });
});

describe("multiplying two measurements", () => {
  it("is refused, since an area satisfies no property", () => {
    expect(codes({ width: "calc(1px * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(1em * 1rem)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(1px * 1s)" })).toEqual(["invalid-style-value"]);
  });

  it("leaves a measurement scaled by a number alone", () => {
    expect(codes({ width: "calc(1px * 2)" })).toEqual([]);
    expect(codes({ width: "calc(2 * 1px)" })).toEqual([]);
    expect(codes({ width: "calc(1px / 2)" })).toEqual([]);
  });

  it("asks nothing when either side is not a literal", () => {
    expect(codes({ width: "calc(1px * var(--x))" })).toEqual([]);
  });
});

describe("a CSS-wide keyword spelled with escapes on a numeric property", () => {
  it("is the keyword CSS reads", () => {
    expect(codes({ opacity: "in\\68 erit" })).toEqual([]);
    expect(codes({ opacity: "inherit" })).toEqual([]);
  });
});

describe("values only these vocabularies can express", () => {
  it("accepts alignment to an anchor's centre", () => {
    expect(codes({ alignItems: "anchor-center" })).toEqual([]);
  });

  it("accepts an inline list item, which the legacy keyword cannot reach", () => {
    expect(codes({ display: "inline list-item" })).toEqual([]);
    expect(codes({ display: "inline flow-root list-item" })).toEqual([]);
    expect(codes({ display: "list-item" })).toEqual([]);
  });

  it("accepts justification that includes the last line", () => {
    expect(codes({ textAlign: "justify-all" })).toEqual([]);
    expect(codes({ textAlign: "justify" })).toEqual([]);
  });
});

describe("how many operands a rounding call takes", () => {
  it("refuses a third operand where no strategy was given", () => {
    // The strategy is what makes three arguments legal, so without one the
    // third is an operand CSS does not accept.
    expect(codes({ width: "round(1px, 2px, 3px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "round(up, 1px, 2px, 3px)" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("accepts every form that really has one or two operands", () => {
    for (const value of [
      "round(1px)",
      "round(10px, 1px)",
      "round(up, 10px)",
      "round(up, 10px, 1px)",
    ]) {
      expect(codes({ width: value }), value).toEqual([]);
    }
  });
});

describe("whitespace written as an escape", () => {
  it("stays inside its identifier rather than separating two", () => {
    // `hidden\ auto` is one identifier containing a space, which is not a
    // keyword; splitting the decoded text would read it as two that are.
    expect(codes({ overflow: "hidden\\ auto" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ background: { repeat: "repeat\\ no-repeat" } })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("leaves real whitespace separating tokens", () => {
    expect(codes({ overflow: "hidden auto" })).toEqual([]);
    expect(codes({ background: { repeat: "repeat no-repeat" } })).toEqual([]);
    expect(codes({ gridAutoFlow: "row dense" })).toEqual([]);
    expect(codes({ textTransform: "uppercase full-width" })).toEqual([]);
  });

  it("still decodes an escape that is not whitespace", () => {
    expect(codes({ display: "bl\\6f ck" })).toEqual([]);
  });
});

describe("a url leaf's keywords spelled with escapes", () => {
  it("are the keywords CSS reads", () => {
    expect(codes({ background: { url: "n\\6f ne" } })).toEqual([]);
    expect(codes({ background: { url: "in\\68 erit" } })).toEqual([]);
  });

  it("leaves an ordinary path a path", () => {
    expect(codes({ background: { url: "a.png" } })).toEqual([]);
  });
});

describe("identifiers read as CSS reads them, wherever they appear", () => {
  it("sees an escaped CSS-wide keyword beside another value", () => {
    expect(codes({ gap: "in\\68 erit 1px" })).toEqual(["invalid-style-value"]);
    expect(codes({ gap: "1px un\\73 et" })).toEqual(["invalid-style-value"]);
  });

  it("still accepts one standing alone, however spelled", () => {
    expect(codes({ gap: "in\\68 erit" })).toEqual([]);
    expect(codes({ gap: "inherit" })).toEqual([]);
    expect(codes({ gap: "1px 2px" })).toEqual([]);
  });

  it("accepts a unit written with an escape", () => {
    // A unit is an identifier too, so it carries escapes like any other.
    expect(codes({ width: "1p\\78" })).toEqual([]);
    expect(codes({ width: "calc(sin(1de\\67) * 1px)" })).toEqual([]);
  });
});

describe("grouping does not hide what kind of value something is", () => {
  it("refuses two grouped measurements multiplied", () => {
    for (const value of [
      "calc((1px) * 1px)",
      "calc(1px * (1px))",
      "calc((1px) * (1px))",
    ]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("leaves a grouped measurement scaled by a number alone", () => {
    expect(codes({ width: "calc((1px) * 2)" })).toEqual([]);
    expect(codes({ width: "calc(2 * (1px))" })).toEqual([]);
    expect(codes({ width: "calc((1px + 2px) * 3)" })).toEqual([]);
  });
});

describe("a design token reference carries nothing else", () => {
  it("refuses fields beside the reference itself", () => {
    // A reader keying on `$token` would use the reference and discard the
    // rest in silence, which is worse than being told the shape is wrong.
    const issues = check({
      backgroundColor: { $token: "color.primary", fallback: "#fff" },
    });
    expect(issues[0]?.code).toBe("invalid-style-value");
    expect(issues[0]?.message).toContain("fallback");
  });

  it("leaves a plain reference working, nested or not", () => {
    expect(codes({ backgroundColor: { $token: "color.primary" } })).toEqual([]);
    expect(codes({ padding: { blockStart: { $token: "space.4" } } })).toEqual(
      []
    );
  });
});

describe("a standalone alignment alternative", () => {
  it("takes no overflow-safety keyword, since it is not a self position", () => {
    expect(codes({ alignItems: "safe anchor-center" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ alignItems: "unsafe anchor-center" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("still works alone, and leaves the real self positions expanding", () => {
    expect(codes({ alignItems: "anchor-center" })).toEqual([]);
    expect(codes({ alignItems: "safe center" })).toEqual([]);
    expect(codes({ alignItems: "unsafe self-start" })).toEqual([]);
  });
});

describe("tokens that are not identifiers still carry escapes", () => {
  it("decodes a hexadecimal colour's digits", () => {
    expect(checkColorValue("#\\66 ff")).toBeNull();
    expect(checkColorValue("#\\66\\66\\66")).toBeNull();
  });

  it("decodes the unit an attribute declares", () => {
    expect(codes({ width: "attr(data-width p\\78)" })).toEqual([]);
  });

  it("does not turn a wrong value into a right one", () => {
    expect(checkColorValue("#ggg")).toBe("not-a-color");
    expect(codes({ width: "attr(data-width de\\67)" })).toEqual([
      "invalid-style-value",
    ]);
  });
});

describe("operands of one math function describe one kind of quantity", () => {
  it("refuses a length mixed with a bare number", () => {
    for (const value of [
      "min(1px, 2)",
      "max(2, 1px)",
      "clamp(1px, 2, 3px)",
      "hypot(1px, 2)",
      "mod(1px, 2)",
      "round(1px, 2)",
    ]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("treats a percentage as the length it resolves to", () => {
    // A percentage resolves against the property, so mixing it with a length
    // is ordinary CSS rather than a type error.
    expect(codes({ width: "min(1px, 50%)" })).toEqual([]);
    expect(codes({ width: "clamp(1px, 50%, 3px)" })).toEqual([]);
  });

  it("leaves consistent and unknowable operands alone", () => {
    expect(codes({ width: "min(1px, 2px)" })).toEqual([]);
    expect(codes({ width: "clamp(1rem, 2vw, 3rem)" })).toEqual([]);
    expect(codes({ width: "min(1px, var(--x))" })).toEqual([]);
    expect(codes({ width: "round(up, 10px, 1px)" })).toEqual([]);
    expect(codes({ width: "calc(1px * 2)" })).toEqual([]);
  });
});

describe("a functional attribute type", () => {
  it("is refused, the only valid one being unreachable", () => {
    // `type(<syntax>)` is the sole functional form, and its angle brackets are
    // refused for every value before this is asked. Accepting a function here
    // could only admit a wrong one.
    expect(codes({ width: "attr(data-width type(foo))" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "attr(data-width type(length))" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("leaves a declared unit working", () => {
    expect(codes({ width: "attr(data-width px)" })).toEqual([]);
  });
});

describe("emptiness judged by CSS's whitespace, not JavaScript's", () => {
  it("treats a value CSS reads as an identifier as a value", () => {
    expect(checkCssValue(" ")).toBeNull();
    expect(checkCssValue("　")).toBeNull();
    expect(checkCssValue(" Font")).toBeNull();
  });

  it("still calls a value of real whitespace empty", () => {
    expect(checkCssValue("   ")).toBe("unparsable");
    expect(checkCssValue("\t\n")).toBe("unparsable");
  });
});

describe("a block-level ruby box", () => {
  it("is storable, the legacy keyword being inline-level", () => {
    expect(codes({ display: "block ruby" })).toEqual([]);
    expect(codes({ display: "ruby" })).toEqual([]);
  });
});

describe("addition relates two quantities of the same kind", () => {
  it("refuses a length added to or subtracted from a number", () => {
    for (const value of ["calc(1px + 2)", "calc(1px - 2)", "calc(2 + 1px)"]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("accepts a percentage, which resolves to the length", () => {
    expect(codes({ width: "calc(1px + 50%)" })).toEqual([]);
    expect(codes({ width: "calc(1px - 2em)" })).toEqual([]);
  });

  it("asks nothing of operands it cannot read", () => {
    expect(codes({ width: "calc(1px + var(--x))" })).toEqual([]);
    expect(codes({ width: "calc((1px + 2px) * 3)" })).toEqual([]);
  });
});

describe("a deferred value still needs its name", () => {
  it("refuses one whose head is missing or not a name", () => {
    expect(codes({ width: "var(red)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "env()" })).toEqual(["invalid-style-value"]);
  });

  it("leaves the well-formed ones unread beyond the head", () => {
    expect(codes({ width: "var(--x)" })).toEqual([]);
    expect(codes({ width: "var(--x, 1px)" })).toEqual([]);
    expect(codes({ width: "env(safe-area-inset-top)" })).toEqual([]);
  });

  it("reads an attr fallback as the value it replaces", () => {
    // The fallback is substituted whole when the attribute is missing, so
    // `1px + 2` reaches the property as written. Arithmetic belongs inside a
    // math function; bare operators here are discarded by the browser.
    expect(codes({ width: "attr(data-x px, 1px + 2)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "attr(data-x px, 1px * 2)" })).toEqual([
      "invalid-style-value",
    ]);
    // Wrapped in a math function it is a value again.
    expect(codes({ width: "attr(data-x px, calc(1px + 2px))" })).toEqual([]);
    expect(codes({ width: "attr(data-x px, 1px)" })).toEqual([]);
    // The fallback is ONE value, not a run of them: a px-typed attribute
    // substitutes a single length, so two adjacent ones are as wrong here as
    // they are written out, and a CSS-wide keyword still voids its neighbours.
    expect(codes({ width: "attr(data-x px, 1px 2px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "attr(data-x px, inherit 1px)" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("reads the whole head, not only the name", () => {
    // `env()` takes indices after the variable name and nothing else. The
    // equivalent `var()` head is not asserted here: css-tree refuses one
    // carrying anything past the name, so this module never sees it.
    expect(codes({ width: "env(foo bar)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "env(foo -1)" })).toEqual(["invalid-style-value"]);
    // The name is a custom identifier, so a CSS-wide keyword is not one.
    expect(codes({ width: "env(inherit)" })).toEqual(["invalid-style-value"]);
    expect(codes({ color: "env(initial)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "env(default)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "env(titlebar-area-x 1)" })).toEqual([]);
    // An explicit `+` is integer syntax, so refusing it refuses a reference
    // the browser resolves.
    expect(codes({ width: "env(viewport-segment-width +1 0)" })).toEqual([]);
    expect(codes({ width: "env(foo 1.5)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "env(foo 0, 1px)" })).toEqual([]);
  });

  it("asks the same of a colour, which took the name for proof", () => {
    expect(codes({ color: "var(red)" })).toEqual(["invalid-style-value"]);
    expect(codes({ color: "env()" })).toEqual(["invalid-style-value"]);
    expect(codes({ backgroundColor: "var(red)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ color: "var(--brand)" })).toEqual([]);
    expect(codes({ color: "var(--brand, red)" })).toEqual([]);
    expect(codes({ color: "env(safe-area-inset-top)" })).toEqual([]);
  });
});

describe("an expression of bare numbers is a number", () => {
  it("refuses one where a measurement is wanted", () => {
    for (const value of [
      "calc(1)",
      "min(1, 2)",
      "calc(sqrt(4))",
      "calc(1 + 2)",
      "clamp(1, 2, 3)",
      "calc((1 + 2) * 3)",
      "calc(pi)",
      "max(sign(1), 2)",
    ]) {
      expect(codes({ width: value }), value).toEqual(["invalid-style-value"]);
    }
  });

  it("keeps every expression that carries a measurement", () => {
    for (const value of [
      "calc(1px)",
      "min(1px, 2px)",
      "calc(2 * 1px)",
      "calc(1px / 2)",
      "calc(100% - 1px)",
      "clamp(1rem, 5vw, 3rem)",
    ]) {
      expect(codes({ width: value }), value).toEqual([]);
    }
  });

  it("types an expression nested inside an expression", () => {
    expect(codes({ width: "calc(calc(1px + 2px) * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(calc(1px + 2px) + 1)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(calc(1px + 2px) * 3)" })).toEqual([]);
  });

  it("gives multiplication precedence over addition", () => {
    // Read left to right this is a number plus a number, then scaled — a
    // length. The browser multiplies first and discards a number plus a
    // length, so the folding order decides whether this is refused.
    expect(codes({ width: "calc(1 + 2 * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(1px * 2 + 3px)" })).toEqual([]);
  });

  it("cancels a base type out when it divides away", () => {
    // A length over a length is a number, which `width` cannot take and
    // `line-height` can.
    expect(codes({ width: "calc(1px / 1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ lineHeight: "calc(1px / 1px)" })).toEqual([]);
    expect(codes({ width: "calc(1px / 2)" })).toEqual([]);
  });

  it("refuses a quantity no property takes", () => {
    // An angle, a duration and an area are all well-formed and none is a width.
    expect(codes({ width: "calc(2deg * 3)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "calc(2s + 1s)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "calc(1px * 1px * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("reads the kind a nested function produces", () => {
    // `min(1px, 2px)` is a length wherever it stands, so multiplying by one
    // makes an area and adding a number mixes kinds. Both were unreadable
    // while only direct literals answered.
    expect(codes({ width: "calc(min(1px, 2px) * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(max(1px, 2px) + 1)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(min(1px, 2px) * 2)" })).toEqual([]);
    expect(codes({ width: "calc(max(1px, 2px) + 1em)" })).toEqual([]);
  });

  it("abstains when a nested function holds something unreadable", () => {
    expect(codes({ width: "calc(min(1px, var(--x)) + 1)" })).toEqual([]);
    expect(codes({ width: "calc(max(1em, var(--x)) * 2px)" })).toEqual([]);
  });

  it("counts a percentage as the quantity the property resolves it against", () => {
    // On a length property a percentage IS a length, so it agrees with one in
    // a sum and makes an area when multiplied by one.
    expect(codes({ width: "calc(1px + 50%)" })).toEqual([]);
    expect(codes({ width: "calc(min(1px, 50%) * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(10% + 1)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "min(10%, 1)" })).toEqual(["invalid-style-value"]);
    expect(codes({ width: "clamp(10%, 1, 20%)" })).toEqual([
      "invalid-style-value",
    ]);
  });

  it("judges what it can read when part of the expression it cannot", () => {
    // No value of `--x` makes an area or a length-plus-number valid, so the
    // unreadable operand must not excuse the readable mistake beside it.
    expect(codes({ width: "calc(1px * 1px + var(--x))" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(1px + 1 + var(--x))" })).toEqual([
      "invalid-style-value",
    ]);
    // Order does not matter: the summands still have to agree with each other.
    expect(codes({ width: "calc(var(--x) + 1px + 1)" })).toEqual([
      "invalid-style-value",
    ]);
    // The result itself stays unknown, so a sound expression still stores.
    expect(codes({ width: "calc(1px * 2 + var(--x))" })).toEqual([]);
  });

  it("reads the argument of a function whose result is fixed", () => {
    // `sign()` reports a number whatever it is given, but it cannot be given a
    // sum that does not exist. What a function PRODUCES and whether its
    // argument makes sense are separate questions.
    expect(codes({ width: "calc(sign(1px + 1deg) * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(sin(1deg + 1) * 1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(sign(1px + 1em) * 1px)" })).toEqual([]);
    expect(codes({ width: "calc(sin(45deg) * 1px)" })).toEqual([]);
  });

  it("refuses a product of two quantities even when a division undoes it", () => {
    // Scaling is multiplying by a number. The area in the middle here is
    // cancelled by the division, so only checking the final type misses it.
    expect(codes({ width: "calc(1px * 1px / 1px)" })).toEqual([
      "invalid-style-value",
    ]);
    expect(codes({ width: "calc(1px * 2 / 4)" })).toEqual([]);
    // Division is not symmetric with multiplication: a ratio is a number.
    expect(codes({ lineHeight: "calc(10px / 2px)" })).toEqual([]);
  });

  it("reads past a rounding strategy to the operands", () => {
    // `round(up, 1, 2)` is two numeric operands and a strategy, so it produces
    // a number. Counting the strategy as an operand would make it three
    // arguments, which the arity check refuses for its own reason and which
    // would hide whether the operands were read at all.
    expect(codes({ width: "round(up, 1, 2)" })).toEqual([
      "invalid-style-value",
    ]);
    // The same stripping is what keeps the length form storable.
    expect(codes({ width: "round(up, 10px, 1px)" })).toEqual([]);
  });

  it("abstains wherever an operand is not a literal", () => {
    // A reference could resolve to anything, and reading the division would
    // need the result model this deliberately does without.
    expect(codes({ width: "calc(var(--x))" })).toEqual([]);
    expect(codes({ width: "calc(1px + var(--x))" })).toEqual([]);
    // Dropping the strategy does not make the rest readable on its own.
    expect(codes({ width: "round(up, var(--x), 2)" })).toEqual([]);
  });

  it("keeps it where a bare number is the preferred spelling", () => {
    // `line-height` is the one property whose dimension leaf takes a number,
    // and an expression is the only way to store one as a string.
    expect(codes({ lineHeight: "calc(2)" })).toEqual([]);
    expect(codes({ lineHeight: "calc(1 + 0.5)" })).toEqual([]);
    expect(codes({ lineHeight: "1.5rem" })).toEqual([]);
    expect(codes({ lineHeight: 1.5 })).toEqual([]);
  });
});

describe("the truncation marker only claims what really went unchecked", () => {
  it("stays silent when a cached name resolves cleanly after the allowance is spent", () => {
    // The marker means "some names were not checked". A name this run already
    // resolved is answered from the cache for nothing, and a KNOWN one produces
    // no warning, so it truncates nothing. Announced anyway, it tells a consumer
    // to expect dangling references that a clean document does not have.
    const budget = newStyleIssueBudget(
      MAX_STYLE_ISSUES,
      MAX_STYLE_ISSUE_PATH_BYTES,
      // One reporting slot, so the unknown name below spends the lot.
      1
    );
    const tokens = memoizeTokenLookup(
      {
        kindOf: (name: string) =>
          name === "ok" ? ("color" as const) : undefined,
      },
      budget
    );
    const check = (value: string, path: string) =>
      validateStyleValues(
        { color: { $token: value } },
        path,
        "strict",
        budget,
        false,
        tokens
      );

    // Known: resolves, reports nothing, and is now cached.
    expect(check("ok", "/a")).toEqual([]);
    // Unknown: reports, and spends the single slot.
    expect(check("gone", "/b").map(issue => issue.code)).toEqual([
      "unknown-token",
    ]);
    // The same known name again: answered from the cache, still fine, and NOT
    // a reason to say anything went unchecked.
    expect(check("ok", "/c")).toEqual([]);
  });

  it("still says so when a name that would have warned cannot be reported", () => {
    // The other half: the marker has to fire when a warning really is being
    // withheld, or a truncated report would read as a clean one.
    const budget = newStyleIssueBudget(
      MAX_STYLE_ISSUES,
      MAX_STYLE_ISSUE_PATH_BYTES,
      1
    );
    const tokens = memoizeTokenLookup({ kindOf: () => undefined }, budget);
    const check = (value: string, path: string) =>
      validateStyleValues(
        { color: { $token: value } },
        path,
        "strict",
        budget,
        false,
        tokens
      );
    expect(check("gone", "/a").map(issue => issue.code)).toEqual([
      "unknown-token",
    ]);
    expect(check("alsoGone", "/b").map(issue => issue.code)).toEqual([
      "site-issues-truncated",
    ]);
  });
});
