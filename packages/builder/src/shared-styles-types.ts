/**
 * What the Shared styles tab is handed and answers in: the host's access to
 * the library, a rename's answer, the page's blocks by class, the look editor
 * the tab mounts, the tab's props, and how many rows mount at a time.
 * `shared-styles-panel.tsx` still exports each of these names.
 *
 * @module shared-styles-types
 */

import type {
  NamedClass,
  SiteTokenSet,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";

import type { LookKey } from "./block-look-rows";
import type {
  SharedStyleRefusal,
  SharedStylesCount,
  SharedStylesUsage,
  SharedStyleUsesPage,
} from "./shared-style-library";

/** What the host answers a rename with. */
export type ClassRenameOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** The host's reads and writes through the site's shared-style routes. */
export interface SharedStylesAccess {
  /** How widely each of these styles is used: at most fifty ids per read. */
  readonly usage: (
    ids: readonly string[],
    signal: AbortSignal
  ) => Promise<SharedStylesUsage>;
  /** One page, from 1, of the documents a style is used on. */
  readonly uses: (
    id: string,
    page: number,
    signal: AbortSignal
  ) => Promise<SharedStyleUsesPage>;
  /** Lock or unlock a style. Resolves to the refusal, or nothing. */
  readonly lock: (id: string, locked: boolean) => Promise<string | undefined>;
  /** Remove unused styles, at most fifty. Resolves to the refusal, or nothing. */
  readonly remove: (ids: readonly string[]) => Promise<string | undefined>;
  /**
   * `remove`, answering a refusal with its words and whether it said a style
   * is still used. Optional: a host without it keeps working through
   * `remove`, and the tab then takes no refusal as saying a style is used.
   *
   * @experimental Settles with the Shared styles tab.
   */
  readonly removeWithReason?: (
    ids: readonly string[]
  ) => Promise<SharedStyleRefusal | undefined>;
  /**
   * Count the site's pages now, for a bounded time, rather than waiting for
   * the site's background jobs. Optional: without it the tab only says the
   * jobs count them.
   *
   * @experimental Settles with the Shared styles tab.
   */
  readonly count?: () => Promise<SharedStylesCount>;
}

/** The blocks on the open page carrying each style, by id. */
export interface PageClassBlocks {
  readonly counts: ReadonlyMap<string, number>;
  /** False when the page has more blocks than could be read. */
  readonly complete: boolean;
}

export interface SharedStylesPanelProps {
  /** The site's class library, or `undefined` while it is being read. */
  library: readonly NamedClass[] | undefined;
  /** Why the library is absent, when it is. */
  absence?: "pending" | "failed";
  /** The styles the site's code supplies: shown, never changed here. */
  suppliedClassIds?: readonly string[];
  /** The context the page compiles with, so summaries match the page. */
  styleContext?: StyleCompileContext;
  /**
   * The site's variables, so each row's preview is drawn on the site's page
   * colours. Absent: a neutral tile.
   */
  tokens?: SiteTokenSet;
  /** The blocks on the open page carrying each style. */
  pageBlocks: PageClassBlocks;
  /** Shown, never changed: no rename and no removal. A lock is its own right. */
  readOnly?: boolean;
  /** The usage routes and the lock and remove writes. Absent: none read. */
  access?: SharedStylesAccess;
  /** Rename a style: the name typed, and the class name derived from it. */
  onRename?: (
    classId: string,
    name: { label: string; slug: string }
  ) => Promise<ClassRenameOutcome>;
  /**
   * The live rename attempt for a style, as the host counts it, read right
   * after `onRename` is called, so a late answer to an earlier rename is not
   * shown as the current one.
   */
  currentRenameAttempt?: (classId: string) => number;
  /** The name each style is being renamed to while its write is open. */
  pendingNames?: Readonly<Record<string, string>>;
  /**
   * Choosing a look to edit in the inspector, with no block selected. Absent:
   * the Block looks group is listed, not chosen.
   *
   * @experimental
   */
  looks?: PanelLookEditing;
  /**
   * The style whose details are open as the tab mounts, as when the Variables
   * tab sends the author to a style that uses a variable. Read once.
   *
   * @experimental Settles with the Variables tab's usage.
   */
  initialOpenId?: string;
  /**
   * A search the host keeps across several views, as the Design panel keeps
   * one across its tabs, with the way to change it. Given, this tab lists
   * what it matches and draws no search box of its own.
   */
  hostSearch?: {
    readonly query: string;
    readonly onQuery: (query: string) => void;
  };
}

/** How the Block looks group's rows choose the look the inspector edits. */
export interface PanelLookEditing {
  /** Edit a look in the inspector. */
  readonly onEdit: (look: LookKey) => void;
  /** The look the inspector is editing, whose row shows as chosen. */
  readonly editing: LookKey | null;
}

/** How many rows mount before the author asks for more. */
export const PAGE_SIZE = 50;
