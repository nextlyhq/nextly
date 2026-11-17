"use client";

/**
 * What every content control is given: the host's services (the media
 * library, entry and link-target search, the collections a list reads), the
 * context that carries them, and the props each control takes.
 *
 * @module content-services
 */

import type {
  BlockDocument,
  FieldStoragePrimitive,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { BindingServices } from "./binding-services";
import type { InlineRichTextEditorLoader } from "./canvas/use-inline-rich-text";
import type { EditableProp } from "./inspector";
import type { QueryField } from "./list-query-model";
import type { CustomSource } from "./named-query-model";
import type { OpenPassages } from "./open-passages";
import type { PreferenceStore } from "./shell-state";

/** One item the host's media picker returned. Only its id is ever stored. */
export interface PickedMedia {
  readonly id: string;
  readonly url?: string | null;
  readonly filename?: string;
}

/** What a field shows of a chosen media item, read by its id. */
export interface MediaSummary {
  /** The file's name, as the author uploaded it. */
  readonly name?: string;
  /** An address to draw a small picture of it from. */
  readonly thumbnail?: string;
  /** Its alt text in the library, when it has one. */
  readonly alt?: string;
}

/**
 * One image a library search found: its summary, and the id a pick stores.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface FoundMedia extends MediaSummary {
  readonly id: string;
}

/** What the content controls hand the host's media picker. */
export interface MediaPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (media: PickedMedia[]) => void;
  title?: string;
  /** The kinds of file it offers, as an `accept` list: `image/*`. */
  accept?: string;
  /** What is chosen when it opens: the file the prop stores, if any. */
  initialSelectedIds?: Set<string>;
}

