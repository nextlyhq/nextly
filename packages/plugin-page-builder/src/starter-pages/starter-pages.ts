/**
 * Starter pages: where a site and its plugins register them, and how each is
 * judged before the site starts.
 *
 * - **The site** passes `pageBuilder({ starterPages })`, and may hide the
 *   page builder's own set with `builtInStarterPages: false`.
 * - **A plugin** declares them under
 *   `contributes.declarations["@nextlyhq/plugin-page-builder"].starterPages`,
 *   the channel its blocks and named queries already use, read at boot, so
 *   plugin order does not matter.
 *
 * Every registered starter is judged once its blocks are known, all or
 * nothing: a starter that is malformed, takes an id another holds, names a
 * block the site doesn't have, places a component, carries a picture or an
 * address to load, or holds blocks the engine's own validation refuses stops
 * the boot with a message naming the starter, where it came from and why.
 * The page builder's own starters are judged the same way, except that one
 * needing a block the site doesn't have is left out of the list rather than
 * refusing the boot: the site did not write it.
 *
 * @module starter-pages/starter-pages
 */
import {
  DOCUMENT_FORMAT_VERSION,
  forEachStyleValues,
  isComponentInstance,
  isErrorIssue,
  isPlainRecord,
  paintsBackgroundImage,
  validateDocument,
  walkNodes,
  type BlockNode,
  type BlockRegistryReader,
  type BreakpointSet,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import {
  collectDeclarations,
  type PluginContext,
  type PluginDeclaration,
} from "@nextlyhq/plugin-sdk";
import type { StarterPageDefinition } from "@nextlyhq/plugin-sdk/blocks";

import { PAGE_BUILDER_PLUGIN } from "../blocks/registration-service";
import { registryMediaProps } from "../transfer/transfer-references";

/** Where a site's own starters are said to come from, in a boot error. */
const SITE_STARTERS_SOURCE = "pageBuilder({ starterPages })";

/** Where the page builder's own starters are said to come from. */
const BUILT_IN_STARTERS_SOURCE = "the page builder's own starter pages";

/** A starter's id: lower case letters, digits and `-`, 1 to 64 characters. */
const STARTER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The longest name a starter may have, in characters. */
const LABEL_MAX = 80;

/** The longest description a starter may have, in characters. */
const DESCRIPTION_MAX = 200;

/** A starter the site offers, with where it came from. */
export interface RegisteredStarterPage {
  readonly starter: StarterPageDefinition;
  /** The plugin that declared it, or the site's option. */
  readonly source: string;
  /** Whether it is one of the page builder's own. */
  readonly builtIn: boolean;
}

/** A starter as read from its source, before it is judged. */
interface ReadStarter {
  readonly value: unknown;
  readonly source: string;
  readonly builtIn: boolean;
}

/**
 * The starters in one plugin's declaration, or why its `starterPages` is not
 * a list. Nothing for a declaration this reader does not understand, as
 * `blocksIn` does: another version of the page builder may read keys this
 * one does not.
 */
function starterPagesIn(declaration: PluginDeclaration): {
  starters: readonly unknown[];
  error?: string;
} {
  const value = declaration.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { starters: [] };
  }
  const declared = (value as { starterPages?: unknown }).starterPages;
  if (declared === undefined) return { starters: [] };
  if (!Array.isArray(declared)) {
    return {
      starters: [],
      error:
        `[page-builder] "${declaration.source}" declared starterPages for the page builder as ` +
        `${typeof declared}; it must be an array of defineStarterPage definitions.`,
    };
  }
  return { starters: declared };
}

/** A built-in starter's blocks need one the site doesn't have: it is left out. */
const LEFT_OUT: unique symbol = Symbol("left out");

/** What a starter's blocks are judged against: the site's blocks and devices. */
export interface StarterJudgement {
  readonly blocks: BlockRegistryReader;
  readonly breakpoints: BreakpointSet;
  /**
   * The bounds the site holds a page to, so a starter too large for them is
   * refused here rather than offered and then refused at create. The
   * engine's defaults where the site sets none.
   */
  readonly limits?: DocumentLimits;
}

