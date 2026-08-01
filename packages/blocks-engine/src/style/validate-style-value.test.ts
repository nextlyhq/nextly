import { describe, expect, it } from "vitest";

import type { StyleValues } from "../document";
import { ISSUE_CODES } from "../validation";
import { checkCssValue, checkUrlValue } from "./css-value";
import { validateStyleValues } from "./validate-style-value";

/** Validate one style-values record at the document root, strictly. */
function check(values: StyleValues) {
  return validateStyleValues(values, "/styles", "strict");
}

function codes(values: StyleValues): string[] {
  return check(values).map(issue => issue.code);
}

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
    expect(codes({ borderRadius: true })).toEqual(["invalid-style-value"]);
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
      "4px 8px",
    ]) {
      expect(codes({ width: value }), value).toEqual([]);
    }
  });

  it("accepts a multi-part corner radius", () => {
    expect(codes({ borderRadius: "4px 8px" })).toEqual([]);
    expect(codes({ borderRadius: "4px / 8px" })).toEqual([]);
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