/** What a relation control asks the host for: one collection's entries. */
export interface EntryQuery {
  readonly collection: string;
  /** Entries whose title holds this, ignoring case; empty for the first few. */
  readonly search?: string;
  /** These entries by id, to name the one a prop stores. */
  readonly ids?: readonly string[];
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

/** One entry as a relation control shows it: its id and its title, nothing else. */
export interface FoundEntry {
  readonly id: string;
  readonly title: string;
}

/** What the link control asks the host for: what a link can point at. */
export interface LinkTargetQuery {
  /** Pages and entries whose title holds this, ignoring case; empty for the first few. */
  readonly search: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

/** One page or entry the link control offers. */
export interface LinkTarget {
  readonly id: string;
  /** Its collection's slug, which a link to the entry stores. */
  readonly collection: string;
  /** The heading it is listed under: its collection's name ("Pages"). */
  readonly group: string;
  readonly title: string;
  /**
   * Where it is served on the site (`/pricing`), when the host knows. A
   * heading or a box links by this address; without one, only a block that
   * can hold an entry reference can link to it.
   */
  readonly path?: string;
}

/**
 * One field a collection list may filter by, and sort by unless it is a
 * relation: a field visitors can see, holding one value.
 */
export interface LoopListField extends QueryField {
  /** A date picked as a day, which a filter compares as that day. */
  readonly dateOnly?: boolean;
}

/** A to-many relation a related list can show the entries of. */
export interface LoopRelation {
  /** The relation field a list's `relation.field` stores. */
  readonly field: string;
  /** What the author calls it: "Categories". */
  readonly label: string;
  /** The collection its entries are in. */
  readonly collection: string;
}

/** One collection a loop can repeat over, as its controls offer it. */
export interface LoopCollection {
  /** The slug a loop stores. */
  readonly slug: string;
  /** Its name, as the admin shows it: "Blog posts". */
  readonly label: string;
  /** Its name for one entry: "Post". Its label where it has none. */
  readonly singular?: string;
  /**
   * The fields a list may filter and sort by, in the collection's order:
   * only those visitors can see, since the entries shown would otherwise
   * reveal a field no visitor may read.
   */
  readonly fields: readonly LoopListField[];
  /** Its to-many relations visitors can see, to a listed collection. */
  readonly relations?: readonly LoopRelation[];
  /**
   * Every field name it declares, so a stored filter on a field visitors
   * can't see is told apart from one on a field it no longer has.
   */
  readonly declared?: readonly string[];
  /**
   * Every field the public may read, as a save judges a list against them;
   * {@link fields} is the narrower view of these an author is offered.
   */
  readonly readable?: readonly {
    readonly name: string;
    /** What the admin calls it: "Cover image". */
    readonly label?: string;
    readonly type: string;
    readonly hasMany?: boolean;
    readonly relationTo?: string | readonly string[];
    /** A time of day, which no list filters or sorts by. */
    readonly timeOnly?: boolean;
    /** The primitive a plugin's field type is stored as, which gives its kind. */
    readonly storage?: FieldStoragePrimitive;
  }[];
}

/** A list's matching entries, and how many of them it shows. */
export interface ListEntriesCount {
  readonly matching: number;
  readonly shown: number;
}

/**
 * What the host lends the Content tab: the parts of the admin this package
 * cannot reach itself. Each is optional, and a control whose service is absent
 * says so rather than offering a button that does nothing.
 *
 * The binding controls' share is {@link BindingServices}.
 *
 * @experimental Grows with the controls registry.
 */
export interface ContentServices extends BindingServices {
  /** The admin's media library, as a dialog the control opens. */
  readonly MediaPicker?: React.ComponentType<MediaPickerProps>;
  /** The shared rich-text editor, loaded when a passage is first focused. */
  readonly loadRichTextEditor?: InlineRichTextEditorLoader;
  /**
   * A collection's entries, read with the signed-in author's own access, for
   * a prop that points at one of them.
   */
  readonly findEntries?: (query: EntryQuery) => Promise<readonly FoundEntry[]>;
  /**
   * The pages and entries a link can point at, read with the signed-in
   * author's own access and listed by collection, the site's own pages first.
   * Absent, a link control takes typed addresses only.
   */
  readonly findLinkTargets?: (
    query: LinkTargetQuery
  ) => Promise<readonly LinkTarget[]>;
  /**
   * The collections a collection loop can repeat over, read with the
   * signed-in author's own access, each with the fields visitors can see
   * and its to-many relations. Absent, a loop's collection and sort are
   * typed as text.
   */
  readonly listLoopCollections?: () => Promise<readonly LoopCollection[]>;
  /**
   * The custom sources a collection list may show: the named queries the
   * site registers, each without its run function, with the collections it
   * reads that visitors can read nothing of. Absent, the Source menu offers
   * collections and related entries only.
   */
  readonly listCustomSources?: () => Promise<readonly CustomSource[]>;
  /**
   * How many entries a list's stored query matches as the canvas reads them,
   * and how many of those its window shows, from one count read. Asked only
   * for the list selected in the editor. Undefined where one read cannot
   * count it, such as a list of an entry's related entries.
   */
  readonly countListEntries?: (
    props: Readonly<Record<string, unknown>>
  ) => Promise<ListEntriesCount | undefined>;
  /**
   * The collection the document being edited is an entry of, so a list on
   * it can show the entry's related entries. `null` where the document is
   * known to be no collection's entry, such as a Single, so a list there
   * showing the entry's related entries is refused as the save refuses it;
   * absent where that is not known.
   */
  readonly entryCollection?: string | null;
  /**
   * A media item by its id, read with the signed-in author's own access, so a
   * stored file is shown by its picture and name rather than as "a file".
   */
  readonly readMedia?: (mediaId: string) => Promise<MediaSummary | null>;
  /**
   * The media library's images found by name, read with the signed-in
   * author's own access: the newest first, a handful at a time, and the
   * newest of all for an empty search. Rejects where the library cannot be
   * read, and once `signal` aborts. Absent, an image binding's Fallback
   * offers the host's `MediaPicker` dialog alone.
   *
   * @experimental Settles with the editor's binding controls.
   */
  readonly searchMedia?: (
    search: string,
    signal?: AbortSignal
  ) => Promise<readonly FoundMedia[]>;
  /**
   * Where a rich-text field holds the passage it has open, so the host
   * finishes it before the document is stored.
   */
  readonly openPassages?: OpenPassages;
  /**
   * Where the icons this author chose last are kept, for the Icon control's
   * Recent row: the host's, so it is one per signed-in author. Absent, the
   * picker offers no Recent row.
   */
  readonly recentIcons?: PreferenceStore;
  /**
   * A form a Form block picked from a provider, read with the signed-in
   * author's own access, for what its own "After sending" setting is.
   * Absent, or answering `undefined`, the panel names the choice without
   * saying what it is.
   *
   * @experimental Settles with the form provider contract.
   */
  readonly describeForm?: (form: {
    readonly provider: string;
    readonly ref: string;
  }) => Promise<
    { readonly afterSending: { readonly kind: "message" | "page" } } | undefined
  >;
}

/**
 * The host's content services for a surface below the inspector that is not
 * a Content tab control, such as a component placement's exposed image, so
 * it reaches the same media library without a prop threaded through every
 * surface between.
 */
export const ContentServicesContext: React.Context<
  ContentServices | undefined
> = React.createContext<ContentServices | undefined>(undefined);

/** What every content control is given. */
export interface ContentControlProps {
  /** The id its field takes, which its label points at. Unique per mount. */
  readonly id: string;
  readonly prop: EditableProp;
  /** Whether the prop may not be changed here: a lock, or a `contentOnly` area. */
  readonly disabled: boolean;
  /**
   * Set the prop, through the editor's one write path; `undefined` removes
   * it. Answers the document the write produced, when the caller knows it.
   */
  readonly onCommit: (
    name: string,
    value: unknown
  ) => BlockDocument | null | void;
  /** What the host lends, for the controls that need the admin. */
  readonly services?: ContentServices | undefined;
  /**
   * How many lists this control sits inside: 0 at the top of the tab. Lists
   * nest only as deep as the engine's `ITEM_SCHEMA_MAX_DEPTH`.
   */
  readonly depth?: number;
  /**
   * The label to show, when it is not the prop's own name: an item of a list
   * is labelled by its list and its position.
   */
  readonly label?: string | undefined;
  /**
   * The block's other props as stored, read-only, for a control whose
   * choices depend on one: a loop's sort offers the fields of the collection
   * its `collectionProp` names. Absent inside a list's items.
   */
  readonly values?: Readonly<Record<string, unknown>> | undefined;
}

/** A content control: a label and the field it names. */
export type ContentControl = (props: ContentControlProps) => React.JSX.Element;
