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
import { Button, Widget } from "@nextlyhq/plugin-sdk/admin";
import { AlertTriangle } from "lucide-react";
import type { JSX } from "react";

import {
  BINDINGS_TO_FIX_PAGE_HREF,
  type BindingsToFixItem,
  type BindingsToFixRow,
} from "../../bindings-report/contract";

import { checkedWords } from "./checked-words";
import { editorAddressOf, useBindingsToFix } from "./client";
import { whatChanged, whereBound } from "./words";

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
  if (report.data === undefined) {
    // The count came with the card; its rows are a read of their own, which
    // may still be on its way or may have failed. Never an empty list under
    // a count.
    return report.pending ? (
      <div aria-busy="true" className="flex flex-col gap-3 px-4 py-2">
        {[0, 1, 2].map(line => (
          <div key={line} className="h-10 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    ) : (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground"
      >
        The bindings to fix couldn’t be read.
        <Button variant="outline" size="sm" onClick={report.refetch}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <p className="px-4 pb-2 text-sm text-muted-foreground">
        A field or block changed after these were bound. Each shows its fallback
        until it’s fixed.
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
        action={({ item, row }) => {
          // None for a binding the builder can't open (another language).
          const href = editorAddressOf(item, row);
          return href === undefined ? undefined : { label: "Open", href };
        }}
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
