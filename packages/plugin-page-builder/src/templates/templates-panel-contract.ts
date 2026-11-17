/**
 * What the builder's Pages panel reads of the collection templates: each
 * template with the collection it draws, how many entries it is used by, and
 * what its picture is drawn from.
 *
 * FREE OF RUNTIME IMPORTS, so the admin's bundle reads it without the
 * server's runtime.
 *
 * @experimental Settles when collection templates ship.
 * @module templates/templates-panel-contract
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";

/** Where the panel reads the templates: `GET /templates/panel`. */
export const TEMPLATES_PANEL_ROUTE_PATH = "/templates/panel";

/** How many entries a template draws. */
export interface TemplateUse {
  /** The entries counted: the collection's entries, less own designs. */
  readonly entries: number;
}

/** One collection template, as the panel lists it. */
export interface PanelTemplate {
  readonly id: string;
  readonly title: string;
  /** The collection whose entries it draws, by slug. */
  readonly collection: string;
  /** That collection's name, as the admin calls it. */
  readonly collectionLabel: string;
  readonly published: boolean;
  /** Its PUBLISHED document, which its picture draws, or null for none. */
  readonly document: BlockDocument | null;
  readonly use: TemplateUse;
}

/** What the panel's read answers. */
export interface TemplatesPanelResponse {
  readonly items: readonly PanelTemplate[];
  readonly meta: {
    /** The templates collection, as the site named it. */
    readonly templatesCollection: string;
    /** The published definitions the templates' documents reach, by id. */
    readonly definitions: Readonly<Record<string, BlockDocument>>;
  };
}
