/**
 * Scoping the admin's CSS to `.nextly-admin`.
 *
 * The admin is a whole Tailwind app — tokens, utilities, preflight reset —
 * mounted inside the host's document. Any rule that escapes the wrapper
 * restyles the host's page, so this runs over every build.
 *
 * One module rather than a copy per pipeline: the dev and production builds
 * had their own, they drifted, and the dev one silently kept leaking `html`,
 * `body`, `:root` and `*` onto the host page long after production stopped.
 * Isolation has one right answer, so there is one implementation of it.
 *
 * @module scripts/lib/css-scope
 */

/**
 * Split a selector list on top-level commas only, so commas inside functional
 * pseudo-classes (`:where(.dark, .dark *)`) stay intact.
 */
export function splitTopLevel(selector) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/**
 * Scope a single selector within `.nextly-admin`.
 */
export function scopeSelector(selector) {
  selector = selector.trim();
  if (!selector) return selector;

  // @-rules are not selectors.
  if (selector.startsWith("@")) return selector;

  // Tailwind v4 emits variants as `&:where(.dark, .dark *)` inside an
  // already-scoped parent. Scoping again would corrupt the variant.
  if (selector.startsWith("&")) return selector;

  // Selector lists: split on top-level commas so grouped preflight selectors
  // (`*, ::after, ::before, ::backdrop`, `html, :host`, `:root, :host`) are
  // each scoped, while `:where(...)` internals survive. Branch on the split
  // result, not on the presence of a comma — a selector whose only commas sit
  // inside parens yields one part and must not re-recurse.
  const parts = splitTopLevel(selector);
  if (parts.length > 1) {
    return parts.map(s => scopeSelector(s.trim())).join(", ");
  }

  // Already scoped.
  if (selector.includes(".nextly-admin")) return selector;

  // Document-root selectors collapse onto the admin root, so the theme and the
  // preflight reset apply inside the admin and never reach the host.
  if (
    selector === ":root" ||
    selector === "html" ||
    selector === ":host" ||
    selector === "body"
  ) {
    return ".nextly-admin";
  }

  // The dark class sits on the admin root itself, not on a descendant.
  if (selector === ".dark") return ".nextly-admin.dark";

  return `.nextly-admin ${selector}`;
}

/** How far a line opens or closes the brace depth. */
function countBraces(line) {
  return (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
}

/**
 * Scope every rule in a stylesheet.
 *
 * Line-based: it assumes a rule's whole selector list sits on one line, which
 * holds for Tailwind's output but not for arbitrary hand-authored CSS.
 * {@link findUnscopedRules} is what catches the difference.
 */
export function scopeCss(css) {
  const lines = css.split("\n");
  const result = [];
  let inKeyframes = false;
  let braceCount = 0;

  for (const line of lines) {
    // @keyframes bodies are percentages and `from`/`to`, not selectors.
    if (line.includes("@keyframes")) {
      // Count this line's own braces. Skipping them left the depth at zero, so
      // the first frame's closing brace read as the end of the whole block and
      // every later frame was scoped as a selector — `.nextly-admin to{...}`,
      // which is not valid inside @keyframes, so the minifier dropped it and
      // the animation quietly lost its frames.
      braceCount = countBraces(line);
      inKeyframes = braceCount > 0;
      if (!inKeyframes) braceCount = 0;
      result.push(line);
      continue;
    }
    if (inKeyframes) {
      braceCount += countBraces(line);
      if (braceCount <= 0) {
        inKeyframes = false;
        braceCount = 0;
      }
      result.push(line);
      continue;
    }

    // Conditional at-rules keep their prelude; their contents are lines too,
    // so they get scoped on their own pass through this loop.
    const trimmed = line.trim();
    if (
      trimmed.startsWith("@media") ||
      trimmed.startsWith("@supports") ||
      trimmed.startsWith("@layer") ||
      trimmed.startsWith("@font-face") ||
      trimmed.startsWith("@property")
    ) {
      result.push(line);
      continue;
    }

    if (line.includes("{") && !trimmed.startsWith("@")) {
      const parts = line.split("{");
      const selector = parts[0];
      const rest = parts.slice(1).join("{");

      if (selector.trim().startsWith("--")) {
        result.push(line);
        continue;
      }
      if (selector.includes(".nextly-admin")) {
        result.push(line);
        continue;
      }

      result.push(`${scopeSelector(selector)}{${rest}`);
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Collect style-rule selectors that escaped `.nextly-admin`.
 *
 * Walks brace depth so nested at-rules (@layer/@media/@supports) are checked,
 * while at-rules whose bodies are not selectors are skipped.
 */
export function findUnscopedRules(css) {
  const offenders = [];
  const skipAtRule = /^@(keyframes|font-face|property|counter-style|page)/i;
  // Comments would otherwise be swallowed into the following rule's prelude
  // (e.g. the `/*! tailwindcss ... */` banner before `@layer`).
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");

  function walk(block) {
    let i = 0;
    while (i < block.length) {
      const open = block.indexOf("{", i);
      if (open === -1) break;
      // Statement (e.g. @charset/@import) before any block — skip past it.
      const semi = block.indexOf(";", i);
      if (semi !== -1 && semi < open) {
        i = semi + 1;
        continue;
      }
      const prelude = block.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      for (; j < block.length && depth > 0; j++) {
        if (block[j] === "{") depth++;
        else if (block[j] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      if (prelude.startsWith("@")) {
        if (!skipAtRule.test(prelude)) walk(block.slice(open + 1, j));
      } else if (prelude && !prelude.includes(".nextly-admin")) {
        offenders.push(prelude.slice(0, 100));
      }
      i = j + 1;
    }
  }

  walk(css);
  return [...new Set(offenders)];
}
