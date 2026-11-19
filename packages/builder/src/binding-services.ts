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
import type {
  Binding,
  BindingFieldShape,
  BlockDocument,
} from "@nextlyhq/blocks-engine";

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
   * The start of its value, as the person editing reads it, a draft's
   * included (marked by `draft`). Absent for a field visitors can't read, an
   * empty one, and one whose value is not text, a number or a yes-or-no.
   */
  readonly preview?: string;
  /**
   * Set when the value differs from what the published entry holds: the
   * picker shows it beside the value, so the author knows it isn't live yet.
   */
  readonly draft?: true;
  /**
   * A small picture of the value, for a field holding an image visitors may
   * read: its address, as the author's read gave it. The picker draws it
   * beside the field's name.
   */
  readonly thumbnail?: string;
  /**
   * Set on a field visitors may read that holds nothing: the picker says
   * "(empty)" beside it, rather than leaving the author to guess why no value
   * shows.
   */
  readonly empty?: true;
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
 * One field's value in a list's entry, as the picker shows it: its start as
 * text, a picture's small thumbnail, or a field holding nothing.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type ListSampleValue =
  | string
  | { readonly thumbnail: string }
  | { readonly empty: true };

/**
 * Each field's value in one entry a list shows, as the canvas reads it, by
 * the field's path (`title`, `author.name`): the samples the picker shows
 * beside a list item's fields. Text is cut short by the same rule as a
 * {@link BindingFieldChoice}'s `preview`; a field with nothing to show is
 * absent.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type ListSample = Readonly<Record<string, ListSampleValue>>;

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

/**
 * What the binding controls read and do through the host: the fields, their
 * previews and an unbind's plan. Part of the editor's content services.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingServices {
  /**
   * The fields a binding can read, for the inspector's picker: the entry's,
   * each Single's and the site settings', only those the signed-in author may
   * read, each marked by whether visitors may and previewed as the author
   * reads it. Absent, a prop offers no binding.
   */
  readonly listBindingFields?: () => Promise<readonly BindingFieldSource[]>;
  /**
   * Each field's value in one entry a list shows, read as the canvas reads
   * that list, for the picker's samples beside a list item's fields. Takes
   * the list's stored props and the entry's place among those it shows
   * (the one the author clicked on the canvas), the first where none is
   * given or the list shows fewer. `undefined` for a list the canvas reads
   * no entry of. Absent, the item's fields show no samples.
   *
   * @experimental Settles with the editor's binding controls.
   */
  readonly readListSample?: (
    props: Readonly<Record<string, unknown>>,
    entry?: number
  ) => Promise<ListSample | undefined>;
  /**
   * The page's language, as the canvas's render formats bound values in it,
   * so the picker previews a date or a number as the page shows it. Resolved
   * as a render resolves it (`bindingFormatEnv`): absent, English.
   */
  readonly bindingLocale?: string;
  /**
   * The site's time zone, as a published page shows its date-times in it,
   * read when a binding picker opens: `undefined` for a site with none set.
   * Until it is in, or where it is absent or fails, previews are in UTC, as
   * a page rendered with no zone.
   */
  readonly readSiteTimeZone?: () => Promise<string | undefined>;
  /**
   * An unbind's plan, made against the document the editor holds by the same
   * decision the page actions API takes: what to write in the binding's place
   * and why, or why it can't be kept. Absent, a bound prop offers no unbind.
   */
  readonly planUnbind?: (ask: UnbindAsk) => Promise<UnbindPlanAnswer>;
  /**
   * Where a binding's source is edited in the admin: the entry's edit
   * screen, the Single's, or the site settings. `undefined` for a source the
   * host has no screen for, such as a list's item, which leaves a bound
   * prop's menu without "Open source".
   */
  readonly sourceHref?: (binding: Binding) => string | undefined;
}
