/**
 * Turning stored style values into CSS declarations.
 *
 * The walk mirrors the one validation performs, because both read the same
 * catalog shape: a leaf pairs a stored value with the CSS property it emits, a
 * composite names its parts.
 *
 * What it does NOT do is repeat validation's checks. It asks validation for a
 * verdict and writes only what came back clean. Two consequences, and both are
 * the point. A document that validates cleanly compiles completely, because
 * there is no second, subtly stricter opinion to disagree with the first. And a
 * caller who skipped validation still cannot put an unsafe value on a page,
 * because the verdict is taken here rather than assumed to have been taken
 * earlier.
 *
 * @module style/declarations
 */
import { isTokenRef } from "../document";
import { describeValue, pointer } from "../issue-text";
import { isPlainRecord } from "../plain-record";
import type { ValidationIssue } from "../validation";

import { CATALOG_IN_EMISSION_ORDER } from "./catalog";
import { isStyleLeaf } from "./catalog-types";
import type { StyleLeaf, StyleShape, UrlLeaf } from "./catalog-types";
import {
  asciiLower,
  decodeIdentifier,
  isCssWideKeyword,
  trimCssWhitespace,
} from "./css-value";
import {
  newStyleIssueBudget,
  normalizeStyleIssueBudget,
  structuralAllowanceSpent,
  styleUnionVariant,
  validateStyleValues,
} from "./validate-style-value";
import type {
  StyleIssueBudget,
  StyleUnionVariantOptions,
} from "./validate-style-value";
import { newWarningAllowance, pushBoundedWarning } from "./warning-allowance";
import type { WarningAllowance } from "./warning-allowance";

/** One `property: value` pair bound for a rule. */
export interface Declaration {
  property: string;
  value: string;
  /**
   * A selector appended to the node's own, for the enumerated cases where a
   * property styles something inside the block rather than its root.
   */
  descendant?: string;
}

/** What one style map compiled to, and what it refused on the way. */
export interface CompiledDeclarations {
  declarations: Declaration[];
  warnings: ValidationIssue[];
}

/**
 * The token-name grammar: dot-separated lowercase slugs.
 *
 * Checked here rather than left to validation because a name is written into a
 * `var()` unquoted. A stored name carrying a bracket or a semicolon would close
 * the function and open a declaration of its own choosing, which is the one way
 * a document could write arbitrary CSS through a path that looks like data.
 */
const TOKEN_NAME_RE = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

/**
 * The longest name this engine will write as a token.
 *
 * The grammar above bounds the ALPHABET and not the length, so a name of
 * megabytes of otherwise-valid characters satisfies it, is scanned in full by
 * the regex on every compile, and is copied into a `var()` on every rule that
 * references it. `MAX_NAMED_CLASS_NAME_LENGTH` exists for exactly this reason
 * one file over; a token name reaches CSS the same way and had no equivalent.
 *
 * Deliberately NOT the 128 that bounds a class name, because the two are
 * produced by different mechanisms. A class slug is typed by a person. A token
 * name is composed — `readToken` joins a design-token file's nested group path
 * with dots, so its length is set by how deeply an imported file nests rather
 * than by anything anyone types. Real token paths run 30-65 characters
 * (`md.sys.color.on-surface-variant`); 256 sits an order of magnitude above
 * that, so no realistic import meets it, while still bounding both the scan and
 * the copy. Inheriting the class-name number would have applied a limit
 * calibrated for hand-typed input to a value nesting depth produces.
 */
export const MAX_TOKEN_NAME_LENGTH = 256;

/**
 * Whether a name may be written as a token, on either side of the reference.
 *
 * One grammar for the table and for the `$token` that reads it. Two would
 * disagree the moment either moved, and the disagreement has no symptom to
 * follow: a table accepting `Color.Primary` while a reference refuses it leaves
 * a token that exists, resolves to nothing, and reports no reason.
 *
 * Length BEFORE the pattern, so the cheap test is what rejects an oversized
 * name: run the other way round, the regex scans the whole string first and the
 * cap bounds nothing it was added to bound.
 */
export function isTokenName(name: string): boolean {
  return name.length <= MAX_TOKEN_NAME_LENGTH && TOKEN_NAME_RE.test(name);
}

/** The default custom-property prefix for site tokens. */
export const DEFAULT_TOKEN_PREFIX = "--site-";

/**
 * Prefixes no site may write tokens under.
 *
 * `--nx-` is the admin's own namespace and `--tw-` is Tailwind's internals.
 * Either would let a site's token restyle surfaces the site does not own — the
 * admin panel around the editor, or the utility classes in a host's markup.
 */
