/**
 * What the code generators emit for plugin-contributed field types.
 *
 * The generators know the built-in types by name. A plugin type reaching them
 * without this resolves to its storage primitive's default — `string` for the
 * TypeScript types, an unconstrained value for the Zod schemas — which is the
 * difference between a generated type an app can use and one it casts at every
 * call site. A type states its own rendering through `PluginFieldType.codegen`
 * and this module is where both generators read it.
 *
 * @module domains/schema/services/plugin-codegen
 */
import type { BlockFieldCatalogType } from "../../../collections/fields/catalog";
import { NextlyError } from "../../../errors/nextly-error";
import type {
  PluginFieldCodegenImport,
  PluginFieldInstance,
} from "../../../plugins/contributions";
import { detachedField } from "../../../shared/lib/detached-field";
import { pluginStorageFieldType } from "../../../shared/lib/plugin-storage";
import { getFieldType } from "../field-types/field-type-registry";

/** A field as the generators hold it: a type, maybe a name, maybe children. */
interface CodegenField {
  type?: unknown;
  fields?: unknown;
}

/**
 * The declared type's own rendering, when it has one.
 *
 * Returns nothing for built-ins and for unregistered types, so each caller
 * keeps its existing handling and only consults this where it would otherwise
 * fall back.
 */
function codegenFor(field: CodegenField) {
  if (typeof field.type !== "string") return undefined;
  return getFieldType(field.type)?.codegen;
}

/**
 * The local names a field's type declared imports for, on one output.
 *
 * A global utility a plugin writes WITHOUT declaring an import for is the
 * standard one, exactly as core's own use of it is, so it has to be protected
 * from another plugin's same-named import. Telling the two apart needs to know
 * which names an expression's own type actually brought in.
 */
export function pluginDeclaredImportNames(
  field: CodegenField,
  usedBy: "tsImports" | "zodImports"
): ReadonlySet<string> {
  const declared = codegenFor(field)?.[usedBy] ?? [];
  const names = new Set<string>();
  for (const entry of declared) for (const name of entry.names) names.add(name);
  return names;
}

/**
 * The field as its own type sees it: options folded into one flat view.
 *
 * The Schema Builder writes unmodelled options into `pluginOptions`, so a
 * callback reading `field.ratingScale` would find it on a code-first field and
 * lose it the moment an ordinary save moved it into the container. The same
 * view `validate` and `validateOptions` are given, built by the same helper, so
 * generated output cannot depend on where an option happened to be stored.
 */
function optionView(field: CodegenField): PluginFieldInstance {
  return detachedField(field as unknown as { name?: string; type: string });
}

/**
 * The TypeScript type a plugin field type declares, or nothing.
 *
 * The field is passed as declared so a type can narrow its output to the
 * options in front of it.
 */
export function pluginTsType(field: CodegenField): string | undefined {
  const emit = codegenFor(field)?.tsType;
  return emit?.(optionView(field));
}

/**
 * The built-in field type a plugin type stores as, for a type that contributes
 * no rendering of its own.
 *
 * Generating such a field as `unknown`, or omitting it, would lose what the
 * registry already knows: a `number`-backed type stores a number whether or not
 * its author wrote a `tsType`. Substituting the storage primitive's built-in
 * type lets both generators reuse the branch they already have for it, which is
 * the same substitution the write path makes when it applies the primitive's
 * rules to a custom type.
 */
export { pluginStorageFieldType };

/**
 * The same field, retyped as the built-in its plugin type stores as.
 *
 * The generators dispatch on `type`, so re-entering with it substituted makes
 * them emit the primitive's shape while every other option on the field stays
 * visible. Spread through a record because a field config is a union of
 * per-type shapes and TypeScript will not spread one directly.
 */
export function asStorageEquivalentField<T extends CodegenField>(
  field: T,
  storageType: BlockFieldCatalogType
): T {
  return { ...(field as Record<string, unknown>), type: storageType } as T;
}

/**
 * The same field retyped as the scalar its storage primitive writes.
 *
 * `hasMany` is dropped with it: the primitive maps to a single column, and the
 * built-in builders wrap on that flag, so keeping it would generate a list for
 * a field the table holds one value of.
 */
