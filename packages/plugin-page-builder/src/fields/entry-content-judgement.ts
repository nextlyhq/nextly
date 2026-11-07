/**
 * A blocks field's write, judged for its Entry content block against the
 * collection the template draws.
 *
 * The engine holds the block to its own rules on every write: a template
 * only, one per template, a field named as text. Two things it cannot know
 * are judged here, with what only the server knows:
 *
 * - **Where the document is stored.** A document of kind `template` belongs
 *   in the templates collection. One in any other blocks field (an entry's
 *   own, which may accept that kind) holding Entry content would draw the
 *   content that holds it, so it is refused, whatever the field accepts.
 * - **Which field it names.** The field must be a top-level blocks field of
 *   the template's collection (`templates/entry-content-fields`); any other
 *   name is refused, naming the field and the collection, and so is a block
 *   that names none, since the stored choice is always explicit (the editor
 *   and the page actions route fill it as the block is placed).
 *
 * A template stored before its field was removed keeps saving: a choice the
 * stored template already held on the same block is kept, as a list's field
 * a schema change removed is kept, and the canvas reports it in red until
 * the author chooses another. Where the stored forms cannot be read, nothing
 * can tell a new choice from an old one, so none is refused.
 *
 * @experimental Settles when collection templates ship.
 * @module fields/entry-content-judgement
 */
import {
  entryContentFieldOf,
  entryContentPlacements,
  isPlainRecord,
  type BlockDocument,
  type EntryContentPlacement,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldIssue,
  PluginFieldValidateArgs,
} from "@nextlyhq/plugin-sdk";

import type { EntryBlocksField } from "../templates/entry-content-fields";

import type { StoredForms } from "./added-undefined-ids";
import {
  isStoredTemplate,
  TEMPLATE_TARGET_UNKNOWN,
  writeSettingOf,
  type TemplateTargets,
} from "./list-query-judgement";

/** The refusal of Entry content in a document stored outside the templates. */
const OUTSIDE_TEMPLATES_CODE = "ENTRY_CONTENT_OUTSIDE_TEMPLATES";

/** The refusal of a field that is not a top-level blocks field of the collection. */
const FIELD_UNKNOWN_CODE = "ENTRY_CONTENT_FIELD_UNKNOWN";

/** The refusal of a template save whose collection's fields could not be read. */
const FIELD_UNCHECKED_CODE = "ENTRY_CONTENT_FIELD_UNCHECKED";

/** The refusal of an Entry content block that names no field. */
const FIELD_UNSET_CODE = "ENTRY_CONTENT_FIELD_UNSET";

/**
 * A collection's top-level blocks fields and its name, read when asked, or
 * `undefined` for a collection the server cannot read.
 *
 * @experimental Settles when collection templates ship.
 */
export type EntryBlocksFieldsReader = (collection: string) => Promise<
  | {
      readonly fields: readonly EntryBlocksField[];
      /** The collection's name, as the editor names it: "Posts". */
      readonly label: string;
    }
  | undefined
>;

/** What a write's Entry content block is judged with. */
export interface EntryContentJudging {
  /** Where templates are stored; absent, no document is judged a template. */
  readonly templates?: TemplateTargets;
  /** The collection's blocks fields; absent, the field is not judged. */
  readonly blocksFieldsOf?: EntryBlocksFieldsReader;
  /** The forms the document is stored as, read only once a problem is found. */
  readonly storedForms?: () => Promise<StoredForms>;
  readonly maxNodes?: number;
}

/** A stored form's nodes, when it has a forest to walk. */
function nodesOf(document: unknown): readonly unknown[] | undefined {
  return isPlainRecord(document) && Array.isArray(document.nodes)
    ? document.nodes
    : undefined;
}

