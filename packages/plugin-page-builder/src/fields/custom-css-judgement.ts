/**
 * Custom CSS a blocks value holds, judged on the server on every write that
 * adds or changes it, whatever the editor checked first: the document's own
 * (`settings.customCss`, a page's CSS) and each block's (`node.customCss`).
 *
 * CSS reaches every visitor of the published page, so it is held to page
 * code's rule: the person making the write must be able to change the site's
 * settings, an API key may never change it, and what the one custom CSS
 * checker refuses is named, line by line, and not stored.
 *
 * Moving, copying and deleting blocks keep or drop CSS someone permitted
 * already wrote, so they ask none of this: a block's CSS is a change only
 * where its text is held by no block of the stored forms the write changes.
 * A block placed from a saved section brings CSS someone permitted wrote
 * there, so text the section it came from holds is no change either. A
 * component placed on a page holds no CSS of its own on the page at all, and
 * detaching one the stored page placed brings the CSS its definition holds,
 * which is no change either. A create that copies a stored entry the caller
 * could read (a duplicated page, a selection saved as a section or a
 * component) brings the CSS that entry holds, in the forms the caller could
 * see, and that is no change either: the document's CSS against the source
 * document's, and a block's against the source's blocks'.
 *
 * @module fields/custom-css-judgement
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  isPlainRecord,
  walkNodes,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import type { PluginFieldIssue, PluginFieldWrite } from "@nextlyhq/plugin-sdk";

import { checkCustomCss, customCssProblemText } from "../site-code/css-check";
import { blocksValueRecord } from "../site-code/page-code";

import type { JudgedField, StoredForms } from "./added-undefined-ids";
import { copiedSourceValues } from "./copied-source";
import { isTopLevel, siteSettingsCallerRefusal } from "./page-code-judgement";

/** The issue code a refused change to custom CSS carries. */
export const CUSTOM_CSS_REFUSED = "CUSTOM_CSS_REFUSED";

/** Where documents of one kind are kept: the collection, and its blocks field. */
export interface StoreAddress {
  readonly collection: string;
  readonly field: string;
}

/**
 * Where the site keeps the documents a page's blocks may come from: saved
 * sections, and component definitions. Absent, none vouches for CSS.
 */
export interface CssLibrary {
  readonly patterns?: StoreAddress;
  readonly components?: StoreAddress;
}

/**
 * The most saved sections, or components, one write's new block CSS is
 * looked up in. Beyond it, CSS is judged as the write's own, which refuses
 * more and never less.
 */
const MAX_LIBRARY_READ = 20;

/** The custom CSS one blocks value holds. */
export interface HeldCustomCss {
  /** The document's own CSS; null where it holds none. */
  readonly document: string | null;
  /** Each block's CSS, with the saved section its block was placed from. */
  readonly blocks: readonly { text: string; section?: string }[];
  /** The components it places, by id. */
  readonly placed: readonly string[];
}

/** CSS text, or none where it is empty or not text. */
function cssText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The component a node places, where it is a placement. */
function placementOf(node: BlockNode): string | undefined {
  if (node.type !== COMPONENT_INSTANCE_TYPE) return undefined;
  const props = (node as { props?: unknown }).props;
  return isPlainRecord(props) && typeof props.componentId === "string"
    ? props.componentId
    : undefined;
}

/** The saved section a node was placed from, as its copy records it. */
function sectionOf(node: BlockNode): string | undefined {
  const origin = (node as { origin?: unknown }).origin;
  return isPlainRecord(origin) &&
    origin.from === "pattern" &&
    typeof origin.id === "string"
    ? origin.id
    : undefined;
}

/** The custom CSS a blocks value holds, read within the document caps. */
export function customCssHeldBy(value: unknown): HeldCustomCss {
  const record = blocksValueRecord(value);
  const settings = record?.settings;
  const document = cssText(
    isPlainRecord(settings) ? settings.customCss : undefined
  );
  const nodes = record?.nodes;
  const blocks: { text: string; section?: string }[] = [];
  const placed: string[] = [];
  if (Array.isArray(nodes)) {
    // The section each node came from: its own copy's, or its parent's.
    const placedFrom = new Map<BlockNode, string | undefined>();
    walkNodes(
      nodes as BlockNode[],
      (node, parent) => {
        const section =
          sectionOf(node) ??
          (parent === undefined ? undefined : placedFrom.get(parent));
        placedFrom.set(node, section);
        const component = placementOf(node);
        if (component !== undefined) placed.push(component);
        const text = cssText(node.customCss);
        if (text === null) return;
        blocks.push(section === undefined ? { text } : { text, section });
      },
      { maxNodes: DEFAULT_LIMITS.maxNodes }
    );
  }
  return { document, blocks, placed };
}

/** What a write changes of the CSS the stored forms hold. */
interface CssChange {
  /** The document's CSS, where the write changes it; null where it removes it. */
  readonly document?: string | null;
  /** The blocks' CSS texts no stored form holds. */
  readonly blocks: readonly string[];
}

/**
 * Block CSS texts held by these stored documents (the saved sections blocks
 * were placed from, or the components a page placed), read in one query per
 * form. One that can't be read vouches for nothing.
 */
