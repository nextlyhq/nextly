"use client";

/**
 * The editor's notice of the open document's broken bindings: a quiet chip
 * beside the page's status, "2 bindings to fix", that opens a list of them,
 * each with Select, which selects its block, opens Layers on it and brings it
 * into view.
 *
 * Read from the stored report, as the page and the dashboard card are, so the
 * editor says what they say. Drawn only when the document has one: a page
 * whose bindings all fit shows nothing here.
 *
 * @module admin/bindings-report/BindingsToFixChip
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { revealNode, type LeftPanel } from "@nextlyhq/builder";
import type { EditorState } from "@nextlyhq/builder/shell";
import { navigateTo, useDocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import { Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import { AlertTriangle, ArrowRight, MousePointer2 } from "lucide-react";
import { useState, type JSX } from "react";

import { documentKeyOf } from "../../host-rewrite/contract";
import { navigateWithin } from "../plain-click";

import { BINDINGS_TO_FIX_PAGE_HREF } from "./BindingsToFixCard";
import { useBindingsToFix } from "./client";
import { visitorsSee, whatChanged, whereBound } from "./words";

/** What the chip needs of the editor. */
export interface BindingsToFixChipProps {
  readonly editor: {
    readonly document: Pick<BlockDocument, "nodes">;
    readonly select: EditorState["select"];
  };
  /** The blocks field the editor is open on; rows of another field are left out. */
  readonly field: string;
  readonly canvas: HTMLElement | null;
  readonly requestPanel: (panel: LeftPanel) => void;
}

/** The open document's key in the report, or `undefined` before it is saved. */
function useDocumentKey(): string | undefined {
  const identity = useDocumentIdentity();
  if (identity === null || identity === undefined) return undefined;
  if (identity.kind === "single") {
    return documentKeyOf({ kind: "single", slug: identity.slug });
  }
  return identity.documentId === undefined
    ? undefined
    : documentKeyOf({
        kind: "collection",
        slug: identity.slug,
        id: identity.documentId,
      });
}

/** The chip, and the list it opens; nothing when the document has none. */
export function BindingsToFixChip({
  editor,
  field,
  canvas,
  requestPanel,
}: BindingsToFixChipProps): JSX.Element | null {
  const key = useDocumentKey();
  const report = useBindingsToFix(key);
  const [open, setOpen] = useState(false);
  if (key === undefined) return null;
  const item = report.data?.items.find(entry => entry.documentKey === key);
  const rows = (item?.rows ?? []).filter(
    row => row.blocksField === undefined || row.blocksField === field
  );
  if (item === undefined || rows.length === 0) return null;
  const elsewhere = (report.data?.meta.bindings ?? rows.length) - rows.length;
  const select = (nodeId: string): void => {
    setOpen(false);
    editor.select(nodeId);
    requestPanel("layers");
    if (canvas !== null) revealNode(canvas, nodeId);
  };
  const label = `${String(rows.length)} ${rows.length === 1 ? "binding" : "bindings"} to fix`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="nx-pb-bindings-chip">
          <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[400px] p-0"
        aria-label="Bindings to fix on this page"
      >
        <div className="px-4 pb-2.5 pt-3.5">
          <h2 className="text-sm font-semibold text-foreground">
            {rows.length === 1
              ? "1 binding no longer fits"
              : `${String(rows.length)} bindings no longer fit`}
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            Visitors see each one’s fallback until you bind it again or unbind
            it.
          </p>
        </div>
        <ul>
          {rows.map((row, index) => (
            <li
              key={`${row.nodeId}:${row.prop}:${String(index)}`}
              className="flex items-center gap-3 border-t border-border px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">
                  {whereBound(row)}
                </div>
                <div className="text-[13px] leading-snug text-muted-foreground">
                  {whatChanged(row, item.collectionLabel)}. Visitors see{" "}
                  {visitorsSee(row)}.
                </div>
              </div>
              {row.nodeId === "" ? null : (
                <button
                  type="button"
                  onClick={() => select(row.nodeId)}
                  aria-label={`Select ${whereBound(row)}`}
                  className="inline-flex h-8 flex-none items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[13px] font-medium text-foreground hover:bg-muted"
                >
                  <MousePointer2 aria-hidden="true" className="h-3.5 w-3.5" />
                  Select
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
          <span>
            {elsewhere > 0
              ? `${String(elsewhere)} more on other pages`
              : "None on other pages"}
          </span>
          <a
            href={BINDINGS_TO_FIX_PAGE_HREF}
            onClick={navigateWithin(BINDINGS_TO_FIX_PAGE_HREF, navigateTo).onClick}
            className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
          >
            All bindings to fix
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
