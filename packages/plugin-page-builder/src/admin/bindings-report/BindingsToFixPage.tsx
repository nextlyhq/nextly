"use client";

/**
 * The "Bindings to fix" page: every binding on the site that no longer fits
 * what it reads, for the people who edit pages, each with a way into the
 * editor at its block.
 *
 * A schema change (a field renamed, a Single's field removed, a block's prop
 * retyped) leaves a binding stored and showing its fallback rather than
 * breaking the page; this is where an author finds them. One row per binding:
 * the document, the block and prop, what it reads, what changed, and what a
 * visitor sees meanwhile. The places (pages, components, patterns, layouts,
 * other entries, Singles) filter it through the admin's own tabs, each with
 * its count, which stays whatever tab is open.
 *
 * Laid out as the admin's own pages are: its breadcrumb and heading, its page
 * padding, and its table on a card. The count comes from the stored report,
 * with when every document was last checked; while a check runs, the last
 * result shows with "Checking…" beside it, never a spinner in its place.
 *
 * @module admin/bindings-report/BindingsToFixPage
 */
import { Button, navigateTo } from "@nextlyhq/plugin-sdk/admin";
import { Tabs, TabsList, TabsTrigger } from "@nextlyhq/ui";
import { AlertTriangle, ArrowRight, ChevronRight } from "lucide-react";
import { useState, type JSX } from "react";

import type {
  BindingsToFixItem,
  BindingsToFixRow,
} from "../../bindings-report/contract";
import { navigateWithin } from "../plain-click";

import { checkedWords } from "./checked-words";
import { editorAddressOf, useBindingsToFix } from "./client";
import { boundTo, visitorsSee, whatChanged, whereBound } from "./words";

/** The places a document lives, as the tabs name them, in tab order. */
const PLACES: readonly { readonly value: string; readonly label: string }[] = [
  { value: "pages", label: "Pages" },
  { value: "components", label: "Components" },
  { value: "patterns", label: "Patterns" },
  { value: "layouts", label: "Layouts" },
  { value: "entries", label: "Entries" },
  { value: "singles", label: "Singles" },
];

/** A document's place, as its chip names it. */
const PLACE_LABEL: Readonly<Record<string, string>> = {
  pages: "Page",
  components: "Component",
  patterns: "Pattern",
  layouts: "Layout",
  entries: "Entry",
  singles: "Single",
};

/** The page's breadcrumb, drawn as the admin draws its own. */
function Breadcrumb(): JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex items-center gap-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <a
            href="/admin"
            onClick={navigateWithin("/admin", navigateTo).onClick}
            className="hover:text-foreground hover:underline"
          >
            Dashboard
          </a>
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </li>
        <li className="flex items-center gap-2">
          <span>Page Builder</span>
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </li>
        <li>
          <span aria-current="page" className="font-medium text-foreground">
            Bindings to fix
          </span>
        </li>
      </ol>
    </nav>
  );
}

/** One binding's row. */
function BindingRow({
  item,
  row,
}: {
  item: BindingsToFixItem;
  row: BindingsToFixRow;
}): JSX.Element {
  const href = editorAddressOf(item, row);
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-3.5 align-top">
        <div className="font-medium text-foreground">{item.title}</div>
        <span className="mt-1.5 inline-block rounded-md border border-border px-2 py-px text-xs text-muted-foreground">
          {PLACE_LABEL[item.place] ?? item.place}
        </span>
      </td>
      <td className="px-4 py-3.5 align-top">
        <div className="text-foreground">
          {row.blockLabel === "" ? "Page metadata" : row.blockLabel}
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          {row.propLabel}
        </div>
      </td>
      <td className="px-4 py-3.5 align-top text-foreground">
        {boundTo(row, item.collectionLabel)}
      </td>
      <td className="px-4 py-3.5 align-top">
        <div className="flex items-start gap-2 text-foreground">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 flex-none text-warning"
          />
          <span>{whatChanged(row, item.collectionLabel)}</span>
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          Visitors see {visitorsSee(row)}
        </div>
      </td>
      <td className="px-4 py-3.5 text-right align-top">
        <Button asChild variant="outline" size="sm">
          <a
            href={href}
            onClick={navigateWithin(href, navigateTo).onClick}
            aria-label={`Open ${whereBound(row)} on ${item.title} in the editor`}
          >
            Open in editor
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </a>
        </Button>
      </td>
    </tr>
  );
}

/** The table of the bindings in one place, or every place. */
function BindingsTable({
  items,
}: {
  items: readonly BindingsToFixItem[];
}): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Bindings to fix</caption>
        <thead>
          <tr className="border-b border-border text-left">
            {["Document", "Block", "Bound to", "What changed"].map(heading => (
              <th
                key={heading}
                scope="col"
                className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-foreground"
              >
                {heading}
              </th>
            ))}
            <th scope="col" className="px-4 py-3">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.flatMap(item =>
            item.rows.map((row, index) => (
              <BindingRow
                key={`${item.documentKey}:${row.blocksField ?? ""}:${row.locale ?? ""}:${row.nodeId}:${row.prop}:${String(index)}`}
                item={item}
                row={row}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** What the page shows when nothing is broken. */
function AllFit(): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
      <p className="text-base font-medium text-foreground">
        Every binding fits its field.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        When a field, a Single or a block changes so a binding no longer fits,
        it shows up here.
      </p>
    </div>
  );
}

/** The page. */
export function BindingsToFixPage(): JSX.Element {
  const report = useBindingsToFix();
  const [place, setPlace] = useState("all");
  const items = report.data?.items ?? [];
  const meta = report.data?.meta;
  const shown =
    place === "all" ? items : items.filter(item => item.place === place);
  const places = PLACES.filter(entry => (meta?.byPlace[entry.value] ?? 0) > 0);
  return (
    <div className="min-h-[calc(100vh-4rem)] w-full max-w-full px-4 py-6 @sm/content:px-6 @sm/content:py-8 @2xl/content:px-8">
      <Breadcrumb />
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Bindings to fix
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A field, a Single or a block changed after these were bound, so
            each one shows its fallback on the published page. Open one to bind
            it to another field or unbind it.
          </p>
        </div>
        {meta === undefined ? null : (
          <p
            className="whitespace-nowrap text-sm text-muted-foreground"
            aria-live="polite"
          >
            {checkedWords(meta)}
          </p>
        )}
      </div>
      {report.pending && report.data === undefined ? (
        <div
          aria-busy="true"
          className="h-48 animate-pulse rounded-lg border border-border bg-card"
        />
      ) : report.error !== undefined && report.error !== null ? (
        <div
          role="alert"
          className="rounded-lg border border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground"
        >
          The report could not be read. Reload the page to try again.
        </div>
      ) : items.length === 0 ? (
        <AllFit />
      ) : (
        <>
          <Tabs value={place} onValueChange={setPlace} className="mb-4">
            <TabsList aria-label="Show bindings in">
              <TabsTrigger value="all">
                All
                <span className="ml-1.5 text-muted-foreground">
                  {meta?.bindings ?? 0}
                </span>
              </TabsTrigger>
              {places.map(entry => (
                <TabsTrigger key={entry.value} value={entry.value}>
                  {entry.label}
                  <span className="ml-1.5 text-muted-foreground">
                    {meta?.byPlace[entry.value] ?? 0}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <BindingsTable items={shown} />
        </>
      )}
    </div>
  );
}