async function libraryTexts(
  write: PluginFieldWrite | undefined,
  store: StoreAddress | undefined,
  documents: readonly string[]
): Promise<ReadonlySet<string>> {
  const texts = new Set<string>();
  if (write === undefined || store === undefined || documents.length === 0) {
    return texts;
  }
  const ids = [...new Set(documents)].slice(0, MAX_LIBRARY_READ);
  for (const form of ["published", "draft"] as const) {
    let read: ReadonlyMap<string, { kind: string; value?: unknown }>;
    try {
      read = await write.readStoredOf({
        collection: store.collection,
        ids,
        field: store.field,
        form,
      });
    } catch {
      continue;
    }
    for (const stored of read.values()) {
      if (stored.kind !== "value") continue;
      for (const block of customCssHeldBy(stored.value).blocks) {
        texts.add(block.text);
      }
    }
  }
  return texts;
}

/**
 * Whether the write changes the document's CSS: no stored form it changes
 * holds the same (a new page holds nothing yet, so no CSS is no change),
 * and the entry it copies holds no such document CSS either. A copy vouches
 * for text only, never for removing it.
 */
function documentCssChanged(
  document: string | null,
  held: readonly HeldCustomCss[],
  copied: readonly HeldCustomCss[]
): boolean {
  if (document !== null && copied.some(form => form.document === document)) {
    return false;
  }
  return held.length === 0
    ? document !== null
    : !held.some(form => form.document === document);
}

/**
 * What the write changes: the document's CSS where no stored form it
 * changes holds the same, and each block's CSS no stored form holds. A
 * stored value that can't be read counts every CSS the write holds as a
 * change, so nothing is let through unjudged.
 *
 * A field below the top level whose write holds no CSS is not read at all:
 * removing CSS there adds nothing to any page, and a group kept per
 * language can't be read, which would fail a save that holds no CSS.
 */
async function cssChangedBy(
  written: HeldCustomCss,
  args: JudgedField,
  stored: () => Promise<StoredForms>,
  library: CssLibrary
): Promise<CssChange> {
  const holdsAny = written.document !== null || written.blocks.length > 0;
  if (!holdsAny && !isTopLevel(args)) return { blocks: [] };
  const forms = await stored();
  if (!forms.readable) {
    return holdsAny
      ? {
          ...(written.document === null ? {} : { document: written.document }),
          blocks: [...new Set(written.blocks.map(block => block.text))],
        }
      : { blocks: [] };
  }
  const held = forms.forms.map(form => customCssHeldBy(form));
  // The entry a create copies, in the forms the caller could read: its
  // document's CSS vouches for the document's, its blocks' for the blocks'.
  const copied = (await copiedSourceValues(args)).map(customCssHeldBy);
  const documentChanged = documentCssChanged(written.document, held, copied);
  const blocks = await newBlockCss(
    written,
    [...held, ...copied],
    args.write,
    library
  );
  return documentChanged ? { document: written.document, blocks } : { blocks };
}

/**
 * The blocks' CSS texts no stored form holds (the entry's own, or the one a
 * create copies), nor the saved section a block was placed from, nor a
 * component a stored form placed (which detaching it copies into the page).
 * Each library is read only while some CSS is still unknown.
 */
async function newBlockCss(
  written: HeldCustomCss,
  held: readonly HeldCustomCss[],
  write: PluginFieldWrite | undefined,
  library: CssLibrary
): Promise<string[]> {
  const known = new Set(
    held.flatMap(form => form.blocks.map(block => block.text))
  );
  const unknown = written.blocks.filter(block => !known.has(block.text));
  const fromSections = await libraryTexts(
    write,
    library.patterns,
    unknown.flatMap(block =>
      block.section === undefined ? [] : [block.section]
    )
  );
  const left = [
    ...new Set(
      unknown.map(block => block.text).filter(text => !fromSections.has(text))
    ),
  ];
  if (left.length === 0) return left;
  const fromComponents = await libraryTexts(
    write,
    library.components,
    held.flatMap(form => form.placed)
  );
  return left.filter(text => !fromComponents.has(text));
}

/** A refusal, at the field's path. */
function refusal(args: JudgedField, message: string): PluginFieldIssue {
  return { path: args.path, code: CUSTOM_CSS_REFUSED, message };
}

/**
 * The issues a write's custom CSS raises: none where it adds or changes
 * none; otherwise who may change it, then each line the checker refuses.
 */
export async function customCssIssues(
  value: unknown,
  args: JudgedField,
  label: string,
  stored: () => Promise<StoredForms>,
  /**
   * Where saved sections and components are kept; absent, no placed section
   * and no detached component vouches.
   */
  library: CssLibrary = {}
): Promise<PluginFieldIssue[]> {
  const change = await cssChangedBy(
    customCssHeldBy(value),
    args,
    stored,
    library
  );
  if (change.document === undefined && change.blocks.length === 0) return [];
  // The caller first, before anything about the CSS is read out.
  const refused = await siteSettingsCallerRefusal(args, {
    nobody:
      "This CSS can't be changed here: the write doesn't say who is making it.",
    apiKey:
      "An API key can't change custom CSS. Sign in as someone who can change the site's settings.",
    notPermitted:
      "Only people who can change site settings can change custom CSS.",
  });
  if (refused !== null) return [refusal(args, `${label}: ${refused}`)];
  const issues: PluginFieldIssue[] = [];
  if (typeof change.document === "string") {
    for (const problem of checkCustomCss(change.document, "page")) {
      issues.push(
        refusal(args, `${label} (page CSS): ${customCssProblemText(problem)}`)
      );
    }
  }
  for (const text of change.blocks) {
    for (const problem of checkCustomCss(text, "block")) {
      issues.push(
        refusal(args, `${label} (block CSS): ${customCssProblemText(problem)}`)
      );
    }
  }
  return issues;
}
