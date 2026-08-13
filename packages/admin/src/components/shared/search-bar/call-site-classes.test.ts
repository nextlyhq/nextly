/**
 * `SearchBar`'s `className` lands on its WRAPPER, not on the input.
 *
 * That is the right place for it — every call site uses it for layout (`w-full`,
 * `max-w-sm`, `flex-1`) and layout belongs to the element that owns the box.
 * But it means a class aimed at the FIELD does nothing, and does nothing
 * silently: the wrapper has no border-width, so `border-input` sets a colour on
 * an edge that is never drawn.
 *
 * That is not hypothetical. Eighteen call sites carried `border-input`,
 * `border-border`, `bg-background` or `text-foreground`, in three different
 * spellings — which reads as people trying tokens until one worked, and none
 * ever did. The field's appearance comes from `Input`, which `SearchBar` now
 * composes, so there is nothing left for a call site to restyle.
 *
 * A type cannot express this: `className` is a legitimate string prop and the
 * dead values are ordinary utilities. The property is about which utilities
 * make sense on which element, so it is asserted over the source.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const adminSrc = resolve(here, "../../..");
const repo = resolve(adminSrc, "../../..");

/**
 * Utilities that can only affect the FIELD, so passing one to `SearchBar` is
 * inert. Border is the clear case (the wrapper draws no edge); background and
 * text colour are redundant rather than harmful, but they are listed because
 * they appear in the same class strings for the same reason — an author
 * reaching past the wrapper for the input.
 */
const FIELD_ONLY =
  /\b(?:border-(?:input|border|control-border)|bg-background|text-foreground)\b/;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (extname(full) === ".tsx") found.push(full);
  }
  return found;
}

/**
 * Every `<SearchBar ... />` opening tag, read by tracking brace depth rather
 * than by scanning to the first `>`.
 *
 * The obvious pattern — `<SearchBar\b[^>]*?>` — is wrong on real JSX, and
 * silently: an arrow function in a prop (`onChange={v => setSearch(v)}`)
 * contains a `>`, so the match ends inside the props and never reaches
 * `className`. A guard written that way passes over exactly the call sites most
 * likely to be complex, and it passed over a deliberately reintroduced dead
 * class when this file was first written.
 */
function openingTags(source: string): { text: string; index: number }[] {
  const tags: { text: string; index: number }[] = [];
  const NAME = /<SearchBar\b/g;
  for (const start of source.matchAll(NAME)) {
    let depth = 0;
    let quote: string | null = null;
    for (let i = start.index; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) {
        tags.push({
          text: source.slice(start.index, i + 1),
          index: start.index,
        });
        break;
      }
    }
  }
  return tags;
}

/**
 * The text between the brace at `open` and its match, skipping string literals
 * so that a brace inside a string does not unbalance the count.
 */
function braceBody(source: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** Every `{...expr}` on the tag, as the expression text without its dots. */
function spreadExpressions(tag: string): string[] {
  const found: string[] = [];
  for (const spread of tag.matchAll(/\{\s*\.\.\./g)) {
    const body = braceBody(tag, spread.index);
    if (body !== null) found.push(body.replace(/^\s*\.\.\./, ""));
  }
  return found;
}

/**
 * The class text a tag carries, in any JSX spelling that can be read statically.
 *
 * `className="a b"` is the literal form. `className={...}` is equally valid and
 * equally common once a call site needs `cn()` or a conditional, and a pattern
 * that reads only the literal form skips those attributes in SILENCE — the
 * offending class is still there, the scan simply never sees it. A spread of an
 * object literal, `{...{ className: "..." }}`, is a third spelling with the same
 * property.
 *
 * Returning the whole expression text is deliberately blunt: this check asks
 * whether a forbidden class NAME appears anywhere in what the tag passes, and a
 * name inside `cn("border-input", x)` is just as inert as one in a plain string.
 */
function classText(tag: string): string | null {
  const literal = /className="([^"]*)"/.exec(tag);
  if (literal) return literal[1];

  const brace = tag.indexOf("className={");
  if (brace !== -1) {
    const body = braceBody(tag, brace + "className=".length);
    if (body !== null) return body;
  }

  for (const expression of spreadExpressions(tag)) {
    const inner = expression.trim();
    if (inner.startsWith("{") && /\bclassName\b/.test(inner)) return inner;
  }
  return null;
}

/** Words that can appear where a class value would, but carry no classes. */
const NOT_A_CLASS_VALUE = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "typeof",
]);