const RESERVED_TOKEN_PREFIXES = ["--nx-", "--tw-"] as const;

/**
 * The shape a custom-property prefix may take.
 *
 * The prefix comes from a caller and lands inside `var()` unquoted, so one
 * carrying CSS syntax would close the function and open declarations of its
 * own. A prefix that merely forgets the leading `--` is a quieter failure with
 * the same shape: every token reference it builds is nonsense the browser drops.
 */
const TOKEN_PREFIX_RE = /^--[a-z0-9-]*$/;

/**
 * The longest custom-property prefix this engine will write.
 *
 * The pattern above constrains the alphabet and not the length, and the prefix
 * is copied into every token definition and every `var()` that reads one — so
 * one oversized stored value is written once per token and once per reference,
 * on every compile.
 *
 * Small because a prefix is small: `--site-` is seven characters and a vendor
 * prefix is not much more. Set well clear of that and still far below anything
 * a person would type by accident, so the cap is only met by data already wrong.
 */
export const MAX_TOKEN_PREFIX_LENGTH = 64;

/**
 * The prefix to write tokens under, or the default when the supplied one cannot
 * be used. Reports rather than throwing, in keeping with everything else here:
 * one bad setting should cost the tokens, not the page.
 */
export function safeTokenPrefix(prefix: string | undefined): {
  prefix: string;
  warning?: string;
} {
  if (prefix === undefined) return { prefix: DEFAULT_TOKEN_PREFIX };
  // Length before the pattern, so the cheap test is what rejects an oversized
  // value rather than the regex scanning it in full first.
  if (
    prefix.length > MAX_TOKEN_PREFIX_LENGTH ||
    !TOKEN_PREFIX_RE.test(prefix)
  ) {
    return {
      prefix: DEFAULT_TOKEN_PREFIX,
      warning: `"${describeValue(prefix)}" is not a custom-property prefix, so design tokens were written under "${DEFAULT_TOKEN_PREFIX}" instead. A prefix starts with "--" and holds only lowercase letters, digits and dashes.`,
    };
  }
  // Refused here rather than where the tokens are written, because a prefix
  // refused on one side and accepted on the other is worse than either verdict:
  // the definitions land under the fallback while every reference still reads
  // the reserved one, and the tokens resolve to nothing at all.
  const reserved = RESERVED_TOKEN_PREFIXES.find(value =>
    prefix.startsWith(value)
  );
  if (reserved !== undefined) {
    return {
      prefix: DEFAULT_TOKEN_PREFIX,
      warning: `"${describeValue(prefix)}" starts with "${reserved}", which is reserved, so design tokens were written under "${DEFAULT_TOKEN_PREFIX}" instead. Tokens under that prefix would change the ${reserved === "--nx-" ? "admin interface" : "Tailwind internals"} as well as this site.`,
    };
  }
  return { prefix };
}

function warning(path: string, message: string): ValidationIssue {
  return { path, code: "invalid-style-value", severity: "warning", message };
}

/**
 * The custom property a token reference reads.
 *
 * `color.primary` becomes `--site-color-primary`: a dot is not a
 * custom-property character, and a dash reads the same way to anyone who has
 * seen the name.
 *
 * The mapping is not injective, and that is a deliberate trade rather than an
 * oversight. `color.primary-dark` and `color-primary.dark` are both legal names
 * and both land on `--site-color-primary-dark`, so a site defining BOTH would
 * have one resolve to the other's value. Encoding around it — a doubled dash,
 * say — would make every token's custom property read oddly forever to prevent
 * a pair almost nobody writes, and these names are user-facing: an author reads
 * them in devtools and writes them in custom CSS.
 *
 * The answer is uniqueness where the token table is known, which is the same
 * place a duplicate NAME is already refused, and the same answer the design-token
 * tooling ecosystem reached: Style Dictionary emits kebab-case from dot paths
 * and detects the collisions rather than escaping them away. The compiler sees
 * references, never the table, so it cannot make that check here.
 *
 * Block-type classes take the opposite trade for the opposite reason: nobody
 * reads or writes those, so a doubled separator there costs nothing.
 */
export function tokenCustomProperty(name: string, prefix: string): string {
  return prefix + name.replace(/\./g, "-");
}

/** A declaration with the pointer it came from, so a verdict can be applied. */
interface PlacedDeclaration extends Declaration {
  path: string;
}

