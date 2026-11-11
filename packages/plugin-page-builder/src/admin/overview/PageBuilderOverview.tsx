"use client";

/**
 * The Page Builder overview, the page its rail item opens: what needs fixing,
 * the four libraries pages are built from, and where the builder is used.
 *
 * Top to bottom:
 * - the bindings to fix, only while there are any, as a warning that leads to
 *   the "Bindings to fix" page; its number is the report's own count for the
 *   reader, read through the same request the dashboard card makes;
 * - the libraries the reader may read, each with its count and, for a reader
 *   who may create there, a New that opens its create page;
 * - the collections and Singles that have a Page Builder field, each opening
 *   its list or its edit page, or a line saying how to add one.
 *
 * The libraries and the uses come from the overview route, which reads them
 * as the reader; nothing here decides who may see what.
 *
 * @module admin/overview/PageBuilderOverview
 */
import {
  Button,
  Card,
  navigateTo,
  PageFrame,
  PageHeader,
  usePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { Alert, AlertDescription, Skeleton } from "@nextlyhq/ui";
import {
  AlertTriangle,
  Component,
  FileText,
  LayoutDashboard,
  LayoutTemplate,
  List,
  PanelsTopLeft,
  Plus,
  type LucideIcon,
} from "lucide-react";
import type { AnchorHTMLAttributes, JSX, ReactNode } from "react";

import { BINDINGS_TO_FIX_PAGE_HREF } from "../../bindings-report/contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import {
  OVERVIEW_ROUTE_PATH,
  type LibraryKind,
  type OverviewLibrary,
  type OverviewUse,
  type PageBuilderOverview as Overview,
} from "../../overview/contract";
import { useBindingsToFix } from "../bindings-report/client";
import {
  collectionListPath,
  entryCreatePath,
  singleEditPath,
} from "../editor/builder-address";
import { navigateWithin } from "../plain-click";

/** How each library is named, described and offered, and its icon. */
const LIBRARY_WORDS: Readonly<
  Record<
    LibraryKind,
    {
      readonly name: string;
      readonly about: string;
      readonly create: string;
      readonly icon: LucideIcon;
    }
  >
> = {
  patterns: {
    name: "Patterns",
    about: "Starting points an editor inserts, then changes freely",
    create: "New pattern",
    icon: LayoutTemplate,
  },
  components: {
    name: "Components",
    about: "Built once, placed on many pages; an edit updates them all",
    create: "New component",
    icon: Component,
  },
  layouts: {
    name: "Layouts",
    about: "Page frames: header, footer and the content area",
    create: "New layout",
    icon: PanelsTopLeft,
  },
  templates: {
    name: "Templates",
    about: "How a collection’s entries look as pages",
    create: "New template",
    icon: LayoutDashboard,
  },
};

/**
 * A link that moves within the admin on a plain click. Its other attributes
 * are passed on, so a `Button` drawn `asChild` styles it.
 */
function AdminLink({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly href: string;
}): JSX.Element {
  return (
    <a {...rest} href={href} onClick={navigateWithin(href, navigateTo).onClick}>
      {children}
    </a>
  );
}

/** "1 binding to fix." or "N bindings to fix." */
function bindingsSentence(count: number): string {
  return `${count} ${count === 1 ? "binding" : "bindings"} to fix.`;
}

/**
 * The warning that leads to the "Bindings to fix" page, or nothing: before
 * the report answers, when it cannot be read, and while there is nothing to
 * fix.
 */
function BindingsNotice(): JSX.Element | null {
  const report = useBindingsToFix();
  const count = report.data?.meta.bindings ?? 0;
  if (count === 0) return null;
  return (
    <Alert variant="warning" role="status" data-testid="overview-bindings">
      <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-3 @xl/content:flex-row @xl/content:items-center">
        <AlertDescription className="min-w-0 flex-1">
          <span className="font-semibold">{bindingsSentence(count)}</span> A
          field changed after these blocks were bound to it.
        </AlertDescription>
        <Button asChild variant="outline" size="sm" className="self-start">
          <AdminLink href={BINDINGS_TO_FIX_PAGE_HREF}>Review</AdminLink>
        </Button>
      </div>
    </Alert>
  );
}