/** Why a text a starter needs is not one, or `undefined` when it is. */
function textProblem(
  value: unknown,
  missing: string,
  what: string,
  max: number
): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return missing;
  return value.length > max
    ? `has ${what} longer than ${max} characters`
    : undefined;
}

/** Why a starter's shape is not one, or `undefined` when it is. */
function shapeProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "must be an object made with defineStarterPage";
  }
  const starter = value as Record<string, unknown>;
  if (typeof starter.id !== "string" || !STARTER_ID.test(starter.id)) {
    return "needs an id of 1 to 64 lower case letters, digits and dashes";
  }
  return (
    textProblem(starter.label, "needs a name", "a name", LABEL_MAX) ??
    textProblem(
      starter.description,
      "needs a short description",
      "a description",
      DESCRIPTION_MAX
    ) ??
    (Array.isArray(starter.blocks) && starter.blocks.length > 0
      ? undefined
      : "needs at least one block")
  );
}

/**
 * The props of a block type that hold something it LOADS: a picture by its
 * media id (a prop the registry declares as media, the reading an export
 * carries media by), and an address under `src` (an Image's picture, an
 * Embed's video). A link is held under its own name and only followed, so
 * it is not among them.
 */
function loadedProps(
  blocks: BlockRegistryReader,
  type: string
): readonly string[] {
  const props = blocks.get(type)?.props ?? {};
  const src = Object.hasOwn(props, "src") ? ["src"] : [];
  return [...registryMediaProps(blocks, type), ...src];
}

/** Whether a prop's stored value holds something, rather than leaving it empty. */
function holdsValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

/**
 * Whether a node's styles name a picture to load, under any state and device:
 * a background image as the Style tab stores it (an address the compiler
 * wraps in `url(…)`, or a variable naming one), judged by the engine's own
 * reading of whether it paints, so `none` is no picture; or `url(…)` written
 * into any other value.
 */
function stylesLoadSomething(node: BlockNode): boolean {
  let found = false;
  forEachStyleValues(node.styles, (_breakpoint, values) => {
    if (found) return;
    const background = isPlainRecord(values) ? values.background : undefined;
    found =
      (isPlainRecord(background) &&
        paintsBackgroundImage("url", background.url)) ||
      JSON.stringify(values ?? null).includes("url(");
  });
  return found;
}

/**
 * The value an empty binding on `prop` falls back to, which the block draws
 * when the bound field has none: a picture to load as much as the prop's own.
 */
function fallbackOf(node: BlockNode, prop: string): unknown {
  const bindings: unknown = node.bindings;
  if (!isPlainRecord(bindings) || !Object.hasOwn(bindings, prop)) {
    return undefined;
  }
  const binding = bindings[prop];
  return isPlainRecord(binding) ? binding.fallback : undefined;
}

/**
 * Why a starter's blocks can't be offered, or `undefined` when they can:
 * a block the site doesn't have (asked of the page builder's own starters
 * only when `unknownBlocks` is "refuse"), a placed component, something to
 * load, then the engine's validation of them as a page.
 */
