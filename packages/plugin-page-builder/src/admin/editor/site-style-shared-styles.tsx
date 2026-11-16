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
  SharedStylesPanel,
  type PageClassBlocks,
} from "@nextlyhq/builder/shell";
import { useCan } from "@nextlyhq/plugin-sdk/client";

import { useSharedStylesClient } from "../shared-styles-client";

import type { ClassSurface } from "./site-style-class-surface";
import { useStyleToOpen } from "./site-style-tokens-studio";

/**
 * The Shared styles tab, with the class surface's rename and the shared-style
 * routes' reads, lock and removal.
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
  const access = useSharedStylesClient();
  const initialOpenId = useStyleToOpen();
  return (
    <SharedStylesPanel
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
      {...(looks === undefined ? {} : { looks })}
      {...(initialOpenId === undefined ? {} : { initialOpenId })}
    />
  );
}
