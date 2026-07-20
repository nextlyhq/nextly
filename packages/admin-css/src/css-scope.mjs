/** The admin's root class — the historical and default scope. */
const DEFAULT_SCOPE = ".nextly-admin";

/**
 * Scoping a compiled stylesheet under a single root class.
 *
 * Defaults to the admin's `.nextly-admin`. The scope is a parameter because the
 * same problem exists wherever this design system is embedded in a page it does
 * not own: Tailwind's preflight resets `html`/`body`/`*`, so an unscoped sheet
 * restyles the host document.
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
 * Whether a selector is genuinely constrained to `scope`.
 *
 * A substring test is not enough. `.nextly-admin-card` contains the scope text
 * but is an unrelated class, and `[class*=".nextly-admin"]` matches host
 * elements the wrapper does not contain — both would be left unprefixed and
 * then pass the leak check, so the sheet escapes while the build reports
 * success. Attribute selectors are dropped before matching, and the class must
 * end at a boundary: the next character cannot continue a CSS identifier.
 */
export function isScoped(selector, scope = DEFAULT_SCOPE) {
  const withoutAttributes = selector.replace(/\[[^\]]*\]/g, "");
  const className = scope.replace(/^\./, "");
  return new RegExp(`\\.${escapeRegExp(className)}(?![\\w-])`).test(
    withoutAttributes
  );
}

/**
 * Scope a single selector within `scope` (a class selector such as
 * `.nextly-admin`).
 */
export function scopeSelector(selector, scope = DEFAULT_SCOPE) {
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
    return parts.map(s => scopeSelector(s.trim(), scope)).join(", ");
  }

  // Already scoped.
  if (isScoped(selector, scope)) return selector;

  // Document-root selectors collapse onto the admin root, so the theme and the
  // preflight reset apply inside the admin and never reach the host.
  if (
    selector === ":root" ||
    selector === "html" ||
    selector === ":host" ||
    selector === "body"
  ) {
    return scope;
  }

  // The dark class sits on the scope root itself, not on a descendant.
  if (selector === ".dark") return `${scope}.dark`;

  return `${scope} ${selector}`;
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
export function scopeCss(css, scope = DEFAULT_SCOPE) {
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

      // No whole-prelude "already scoped" shortcut: in a list like
      // `.nextly-admin .a, .b` it would leave `.b` unscoped. scopeSelector
      // splits the list and decides per part.
      result.push(`${scopeSelector(selector, scope)}{${rest}`);
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches a keyframes definition, capturing the vendor prefix and the name. */
const KEYFRAMES_RE = /@(-webkit-)?keyframes\s+("[^"]*"|'[^']*'|[\w-]+)/gi;

/**
 * Namespace every `@keyframes` name in a stylesheet.
 *
 * Animation names are global no matter where the rule that uses them lives, so
 * scoping selectors is not enough: this sheet defines `spin`, `pulse` and
 * `fade-in`, and a host page that defines its own wins or loses by source
 * order. Prefixing the definitions and every reference to them keeps the
 * promise that importing the scoped sheet cannot change the host's rendering.
 *
 * References are rewritten only inside `animation`, `animation-name` and
 * `--animate-*` values, so an unrelated identifier that happens to share a
 * keyframe's name is left alone.
 */
export function prefixKeyframes(css, prefix) {
  const names = new Set();
  for (const match of css.matchAll(KEYFRAMES_RE)) {
    names.add(match[2].replace(/^["']|["']$/g, ""));
  }
  if (names.size === 0) return css;

  const renamed = css.replace(
    KEYFRAMES_RE,
    (_full, webkit, name) =>
      `@${webkit ?? ""}keyframes ${prefix}${name.replace(/^["']|["']$/g, "")}`
  );

  return renamed.replace(
    /(^|[;{\s])(animation(?:-name)?|--animate-[\w-]+)(\s*:\s*)([^;}]*)/gi,
    (_full, lead, property, colon, value) => {
      let rewritten = value;
      for (const name of names) {
        rewritten = rewritten.replace(
          new RegExp(`(^|[\\s,])${escapeRegExp(name)}(?=$|[\\s,])`, "g"),
          `$1${prefix}${name}`
        );
      }
      return `${lead}${property}${colon}${rewritten}`;
    }
  );
}

/**
 * Collect style-rule selectors that escaped `.nextly-admin`.
 *
 * Walks brace depth so nested at-rules (@layer/@media/@supports) are checked,
 * while at-rules whose bodies are not selectors are skipped.
 */
export function findUnscopedRules(css, scope = DEFAULT_SCOPE) {
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
      } else if (prelude) {
        // A comma-separated selector list is scoped only if EVERY part is
        // scoped. Check each part independently — a whole-prelude substring
        // test would accept `.nextly-admin .a, .leak` because the first part
        // scopes it, letting `.leak` restyle the host page.
        for (const part of splitTopLevel(prelude)) {
          const trimmed = part.trim();
          if (trimmed && !isScoped(trimmed, scope)) {
            offenders.push(trimmed.slice(0, 100));
          }
        }
      }
      i = j + 1;
    }
  }

  walk(css);
  return [...new Set(offenders)];
}