export function asScalarStorageField<T extends CodegenField>(
  field: T,
  storageType: BlockFieldCatalogType
): T {
  const scalar = { ...(field as Record<string, unknown>) };
  delete scalar.hasMany;
  return asStorageEquivalentField(scalar, storageType) as unknown as T;
}

/**
 * Whether a field's type is one a plugin contributed.
 *
 * `isDataField` tests membership of the built-in list, so a plugin type fails
 * it and the generators skip the field outright — the value is stored and
 * simply absent from the generated interface. The generators pair this with
 * that guard so a contributed type is emitted like any other stored value.
 */
export function isPluginDataField(field: CodegenField): boolean {
  return typeof field.type === "string" && !!getFieldType(field.type);
}

/** The Zod expression a plugin field type declares, or nothing. */
export function pluginZodSchema(field: CodegenField): string | undefined {
  const emit = codegenFor(field)?.zodSchema;
  return emit?.(optionView(field));
}

/**
 * Every field in a tree, container children included.
 *
 * Only a `repeater` or a `group` holds nested fields, matching where the
 * generators recurse. A plugin type is free to call one of its own options
 * `fields`, and descending into that would treat configuration objects as
 * declarations: one carrying the `type` of another registered type would have
 * its imports collected for an expression that was never emitted.
 */
function* walkFields(fields: readonly unknown[]): Generator<CodegenField> {
  for (const entry of fields) {
    if (entry === null || typeof entry !== "object") continue;
    const field = entry as CodegenField;
    yield field;
    if (
      (field.type === "repeater" || field.type === "group") &&
      Array.isArray(field.fields)
    ) {
      yield* walkFields(field.fields);
    }
  }
}

/**
 * The index of the quote closing the one opened at `open`, or `-1` for none.
 *
 * A backslash consumes the character after it, so `"a\""` ends at the last
 * quote rather than at the escaped one it protects.
 */
function closingQuote(source: string, open: number): number {
  const quote = source[open];
  for (let i = open + 1; i < source.length; i++) {
    if (source[i] === "\\") {
      i++;
      continue;
    }
    if (source[i] === quote) return i;
  }
  return -1;
}

/**
 * The index of the backtick closing the template opened at `open`, or `-1`.
 *
 * Interpolations are skipped whole: a backtick inside one opens a nested
 * template of its own — `` `${`x`}` `` is legal — and reading it as this
 * literal's closing backtick would end the template early and leave the code
 * after it looking like literal text.
 */
function closingBacktick(source: string, open: number): number {
  for (let i = open + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "`") return i;
    if (ch === "$" && source[i + 1] === "{") {
      const end = interpolationEnd(source, i);
      if (end === -1) return -1;
      i = end;
    }
  }
  return -1;
}

/**
 * The index of the `}` closing the interpolation opened at `open`, or `-1`.
 *
 * Braces are counted rather than matched, and every span that is text rather
 * than code is skipped whole, because an interpolation may hold braces of its
 * own — an object type, a mapped type, or a brace inside a string, a comment or
 * a regex, as in `${"}" extends R ? A : B}`. Counting one of those ends the
 * body inside its own expression and discards every reference after it, which
 * is how an import the expression needs goes missing.
 *
 * The same spans `codeOnly` recognises, for the same reason: a body found by
 * one set of rules and then read by another disagree exactly where the text is
 * unusual.
 */
function interpolationEnd(source: string, open: number): number {
  let depth = 1;
  // The last character that was code, which is what tells a regex literal from
  // a division — the same test `codeOnly` makes.
  let previous = "";

  for (let i = open + 2; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      i++;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i + 2);
      // A line comment running to the end means no `}` follows it.
      if (end === -1) return -1;
      i = end;
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const end =
        ch === "`" ? closingBacktick(source, i) : closingQuote(source, i);
      // Unterminated, so the character opened nothing: read on from the next
      // one rather than swallowing the remainder of the interpolation.
      if (end !== -1) {
        i = end;
        previous = ch;
        continue;
      }
    } else if (ch === "/" && opensRegex(previous)) {
      const end = closingSlash(source, i);
      if (end !== -1) {
        i = end;
        previous = ch;
        continue;
      }
    }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    if (!WHITESPACE.test(ch)) previous = ch;
  }
  return -1;
}

