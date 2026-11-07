"use client";

/**
 * The dashboard card "Bindings to fix": the documents whose bindings no
 * longer fit, the first few as rows, each leading into the editor at its
 * block, and a link to the whole report.
 *
 * Drawn in the dashboard's own card frame through the widget kit, so its
 * title, count, rows and footer are the dashboard's. The card's `load` counts
 * what the reader may see, which hides the card when it is nothing; the rows
 * are read here, through the report's route, as the reader may read them.
 *
 * @module admin/bindings-report/BindingsToFixCard
 */
import { Widget } from "@nextlyhq/plugin-sdk/admin";
import { AlertTriangle } from "lucide-react";
import type { JSX } from "react";

import type {
  BindingsToFixItem,
  BindingsToFixRow,
} from "../../bindings-report/contract";

import { checkedWords } from "./checked-words";
import { editorAddressOf, useBindingsToFix } from "./client";
import { whatChanged, whereBound } from "./words";

/** Where the whole report is. */
export const BINDINGS_TO_FIX_PAGE_HREF =
  "/admin/plugins/nextlyhq-plugin-page-builder/bindings-to-fix";

/** What the card's `load` answers: how many bindings the reader may see. */
export interface BindingsToFixCardData {
  readonly bindings: number;
}

/** A document's place, as a row names it. */
const PLACE_LABEL: Readonly<Record<string, string>> = {
  pages: "Page",
  components: "Component",
  patterns: "Pattern",
  layouts: "Layout",
  entries: "Entry",
  singles: "Single",
};

/** One row of the card: a binding, with the document it is in. */
interface CardRow {
  readonly item: BindingsToFixItem;
  readonly row: BindingsToFixRow;
}

/** The card. */
export function BindingsToFixCard({
  data,
}: {
  readonly data: BindingsToFixCardData;
}): JSX.Element {
  const report = useBindingsToFix();
  const rows: CardRow[] = (report.data?.items ?? []).flatMap(item =>
    item.rows.map(row => ({ item, row }))
  );
  Widget.useTitleCount(report.data?.meta.bindings ?? data.bindings);
  return (
    <div className="flex h-full flex-col">
      <p className="px-4 pb-2 text-sm text-muted-foreground">
        A field or block changed after these were bound. Each shows its
        fallback until it’s fixed.
      </p>
      <Widget.List
        rows={rows}
        title={({ item }) => item.title}
        meta={({ item, row }) => [
          PLACE_LABEL[item.place] ?? item.place,
          `${whereBound(row)}: ${whatChanged(row, item.collectionLabel)}`,
        ]}
        leading={() => (
          <AlertTriangle aria-hidden="true" className="h-4 w-4 text-warning" />
        )}
        action={({ item, row }) => ({
          label: "Open",
          href: editorAddressOf(item, row),
        })}
        total={{ count: report.data?.meta.bindings ?? data.bindings }}
        viewAllHref={BINDINGS_TO_FIX_PAGE_HREF}
      />
      {report.data === undefined ? null : (
        <p className="px-4 pt-2 text-xs text-muted-foreground">
          {checkedWords(report.data.meta)}
        </p>
      )}
    </div>
  );
}