interface Walk {
  placed: PlacedDeclaration[];
  warnings: ValidationIssue[];
  prefix: string;
  /**
   * What this compile may still spend explaining values it did not write.
   *
   * Shared across the whole walk rather than per map. These objections are the
   * compiler's own — validation accepts a `$token` whose NAME breaks the
   * grammar, because only the compiler writes that name into a `var()` — so
   * nothing charges them the style-issue budget, and a document repeating one
   * across thousands of maps would answer with a warning for each, every one
   * carrying its full pointer.
   */
  allowance: WarningAllowance;
  /**
   * What the site allows, as validation was told it.
   *
   * Carried because choosing a union's arm depends on it: which arm a token
   * belongs to is a fact about the TOKEN rather than about its name, and a URL
   * arm's verdict depends on the host policy. Asking the resolver without them
   * would answer a different question from the one validation answered about
   * the same value, which is the disagreement sharing the resolver exists to
   * remove.
   */
  options: StyleUnionVariantOptions | undefined;
}

/** The CSS text for one stored scalar, or nothing when it cannot be written. */
function scalarText(
  leaf: StyleLeaf,
  value: unknown,
  path: string,
  walk: Walk
): string | undefined {
  if (isTokenRef(value)) {
    const name = value.$token;
    if (!isTokenName(name)) {
      pushBoundedWarning(
        walk.allowance,
        walk.warnings,
        warning(
          path,
          `"${describeValue(name)}" is not a design-token name, so it was not written.`
        )
      );
      return undefined;
    }
    return `var(${tokenCustomProperty(name, walk.prefix)})`;
  }
  // Written through `String`, which does not read a locale. A formatter that
  // did would emit "1,5" on half the machines in the world, breaking both the
  // CSS and the guarantee that the same document always produces the same bytes.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  return leaf.kind === "url" ? urlText(leaf, value) : value;
}

/**
 * A stored URL as the declaration writes it.
 *
 * The value is a path, not a CSS value: `background-image` takes `url(...)`,
 * so emitting what was stored would produce a declaration the browser discards
 * and every background image on the site would silently do nothing.
 *
 * A keyword is the exception and is matched first, the way validation matches
 * it: `background-image: none` is how an image set at an earlier state is
 * cleared, and wrapping it would emit `url("none")` and go looking for a file.
 *
 * Exported for its own tests. What it escapes cannot be reached through
 * `compileStyleValues`, which refuses those values first, so testing it through
 * that entry would be testing the refusal instead.
 */
