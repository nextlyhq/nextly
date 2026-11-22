/**
 * Where a stored blocks value binds a Single's field: one use per binding,
 * with the block holding it, for the index a Single's panel reads ("Shown
 * on (from the builder)").
 *
 * Read off the value as stored, not composed with the components it places:
 * a binding inside a component is the component's own, and is listed once,
 * on the component, when the component's document is judged. A binding to a
 * Single reads the same Single wherever it is placed, so nothing is lost by
 * not following a placement.
 *
 * Walked with the engine's own bounded walk, within the document's node cap,
 * as the report's judgement is. Only well-formed bindings count: a `single`
 * source naming its Single and a field path. Whether the field still exists
 * is the report's question, not this one: a broken binding is still a place
 * the Single's value is meant to show.
 *
 * @module bindings-report/uses
 */
import {
  isPlainRecord,
  MAX_SEO_SEGMENTS,
  SEO_TEXT_FIELDS,
  walkNodes,
} from "@nextlyhq/blocks-engine";

import { asDocument } from "../component-store-source";

/**
 * The index's format. Part of the report's fingerprint, so raising it runs
 * the check of every document once on every site, which fills the index
 * again; and the value the index's "filled" mark holds.
 */
// 2: a value that may be shared by every language keeps each language's
// uses, so an index written before it is written again.
export const BINDING_USES_FORMAT = 2;

/** One binding to a Single's field, and where it is. */
export interface BindingUse {
  /** The block holding it; empty for the document's own search details. */
  readonly nodeId: string;
  /** The block's type; empty for the document's own search details. */
  readonly blockType: string;
  /** The author's own name for the block, as Layers shows it, if any. */
  readonly blockName?: string;
  /** The prop it fills, or `seo.<field>` for the document's search details. */
  readonly prop: string;
  /** The Single's slug. */
  readonly sourceKey: string;
  /** The field it reads, as a dot path. */
  readonly path: string;
}

/**
 * The longest Single slug a use is kept for: the width of the index's
 * column. No Single's slug is longer, so a binding naming one names none.
 */
const SOURCE_KEY_MAX = 255;

/** A binding's Single and field, when it is a well-formed one to a Single. */
function singleRead(
  binding: unknown
): { readonly sourceKey: string; readonly path: string } | undefined {
  if (!isPlainRecord(binding) || binding.source !== "single") return undefined;
  const { sourceKey, $bind } = binding;
  if (typeof sourceKey !== "string" || sourceKey === "") return undefined;
  if (sourceKey.length > SOURCE_KEY_MAX) return undefined;
  if (typeof $bind !== "string" || $bind === "") return undefined;
  return { sourceKey, path: $bind };
}

/** The document's own search details' bindings to a Single. */
function settingsUses(settings: unknown): BindingUse[] {
  const seo = isPlainRecord(settings) ? settings.seo : undefined;
  if (!isPlainRecord(seo)) return [];
  const uses: BindingUse[] = [];
  const add = (field: string, binding: unknown): void => {
    const read = singleRead(binding);
    if (read !== undefined) {
      uses.push({ nodeId: "", blockType: "", prop: `seo.${field}`, ...read });
    }
  };
  for (const field of SEO_TEXT_FIELDS) {
    const segments = seo[field];
    if (!Array.isArray(segments)) continue;
    // Only the segments a page's metadata reads, as the renderer reads them.
    const read = Math.min(segments.length, MAX_SEO_SEGMENTS);
    for (let index = 0; index < read; index += 1) add(field, segments[index]);
  }
  add("image", seo.image);
  return uses;
}

/**
 * Every binding to a Single's field in one stored blocks value, in document
 * order: its blocks', then its own search details'. Nothing for a value that
 * is not a blocks document.
 */
export function bindingUsesOf(value: unknown, maxNodes: number): BindingUse[] {
  const document = asDocument(value);
  if (document === null) return [];
  const uses: BindingUse[] = [];
  walkNodes(
    document.nodes,
    node => {
      const bindings = (node as { bindings?: unknown }).bindings;
      if (!isPlainRecord(bindings)) return;
      const name = typeof node.name === "string" ? node.name.trim() : "";
      for (const [prop, binding] of Object.entries(bindings)) {
        const read = singleRead(binding);
        if (read === undefined) continue;
        uses.push({
          nodeId: typeof node.id === "string" ? node.id : "",
          blockType: typeof node.type === "string" ? node.type : "",
          ...(name === "" ? {} : { blockName: name }),
          prop,
          ...read,
        });
      }
    },
    { maxNodes }
  );
  uses.push(...settingsUses(document.settings));
  return uses;
}
