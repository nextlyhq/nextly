/**
 * What judging a composition needs to know about the site, and the shapes
 * it reports in: the usage index's hosts, the site's definitions, which
 * document a write is to, and what the server log is told about writes kept
 * unjudged or component saves refused.
 *
 * Part of the blocks field's composition checks. `blocks-composition.ts` is
 * the entry, and its header explains the rules.
 *
 * @module fields/blocks-composition-setup
 */
import type {
  BlockRegistryReader,
  DocumentLimits,
  LockedExposure,
  NamedQuerySource,
} from "@nextlyhq/blocks-engine";
import type {
  PluginCollectionTransaction,
  PluginFieldWrite,
} from "@nextlyhq/plugin-sdk";

import type { OpenRemovalReader } from "../breakpoint-removal/lock-acceptance";
import type { ComponentStoreAddress } from "../component-cycle-guard";
import type { FencedComponents } from "../host-rewrite/fence";

import type { DeclaredShapesReader } from "./binding-judgement";
import type { EntryBlocksFieldsReader } from "./entry-content-judgement";
import type { ListFieldsReader, TemplateTargets } from "./list-query-judgement";
import type { PageCodeJudgeDeps } from "./page-code-judgement";

/** The issue shape core's validation envelope carries. */
export interface Issue {
  path: string;
  code: string;
  message: string;
}

/** One document that places a component, as the usage index records it. */
export interface HostRef {
  /** The collection's slug, or the Single's when {@link single} is set. */
  readonly slug: string;
  /** The entry's id; empty for a Single, which has one document. */
  readonly id: string;
  /** Whether this is a Single's document rather than a collection entry. */
  readonly single?: boolean;
  /** The blocks field the placement is in. */
  readonly field: string;
  /** Whether the reference was recorded in one language of a localized field. */
  readonly localized: boolean;
}

/** Who places a component, as the usage index answers it. */
export interface HostFinder {
  /**
   * Whether the index covers every document it is meant to — false while a
   * backfill has not finished, or where content exists it cannot index at all.
   * Read once per host walk.
   */
  whole(): Promise<boolean>;
  /**
   * The documents placing any of these components, and whether this lookup
   * read every row there was (false where the index held more than one save
   * reads).
   */
  placing(componentIds: readonly string[]): Promise<{
    readonly hosts: readonly HostRef[];
    readonly complete: boolean;
  }>;
}

/** Hosts a component save could not judge, and why, for the site's operators. */
export interface UnjudgedHosts {
  readonly componentId: string;
  /** Hosts the index listed that could not be judged. */
  readonly count: number;
  /**
   * Whether the index could not vouch for listing every host, so there may be
   * more than `count` unjudged — how many is not known.
   */
  readonly listIncomplete: boolean;
  /** One sentence per cause, without repeats. */
  readonly reasons: readonly string[];
}