export function urlText(leaf: UrlLeaf, value: string): string {
  const written = asciiLower(decodeIdentifier(trimCssWhitespace(value)));
  const keywords = leaf.keywords ?? [];
  if (
    isCssWideKeyword(written) ||
    keywords.some(entry => asciiLower(entry) === written)
  ) {
    return value;
  }
  // Quoted, with everything that could end the string escaped: the quote and
  // the backslash, and the line terminators, because a raw newline closes a CSS
  // string even inside quotes.
  //
  // The line terminators cannot reach here through `compileStyleValues`, which
  // refuses the value before it is written. They are escaped anyway, because a
  // function whose job is to produce a quoted CSS string should produce one for
  // any input rather than for the inputs its current caller happens to allow.
  const escaped = value
    .replace(/[\\"]/g, character => `\\${character}`)
    // A hex escape ends at the space, which CSS then discards.
    .replace(
      /[\n\r\f]/g,
      character => `\\${character.charCodeAt(0).toString(16)} `
    );
  return `url("${escaped}")`;
}

/** Compile one value against one shape. */
function shapeDeclarations(
  shape: StyleShape,
  value: unknown,
  path: string,
  walk: Walk
): void {
  if (isStyleLeaf(shape)) {
    const text = scalarText(shape, value, path, walk);
    if (text === undefined) return;
    walk.placed.push({
      path,
      property: shape.cssProperty,
      value: text,
      ...(shape.descendant === undefined
        ? {}
        : { descendant: shape.descendant }),
    });
    return;
  }
  switch (shape.kind) {
    case "logicalSides":
      partDeclarations(shape.sides, value, path, walk);
      return;
    case "logicalCorners":
      partDeclarations(shape.corners, value, path, walk);
      return;
    case "object":
      partDeclarations(shape.fields, value, path, walk);
      return;
    case "union":
      unionDeclarations(shape, value, path, walk);
      return;
  }
}

/**
 * Compile a union through the ONE arm the resolver picks.
 *
 * ASKED, not guessed. This used to take the first arm that wrote any bytes,
 * which is a THIRD answer to a question the validator and the editor already
 * share — and `scalarText` reads no leaf kind for a number, so
 * `fontWeight: 700` was written through the KEYWORD arm while both of the
 * others judged it under the number one. Invisible today only because every
 * catalog union's arms write the same CSS property; the day one does not, the
 * stylesheet disagrees with the control that authored it and with the message
 * explaining the refusal.
 *
 * Written straight into the caller's walk rather than into a trial copy. The
 * trial existed so a losing arm's output could be discarded, and there are no
 * losing arms once one is chosen — whatever this arm places is what the
 * stylesheet gets, and whatever it objects to is why a value is missing from
 * it.
 */
function unionDeclarations(
  shape: Extract<StyleShape, { kind: "union" }>,
  value: unknown,
  path: string,
  walk: Walk
): void {
  // `undefined` only for a union declaring no arms, which has no shape to
  // write through and nothing to object with.
  const arm = styleUnionVariant(shape, value, walk.options);
  if (arm === undefined) return;
  const variant = shape.of[arm];
  if (variant === undefined) return;
  shapeDeclarations(variant, value, path, walk);
}

/** Compile the named parts of a composite. */
function partDeclarations(
  parts: Readonly<Record<string, StyleShape>>,
  value: unknown,
  path: string,
  walk: Walk
): void {
  if (!isPlainRecord(value)) return;
  // Sorted, so two documents differing only in the order their keys were
  // written compile to the same bytes. Ownership is checked rather than trusted:
  // a stored key may be `constructor`, which a plain lookup answers from the
  // prototype and hands a function to the walk.
  const keys = Object.keys(value)
    .filter(key => Object.hasOwn(value, key))
    .sort();
  for (const key of keys) {
    const partShape = Object.hasOwn(parts, key) ? parts[key] : undefined;
    if (partShape === undefined) continue;
    shapeDeclarations(partShape, value[key], pointer(path, key), walk);
  }
}

/** Whether a pointer is at or below one of the refused ones. */
function refusedAt(path: string, refused: readonly string[]): boolean {
  return refused.some(at => path === at || path.startsWith(`${at}/`));
}

/**
 * Compile one style map into declarations.
 *
 * Properties are emitted in sorted order rather than in the order the document
 * happens to list them. Within one rule, CSS order decides only between two
 * declarations of the same property, which a map cannot hold twice, so sorting
 * costs nothing and buys the guarantee that the same styles always produce the
 * same bytes.
 */
/**
 * Validation's errors, charged to the allowance exactly once.
 *
 * Returned uncharged they were bounded only by the per-map style budget, so a large class library
 * multiplied them; charged again by the caller they paid twice, and later omissions lost their
 * explanations while the allowance still had room. So the charging happens here, where the
 * allowance is already in hand, and callers append what they are given.
 *
 * The truncation notice is exempt: charged to the allowance it describes, it is the first thing
 * dropped once that allowance is spent, leaving a truncated list looking complete.
 */
function chargeIssues(
  issues: readonly ValidationIssue[],
  allowance: WarningAllowance
): ValidationIssue[] {
  const reported: ValidationIssue[] = [];
  for (const issue of issues) {
    if (issue.severity !== "error") continue;
    if (issue.code === "style-issues-truncated") {
      if (!allowance.styleIssuesAnnounced) {
        allowance.styleIssuesAnnounced = true;
        reported.push(issue);
      }
      continue;
    }
    pushBoundedWarning(allowance, reported, issue);
  }
  return reported;
}

export function compileStyleValues(
  values: Readonly<Record<string, unknown>>,
  basePath: string,
  tokenPrefix?: string,
  suppliedBudget?: StyleIssueBudget,
  suppliedAllowance?: WarningAllowance,
  // Same object as validation takes, forwarded whole. This decides what reaches
  // a page from what validation REPORTED, so a policy the two do not share is a
  // policy the stylesheet does not have.
  //
  // The ARM resolver's option type, which is the wider one: it adds the site's
  // token table. Which arm a token belongs to is a fact about the TOKEN and a
  // stored reference carries only its name, so a caller holding that table and
  // unable to pass it here would compile through an arm chosen by the catalog's
  // order while the control that authored the value chose by the token's kind.
  options?: StyleUnionVariantOptions
): CompiledDeclarations {
  // Strict, because this decides what reaches a page: a property this engine
  // does not know is preserved in the document and left out of the stylesheet,
  // rather than written on the guess that it might mean something.
  // The budget spans the whole compile, not one style map. Without it every map
  // starts fresh, so a document with a long slot key and many bad properties
  // produces diagnostics quadratic in its own size — the amplification the
  // allowance exists to stop, reintroduced by resetting it.
  //
  // Sharing it brings an obligation with it. This decides what to write from
  // what validation REPORTED, and an exhausted budget reports nothing: a map
  // reached after the allowance ran out would come back clean and be written
  // unchecked, which is how a value like `red; } .owned { display: block` would
  // reach a page as a rule of its own. So an exhausted budget refuses the whole
  // map. Nothing here was checked, so nothing here is written.
  // A direct caller gets one by default, so the diagnostics are bounded however
  // this is reached. Without it an untrusted map produced a warning for every
  // invalid property, each repeating `basePath`, and a caller compiling one map
  // at a time — the natural two-argument form — had no bound at all.
  // Normalized, not merely defaulted: the structural fields have been public
  // since this type shipped, so a caller may hand back an object carrying only
  // those, and reading a missing site allowance would bound nothing.
  const budget =
    normalizeStyleIssueBudget(suppliedBudget) ?? newStyleIssueBudget();
  // Resolved before the refusal branch below, which reports through it. A direct caller gets a
  // fresh one, so the diagnostics are bounded however this is reached.
  const allowance = suppliedAllowance ?? newWarningAllowance();
  const spentBefore = structuralAllowanceSpent(budget);
  const issues = validateStyleValues(
    values,
    basePath,
    "strict",
    budget,
    false,
    // The caller's table, so this run and the arm resolver below judge the same
    // value against the same site. Passing it to one and not the other would
    // put the arm the walk writes through and the arm validation judged under
    // back out of step, which is the disagreement this file just stopped
    // having.
    options?.tokens,
    options
  );
  const stopped =
    spentBefore ||
    structuralAllowanceSpent(budget) ||
    issues.some(issue => issue.code === "style-issues-truncated");
  if (stopped) {
    return {
      declarations: [],
      // Silent once the run has already said it stopped. A word per refused map
      // would repeat this map's whole pointer for every map after the cap, which
      // is the amplification the allowance exists to prevent, restated as an
      // explanation of the allowance.
      warnings:
        issues.length === 0
          ? []
          : [
              // Charged like everything else this returns. This is the branch a map full of
              // invalid properties takes, so leaving it uncharged is exactly where a large class
              // library multiplied its diagnostics.
              ...chargeIssues(issues, allowance),
              // Charged like the rest. Left out of the allowance it is one message per refused
              // map, and the branch this is in is the one every map takes once the style budget
              // is spent — so a large library answers with a message per class.
              ...chargeIssues(
                [
                  {
                    ...warning(
                      basePath,
                      "These styles were not written, because checking stopped before they could be read."
                    ),
                    severity: "error" as const,
                  },
                ],
                allowance
              ),
            ],
    };
  }
  const refused = issues
    .filter(issue => issue.severity === "error")
    .map(issue => issue.path);

  const safe = safeTokenPrefix(tokenPrefix);
  const walk: Walk = {
    placed: [],
    warnings: [],
    prefix: safe.prefix,
    allowance,
    options,
  };
  // Once per run. The prefix is one setting, and every map compiled under it
  // would otherwise repeat the same sentence about it.
  if (safe.warning !== undefined && !allowance.prefixReported) {
    allowance.prefixReported = true;
    pushBoundedWarning(
      allowance,
      walk.warnings,
      warning(basePath, safe.warning)
    );
  }
  // Walked over the catalog rather than over the stored map's keys. Both emit the same
  // declarations in the same order — a key the catalog does not define writes nothing, and this
  // loop skipped those anyway — but materializing and sorting the stored keys first made the work
  // proportional to whatever was persisted. A named class is site settings: outside the document
  // byte cap, read on every page render, so one corrupt entry paid that cost every time.
  for (const entry of CATALOG_IN_EMISSION_ORDER) {
    if (!Object.hasOwn(values, entry.property)) continue;
    shapeDeclarations(
      entry.shape,
      values[entry.property],
      pointer(basePath, entry.property),
      walk
    );
  }

  const declarations: Declaration[] = [];
  for (const placed of walk.placed) {
    if (refusedAt(placed.path, refused)) continue;
    const { path: _path, ...declaration } = placed;
    declarations.push(declaration);
  }
  // Validation's errors are reported as the reason something is missing from
  // the stylesheet. They keep their own paths and codes, so a caller that
  // already validated sees the same issue twice rather than two accounts of it.
  //
  // Charged HERE, alongside the compiler's own objections, so everything this returns has been
  // through the allowance exactly once. Returned uncharged they were bounded only by the style
  // budget, which is per map — so a large class library multiplied them; charged again by the
  // caller, the compiler's objections paid twice and later omissions lost their explanations
  // while the allowance still had room.
  return {
    declarations,
    warnings: [...chargeIssues(issues, walk.allowance), ...walk.warnings],
  };
}
