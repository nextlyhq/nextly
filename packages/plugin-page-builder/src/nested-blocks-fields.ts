/**
 * Blocks fields declared below the top level of a collection or a Single.
 *
 * The Page Builder opens as a view of the document for one of its top-level
 * fields; a blocks field inside a named group or a repeater has no such view,
 * so its card offers no way in. That is a configuration fact, so it is said at
 * startup as well as in the form: an operator learns it from the log before an
 * author meets it on screen.
 *
 * "Top level" means addressable at the top level: an unnamed group is
 * presentation only and adds nothing to its fields' paths, as the class-usage
 * index reads it too.
 *
 * @module nested-blocks-fields
 */
import { isBlocksField } from "./fields/blocksHelper";

/** One blocks field the Page Builder cannot open, by where it is declared. */
export interface NestedBlocksField {
  kind: "collection" | "single";
  slug: string;
  /** Its path from the document's top level, dot-separated. */
  path: string;
}

interface DeclaredDocument {
  slug?: unknown;
  fields?: unknown;
}

/** The fields a container holds, when it declares a list of them. */
function childrenOf(value: unknown): readonly unknown[] {
  if (typeof value !== "object" || value === null) return [];
  const fields = (value as { fields?: unknown }).fields;
  return Array.isArray(fields) ? fields : [];
}

/** A declared field as the shared guard reads it, or `null` when it is none. */
function asDeclaration(value: unknown): { type?: unknown } | null {
  return typeof value === "object" && value !== null ? value : null;
}

/** A field's own name, when it has a usable one. */
function nameOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name !== "" ? name : undefined;
}

/**
 * The paths of blocks fields under `fields`, each prefixed by `prefix`, at
 * any depth below a named container. `nested` says whether `fields` are
 * already below one.
 */
function blocksPathsIn(
  fields: readonly unknown[],
  prefix: string,
  nested: boolean
): string[] {
  return fields.flatMap(field => {
    const name = nameOf(field);
    const path = name === undefined ? prefix : `${prefix}${name}`;
    if (isBlocksField(asDeclaration(field))) {
      return nested && name !== undefined ? [path] : [];
    }
    // A named container moves its fields one level down; an unnamed one is
    // presentation only and leaves them where they were.
    return name === undefined
      ? blocksPathsIn(childrenOf(field), prefix, nested)
      : blocksPathsIn(childrenOf(field), `${path}.`, true);
  });
}

/** Every blocks field the Page Builder cannot open, across a config. */
export function nestedBlocksFields(config: {
  collections?: readonly DeclaredDocument[];
  singles?: readonly DeclaredDocument[];
}): NestedBlocksField[] {
  const of = (kind: NestedBlocksField["kind"]) => (doc: DeclaredDocument) => {
    const slug = doc.slug;
    if (typeof slug !== "string") return [];
    return blocksPathsIn(childrenOf(doc), "", false).map(path => ({
      kind,
      slug,
      path,
    }));
  };
  return [
    ...(config.collections ?? []).flatMap(of("collection")),
    ...(config.singles ?? []).flatMap(of("single")),
  ];
}

/** Fields already reported in this process, so a repeated setup says nothing new. */
const reported = new Set<string>();

/**
 * Warn once for each blocks field declared below the top level: where it is,
 * that the Page Builder opens for top-level fields only, and what to do.
 *
 * Called from the plugin's `setup`, which runs at boot and in the CLI alike,
 * so the warning reaches an operator wherever the config is loaded.
 */
export function warnNestedBlocksFields(config: {
  collections?: readonly DeclaredDocument[];
  singles?: readonly DeclaredDocument[];
  logger?: { warn: (message: string) => void };
}): void {
  // The config's logger where it has one; the console where it has none, as
  // the CLI's config loader does, so the warning is never silently dropped.
  const warn = (message: string) =>
    config.logger === undefined
      ? console.warn(message)
      : config.logger.warn(message);
  for (const field of nestedBlocksFields(config)) {
    const key = JSON.stringify([field.kind, field.slug, field.path]);
    if (reported.has(key)) continue;
    reported.add(key);
    warn(
      `[page-builder] The blocks field "${field.path}" on ${field.kind} "${field.slug}" ` +
        "is inside a group or a repeater. The Page Builder opens for top-level fields only, " +
        "so this field cannot be edited visually. Move it to the top level to edit it in the Page Builder."
    );
  }
}