/** What judging a composition needs to know about the site. */
export interface CompositionSetup {
  /** Where components live, so a write to one is known for what it is. */
  readonly store: ComponentStoreAddress;
  /** The caps the renderer draws under. */
  readonly limits: DocumentLimits;
  /** The site's block registry, whose nesting rules and locks are judged. */
  readonly blocks: BlockRegistryReader;
  /** Who places a component; absent where the index cannot be reached. */
  readonly hostsOf?: HostFinder;
  /**
   * Whether {@link hostsOf} reads the index on the write's own transaction, so
   * a save made inside one can list its hosts. Otherwise a save inside a
   * transaction lists none: a read on another connection can wait on the one
   * the transaction holds.
   */
  readonly hostsInTransaction?: boolean;
  /** Told about hosts a component save could not judge. */
  readonly onUnjudged?: (unjudged: UnjudgedHosts) => void;
  /**
   * Told which hosts a refused component save would have broken. The refusal
   * itself names none of them: the hosts were found and read as the system,
   * and the author saving the component may not be allowed to see them.
   */
  readonly onHostsBroken?: (broken: BrokenHosts) => void;
  /**
   * Told of the exposures a component already stores that drive something a
   * `contentOnly` lock holds. Kept, not refused, so the server log is where
   * an operator learns of them.
   */
  readonly onLockedExposures?: (found: LockedExposures) => void;
  /**
   * Told of the hosts whose lock was already broken before a component save
   * and is no worse after it. Kept, not refused, so the server log is where an
   * operator learns of them.
   */
  readonly onHostsStillBroken?: (found: StillBrokenHosts) => void;
  /**
   * Told of placement breaks a write kept because the stored value they may
   * already be part of could not be read (a single, a localized field). Kept,
   * not refused, so the server log is where an operator learns of them.
   */
  readonly onPlacementUnjudged?: (found: PlacementUnjudged) => void;
  /**
   * Told of a write whose Layers locks could not be judged, because the
   * stored value they would be judged against could not be read (see
   * `LayersLockUnjudged.reason`). Kept, not refused, so the server log is
   * where an operator learns of it.
   */
  readonly onLayersLockUnjudged?: (found: LayersLockUnjudged) => void;
  /**
   * Whether documents are composed against this store at all. `false` where
   * the renderer draws components from somewhere no collection can stand for
   * (a route's own `resolveComponents`): composing against this store would
   * judge a page by definitions it is not drawn with. A component saved to the
   * store is still refused for containing itself.
   */
  readonly composesDocuments: boolean;
  /**
   * The components being deleted, or deleted: among the ones named, when
   * they are. A write adding a reference to one is refused, judged against
   * what the document stores now; absent where no fence is installed.
   */
  readonly fencedComponents?: (
    among?: readonly string[]
  ) => Promise<FencedComponents>;
  /**
   * The breakpoint removal that is open, if any: while one is, a Layers or
   * `contentOnly` lock accepts exactly the stored value with the removed
   * breakpoints' values stripped (`breakpoint-removal/lock-acceptance`).
   * Absent, no lock accepts anything more than it always did.
   */
  readonly openBreakpointRemoval?: OpenRemovalReader;
  /**
   * What the site defines that a page refers to by id, from ONE read of its
   * style, so every reference in a write is judged against the same version
   * of it. Asked at most once per write, and only when a reference needs it.
   * A write adding a reference to anything else is refused. Absent where the
   * site style cannot be read, and then nothing is refused.
   *
   * Read through the Direct API when asked with no transaction, as the
   * validation asks before the write's transaction opens; on `transaction`
   * when handed one, as the judgement under the composition graph lock asks
   * (`composition-rejudge`), so that read takes no second connection while
   * the write holds one. Both resolve the record by one reading
   * (`site-definitions`).
   */
  /**
   * What a page's own code (`settings.code`) is judged with on every write
   * that changes it: the site code's declared policy and the site's origin.
   * Absent, page code is not judged, as where nothing installed the plugin.
   */
  readonly pageCode?: PageCodeJudgeDeps;
  readonly siteDefinitions?: (
    transaction?: PluginCollectionTransaction
  ) => Promise<SiteDefinitions>;
  /**
   * The fields a collection declares and the public may read, for judging
   * what a page's collection lists filter and sort by. Absent where the
   * schema cannot be read, and then lists are judged by their shape alone.
   */
  readonly listFields?: ListFieldsReader;
  /**
   * The fields a collection or a Single declares, whoever may read them, for
   * judging a page's bindings at save. Absent where the schema cannot be
   * read, and then bindings are judged by their shape alone.
   */
  readonly bindingShapes?: DeclaredShapesReader;
  /**
   * Told of binding problems a save kept because the stored value they may
   * already be part of could not be read; absent, they are kept silently.
   */
  readonly onBindingsUnjudged?: (found: BindingsUnjudged) => void;
  /**
   * This site's named queries, for a list whose source is one; absent, such
   * a list is judged by its shape alone.
   */
  readonly namedQueries?: NamedQuerySource;
  /**
   * Where templates are stored and what a stored one draws, so a template's
   * lists and conditions are judged against the collection it draws rather
   * than the templates collection. Absent, a template is judged as any entry.
   */
  readonly templates?: TemplateTargets;
  /**
   * A collection's top-level blocks fields, for judging which one a
   * template's Entry content block draws. Absent, its field is judged by
   * its shape alone.
   *
   * @experimental Settles when collection templates ship.
   */
  readonly entryBlocksFields?: EntryBlocksFieldsReader;
}

/** What the site defines that a page refers to by id. */
export interface SiteDefinitions {
  /** The classes the compiler applies: the code's and the stored ones. */
  readonly classIds: ReadonlySet<string>;
  /** The breakpoints the stylesheet is emitted under, the base included. */
  readonly breakpointIds: ReadonlySet<string>;
  /**
   * The identities of the variables the page may name: the engine's, the
   * code's and the stored ones, merged as the stylesheet resolves them.
   */
  readonly tokenIds: ReadonlySet<string>;
}

/** Which document a write is to: a collection or a single, its slug, an id. */
export interface WrittenTo {
  readonly kind?: string;
  readonly slug?: string;
  readonly id?: string;
}

/** Placement breaks a write kept unjudged, for the server log. */
export interface PlacementUnjudged extends WrittenTo {
  /** The blocks field written. */
  readonly field: string;
  /** How many breaks were kept. */
  readonly breaks: number;
}

/** Binding problems a write kept unjudged, for the server log. */
export interface BindingsUnjudged extends WrittenTo {
  /** The blocks field written. */
  readonly field: string;
  /** How many problems were kept. */
  readonly bindings: number;
}

/** A write whose Layers locks were not judged, for the server log. */
export interface LayersLockUnjudged extends WrittenTo {
  /** The blocks field written. */
  readonly field: string;
  /**
   * Why its stored value could not be read: a translated field whose language
   * store is not ready, or a field inside a group or a repeater.
   */
  readonly reason: "language-not-ready" | "nested-field";
}

/**
 * A component's stored exposures that drive something a `contentOnly` lock
 * holds, for the server log. Kept rather than refused, so an edit unrelated to
 * them still saves; each one is the designer's to remove, or the lock's to
 * loosen.
 */
export interface LockedExposures {
  readonly componentId: string;
  readonly exposures: readonly LockedExposure[];
}

/**
 * The hosts a component save found already breaking a lock and left no
 * worse, for the server log. Not this save's to refuse; each one is the
 * host's to repair.
 */
export type StillBrokenHosts = BrokenHosts;

/** The hosts a refused component save would have broken, for the server log. */
export interface BrokenHosts {
  readonly componentId: string;
  /** One entry per document, with the blocks fields it places the component in. */
  readonly hosts: readonly {
    readonly slug: string;
    readonly id: string;
    readonly fields: readonly string[];
    readonly messages: readonly string[];
  }[];
}

/** Which document a write is to, for the server log: kind, slug and entry id. */
export function documentOf(write: PluginFieldWrite | undefined): WrittenTo {
  if (write === undefined) return {};
  return {
    kind: write.kind,
    slug: write.slug,
    ...(write.id === undefined ? {} : { id: write.id }),
  };
}
