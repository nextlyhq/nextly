"use client";

import {
  hasBlock,
  registerBlocks,
  registryNestingSource,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { registrySlotSource } from "@nextlyhq/builder";
import {
  BlockKeyboardActions,
  BlockToolbar,
  BuilderShell,
  Canvas,
  CanvasFrame,
  CanvasFrameProvider,
  CanvasMarks,
  DESKTOP_PREVIEW_WIDTH,
  DropIndicator,
  DropRefusal,
  InsertPanel,
  InspectorPanel,
  RepairNotice,
  useCanvasDrag,
  useEditorState,
  useNoticeQueue,
} from "@nextlyhq/builder/shell";
import { useMemo } from "react";

// The same sheets, in the same order, as the canvas harness; see there.
import "@nextlyhq/ui/styles.css";
import "@nextlyhq/builder/styles.css";

import { useCoreBlocks } from "@/lib/use-core-blocks";

import { LOCKED_BLOCKS } from "./blocks";
import { brokenDocument, placedDocument } from "./seed";

const HARNESS_SOURCE = "e2e-locks-harness";

/** No breakpoints: nothing here is responsive, so the canvas's width decides nothing. */
const NO_BREAKPOINTS = { breakpoints: { viewport: [], container: [] } };

/** Register the locked blocks once, as `useCoreBlocks` registers the core ones. */
function useLockedBlocks(): void {
  useMemo(() => {
    const missing = LOCKED_BLOCKS.filter(block => !hasBlock(block.name));
    if (missing.length > 0) registerBlocks(missing, { source: HARNESS_SOURCE });
  }, []);
}

/** The document's tree as ids, for a test to read what the STORE holds. */
function treeOf(nodes: readonly BlockNode[]): unknown[] {
  return nodes.map(node =>
    node.slots === undefined
      ? node.id
      : [
          node.id,
          Object.values(node.slots).flatMap(children => treeOf(children)),
        ]
  );
}

/**
 * The editor, mounted for real over a page with locked areas.
 *
 * The real store, the real shell and the components the page builder ships:
 * the canvas with its drag, the block toolbar, the keyboard actions, the
 * inserter, the inspector and the repair notice. The store's refusals reach
 * the shell's notices, as they do in the admin. Nothing here judges a lock:
 * every refusal a test meets is the editor's own, and a harness that judged
 * one itself would certify itself.
 *
 * It REPORTS, beside the canvas, what the store holds: the undo depth and the
 * block tree, so "nothing changed" and "one edit" are asked of the store
 * rather than inferred from pixels.
 */
/** The save-as-pattern gesture, for a route with no library to save to. */
const NO_PATTERN_LIBRARY = (): void => {};

export function BuilderLocksHarness({ seed }: { seed: "placed" | "broken" }) {
  useCoreBlocks(HARNESS_SOURCE);
  useLockedBlocks();

  const initialDocument = useMemo(
    () => (seed === "broken" ? brokenDocument() : placedDocument()),
    [seed]
  );
  const notices = useNoticeQueue();
  const editor = useEditorState({
    initialDocument,
    onRefused: refusal => notices.raise(refusal.sentence),
    // A lock refusal, said the same way: the author reads why, in words.
    onLockRefused: refusal => notices.raise(refusal.sentence),
  });

  // Both drop questions answered by the registry the inserter reads.
  const sources = useMemo(
    () => ({ slots: registrySlotSource(), nesting: registryNestingSource() }),
    []
  );
  const drag = useCanvasDrag({ editor, ...sources });

  // A <main>, as the admin draws its screens, so the page's one landmark is
  // the editor and the visual check can find it.
  return (
    <main
      data-testid="locks-harness"
      data-nx-undo-depth={editor.undoDepth}
      data-nx-tree={JSON.stringify(treeOf(editor.document.nodes))}
      style={{ height: "100vh" }}
    >
      {/* Above the shell, as the editor provides it, so the keys and the
          panels see the canvas's frame. */}
      <CanvasFrameProvider>
        <BuilderShell
          notices={notices}
          // The rail's panel that holds the inserter, which it names "Add".
          availablePanels={["add"]}
          inspector={<InspectorPanel editor={editor} />}
          renderPanel={panel =>
            panel === "add" ? <InsertPanel editor={editor} /> : null
          }
        >
          <BlockKeyboardActions
            editor={editor}
            nesting={sources.nesting}
            // No pattern library behind this route, so saving one is not
            // offered and the gesture does nothing.
            onSaveAsPattern={NO_PATTERN_LIBRARY}
            mayCreatePattern={false}
          >
            <RepairNotice editor={editor} />
            {/* In its frame, with its chrome drawn over it, as the admin draws it. */}
            <CanvasFrame
              width={DESKTOP_PREVIEW_WIDTH}
              title="Locks harness"
              overlay={
                <>
                  <CanvasMarks />
                  <DropIndicator target={drag.target} />
                  {/* A refused drop is drawn with its reason over the region
                      that refuses it. */}
                  <DropRefusal drag={drag} document={editor.document} />
                  <BlockToolbar
                    editor={editor}
                    hidden={drag.draggingId !== null}
                  />
                </>
              }
            >
              <Canvas
                document={editor.document}
                siteStyles={NO_BREAKPOINTS}
                render={{ styleContext: NO_BREAKPOINTS }}
                selectedId={editor.selectedId}
                selectedIds={editor.selection.ids}
                onSelect={editor.select}
                dragHandlers={drag.handlers}
                // Whole, as the admin passes it, so the drag's marks are drawn.
                drag={drag}
              />
            </CanvasFrame>
          </BlockKeyboardActions>
        </BuilderShell>
      </CanvasFrameProvider>
    </main>
  );
}
