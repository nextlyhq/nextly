"use client";

/**
 * The Shared styles tab, over the class surface: the site's shared styles,
 * opened at the one the Variables tab sent the author to.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/site-style-shared-styles
 */
import type {
  SiteTokenSet,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import {
  SharedStylesHostSearch,
  SharedStylesPanel,
  type PageClassBlocks,
} from "@nextlyhq/builder/shell";
import { useCan } from "@nextlyhq/plugin-sdk/client";
import { useMemo } from "react";

import { useSharedStylesClient } from "../shared-styles-client";

import { useDesignBrowse } from "./design-panel";
import type { ClassSurface } from "./site-style-class-surface";
import { useStyleToOpen } from "./site-style-tokens-studio";
import { useUsageHere } from "./usage-here";

/**
 * The Styles tab, with the class surface's rename and whole-list edits (the
 * Block styles section's new, copied, renamed and hidden styles and its ★)
 * and the shared-style routes' reads, lock and removal, which a block style's
 * removal goes through too.
 *
 * Shown read-only to a role without `update-site-style`, which the server
 * would refuse anyway; locking is its own permission, which the usage read
 * reports, so it is offered on the server's word alone.
 */
export function SharedStylesStudio({
  classes,
  pageBlocks,
  styleContext,
  suppliedClassIds,
  tokens,
  looks,
}: {
  classes: ClassSurface;
  pageBlocks: PageClassBlocks;
  styleContext: StyleCompileContext;
  suppliedClassIds: readonly string[] | undefined;
  /** The site's variables as the canvas draws them, for the rows' preview tile. */
  tokens: SiteTokenSet | undefined;
  /** The look the inspector edits on its own, which a Block looks row chooses. */
  looks?: React.ComponentProps<typeof SharedStylesPanel>["looks"];
}): React.JSX.Element {
  const mayChange = useCan("update-site-style");
  // Named with what the editor has open, as the inspector's read is: the
  // rows count the open page from `pageBlocks`, in place of its saved share.
  const here = useUsageHere();
  const access = useSharedStylesClient(here);
  const initialOpenId = useStyleToOpen();
  const { search, setSearch, searchRef, folds } = useDesignBrowse();
  // The Design panel's one search, across its tabs, and its box, where focus
  // goes once a style is removed.
  const hostSearch = useMemo(
    () => ({ query: search, onQuery: setSearch, searchRef }),
    [search, setSearch, searchRef]
  );
  return (
    <SharedStylesHostSearch.Provider value={hostSearch}>
      <SharedStylesPanel
        // Drawn again when what the editor has open changes (a publish, a
        // first draft, another language): the rows keep each style's usage
        // once read, and the open document's parts in it are then another
        // document's, which would count a still-live page as gone.
        key={here === undefined ? "" : JSON.stringify(here)}
        library={classes.library}
        absence={classes.absence}
        suppliedClassIds={suppliedClassIds}
        styleContext={styleContext}
        tokens={tokens}
        pageBlocks={pageBlocks}
        readOnly={!mayChange}
        access={access}
        onRename={classes.rename}
        currentRenameAttempt={classes.currentRenameAttempt}
        pendingNames={classes.pendingNames}
        onEditClasses={classes.edit}
        {...(folds === undefined ? {} : { folds })}
        {...(looks === undefined ? {} : { looks })}
        {...(initialOpenId === undefined ? {} : { initialOpenId })}
      />
    </SharedStylesHostSearch.Provider>
  );
}
