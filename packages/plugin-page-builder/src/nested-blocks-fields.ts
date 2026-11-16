/**
 * Blocks fields declared where the Page Builder cannot open them, in a
 * collection or a Single.
 *
 * The Page Builder opens as a view of the document for one blocks field, which
 * the admin reaches by its address: at the top level, inside named groups at
 * any depth (`hero.body`), and inside a repeater's rows, each row named by its
 * saved id (`sections.<rowId>.body`), so the address stays on the same row
 * when the rows are reordered. What it cannot open is a field inside a
 * repeater whose rows declare their own `id` field, since those rows have no
 * saved id to be named by, or inside any other container. That is a
 * configuration fact, so it is said at startup as well as in the form: an
 * operator learns it from the log before an author meets it on screen.
 *
 * Groups and repeaters are walked through, as the admin walks them; any other
 * container on the path leaves the field out of reach. An unnamed group is
 * presentation only and adds nothing to its fields' paths, as the class-usage
 * index reads it too.
 *
 * @module nested-blocks-fields
 */
import { declaresOwnId } from "nextly/field-catalog";

import { isBlocksField } from "./fields/blocksHelper";

/**
 * Why a blocks field is out of the Page Builder's reach: a repeater on its
 * path whose rows declare their own `id` field, or another kind of container.
 */
export type UnreachedBecause = "ownIdRows" | "container";

