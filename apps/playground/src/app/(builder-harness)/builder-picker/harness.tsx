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
  type InsertPickerTarget,
  type InsertPlace,
} from "@nextlyhq/builder/shell";
import {
  BUILDER_CHROME_CLASS,
  BUILDER_TOKENS_CLASS,
} from "@nextlyhq/builder/shell-state";
import { PortalProvider } from "@nextlyhq/ui";
import { useEffect, useMemo, useRef, useState } from "react";

// The design system's sheet first, then the editor's, as the other harnesses.
import "@nextlyhq/ui/styles.css";
import "@nextlyhq/builder/styles.css";

import { useCoreBlocks } from "@/lib/use-core-blocks";

const HARNESS_SOURCE = "e2e-picker-harness";

/** The frame drawn at its own size, never fitted. */
const ACTUAL_SIZE = { kind: "fixed", scale: 1 } as const;

const HERO = "px-hero";
const PRICING = "px-pricing";

/** Hero and Pricing, two Sections with a gap between them. */
function pickerHarnessDocument(): BlockDocument {
  const section = (id: string, name: string, text: string) => ({
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
  });
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
  // The Add panel, opened by "Browse all", and the place it was handed.
  const [panelOpen, setPanelOpen] = useState(false);
  const [carried, setCarried] = useState<InsertPlace | null>(null);
  // A carried place lasts while its block is selected, as in the editor.
  const held =
    carried !== null && placeBlock(carried) === editor.selectedId
      ? carried
      : null;
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null
  );
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const read = (): void =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const browseAll = (target: InsertPickerTarget): void => {
    if (target.kind === "place") {
      const block = placeBlock(target.place);
      if (block !== null) editor.select(block);
      setCarried(target.place);
    }
    setPanelOpen(true);
  };
  return (
    <div
      ref={host}
      data-testid="picker-harness"
      className={`${BUILDER_CHROME_CLASS} ${BUILDER_TOKENS_CLASS}`}
      style={{ height: "100vh", overflow: "hidden", position: "relative" }}
      data-nx-selected={editor.selectedId ?? ""}
      data-nx-document={JSON.stringify(
        editor.document.nodes.map(node => ({
          type: node.type,
          children: (node.slots?.children ?? []).map(child => child.type),
        }))
      )}
    >
      <div ref={setOverlayHost} />
      <PortalProvider container={overlayHost}>
        {size === null ? null : (
          <CanvasFrame
            width={size.width}
            height={size.height}
            zoom={ACTUAL_SIZE}
            title="Picker harness"
          >
            <Canvas
              document={editor.document}
              siteStyles={{ breakpoints: { viewport: [], container: [] } }}
              render={{
                styleContext: { breakpoints: { viewport: [], container: [] } },
              }}
              selectedId={editor.selectedId}
              selectedIds={editor.selection.ids}
              onSelect={editor.select}
            />
          </CanvasFrame>
        )}
        {CORNERS.map(corner => (
          <button
            key={corner.name}
            type="button"
            aria-label={`Add a block between Hero and Pricing (${corner.name})`}
            style={{
              position: "fixed",
              width: 24,
              height: 24,
              ...corner.style,
            }}
            onClick={event =>
              picker.open(BETWEEN, elementAnchor(event.currentTarget))
            }
          >
            +
          </button>
        ))}
        <InsertPicker
          request={picker.request}
          onClose={picker.close}
          editor={editor}
          onBrowseAll={browseAll}
        />
        {panelOpen ? (
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
            <InsertPanel
              editor={editor}
              {...(held !== null && "after" in held
                ? { after: held.after }
                : {})}
              {...(held !== null && "inside" in held
                ? { inside: held.inside }
                : {})}
              summoned={1}
            />
          </aside>
        ) : null}
      </PortalProvider>
    </div>
  );
}