/**
 * The identifiers in an expression that could carry class text at runtime.
 *
 * `className={cn("w-full", "border-input")}` is fully determined by its source
 * and can be read. `className={classes}` is not: the utility could be anywhere
 * in a variable this file never sees. Reading only the expression TEXT would
 * find no forbidden name in `classes` and report the call site clean, which is
 * the same silent narrowing as skipping a spread.
 *
 * Two positions hold an identifier without it being a class value, and both are
 * recognisable without parsing:
 *
 * - a callee, `cn(` — the function's NAME contributes nothing;
 * - a condition's test, `isActive && "..."` or `isActive ? "a" : "b"` — the test
 *   decides WHICH literal applies and is not itself a class. `??` is excluded
 *   from that, because `classes ?? "w-full"` uses the identifier as a value.
 *
 * Everything else is treated as unreadable and reported.
 */
function opaqueClassValues(expression: string): string[] {
  // Blank string literals first, so a word inside one is not read as an
  // identifier. Length is preserved to keep the following offsets meaningful.
  const bare = expression.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, match =>
    " ".repeat(match.length)
  );
  const found: string[] = [];
  for (const identifier of bare.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    if (NOT_A_CLASS_VALUE.has(identifier[0])) continue;
    const after = bare
      .slice(identifier.index + identifier[0].length)
      .trimStart();
    if (after.startsWith("(")) continue;
    if (after.startsWith("&&")) continue;
    if (after.startsWith("?") && !after.startsWith("??")) continue;
    found.push(identifier[0]);
  }
  return found;
}

/**
 * Everything a tag passes that no static scan can read: a spread that is not an
 * object literal, and a className expression whose value comes from a variable.
 *
 * These are reported rather than skipped. A scan that passes over the input it
 * cannot read answers a narrower question than the one it claims to, and
 * answers it in green: the forbidden class would reach the wrapper with every
 * assertion still reporting zero. Naming the tag turns that silence into a
 * failure with an instruction, and costs nothing while every call site passes a
 * literal.
 */
function unreadable(tag: string): string[] {
  const opaque = spreadExpressions(tag).filter(
    expression => !expression.trim().startsWith("{")
  );

  const brace = tag.indexOf("className={");
  if (brace !== -1) {
    const body = braceBody(tag, brace + "className=".length);
    if (body !== null) opaque.push(...opaqueClassValues(body));
  }
  for (const expression of spreadExpressions(tag)) {
    const inner = expression.trim();
    if (!inner.startsWith("{")) continue;
    const property = /\bclassName\s*:/.exec(inner);
    if (property) {
      opaque.push(
        ...opaqueClassValues(inner.slice(property.index + property[0].length))
      );
    }
  }
  return opaque;
}

const sources = walk(adminSrc).filter(
  path =>
    !/\.test\.tsx$/.test(path) &&
    readFileSync(path, "utf8").includes("<SearchBar")
);