/** A list of field labels as a sentence reads them: "Body or Sidebar". */
function listed(fields: readonly EntryBlocksField[]): string {
  const labels = fields.map(field => field.label);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/**
 * Whether a stored form already held this block with this field, so the
 * choice is the template's as saved rather than this write's.
 */
function storedHeld(
  forms: readonly BlockDocument[],
  nodeId: string,
  field: string,
  maxNodes: number | undefined
): boolean {
  return forms.some(form =>
    entryContentPlacements(nodesOf(form) ?? [], maxNodes).some(
      ({ node }) => node.id === nodeId && entryContentFieldOf(node) === field
    )
  );
}

/** The refusal of each Entry content block in a document stored outside the templates. */
function outsideTemplatesIssues(
  placements: readonly EntryContentPlacement[],
  args: PluginFieldValidateArgs,
  label: string
): PluginFieldIssue[] {
  return placements.map(({ path }) => ({
    path: args.path,
    code: OUTSIDE_TEMPLATES_CODE,
    message: `${label}${path}: Entry content shows an entry's own content inside its collection's template, so it belongs in a template, not in an entry's blocks field. Remove it from here.`,
  }));
}

/** The collection a stored template's write draws, or nothing where it can't be known. */
async function targetOf(
  value: unknown,
  args: PluginFieldValidateArgs,
  templates: TemplateTargets | undefined
): Promise<string | undefined> {
  if (args.write === undefined) return undefined;
  const setting = await writeSettingOf(args.write, value, args.data, templates);
  if (setting === TEMPLATE_TARGET_UNKNOWN) return undefined;
  return typeof setting.entryCollection === "string"
    ? setting.entryCollection
    : undefined;
}

/**
 * Whether the stored template drew `target` too: a choice it held for
 * another collection is no choice for this one. Read as the system outside a
 * transaction. Inside one the stored row cannot be read, and there the
 * template guard holds the collection the write carries to the stored one,
 * so the two are the same.
 */
async function storedTargetIs(
  args: PluginFieldValidateArgs,
  templates: TemplateTargets | undefined,
  target: string
): Promise<boolean> {
  const write = args.write;
  if (write === undefined || templates === undefined) return false;
  if (write.inTransaction) return true;
  if (write.id === undefined) return false;
  const stored = await templates.storedTargetsOf([write.id]);
  return stored.get(write.id) === target;
}

/**
 * Whether the stored template already chose `field` on this block for the
 * same collection, or its stored forms can't be read, so nothing can tell
 * this write's choice from the one saved. A template retargeted to another
 * collection has its field judged afresh.
 */
async function keptAsStored(
  site: EntryContentJudging,
  args: PluginFieldValidateArgs,
  target: string,
  nodeId: string,
  field: string
): Promise<boolean> {
  const snapshot = await site.storedForms?.();
  if (snapshot === undefined) return false;
  const held =
    !snapshot.readable ||
    storedHeld(snapshot.forms, nodeId, field, site.maxNodes);
  return held && (await storedTargetIs(args, site.templates, target));
}

/**
 * The refusal of a template save whose collection's fields could not be
 * read, so its Entry content field could not be checked: refused rather
 * than stored unchecked.
 */
function uncheckedIssue(
  first: EntryContentPlacement,
  args: PluginFieldValidateArgs,
  label: string,
  target: string
): PluginFieldIssue {
  return {
    path: args.path,
    code: FIELD_UNCHECKED_CODE,
    message: `${label}${first.path}: the fields of "${target}" couldn't be read to check which one Entry content shows, so this save is refused. Try again.`,
  };
}

/**
 * The refusal of a template's Entry content field, judged against the
 * collection's blocks fields, or nothing where it is one of them or kept.
 */
async function fieldIssues(
  first: EntryContentPlacement,
  collection: NonNullable<Awaited<ReturnType<EntryBlocksFieldsReader>>>,
  target: string,
  args: PluginFieldValidateArgs,
  label: string,
  site: EntryContentJudging
): Promise<PluginFieldIssue[]> {
  const field = entryContentFieldOf(first.node);
  const choices =
    collection.fields.length === 0
      ? `${collection.label} has no blocks field for it to show.`
      : `Choose ${listed(collection.fields)}.`;
  const at = `${label}${first.path}`;
  if (field === undefined) {
    return [
      {
        path: args.path,
        code: FIELD_UNSET_CODE,
        message: `${at}: Entry content doesn't say which of ${collection.label}'s blocks fields it shows. ${choices}`,
      },
    ];
  }
  if (collection.fields.some(each => each.name === field)) return [];
  // A choice the template already held as saved is kept: the field was
  // removed from the collection since, by nobody editing this template.
  if (await keptAsStored(site, args, target, first.node.id, field)) return [];
  return [
    {
      path: args.path,
      code: FIELD_UNKNOWN_CODE,
      message: `${at}: Entry content shows "${field}", which isn't a blocks field of ${collection.label}. ${choices}`,
    },
  ];
}

/**
 * The issues a write is refused with for its Entry content block: one in a
 * document stored outside the templates collection, and, in a template, a
 * field that is not a top-level blocks field of the collection it draws or
 * no field at all. Empty where the document holds none, where the write is
 * no entry write, and where the template's collection cannot be known (the
 * lists' judgement refuses that write already, once).
 *
 * @experimental Settles when collection templates ship.
 */
export async function newEntryContentIssues(
  value: unknown,
  args: PluginFieldValidateArgs,
  label: string,
  site: EntryContentJudging
): Promise<PluginFieldIssue[]> {
  const nodes = nodesOf(value);
  const write = args.write;
  if (nodes === undefined || write === undefined) return [];
  const placements = entryContentPlacements(nodes, site.maxNodes);
  const [first] = placements;
  if (first === undefined) return [];
  if (
    write.kind !== "collection" ||
    !isStoredTemplate(write.slug, value, site.templates)
  ) {
    // A template-kind document in an entry's own blocks field, or any other
    // field outside the templates collection. Documents of another kind are
    // refused by the engine's own rule, in its words.
    return isPlainRecord(value) && value.kind === "template"
      ? outsideTemplatesIssues(placements, args, label)
      : [];
  }
  const target = await targetOf(value, args, site.templates);
  if (target === undefined || site.blocksFieldsOf === undefined) return [];
  // Fail closed: a read that fails is a save refused, never a field let
  // through unchecked. A collection the site does not have is the template
  // guard's to refuse, in its words.
  let collection: Awaited<ReturnType<EntryBlocksFieldsReader>>;
  try {
    collection = await site.blocksFieldsOf(target);
  } catch {
    return [uncheckedIssue(first, args, label, target)];
  }
  if (collection === undefined) return [];
  return fieldIssues(first, collection, target, args, label, site);
}
