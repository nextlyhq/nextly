"use client";

/**
 * The empty page's "or start from a page" row: the starter pages the site
 * offers, read once the page on screen is an empty page, each drawn small
 * from its own blocks in the site's own style, and the one picked copied
 * into the page as one undo step.
 *
 * The list is the server's (`/starter-pages`), and a starter the site can't
 * use is listed with the server's reason, which the start area shows under
 * it, dimmed. Such a starter is never applied, and one whose copy the editor
 * refuses is not dropped in silence: both are said in the editor's notices.
 * The copy is the builder's (`applyStarterPage`): the engine's fresh-id copy
 * through `applyAll`, so a single Undo empties the page again.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/starter-pages-client
 */
import {
  applyStarterPage,
  DocumentMiniature,
  PageInserters,
  type PageInsertersProps,
  type StarterPage,
} from "@nextlyhq/builder/shell";
import { readPluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import type { NewPageStarter } from "../../pages-write-contract";
import {
  STARTER_PAGES_ROUTE_PATH,
  starterUnavailableSentence,
  type StarterPagesResponse,
} from "../../starter-pages/starter-pages-contract";

import type { EditorView } from "./editor-view";
import { usePictureRender } from "./section-pictures";

/** The icon a starter's tile shows when its picture can't be drawn. */
const STARTER_ICON = "section";

/** The width a starter's picture is drawn at in the row. */
const PICTURE_BOX = { display: "block", width: "8rem" } as const;

/**
 * The starter pages the site offers, read once `wanted` is true (the page
 * on screen is an empty page) and kept for the editor's life. A read that
 * fails offers none: the row is left out, and the page still starts with
 * "Add a block".
 */
function useOfferedStarterPages(wanted: boolean): readonly NewPageStarter[] {
  const [starters, setStarters] = useState<readonly NewPageStarter[] | null>(
    null
  );
  const needed = wanted && starters === null;
  useEffect(() => {
    if (!needed) return;
    const controller = new AbortController();
    readPluginRoute<StarterPagesResponse>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: STARTER_PAGES_ROUTE_PATH,
      signal: controller.signal,
    })
      .then(answer => {
        if (controller.signal.aborted) return;
        setStarters(Array.isArray(answer?.items) ? answer.items : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStarters([]);
      });
    return () => controller.abort();
  }, [needed]);
  return starters ?? [];
}

/**
 * What the row needs of the editor's view: the page and its apply, what its
 * pictures are drawn with, and the notices a starter it can't apply is said
 * in. Narrower than the whole view, so the row can be drawn on its own.
 */
type StarterRowView = Pick<
  EditorView,
  "canvasSiteStyle" | "previewMode" | "pictureSession"
> & {
  readonly editor: Pick<EditorView["editor"], "document" | "applyAll">;
  readonly componentLibrary: Pick<
    EditorView["componentLibrary"],
    "definitions"
  >;
  readonly notices: Pick<EditorView["notices"], "raise">;
};

/** What the start area's row is drawn and applied from. */
interface StarterRow {
  readonly starters: readonly StarterPage[];
  readonly onStarter: (id: string) => void;
}

/**
 * The start area's starter row for the page on screen: none on a document
 * that is not a page, or a page that has blocks.
 */
function useStarterRow(view: StarterRowView): StarterRow {
  const { editor } = view;
  const { raise } = view.notices;
  const empty = editor.document.nodes.length === 0;
  const offered = useOfferedStarterPages(
    empty && editor.document.kind === "page"
  );
  const render = usePictureRender(
    view.canvasSiteStyle,
    view.componentLibrary.definitions
  );
  const mode = view.previewMode?.mode;
  const session = view.pictureSession;
  const starters = useMemo(
    () =>
      offered.map(
        (starter): StarterPage => ({
          id: starter.id,
          title: starter.label,
          // The server's reason, which the start area shows under the tile.
          unavailable: starter.unavailable?.reason,
          picture: (
            // The picture takes its box's width, and a tile in the row has
            // none of its own, so the box gives it one.
            <span style={PICTURE_BOX}>
              <DocumentMiniature
                documents={[starter.document]}
                render={render}
                {...(mode === null || mode === undefined ? {} : { mode })}
                icon={STARTER_ICON}
                session={session}
              />
            </span>
          ),
        })
      ),
    [offered, render, mode, session]
  );
  const onStarter = useCallback(
    (id: string) => {
      const starter = offered.find(candidate => candidate.id === id);
      if (starter === undefined) return;
      // The start area doesn't report an unavailable tile; were one reported
      // anyway, the site still can't hold it, so it is said, not applied.
      if (starter.unavailable !== undefined) {
        raise(
          starterUnavailableSentence(starter.label, starter.unavailable.reason)
        );
        return;
      }
      // A page that gained a block meanwhile is left as it is, as the
      // builder's apply leaves it; that is not the starter's failing.
      if (editor.document.nodes.length > 0) return;
      // A copy the editor refused (its page limits, or the planner) changes
      // nothing; the author is told rather than left pressing a tile that
      // does nothing.
      if (!applyStarterPage(editor, starter.document.nodes)) {
        raise(starterUnavailableSentence(starter.label));
      }
    },
    [offered, editor, raise]
  );
  return { starters: empty ? starters : [], onStarter };
}

/**
 * The canvas's page inserters with the empty page's starter row: a
 * component of its own, so the row's read and pictures are hooks the
 * canvas region, a plain function of the view, can draw.
 */
export function EditorPageInserters({
  view,
  ...props
}: PageInsertersProps & { readonly view: StarterRowView }): React.JSX.Element {
  const row = useStarterRow(view);
  return (
    <PageInserters
      {...props}
      start={{
        ...props.start,
        ...(row.starters.length === 0
          ? {}
          : { starters: row.starters, onStarter: row.onStarter }),
      }}
    />
  );
}
