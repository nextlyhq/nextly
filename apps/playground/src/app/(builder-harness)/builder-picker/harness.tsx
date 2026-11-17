"use client";

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  Canvas,
  CanvasFrame,
  CanvasFrameProvider,
  elementAnchor,
  InsertPanel,
  InsertPicker,
  useEditorState,
  useInsertPicker,
  type InsertPickerState,
  type InsertPickerTarget,
  type InsertPlace,
} from "@nextlyhq/builder/shell";
import {
  BUILDER_CHROME_CLASS,
  BUILDER_TOKENS_CLASS,
} from "@nextlyhq/builder/shell-state";
import { PortalProvider } from "@nextlyhq/ui";
import { useMemo, useState, useSyncExternalStore } from "react";

// The design system's sheet first, then the editor's, as the other harnesses.
import "@nextlyhq/ui/styles.css";
import "@nextlyhq/builder/styles.css";

import { useCoreBlocks } from "@/lib/use-core-blocks";

const HARNESS_SOURCE = "e2e-picker-harness";

/** The frame drawn at its own size, never fitted. */
const ACTUAL_SIZE = { kind: "fixed", scale: 1 } as const;

/** No breakpoints: this fixture asserts nothing responsive. */
const NO_BREAKPOINTS = { breakpoints: { viewport: [], container: [] } };

const HERO = "px-hero";
const PRICING = "px-pricing";

/** A Section with one Heading in it. */
function section(id: string, name: string, text: string) {
  return {
    id,
    type: "core/section",
    version: 1,
    name,
    props: { as: "section", contained: true },
    slots: {
      children: [
        {
          id: `${id}-heading`,
          type: "core/heading",
          version: 1,
          props: { text, level: "h2" },
        },
      ],
    },
  };
}

/** Hero and Pricing, two Sections with a gap between them. */
function pickerHarnessDocument(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      section(HERO, "Hero", "Welcome"),
      section(PRICING, "Pricing", "Plans"),
    ],
  };
}

/** The window's corners, where a stand-in "+" opens the picker. */
const CORNERS = [
  { name: "top left", style: { top: 8, left: 8 } },
  { name: "top right", style: { top: 8, right: 8 } },
  { name: "bottom left", style: { bottom: 8, left: 8 } },
  { name: "bottom right", style: { bottom: 8, right: 8 } },
] as const;

/** The gap between Hero and Pricing, as a gap's "+" names it. */
const BETWEEN: InsertPickerTarget = {
  kind: "place",
  place: { after: HERO },
};

/** The block a carried place is about, which it holds while selected. */
function placeBlock(place: InsertPlace): string | null {
  if ("inside" in place) return place.inside;
  return "after" in place ? place.after : null;
}

/** The page's blocks as types, one level deep, for a test to read. */
function documentShape(document: BlockDocument): string {
  return JSON.stringify(
    document.nodes.map(node => ({
      type: node.type,
      children: (node.slots?.children ?? []).map(child => child.type),
    }))
  );
}

/** The window's size, which the frame is laid out at. */
function useWindowSize(): string {
  return useSyncExternalStore(
    change => {
      window.addEventListener("resize", change);
      return () => window.removeEventListener("resize", change);
    },
    () => `${window.innerWidth}x${window.innerHeight}`,
    () => "0x0"
  );
}

/**
 * The canvas, the picker and the Add panel, mounted for real, with a "+" at
 * each corner that opens the picker on the gap between Hero and Pricing.
 */
export function BuilderPickerHarness() {
  return (
    <CanvasFrameProvider>
      <HarnessBody />
    </CanvasFrameProvider>
  );
}

function HarnessBody() {
  useCoreBlocks(HARNESS_SOURCE);
  const initialDocument = useMemo(() => pickerHarnessDocument(), []);
  const editor = useEditorState({ initialDocument });
  const picker = useInsertPicker();
  // The place "Browse all" handed on, or `null` while the panel is closed.
  const [carried, setCarried] = useState<{ place?: InsertPlace } | null>(null);
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
  const [width, height] = useWindowSize().split("x").map(Number);
  const browseAll = (target: InsertPickerTarget): void => {
    if (target.kind === "rule") return setCarried({});
    const block = placeBlock(target.place);
    if (block !== null) editor.select(block);
    setCarried({ place: target.place });
  };
  return (
    <div
      data-testid="picker-harness"
      className={`${BUILDER_CHROME_CLASS} ${BUILDER_TOKENS_CLASS}`}
      style={{ height: "100vh", overflow: "hidden", position: "relative" }}
      data-nx-document={documentShape(editor.document)}
    >
      <div ref={setOverlayHost} />
      <PortalProvider container={overlayHost}>
        {width === 0 ? null : (
          <CanvasFrame
            width={width ?? 0}
            height={height ?? 0}
            zoom={ACTUAL_SIZE}
            title="Picker harness"
          >
            <Canvas
              document={editor.document}
              siteStyles={NO_BREAKPOINTS}
              render={{ styleContext: NO_BREAKPOINTS }}
              selectedId={editor.selectedId}
              selectedIds={editor.selection.ids}
              onSelect={editor.select}
            />
          </CanvasFrame>
        )}
        <CornerPluses picker={picker} />
        <InsertPicker
          request={picker.request}
          onClose={picker.close}
          editor={editor}
          onBrowseAll={browseAll}
        />
        {carried === null ? null : (
          <AddPanel editor={editor} place={carried.place} />
        )}
      </PortalProvider>
    </div>
  );
}

/** A stand-in "+" at each corner of the window, opening the picker on the gap. */
function CornerPluses({ picker }: { picker: InsertPickerState }) {
  return CORNERS.map(corner => (
    <button
      key={corner.name}
      type="button"
      aria-label={`Add a block between Hero and Pricing (${corner.name})`}
      style={{ position: "fixed", width: 24, height: 24, ...corner.style }}
      onClick={event =>
        picker.open(BETWEEN, elementAnchor(event.currentTarget))
      }
    >
      +
    </button>
  ));
}

/**
 * The Add panel "Browse all" opened, with the place it was handed while its
 * block stays selected, as the editor holds it.
 */
function AddPanel({
  editor,
  place,
}: {
  editor: ReturnType<typeof useEditorState>;
  place: InsertPlace | undefined;
}) {
  const held =
    place !== undefined && placeBlock(place) === editor.selectedId
      ? place
      : undefined;
  return (
    <aside
      aria-label="Add panel"
      style={{
        position: "fixed",
        top: 48,
        left: 48,
        width: 300,
        bottom: 48,
        overflow: "auto",
        background: "var(--nx-background)",
      }}
    >
      <InsertPanel editor={editor} {...held} summoned={1} />
    </aside>
  );
}
