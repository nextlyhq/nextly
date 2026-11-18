"use client";

/**
 * A page that shows two headers, or two footers: the notice above the canvas.
 *
 * The page's header & footer set draws a header around it, and the page has
 * a header block of its own too (a Section whose HTML tag is header, or a
 * placed component marked "Use as: Header"), so a visitor sees two. The
 * notice says so, naming the set, with the ways on: select the page's own
 * header, change the page's choice in Page settings, or dismiss it. The same
 * for footers. It never changes the page or its choice.
 *
 * A dismissal is the author's own, for this page: kept in their preference
 * store under the page, the set and which blocks were found, so it comes
 * back when the page's choice or its header block changes.
 *
 * @module admin/editor/two-regions-notice
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import type { PreferenceStore } from "@nextlyhq/builder";
import type { EditorState } from "@nextlyhq/builder/shell";
import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { LayoutArea } from "../../collections/areas";
import {
  doubledRegions,
  doubledRegionsKey,
  type DoubledRegion,
} from "../../doubled-regions";

import { twoRegionsStoreFor } from "./editor-preference-stores";

/** What the notice needs to know of a region the page's set draws. */
export interface DrawnRegionFacts {
  readonly area: LayoutArea;
  /** The header & footer set the region comes from, by id. */
  readonly setId: string;
  /** That set's title, which the notice names. */
  readonly setTitle: string;
}

/** What the notices are drawn from. */
export interface TwoRegionsNoticesProps {
  /** The page's own blocks, as the editor holds them now. */
  readonly nodes: readonly BlockNode[];
  /** The regions the page's set draws around it. */
  readonly cards: readonly DrawnRegionFacts[];
  /** A component's "Use as" area, or undefined where it has none. */
  readonly componentArea: (componentId: string) => LayoutArea | undefined;
  /** The page being edited; no notice where the document is not a page. */
  readonly pageId: string | null;
  /** Where this author's dismissals are kept; none keeps nothing. */
  readonly store: PreferenceStore | undefined;
  /** Selects one of the page's blocks on the canvas. */
  readonly onSelect: (nodeId: string) => void;
  /** Opens Page settings at the header & footer choice. */
  readonly onOpenSettings: () => void;
}

/** How many dismissals one author keeps, the most recent first. */
const KEPT_DISMISSALS = 100;

/**
 * The notices for the page the editor has open, for the canvas strip: none
 * while the document is not a saved page.
 */
export function useTwoRegionsNotice({
  editor,
  applied,
  regionCards,
  areaOf,
  currentPage,
  userId,
  openSettings,
}: {
  readonly editor: Pick<EditorState, "document" | "select">;
  /** The page with its conditions applied, while "Preview as visitor" is on. */
  readonly applied: { readonly document: BlockDocument } | undefined;
  readonly regionCards: readonly DrawnRegionFacts[];
  readonly areaOf: (componentId: string) => LayoutArea | undefined;
  /** The page being edited, or null for any other document. */
  readonly currentPage: { readonly id: string } | null;
  readonly userId: string | null;
  /** Opens Page settings, as the region card's link does. */
  readonly openSettings: () => void;
}): React.JSX.Element | undefined {
  const store = useMemo(() => twoRegionsStoreFor(userId), [userId]);
  const { select } = editor;
  const onSelect = useCallback((nodeId: string) => select(nodeId), [select]);
  const onOpenSettings = useCallback(() => {
    openSettings();
    focusHeaderFooterMenu();
  }, [openSettings]);
  return useTwoRegionsNotices({
    nodes: pageAsDrawn(editor.document, applied),
    cards: regionCards,
    componentArea: areaOf,
    pageId: currentPage?.id ?? null,
    store,
    onSelect,
    onOpenSettings,
  });
}

/**
 * The page's blocks as the canvas draws them: with "Preview as visitor" on,
 * the page its conditions were applied to, where a hidden block is a marker,
 * so a header no visitor sees here is not counted; else the page as edited.
 */
export function pageAsDrawn(
  edited: BlockDocument,
  applied: { readonly document: BlockDocument } | undefined
): readonly BlockNode[] {
  return (applied?.document ?? edited).nodes;
}

/** The notices as a component, drawing nothing where none shows. */
export function TwoRegionsNotices(
  props: TwoRegionsNoticesProps
): React.JSX.Element | null {
  return useTwoRegionsNotices(props) ?? null;
}

/**
 * One notice per area the page shows twice, header first; none while it
 * shows each once, or while each one shown twice is dismissed. Undefined
 * rather than an empty element, so the canvas strip is not drawn at all.
 */