function blocksProblem(
  blocks: readonly BlockNode[],
  judgement: StarterJudgement,
  unknownBlocks: "refuse" | "leave out"
): string | typeof LEFT_OUT | undefined {
  let problem: string | typeof LEFT_OUT | undefined;
  walkNodes([...blocks], node => {
    if (problem !== undefined) return;
    if (isComponentInstance(node)) {
      problem =
        "places a component, which belongs to one site's library; use blocks instead";
      return;
    }
    if (!judgement.blocks.has(node.type)) {
      problem =
        unknownBlocks === "leave out"
          ? LEFT_OUT
          : `uses the block "${node.type}", which this site doesn't have`;
      return;
    }
    const props = node.props ?? {};
    const loaded = loadedProps(judgement.blocks, node.type).find(
      prop => holdsValue(props[prop]) || holdsValue(fallbackOf(node, prop))
    );
    if (loaded !== undefined || stylesLoadSomething(node)) {
      problem =
        `has a picture or an address to load in "${node.type}"` +
        (loaded === undefined ? "'s styles" : ` ("${loaded}")`) +
        "; a starter page leaves its pictures empty, so it never shows a broken image or loads from another site, and the author adds their own";
    }
  });
  if (problem !== undefined) return problem;
  // The engine's own reading of the blocks as a page, strictly: what a save
  // would refuse, a starter is refused for, before any author meets it.
  const { issues } = validateDocument(
    {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [...blocks],
    },
    {
      breakpoints: judgement.breakpoints,
      mode: "strict",
      ...(judgement.limits === undefined ? {} : { limits: judgement.limits }),
      registry: judgement.blocks.lookup(),
      nesting: judgement.blocks.nestingSource(),
      definitions: judgement.blocks.blockSource(),
    }
  );
  const refused = issues.find(isErrorIssue);
  return refused === undefined
    ? undefined
    : `fails validation at ${refused.path === "" ? "its blocks" : refused.path}: ${refused.message}`;
}

/** The boot error for a starter, naming it and where it came from. */
function refusal(read: ReadStarter, problem: string): Error {
  const id = (read.value as { id?: unknown } | null)?.id;
  const named = typeof id === "string" && id !== "" ? ` "${id}"` : "";
  return new Error(
    `[page-builder] The starter page${named} from ${read.source} ${problem}.`
  );
}

/**
 * Every starter, judged: the page builder's own (unless hidden), the site's,
 * then each plugin's, in that order. Throws the first refusal; leaves out a
 * built-in one needing a block the site doesn't have.
 */
function judgeStarterPages(
  read: readonly ReadStarter[],
  judgement: StarterJudgement
): RegisteredStarterPage[] {
  const taken = new Map<string, string>();
  const registered: RegisteredStarterPage[] = [];
  for (const entry of read) {
    const shape = shapeProblem(entry.value);
    if (shape !== undefined) throw refusal(entry, shape);
    const starter = entry.value as StarterPageDefinition;
    const holder = taken.get(starter.id);
    if (holder !== undefined) {
      throw refusal(
        entry,
        `takes an id ${holder} already uses; each starter page's id must be its own`
      );
    }
    taken.set(starter.id, entry.source);
    const problem = blocksProblem(
      starter.blocks,
      judgement,
      entry.builtIn ? "leave out" : "refuse"
    );
    if (problem === LEFT_OUT) continue;
    if (problem !== undefined) throw refusal(entry, problem);
    registered.push({
      starter,
      source: entry.source,
      builtIn: entry.builtIn,
    });
  }
  return registered;
}

/** What a site gives its starters: its own, and whether the built-in set shows. */
export interface StarterPageOptions {
  readonly starterPages?: readonly StarterPageDefinition[];
  readonly builtInStarterPages?: boolean;
}

/**
 * This boot's starter pages: the page builder's own unless the site hides
 * them, the site's, and each plugin's declared ones, judged against the
 * blocks registered this boot. Throws, naming the starter and its source,
 * for one that is refused.
 */
export function registerStarterPagesAtBoot(
  ctx: Pick<PluginContext, "config">,
  options: StarterPageOptions,
  builtIn: readonly StarterPageDefinition[],
  judgement: StarterJudgement
): RegisteredStarterPage[] {
  const read: ReadStarter[] = [
    ...(options.builtInStarterPages === false ? [] : builtIn).map(value => ({
      value,
      source: BUILT_IN_STARTERS_SOURCE,
      builtIn: true,
    })),
    ...(options.starterPages ?? []).map(value => ({
      value,
      source: SITE_STARTERS_SOURCE,
      builtIn: false,
    })),
  ];
  for (const declaration of collectDeclarations(
    ctx.config.plugins ?? [],
    PAGE_BUILDER_PLUGIN
  )) {
    const { starters, error } = starterPagesIn(declaration);
    if (error !== undefined) throw new Error(error);
    for (const value of starters) {
      read.push({ value, source: declaration.source, builtIn: false });
    }
  }
  return judgeStarterPages(read, judgement);
}