/** A section of the page: its heading, a hint beside it, and its content. */
function Section({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {hint === undefined ? null : (
          <span className="text-sm text-muted-foreground">{hint}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** One library's card: its name, count, description and New. */
function LibraryCard({
  library,
}: {
  readonly library: OverviewLibrary;
}): JSX.Element {
  const words = LIBRARY_WORDS[library.kind];
  const Icon = words.icon;
  return (
    <Card
      data-testid={`overview-library-${library.kind}`}
      className="flex min-w-0 flex-col gap-3 p-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-muted-foreground"
        />
        <AdminLink
          href={collectionListPath(library.collection)}
          className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline"
        >
          {words.name}
        </AdminLink>
        {library.count === null ? null : (
          <span
            data-testid="overview-library-count"
            className="shrink-0 text-sm tabular-nums text-muted-foreground"
          >
            {library.count}
          </span>
        )}
      </div>
      <p className="flex-1 text-sm text-muted-foreground">{words.about}</p>
      {library.mayCreate ? (
        <Button asChild variant="outline" size="sm" className="self-start">
          <AdminLink href={entryCreatePath(library.collection)}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            {words.create}
          </AdminLink>
        </Button>
      ) : null}
    </Card>
  );
}

/** The grid the libraries' cards sit in: one column on a phone, up to four. */
const LIBRARY_GRID =
  "grid grid-cols-1 gap-4 @xl/content:grid-cols-2 @6xl/content:grid-cols-4";

/** The libraries the reader may read, or a line saying they may read none. */
function Libraries({
  libraries,
}: {
  readonly libraries: readonly OverviewLibrary[];
}): JSX.Element {
  if (libraries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        You can’t open any of the Page Builder’s libraries.
      </p>
    );
  }
  return (
    <div className={LIBRARY_GRID}>
      {libraries.map(library => (
        <LibraryCard key={library.kind} library={library} />
      ))}
    </div>
  );
}

/** Where a use opens: a collection's list, a Single's edit page. */
function useHref(use: OverviewUse): string {
  return use.kind === "collection"
    ? collectionListPath(use.slug)
    : singleEditPath(use.slug);
}

/** What a use's row says at its end: a collection's entries, or "Single". */
function useMeta(use: OverviewUse): string {
  if (use.kind === "single") return "Single";
  if (use.entries === undefined) return "Collection";
  return `${use.entries} ${use.entries === 1 ? "entry" : "entries"}`;
}

/** One collection or Single with a Page Builder field. */
function UseRow({ use }: { readonly use: OverviewUse }): JSX.Element {
  const Icon = use.kind === "collection" ? List : FileText;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <span className="flex min-w-0 flex-1 basis-48 items-center gap-2">
        <Icon
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-muted-foreground"
        />
        <AdminLink
          href={useHref(use)}
          className="min-w-0 truncate font-medium text-foreground hover:underline"
        >
          {use.label}
        </AdminLink>
      </span>
      <span className="min-w-0 truncate text-sm text-muted-foreground">
        {use.field} field
      </span>
      <span className="ml-auto shrink-0 text-sm tabular-nums text-muted-foreground">
        {useMeta(use)}
      </span>
    </li>
  );
}

/** The collections and Singles using the builder, or how to add the field. */
function Uses({
  uses,
}: {
  readonly uses: readonly OverviewUse[];
}): JSX.Element {
  if (uses.length === 0) {
    return (
      <Card data-testid="overview-uses-empty" className="p-6">
        <p className="text-sm font-medium text-foreground">
          No collection or Single has a Page Builder field yet.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a Blocks field to a collection or Single, in the Schema Builder or
          in code, and it’s listed here.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <ul className="divide-y divide-border">
        {uses.map(use => (
          <UseRow key={`${use.kind}:${use.slug}`} use={use} />
        ))}
      </ul>
    </Card>
  );
}

/** The libraries and uses while their read is on its way. */
function Loading(): JSX.Element {
  return (
    <div aria-busy="true" className={LIBRARY_GRID}>
      {[0, 1, 2, 3].map(card => (
        <Skeleton key={card} className="h-32 rounded-lg" />
      ))}
    </div>
  );
}

/** The libraries and uses when their read failed, with a way to ask again. */
function ReadFailed({ retry }: { readonly retry: () => void }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 text-sm text-muted-foreground"
    >
      The Page Builder’s libraries couldn’t be read.
      <Button variant="outline" size="sm" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

/** The libraries, then where the builder is used, once read. */
function OverviewSections({
  overview,
}: {
  readonly overview: Overview;
}): JSX.Element {
  return (
    <>
      <Section title="Library">
        <Libraries libraries={overview.libraries} />
      </Section>
      <Section title="Where it is used" hint="Fields that build pages visually">
        <Uses uses={overview.usedIn} />
      </Section>
    </>
  );
}

/** The page. */
export function PageBuilderOverview(): JSX.Element {
  const read = usePluginRoute<Overview>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: OVERVIEW_ROUTE_PATH,
    staleTime: 30_000,
  });
  let body: JSX.Element;
  if (read.data !== undefined) {
    body = <OverviewSections overview={read.data} />;
  } else if (read.pending) {
    body = <Loading />;
  } else {
    body = <ReadFailed retry={read.refetch} />;
  }
  return (
    <PageFrame type="list">
      <PageHeader
        title="Page Builder"
        description="Build pages visually from blocks. Everything editors reuse lives here."
      />
      <div className="flex min-w-0 flex-col gap-8">
        <BindingsNotice />
        {body}
      </div>
    </PageFrame>
  );
}