function useTwoRegionsNotices({
  nodes,
  cards,
  componentArea,
  pageId,
  store,
  onSelect,
  onOpenSettings,
}: TwoRegionsNoticesProps): React.JSX.Element | undefined {
  const [dismissed, setDismissed] = useState<readonly string[]>(() =>
    readDismissed(store)
  );
  // Another author's store, once they are known, holds their own.
  useEffect(() => setDismissed(readDismissed(store)), [store]);

  const shown = useMemo(() => {
    if (pageId === null) return [];
    const sets = new Map(cards.map(card => [card.area, card]));
    const found = doubledRegions(nodes, {
      shown: new Set(sets.keys()),
      componentArea,
    });
    return found.flatMap(region => {
      const set = sets.get(region.area);
      if (set === undefined) return [];
      const key = doubledRegionsKey(pageId, set.setId, region);
      return dismissed.includes(key) ? [] : [{ region, set, key }];
    });
  }, [nodes, cards, componentArea, pageId, dismissed]);

  if (shown.length === 0) return undefined;
  const dismiss = (key: string) => {
    const next = [key, ...dismissed.filter(kept => kept !== key)].slice(
      0,
      KEPT_DISMISSALS
    );
    setDismissed(next);
    store?.write(JSON.stringify(next));
  };
  return (
    <>
      {shown.map(({ region, set, key }) => (
        <TwoRegionsNotice
          key={region.area}
          region={region}
          setTitle={set.setTitle}
          onSelect={() => {
            const first = region.nodeIds[0];
            if (first !== undefined) onSelect(first);
          }}
          onOpenSettings={onOpenSettings}
          onDismiss={() => dismiss(key)}
        />
      ))}
    </>
  );
}

/** What the notice says for an area shown twice. */
function twoRegionsWords(area: LayoutArea, setTitle: string): string {
  return `This page shows two ${area}s: the site ${area} (${setTitle}) and a ${area} block on the page.`;
}

/**
 * One area's notice. What it says is a live region, drawn empty first and
 * filled once it is on the page, so a screen reader announces it.
 */
function TwoRegionsNotice({
  region,
  setTitle,
  onSelect,
  onOpenSettings,
  onDismiss,
}: {
  readonly region: DoubledRegion;
  readonly setTitle: string;
  readonly onSelect: () => void;
  readonly onOpenSettings: () => void;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const said = twoRegionsWords(region.area, setTitle);
  const [announced, setAnnounced] = useState("");
  useEffect(() => setAnnounced(said), [said]);
  return (
    <div className="nx-preview-strip" data-two-regions={region.area}>
      <span className="nx-preview-strip__mode">
        <TriangleAlert aria-hidden="true" size={14} />
      </span>
      <span className="nx-preview-strip__count" role="status" title={said}>
        {announced}
      </span>
      {/* Together at the row's far end, in the order they are read. */}
      <span className="ms-auto inline-flex items-center gap-1.5">
        <button
          type="button"
          className="nx-preview-strip__stop"
          onClick={onSelect}
        >
          {`Select the page's ${region.area}`}
        </button>
        <button
          type="button"
          className="nx-preview-strip__stop"
          onClick={onOpenSettings}
        >
          Change in Page settings
        </button>
        <button
          type="button"
          className="nx-preview-strip__stop"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}

/** How many frames the menu is waited for while Page settings opens. */
const MENU_WAIT_FRAMES = 30;

/**
 * Put focus on the header & footer menu in Page settings once the dialog
 * draws it, so "Change in Page settings" lands on the choice itself. Gives
 * up quietly if it never appears: Page settings is open either way.
 */
function focusHeaderFooterMenu(frames = MENU_WAIT_FRAMES): void {
  requestAnimationFrame(() => {
    const menu = headerFooterMenu();
    if (menu !== null) menu.focus();
    else if (frames > 0) focusHeaderFooterMenu(frames - 1);
  });
}

/**
 * The menu in the open Page settings, found by its label as the author reads
 * it, "Header & footer", so it is the control that label names.
 */
function headerFooterMenu(): HTMLElement | null {
  const label = Array.from(
    document.querySelectorAll<HTMLLabelElement>('[role="dialog"] label')
  ).find(each => each.textContent.trim() === "Header & footer");
  return label === undefined || label.htmlFor === ""
    ? null
    : document.getElementById(label.htmlFor);
}

/**
 * The dismissals this author keeps, newest first. A store that keeps
 * nothing, or holds something that is not a list of keys, reads as none.
 */
function readDismissed(store: PreferenceStore | undefined): readonly string[] {
  const raw = store?.read() ?? null;
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}
