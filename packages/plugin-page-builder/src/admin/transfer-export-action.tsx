"use client";

/**
 * "Export" on each row of the Components, Patterns and Layouts lists: the
 * row's item as one file, with everything it depends on, downloaded at once.
 *
 * A row action, as WordPress offers "Export as JSON" on its Patterns list:
 * exporting is something done to one item, and the list is where an author
 * finds the item. The file is the export route's own answer, saved as is,
 * so what the browser saves is exactly what an API client would.
 *
 * @module admin/transfer-export-action
 */
import {
  registerRowAction,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { toast } from "@nextlyhq/ui";
import { Download } from "lucide-react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  exportPath,
  transferFileName,
  TRANSFER_FORMAT,
  TRANSFER_KIND_PATHS,
  TRANSFER_KINDS,
  type TransferFile,
  type TransferKind,
} from "../transfer/transfer-contract";

import { refusalMessage } from "./save-pattern-client";

/** The row action's id, the same on all three lists. */
const EXPORT_ROW_ACTION_ID = "page-builder-export";

const UNEXPLAINED = "The file could not be made. Try again.";

/** Whether the actions are registered, so a second load adds no second copy. */
let registered = false;

/**
 * Offer "Export" on the three lists. The lists are the plugin's own
 * collections under their own names; a host that renamed one gets no action
 * on it, since the list is keyed by the name the browser sees.
 */
export function registerExportActions(): void {
  if (registered) return;
  registered = true;
  for (const kind of TRANSFER_KINDS) {
    registerRowAction<Record<string, unknown>>(TRANSFER_KIND_PATHS[kind], {
      id: EXPORT_ROW_ACTION_ID,
      label: "Export",
      icon: <Download className="h-4 w-4" aria-hidden="true" />,
      isVisible: row => rowId(row) !== undefined,
      onSelect: row => {
        const id = rowId(row);
        if (id !== undefined) void exportRow(kind, id);
      },
    });
  }
}

/** Ask for the file and hand it to the browser, saying what went wrong if not. */
async function exportRow(kind: TransferKind, id: string): Promise<void> {
  try {
    const file = await writePluginRoute<TransferFile>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: exportPath(kind, id),
    });
    if (file?.format !== TRANSFER_FORMAT) throw new Error(UNEXPLAINED);
    download(file);
    toast.success(exportedMessage(file));
  } catch (error) {
    toast.error(
      error instanceof Error ? refusalMessage(error, UNEXPLAINED) : UNEXPLAINED
    );
  }
}

/** What the file carries beside the item, said once it is saved. */
function exportedMessage(file: TransferFile): string {
  const parts = [
    counted(
      file.components.length - (file.root.kind === "component" ? 1 : 0),
      "component"
    ),
    counted(file.classes.length, "shared style"),
    counted(file.tokens.length, "variable"),
    counted(file.media.length, "media file"),
  ].filter(part => part !== "");
  return parts.length === 0
    ? "Exported."
    : `Exported, with ${parts.join(", ")}.`;
}

function counted(n: number, noun: string): string {
  if (n <= 0) return "";
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

function rowId(row: Record<string, unknown>): string | undefined {
  const id = row.id;
  if (typeof id === "string" && id !== "") return id;
  if (typeof id === "number") return String(id);
  return undefined;
}

/**
 * Save the file. Revoked on a later task, because the download the click
 * starts is asynchronous and revoking now can cancel it.
 */
function download(file: TransferFile): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], { type: "application/json" })
  );
  const link = window.document.createElement("a");
  link.href = url;
  link.download = transferFileName(file);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