/** One blocks field the Page Builder cannot open, by where it is declared. */
export interface NestedBlocksField {
  kind: "collection" | "single";
  slug: string;
  /** Its path from the document's top level, dot-separated. */
  path: string;
  /** Why it is out of reach, which says what to do about it. */
  because: UnreachedBecause;
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

/** A declared field's type, when it states one. */
function typeOf(value: unknown): unknown {
  return typeof value === "object" && value !== null
    ? (value as { type?: unknown }).type
    : undefined;
}

/**
 * Whether the Page Builder reaches the fields a container holds, and if not,
 * why: a group always; a repeater unless its rows declare their own `id`
 * field (core's one rule, `declaresOwnId`), since its rows are then named by
 * no saved id; any other container never.
 */
function reachesInside(container: unknown): UnreachedBecause | null {
  const type = typeOf(container);
  if (type === "group") return null;
  if (type === "repeater") {
    return declaresOwnId(childrenOf(container)) ? "ownIdRows" : null;
  }
  return "container";
}

/** One blocks field a document declares, by its path, and whether the Page Builder opens it. */
export interface DeclaredBlocksField {
  /**
   * Its path from the document's top level, dot-separated, naming each
   * container by name: a repeater's row adds no step here, so inside one this
   * is the declared path (`sections.body`), not an address of any one row.
   */
  readonly path: string;
  /** The declaration itself, for the options it states. */
  readonly declaration: object;
  /** Why the Page Builder does not reach it, or `null` where it does. */
  readonly unreached: UnreachedBecause | null;
  /** Whether a repeater's row lies on its path, so each row has its own. */
  readonly inRow: boolean;
}

/**
 * Every named blocks field under `fields`, each path prefixed by `prefix`, told
 * apart by whether the Page Builder reaches it. `unreached` says why `fields`
 * are already out of its reach, if they are, and `inRow` whether they sit in a
 * repeater's row.
 *
 * The one walk every question is answered from: which fields to warn about,
 * and which fields the editor can open. Two walks would agree today and
 * disagree the day one learns a new container.
 */
function blocksFieldsIn(
  fields: readonly unknown[],
  prefix: string,
  unreached: UnreachedBecause | null,
  inRow: boolean
): DeclaredBlocksField[] {
  return fields.flatMap(field => {
    const name = nameOf(field);
    const path = name === undefined ? prefix : `${prefix}${name}`;
    const declaration = asDeclaration(field);
    if (isBlocksField(declaration)) {
      // A blocks field without a name has no path to open it at.
      return name === undefined
        ? []
        : [{ path, declaration, unreached, inRow }];
    }
    // A named container moves its fields one level down; an unnamed one is
    // presentation only and leaves them where they were. The first container
    // the Page Builder does not walk through decides why its fields are out
    // of reach.
    const children = childrenOf(field);
    if (children.length === 0) return [];
    return blocksFieldsIn(
      children,
      name === undefined ? prefix : `${path}.`,
      unreached ?? reachesInside(field),
      inRow || typeOf(field) === "repeater"
    );
  });
}

/**
 * Every blocks field the Page Builder opens on one document's declaration, in
 * declaration order, by its declared path: at the top level, inside groups
 * (`hero.body`) and inside a repeater's rows (`sections.body`, which names no
 * one row). The question "where can a builder-edited value be stored", which
 * a reader looking for every stored use asks: a row's value is read in each
 * row (`storedValuesAt`).
 */
export function builderBlocksFields(document: {
  fields?: unknown;
}): DeclaredBlocksField[] {
  return blocksFieldsIn(childrenOf(document), "", null, false).filter(
    field => field.unreached === null
  );
}

/**
 * The fields of {@link builderBlocksFields} outside every repeater, whose
 * declared path is the editor's address (`hero.body`). A field inside a
 * repeater's row opens too, but per row, at an address naming the row's id,
 * so it has no one address to list here and is left out.
 */
export function editorBlocksFields(document: {
  fields?: unknown;
}): DeclaredBlocksField[] {
  return builderBlocksFields(document).filter(field => !field.inRow);
}

/** Every blocks field the Page Builder cannot open, across a config. */
export function nestedBlocksFields(config: {
  collections?: readonly DeclaredDocument[];
  singles?: readonly DeclaredDocument[];
}): NestedBlocksField[] {
  const of = (kind: NestedBlocksField["kind"]) => (doc: DeclaredDocument) => {
    const slug = doc.slug;
    if (typeof slug !== "string") return [];
    // The unreached side of the same walk the editor's fields come from.
    return blocksFieldsIn(childrenOf(doc), "", null, false).flatMap(field =>
      field.unreached === null
        ? []
        : [{ kind, slug, path: field.path, because: field.unreached }]
    );
  };
  return [
    ...(config.collections ?? []).flatMap(of("collection")),
    ...(config.singles ?? []).flatMap(of("single")),
  ];
}

/** Fields already reported in this process, so a repeated install says nothing new. */
const reported = new Set<string>();

/** What the warning says about why a field is out of reach, and what to do. */
const BECAUSE: Record<UnreachedBecause, string> = {
  ownIdRows:
    "is inside a repeater whose rows declare their own `id` field, so its rows have no saved id the Page Builder can open a row by. " +
    "Rename that field to let the system give each row an id, or move the blocks field out of the repeater, to edit it in the Page Builder.",
  container:
    "is inside a container the Page Builder does not open fields in. " +
    "Move it to the top level, into a group or into a repeater to edit it in the Page Builder.",
};

/**
 * Warn once for each blocks field declared where the Page Builder cannot open
 * it — inside a repeater whose rows declare their own `id`, or another
 * container — saying where it is, why, and what to do. A field at the top
 * level, in a group or in a repeater's row opens, and is not mentioned.
 *
 * Called from the plugin's `init` with its own logger. Not from `setup`:
 * a plugin with a `setup` transformer makes every cold request the route
 * boot decision cannot rule out boot the app, anonymous scans included, and
 * `setup` is handed no logger to say it with anyway.
 */
export function warnNestedBlocksFields(
  config: {
    collections?: readonly DeclaredDocument[];
    singles?: readonly DeclaredDocument[];
  },
  warn: (message: string) => void
): void {
  for (const field of nestedBlocksFields(config)) {
    const key = JSON.stringify([field.kind, field.slug, field.path]);
    if (reported.has(key)) continue;
    reported.add(key);
    warn(
      `[page-builder] The blocks field "${field.path}" on ${field.kind} "${field.slug}" ` +
        BECAUSE[field.because]
    );
  }
}
