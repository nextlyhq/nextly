/**
 * What the inspector's binding controls read through the host: the fields a
 * binding can read, for the picker, and an unbind's plan, made on the server
 * by the same decision the page actions API takes.
 *
 * Shapes only: the host reads them (the page builder plugin, through its
 * routes) and hands them to the editor as `ContentServices` members, so this
 * package reaches no server of its own.
 *
 * @module binding-services
 */
import type { BindingFieldShape, BlockDocument } from "@nextlyhq/blocks-engine";

import type { KeptProps } from "./binding-ops";
import type { UnbindAnswer, UnbindKeep } from "./composition-actions";

/**
 * One field a binding can read, as the picker lists it.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingFieldChoice extends Omit<BindingFieldShape, "fields"> {
  /** What the field is called, where its name alone reads poorly. */
  readonly label?: string;
  /** Whether a visitor may read it; a binding to one shows its fallback. */
  readonly public: boolean;
  /**
   * The start of its value, as the person editing reads it. Absent for a
   * field visitors can't read, an empty one, one whose value is not text, a
   * number or a yes-or-no, and one whose value is a draft's.
   */
  readonly preview?: string;
  /** Set when the value differs from what the published entry holds. */
  readonly draft?: true;
  /**
   * The fields inside it: a group's own, or a relation's, one step in, as the
   * entry it names holds them.
   */
  readonly fields?: readonly BindingFieldChoice[];
  /**
   * Set on a related entry's own id, listed under a relation that names one
   * entry of one collection: the collection that entry is in. A link's entry
   * can be bound to it, and only a link's, since an id is no value a reader
   * is shown.
   */
  readonly linksTo?: string;
  /**
   * Set on a related entry (`linksTo`) whose collection has no page yet, as
   * the host serves pages: the collection's name, which the picker says the
   * row is waiting for. Listed, so the author sees why, but not picked.
   */
  readonly noPageFor?: string;
}

/**
 * One source of bound values, as the picker groups its fields.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingFieldSource {
  /** How a binding names the source. */
  readonly binding:
    | { readonly source: "entry" }
    | { readonly source: "single"; readonly sourceKey: string }
    | { readonly source: "site" };
  /** The source's name: a collection's or a Single's label. */
  readonly label: string;
  readonly fields: readonly BindingFieldChoice[];
  /**
   * Set where the source's read failed for a reason other than access: it is
   * named, with no fields, so the picker can say it could not be read while
   * the other sources still list.
   */
  readonly readFailed?: true;
}

/**
 * An unbind the inspector asks the host to plan, in the document it holds.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface UnbindAsk {
  readonly document: BlockDocument;
  readonly nodeId: string;
  readonly prop: string;
  readonly keep?: UnbindKeep;
}

/**
 * The props written in the binding's place and the answer, or why not.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type UnbindPlanAnswer =
  | { readonly kept: KeptProps; readonly answer: UnbindAnswer }
  | { readonly refusal: string };