/**
 * Every `${...}` body inside a template's text, itself reduced to code.
 *
 * The literal text around them is dropped: a name there is characters in a
 * string type, not a reference to a binding.
 */
function templateInterpolations(inner: string): string {
  const bodies: string[] = [];

  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\") {
      i++;
      continue;
    }
    if (inner[i] !== "$" || inner[i + 1] !== "{") continue;

    const end = interpolationEnd(inner, i);
    // An unterminated interpolation keeps what is there: the expression is not
    // this function's to judge, and dropping the tail would lose references.
    bodies.push(inner.slice(i + 2, end === -1 ? inner.length : end));
    if (end === -1) break;
    i = end;
  }

  return bodies.map(codeOnly).join(" ");
}

/**
 * The characters a `/` may follow and still open a regex literal. After
 * anything else — a name, a closing bracket, a digit — it divides.
 */
const OPENS_REGEX = /[([{,;:=!&|?+\-*%~^<>]$/;

/**
 * Whether a `/` following `before` opens a regex literal.
 *
 * At the very start of an expression there is no operand to divide, so a
 * leading slash opens one.
 */
function opensRegex(before: string): boolean {
  const code = before.trimEnd();
  return code === "" || OPENS_REGEX.test(code);
}

/** The flags that may trail a regex literal's closing slash. */
const REGEX_FLAGS = /[dgimsuvy]/;

/** Characters that separate code without being any of it. */
const WHITESPACE = /\s/;

/**
 * `source` with every span that is text rather than code blanked out.
 *
 * One left-to-right scan rather than a chain of replacements. Each of these
 * forms may legally contain the opening of another — a URL's `//` in a
 * template, a brace in a string, an apostrophe in a comment — so whichever
 * form a chain removes first misreads the ones it has yet to run. Classifying
 * every span once, at the character that starts it, is what makes that class
 * of mistake impossible rather than reordered.
 *
 * A form left unterminated is kept as ordinary text: its opening character may
 * not have opened anything, and consuming to the end of the expression would
 * drop references. That is the costly direction of error — an import judged
 * unused is omitted, and the generated file then names an identifier it never
 * brought into scope.
 */
function codeOnly(source: string): string {
  let out = "";
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i + 2);
      out += " ";
      i = end === -1 ? source.length : end;
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end !== -1) {
        out += " ";
        i = end + 2;
        continue;
      }
    } else if (ch === '"' || ch === "'") {
      const end = closingQuote(source, i);
      if (end !== -1) {
        out += " ";
        i = end + 1;
        continue;
      }
    } else if (ch === "`") {
      const end = closingBacktick(source, i);
      if (end !== -1) {
        out += ` ${templateInterpolations(source.slice(i + 1, end))} `;
        i = end + 1;
        continue;
      }
    } else if (ch === "/" && opensRegex(out)) {
      const end = closingSlash(source, i);
      if (end !== -1) {
        out += " ";
        i = end + 1;
        while (i < source.length && REGEX_FLAGS.test(source[i])) i++;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * The index of the slash closing the regex opened at `open`, or `-1`.
 *
 * A slash inside a character class is a literal one — `/[/]/` is a regex
 * matching a slash — so the class is tracked and only a slash outside it ends
 * the literal.
 */
function closingSlash(source: string, open: number): number {
  let inClass = false;

  for (let i = open + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    // A regex literal cannot span lines, so a newline means the slash divided
    // rather than opened one.
    if (ch === "\n") return -1;
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return i;
  }

  return -1;
}

/** One expression a plugin type emitted, with the names its own type imported. */
export interface PluginEmission {
  expression: string;
  imported: ReadonlySet<string>;
}

/**
 * Reserve the globals `body` relies on resolving, so no import shadows them.
 *
 * An import of one shadows it for the whole scope it lands in — a non-generic
 * `Partial` makes every `Partial<Post>` fail to compile — but only the ones an
 * output actually wrote are worth reserving, so a name no construct uses stays
 * free.
 *
 * A plugin expression naming `Partial<Model>` is the plugin using its own
 * import, so its uses are subtracted rather than removed from the text:
 * deleting them would also erase core's own `Partial<Post>` and reserve
 * nothing. `emissions` therefore has to carry repeats — the same field object
 * reused in two containers is emitted twice, and counting it once leaves the
 * subtraction short and refuses the plugin's own legitimate import.
 *
 * Shared by both generators rather than written once each: they emit different
 * files from the same expressions, and the two copies drifted — one gaining a
 * fix the other did not.
 */
export function reserveAppliedGlobals(
  body: string,
  emissions: readonly PluginEmission[],
  reserved: Set<string>
): void {
  // Counted at identifier boundaries rather than as a substring: `Array<`
  // occurs inside `ReadonlyArray<`, and crediting that to `Array` would
  // reserve a name the emitted code never used and refuse an import that
  // could not have shadowed anything.
  const occurrences = (haystack: string, name: string): number =>
    haystack.match(new RegExp(`(?<![$\\w])${name}<`, "g"))?.length ?? 0;

  // Read from code only, on both sides of the comparison. A name inside a
  // string, a comment or a template's literal text applies no type arguments
  // and shadows nothing — `z.literal("Result<Model>")` names no binding, and a
  // JSDoc line mentioning `Partial<Post>` writes no code. Counting either would
  // reserve a name the output never applied and refuse a plugin's legitimate
  // import of it, which fails the build outright rather than degrading.
  const code = codeOnly(body);
  const emitted = emissions.map(emission => ({
    imported: emission.imported,
    code: codeOnly(emission.expression),
  }));

  // Every name the output applies type arguments to, rather than a list of the
  // ones that happened to come up. `Partial` is not special: `Readonly`,
  // `Required`, `Exclude` and the rest shadow just as badly, and a standard
  // utility missing from a fixed list would be imported over in silence.
  // Matching requires the `<` to follow immediately, as a generic application
  // does, so a comparison never reads as one.
  const applied = new Set(
    Array.from(code.matchAll(/(?<![$\w])([A-Za-z_$][\w$]*)</g), m => m[1])
  );

  for (const global of applied) {
    // Only an emission whose own type declared an import for this name is
    // subtracted. A plugin writing `Partial<Model>` without importing
    // `Partial` means the standard global, exactly as core's own use is, so its
    // use has to be protected from another plugin's same-named import rather
    // than counted as that plugin's own.
    const byPlugins = emitted.reduce(
      (total, emission) =>
        emission.imported.has(global)
          ? total + occurrences(emission.code, global)
          : total,
      0
    );
    if (occurrences(code, global) > byPlugins) reserved.add(global);
  }
}

/**
 * The `import type` lines a generated file needs for the plugin types it uses.
 *
 * Collected from the fields actually emitted, so a registered type nobody
 * declares adds nothing, and read from the list belonging to this file's own
 * expression, so a name only the other one needs is never emitted here. Names are
 * merged per module and sorted, so the file is byte-identical between runs — it
 * is committed, and an unstable import block would read as a change on every
 * build.
 */
export function pluginCodegenImports(
  entities: ReadonlyArray<{ fields?: unknown }>,
  declaredNames: ReadonlySet<string> = new Set(),
  usedBy: "tsImports" | "zodImports" = "tsImports",
  emittedByField?: ReadonlyMap<object, string>,
  coreImports: ReadonlyMap<string, string> = new Map()
): string[] {
  const byModule = new Map<string, Set<string>>();
  // Which module first claimed each local name. Two modules exporting the same
  // name would each emit a declaration of it and the generated file would not
  // compile, so the clash is refused here with something the plugin author can
  // act on rather than written out as broken source.
  const claimedBy = new Map<string, string>();

  const refuse = (message: string): never => {
    throw NextlyError.validation({
      errors: [
        {
          path: "contributes.fieldTypes",
          code: "GENERATED_IMPORT_NAME_COLLISION",
          message,
        },
      ],
    });
  };

  // Whether the expression THIS field emitted actually names the import.
  // A declared list belongs to a field type, but a callback may use an import
  // only for some option values, so a field where it did not would carry an
  // import nothing references — `noUnusedLocals` fails on that. Judged per
  // field rather than against the file as a whole: two types can declare the
  // same name from different modules, and one using it must not activate the
  // other's, which would then be refused as a cross-module clash.
  const used = (name: string, expression: string | undefined): boolean => {
    if (expression === undefined) return true;
    // A name inside a string, a template's literal text, a comment or a regex
    // is text, not a reference to the binding — `z.literal("Rating")` does not
    // use an imported `Rating` — so those spans are blanked before matching.
    // Interpolation bodies survive it, being code the expression really runs.
    const code = codeOnly(expression)
      // A property key is a name, not a reference: `{ Rating: string }` and
      // `z.object({ Rating: z.string() })` use the binding on the value side or
      // not at all. Only the key is removed, so `{ a: Rating }` still counts.
      // The `?` of an optional key belongs to the key, as does a `readonly`
      // modifier in front of it — including the `+`/`-` forms a mapped type uses.
      .replace(
        /([{,]\s*)(?:[+-]?readonly\s+)?[A-Za-z_$][\w$]*\s*\??\s*:/g,
        "$1"
      )
      // The member half of a qualified access is a name on the object, not the
      // binding: `Models.Rating` uses `Models`. Dropping the member keeps the
      // object it was read from, so what the expression really references is
      // still counted. A decimal is untouched, as a digit cannot start a name.
      .replace(/\.\s*[A-Za-z_$][\w$]*/g, "");
    // Identifier boundaries rather than `\b`: a legal exported name may begin
    // or end with `$`, which is a non-word character, so `\b` would fail to
    // match it and the import would be dropped as unused.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![$\\w])${escaped}(?![$\\w])`).test(code);
  };

  const record = (
    imports: readonly PluginFieldCodegenImport[],
    expression: string | undefined
  ): void => {
    for (const entry of imports) {
      const names = byModule.get(entry.from) ?? new Set<string>();
      for (const name of entry.names) {
        // Discarded before any collision check: a name this field's expression
        // never references is not going to be imported, so it cannot collide
        // with anything and must not refuse a generation that would be valid.
        if (!used(name, expression)) continue;
        // Already imported by the generator from the same module: the plugin
        // wants the binding that is there, so its line is dropped rather than
        // refused. An author cannot know whether another field made the
        // generator import it.
        if (coreImports.get(name) === entry.from) continue;
        // Whatever this particular run declares or imports for itself — the
        // caller knows, because it is the thing emitting them. An import
        // sharing one of those names conflicts with the local declaration
        // (TS2440) or duplicates a binding.
        if (declaredNames.has(name)) {
          refuse(
            `'${name}' is already declared or imported by the generated file ` +
              `itself, so an import of that name would conflict with it. ` +
              `Export it under a different name.`
          );
        }
        const owner = claimedBy.get(name);
        if (owner !== undefined && owner !== entry.from) {
          refuse(
            `'${owner}' and '${entry.from}' both supply '${name}' to code ` +
              `generation. A generated file declares each name once, so one ` +
              `of them must be exported under a different name.`
          );
        }
        claimedBy.set(name, entry.from);
        names.add(name);
      }
      byModule.set(entry.from, names);
    }
  };

  for (const entity of entities) {
    if (!Array.isArray(entity?.fields)) continue;
    for (const field of walkFields(entity.fields)) {
      // Each expression names its own imports, so a file gets exactly the ones
      // its own output can reference. Sharing one list meant the other file
      // carried an unused import, which fails a consuming app compiled with
      // `noUnusedLocals`.
      const imports = codegenFor(field)?.[usedBy];
      if (!imports) continue;
      // A field the caller recorded nothing for emitted nothing: its type
      // declares imports but its callback is optional, and generation fell back
      // to the storage primitive. Its declared names are then referenced by no
      // output, and emitting them fails a consuming app under `noUnusedLocals`.
      // Only when the caller passed a map at all — without one it cannot say
      // what was emitted, so the permissive reading is the only one available.
      if (emittedByField && !emittedByField.has(field)) continue;
      record(imports, emittedByField?.get(field));
    }
  }

  return [...byModule.entries()]
    .filter(([, names]) => names.size > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([from, names]) =>
        `import type { ${[...names].sort().join(", ")} } from "${from}";`
    );
}
