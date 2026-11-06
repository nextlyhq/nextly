/**
 * Blocks fields declared inside a repeater, in a collection or a Single.
 *
 * The Page Builder opens as a view of the document for one blocks field, which
 * the admin reaches by its path: at the top level, or inside named groups at
 * any depth (`hero.body`). A repeater's rows are not reached, since a row is
 * addressed by its position, and a position names another row once the rows
 * are reordered, so a blocks field inside one has no view and its card offers
 * no way in. That is a configuration fact, so it is said at startup as well as
 * in the form: an operator learns it from the log before an author meets it
 * on screen.
 *
 * Only a group is walked through, as the admin walks it; any other container
 * on the path leaves the field out of reach. An unnamed group is presentation
 * only and adds nothing to its fields' paths, as the class-usage index reads
 * it too.
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

/** Whether a declared field is a group, the one container the admin walks. */
function isGroup(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "group"
  );
}

/** One blocks field a document declares, by its path, and whether the Page Builder opens it. */
export interface DeclaredBlocksField {
  /** Its path from the document's top level, dot-separated. */
  readonly path: string;
  /** The declaration itself, for the options it states. */
  readonly declaration: object;
  /** Whether the Page Builder reaches it: only groups lie on its path. */
  readonly reached: boolean;
}

/**
 * Every named blocks field under `fields`, each path prefixed by `prefix`, told
 * apart by whether the Page Builder reaches it. `unreached` says whether
 * `fields` already sit inside a container other than a group.
 *
 * The one walk both questions are answered from: which fields to warn about,
 * and which fields the editor can open. Two walks would agree today and
 * disagree the day one learns a new container.
 */
function blocksFieldsIn(
  fields: readonly unknown[],
  prefix: string,
  unreached: boolean
): DeclaredBlocksField[] {
  return fields.flatMap(field => {
    const name = nameOf(field);
    const path = name === undefined ? prefix : `${prefix}${name}`;
    const declaration = asDeclaration(field);
    if (isBlocksField(declaration)) {
      // A blocks field without a name has no path to open it at.
      return name === undefined
        ? []
        : [{ path, declaration, reached: !unreached }];
    }
    // A named container moves its fields one level down; an unnamed one is
    // presentation only and leaves them where they were. Anything but a group
    // puts its fields out of the Page Builder's reach.
    return blocksFieldsIn(
      childrenOf(field),
      name === undefined ? prefix : `${path}.`,
      unreached || !isGroup(field)
    );
  });
}

/**
 * Every blocks field the Page Builder opens on one document's declaration, in
 * declaration order: at the top level or inside groups, by its form path
 * (`hero.body`), which is the path the editor's address names.
 */
export function editorBlocksFields(document: {
  fields?: unknown;
}): DeclaredBlocksField[] {
  return blocksFieldsIn(childrenOf(document), "", false).filter(
    field => field.reached
  );
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
    return blocksFieldsIn(childrenOf(doc), "", false)
      .filter(field => !field.reached)
      .map(field => ({ kind, slug, path: field.path }));
  };
  return [
    ...(config.collections ?? []).flatMap(of("collection")),
    ...(config.singles ?? []).flatMap(of("single")),
  ];
}

/** Fields already reported in this process, so a repeated install says nothing new. */
const reported = new Set<string>();

/**
 * Warn once for each blocks field declared inside a repeater: where it is,
 * that the Page Builder does not open it, and what to do.
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
        "is inside a repeater. The Page Builder doesn't open for a field inside a repeater, " +
        "so this field cannot be edited visually. Move it out of the repeater, to the top level " +
        "or into a group, to edit it in the Page Builder."
    );
  }
}