describe("SearchBar call sites", () => {
  it("finds the call sites at all", () => {
    // Every assertion below is vacuously true over an empty scan, so a renamed
    // directory or a changed element spelling has to fail here first rather
    // than reporting a clean run.
    const elements = sources.flatMap(path =>
      openingTags(readFileSync(path, "utf8"))
    );
    expect(sources.length).toBeGreaterThan(10);
    expect(elements.length).toBeGreaterThan(10);
  });

  it("reads a forbidden class in either JSX spelling", () => {
    // The scanner itself is exercised on a known offender, because the other
    // two assertions can only ever report ZERO -- and a scanner that reads
    // nothing reports zero too. Counting tags does not separate those cases:
    // the tag is found either way, and it is the ATTRIBUTE inside it that gets
    // skipped.
    //
    // The expression form is the one that was missed. `className={"..."}` and
    // `className={cn("...")}` are ordinary JSX and were invisible to a pattern
    // that read only the literal spelling.
    const cases = [
      ["literal", '<SearchBar value={v} className="w-full border-input" />'],
      ["braced", '<SearchBar value={v} className={"border-input"} />'],
      [
        "cn() call",
        '<SearchBar value={v} className={cn("w-full", "border-input")} />',
      ],
      [
        "object-literal spread",
        '<SearchBar value={v} {...{ className: "border-input" }} />',
      ],
    ] as const;

    for (const [name, markup] of cases) {
      const [tag] = openingTags(markup);
      expect(tag, `${name}: no opening tag found`).toBeDefined();
      const text = classText(tag.text);
      if (text === null) throw new Error(`${name}: className not read`);
      expect(
        text.split(/[\s"'`,()]+/).some(token => FIELD_ONLY.test(token)),
        `${name}: the scanner did not see border-input`
      ).toBe(true);
    }

    // The negative half, so the check is not simply matching everything.
    const [ok] = openingTags(
      '<SearchBar value={v} className="w-full max-w-sm" />'
    );
    const okText = classText(ok.text);
    if (okText === null) throw new Error("clean case: className not read");
    expect(
      okText.split(/[\s"'`,()]+/).some(token => FIELD_ONLY.test(token))
    ).toBe(false);
  });

  it("separates what it can read from what it cannot", () => {
    // This check answers ZERO when it works and ZERO when it reads nothing, so
    // the classifier is exercised on inputs whose right answer is known. Every
    // case below is a spelling a call site may legitimately use; what differs is
    // whether the class VALUE is determined by the source.
    const readable = [
      ["literal", '<SearchBar className="w-full" />'],
      ["braced literal", '<SearchBar className={"w-full"} />'],
      [
        "cn() of literals",
        '<SearchBar className={cn("w-full", "max-w-sm")} />',
      ],
      // The test is a boolean, not a class. Refusing this would reject the
      // commonest conditional in React to catch nothing.
      ["guarded literal", '<SearchBar className={cn(isOpen && "max-w-sm")} />'],
      ["ternary of literals", '<SearchBar className={x ? "a" : "b"} />'],
      ["object spread", '<SearchBar {...{ className: "w-full" }} />'],
    ] as const;

    for (const [name, markup] of readable) {
      const [tag] = openingTags(markup);
      expect(unreadable(tag.text), `${name}: reported unreadable`).toEqual([]);
    }

    const opaque = [
      ["identifier", "<SearchBar className={classes} />", "classes"],
      ["cn() of a variable", "<SearchBar className={cn(layout)} />", "layout"],
      ["member expression", "<SearchBar className={styles.bar} />", "styles"],
      // `a ?? b` uses the identifier as a VALUE, unlike `a ? x : y` where it is
      // the test. One character apart, opposite answers.
      [
        "nullish default",
        '<SearchBar className={classes ?? "w"} />',
        "classes",
      ],
      ["props spread", "<SearchBar {...props} />", "props"],
      [
        "spread with a variable class",
        "<SearchBar {...{ className: layout }} />",
        "layout",
      ],
    ] as const;

    for (const [name, markup, expected] of opaque) {
      const [tag] = openingTags(markup);
      expect(unreadable(tag.text), `${name}: not reported`).toContain(expected);
    }
  });

  it("passes SearchBar nothing the scan cannot read", () => {
    const opaque: string[] = [];
    for (const path of sources) {
      const source = readFileSync(path, "utf8");
      for (const tag of openingTags(source)) {
        const hidden = unreadable(tag.text);
        if (hidden.length === 0) continue;
        const line = source.slice(0, tag.index).split("\n").length;
        opaque.push(`${relative(repo, path)}:${line} — ${hidden.join(" ")}`);
      }
    }

    expect(
      opaque.sort(),
      `These pass classes to SearchBar through a variable or a spread, so the ` +
        `check below cannot see whether a field-only class is among them. Pass ` +
        `the classes as literals:\n${opaque.join("\n")}`
    ).toEqual([]);
  });

  it("passes no class that only the field could use", () => {
    const inert: string[] = [];
    for (const path of sources) {
      const source = readFileSync(path, "utf8");
      for (const tag of openingTags(source)) {
        const className = classText(tag.text);
        if (!className) continue;
        const offenders = className
          .split(/[\s"'`,()]+/)
          .filter(token => FIELD_ONLY.test(token));
        if (offenders.length === 0) continue;
        const line = source.slice(0, tag.index).split("\n").length;
        inert.push(`${relative(repo, path)}:${line} — ${offenders.join(" ")}`);
      }
    }

    expect(
      inert.sort(),
      `These classes are passed to SearchBar but reach its wrapper, not its ` +
        `input, so they do nothing. The field is an Input and takes its ` +
        `appearance from the design system; use className for LAYOUT only ` +
        `(w-full, max-w-sm, flex-1). If the field itself needs to change, ` +
        `change Input or the token it reads:\n${inert.join("\n")}`
    ).toEqual([]);
  });
});
