"use client";

/**
 * Plugin pages drawn the way a plugin author draws one, from the SDK's page
 * building blocks only: an overview with a checklist, a list page on the
 * admin's list surface, a settings form in the settings row layout, a list of
 * grouped rows that open to list their pages, and a flow of steps above a save
 * bar saying what changed. Each
 * sets its trail in the top bar with `Breadcrumbs`. The data is fixed, so the
 * visual check captures the same screen every run, and nothing here depends on
 * the admin's stylesheet scanning this file: only kit components and inline
 * layout are used.
 */
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checklist,
  ChecklistItem,
  FieldShell,
  FormActions,
  FormSection,
  Input,
  ListView,
  PageFrame,
  PageHeader,
  registerComponents,
  SegmentedChoice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRowGroup,
  Stepper,
  Textarea,
  useTableColumns,
  type BadgeProps,
  type DataTableGroup,
  type NextlyColumn,
} from "@nextlyhq/plugin-sdk/admin";
import { useMemo, useState } from "react";

import { BLOCK_PAGE_PATHS } from "./constants";

/** Where the fixture's pages live, for the trail's way back. */
const OVERVIEW_HREF = "/admin/plugins/style-fixture/blocks-overview";

/** The trail every fixture page sets in the top bar. */
function Trail({ page }: { page: string }) {
  return (
    <Breadcrumbs
      items={[
        { label: "Fixture blocks", href: OVERVIEW_HREF },
        { label: page },
      ]}
    />
  );
}

function BlocksOverviewPage() {
  return (
    <PageFrame type="list" data-testid="blocks-overview">
      <PageHeader
        title="Overview"
        description="A plugin overview drawn from the SDK's building blocks."
        breadcrumbs={<Trail page="Overview" />}
      />
      <Card>
        <CardHeader>
          {/* The bar is a picture, so the count is said beside the title. */}
          <CardTitle>Set up the fixture · 2 of 4 done</CardTitle>
        </CardHeader>
        <CardContent>
          <Checklist label="Fixture setup steps" done={2} total={4}>
            <ChecklistItem status="done" label="Name the site" hint="Done" />
            <ChecklistItem
              status="done"
              label="Choose title patterns"
              hint="Done"
            />
            <ChecklistItem
              status="open"
              label="Bring in values from the old fields"
              hint="Nothing imported yet"
              actions={
                <Button variant="outline" size="sm">
                  Import
                </Button>
              }
            />
            <ChecklistItem
              status="skipped"
              label="Connect a search console"
              hint="Skipped"
            />
          </Checklist>
        </CardContent>
      </Card>
    </PageFrame>
  );
}

interface FixturePage {
  id: string;
  name: string;
  path: string;
  title: string;
  status: "Good" | "Check" | "Hidden";
}

const PAGES: FixturePage[] = [
  {
    id: "home",
    name: "Home",
    path: "/",
    title: "Fixture | A content platform",
    status: "Good",
  },
  {
    id: "pricing",
    name: "Pricing",
    path: "/pricing",
    title: "Pricing | Fixture",
    status: "Check",
  },
  {
    id: "blog",
    name: "Blog",
    path: "/blog",
    title: "Blog | Fixture",
    status: "Good",
  },
  {
    id: "drafts",
    name: "Drafts",
    path: "/drafts",
    title: "Drafts | Fixture",
    status: "Hidden",
  },
];

const STATUS_VARIANT: Record<FixturePage["status"], BadgeProps["variant"]> = {
  Good: "success",
  Check: "warning",
  Hidden: "info",
};

/** The page's identifying column, which the columns menu never offers. */
const ALWAYS_VISIBLE = new Set(["name"]);

function BlocksListPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [mode, setMode] = useState("view");
  const allColumns = useMemo<NextlyColumn<FixturePage>[]>(
    () => [
      { name: "name", header: "Page" },
      { name: "path", header: "Address" },
      { name: "title", header: "Title in search" },
      {
        name: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
        ),
      },
    ],
    []
  );
  const { columns, columnsControl } = useTableColumns({
    storageKey: "style-fixture-blocks",
    columns: allColumns,
    alwaysVisible: ALWAYS_VISIBLE,
  });
  const rows = PAGES.filter(
    page =>
      (status === "all" || page.status === status) &&
      page.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageFrame type="list" data-testid="blocks-list">
      <PageHeader
        title="Pages"
        description="A plugin list drawn on the admin's own list surface."
        breadcrumbs={<Trail page="Pages" />}
        actions={
          <SegmentedChoice
            aria-label="Mode"
            options={[
              { value: "view", label: "View" },
              { value: "edit", label: "Edit titles" },
            ]}
            value={mode}
            onSelect={setMode}
          />
        }
      />
      <ListView<FixturePage>
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search pages",
        }}
        inlineFilters={
          <Select value={status} onValueChange={setStatus}>
            {/* A trigger fills its container by default, so an inline filter
                states its width; the toolbar row then keeps the filter and
                the columns menu beside the search. */}
            <SelectTrigger aria-label="Status" style={{ width: 160 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Status: All</SelectItem>
              <SelectItem value="Good">Good</SelectItem>
              <SelectItem value="Check">Check</SelectItem>
              <SelectItem value="Hidden">Hidden</SelectItem>
            </SelectContent>
          </Select>
        }
        hasActiveFilters={status !== "all"}
        columnsControl={columnsControl}
        columns={columns}
        rows={rows}
        getRowId={page => page.id}
        ariaLabel="Fixture pages"
        rowActions={() => [
          { id: "edit", label: "Edit", onSelect: () => {} },
          { id: "inspect", label: "Inspect", onSelect: () => {} },
        ]}
        empty={{ title: "No pages yet" }}
        emptyFiltered={{
          title: "No page matches",
          description: "Try another search or status.",
        }}
      />
    </PageFrame>
  );
}

function BlocksSettingsPage() {
  const [separator, setSeparator] = useState("|");
  const [dirty, setDirty] = useState(false);
  return (
    <PageFrame type="form" data-testid="blocks-settings">
      <PageHeader
        title="Settings"
        description="A plugin settings form in the admin's settings rows."
        breadcrumbs={<Trail page="Settings" />}
      />
      <FormSection label="General">
        <FieldShell
          layout="row"
          label="Site name"
          description="Ends titles and names the site to search engines."
        >
          <Input defaultValue="Fixture" onChange={() => setDirty(true)} />
        </FieldShell>
        <SettingsRowGroup
          label="Title separator"
          description="Between a page's title and the site name."
        >
          <SegmentedChoice
            aria-label="Title separator"
            size="bordered"
            options={["|", "-", "·", "/"].map(value => ({
              value,
              label: value,
            }))}
            value={separator}
            onSelect={next => {
              setSeparator(next);
              setDirty(true);
            }}
          />
        </SettingsRowGroup>
        <FieldShell
          layout="row"
          label="Default description"
          description="For a page with none of its own."
        >
          <Textarea
            defaultValue="A content platform for Next.js."
            onChange={() => setDirty(true)}
          />
        </FieldShell>
      </FormSection>
      <FormActions dirty={dirty}>
        <Button variant="outline" onClick={() => setDirty(false)}>
          Cancel
        </Button>
        <Button onClick={() => setDirty(false)}>Save changes</Button>
      </FormActions>
    </PageFrame>
  );
}

interface FixtureProblem {
  id: string;
  severity: "Error" | "Warning" | "Notice";
  title: string;
  why: string;
  where: string;
  action: string;
  pages: { id: string; name: string; path: string }[];
}

const PROBLEMS: FixtureProblem[] = [
  {
    id: "unserved",
    severity: "Error",
    title: "Redirects are saved but not served",
    why: "21 redirects exist, but the site's proxy does not call the fixture's.",
    where: "Whole site",
    action: "Copy a note for a developer",
    pages: [],
  },
  {
    id: "shared-description",
    severity: "Warning",
    title: "Pages share one description",
    why: "Search shows the same snippet for each, so neither stands out.",
    where: "Pages",
    action: "Edit these 2 pages",
    pages: [
      { id: "blog", name: "Blog", path: "/blog" },
      { id: "community", name: "Community", path: "/community" },
    ],
  },
  {
    id: "svg-image",
    severity: "Warning",
    title: "Share image in a format networks don't show",
    why: "An SVG; social networks need a JPEG or PNG.",
    where: "Pages",
    action: "Make a share image",
    pages: [{ id: "pricing", name: "Pricing", path: "/pricing" }],
  },
  {
    id: "long-title",
    severity: "Notice",
    title: "Title longer than search shows",
    why: "Saved and served as written; search cuts it at about 60 characters.",
    where: "Pages",
    action: "Review 4 pages",
    pages: [
      { id: "home", name: "Home", path: "/" },
      { id: "about", name: "About", path: "/about" },
      { id: "docs", name: "Docs", path: "/docs" },
      { id: "changelog", name: "Changelog", path: "/changelog" },
    ],
  },
];

const SEVERITY_VARIANT: Record<
  FixtureProblem["severity"],
  BadgeProps["variant"]
> = {
  Error: "destructive",
  Warning: "warning",
  Notice: "info",
};

/** What to fix first, then what is worth a look: the groups the rows fall in. */
const PROBLEM_GROUPS: DataTableGroup[] = [
  {
    id: "fix-first",
    title: "Fix first",
    description: "Search engines or visitors are affected now.",
    badge: <Badge variant="destructive">Error</Badge>,
  },
  {
    id: "worth-a-look",
    title: "Worth a look",
    description: "Served as written, but they could do better.",
    badge: <Badge variant="warning">Warning</Badge>,
    actions: (
      <Button variant="outline" size="sm">
        Check again
      </Button>
    ),
  },
];

const PROBLEM_COLUMNS: NextlyColumn<FixtureProblem>[] = [
  {
    name: "title",
    header: "Problem",
    cell: ({ row }) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <strong>{row.title}</strong>
        <span>{row.why}</span>
      </div>
    ),
  },
  {
    name: "severity",
    header: "Severity",
    cell: ({ row }) => (
      <Badge variant={SEVERITY_VARIANT[row.severity]}>{row.severity}</Badge>
    ),
  },
  { name: "where", header: "Where" },
  {
    name: "pages",
    header: "Pages",
    accessor: row => (row.pages.length > 0 ? row.pages.length : "—"),
  },
  {
    name: "action",
    header: "",
    cell: ({ row }) => (
      <Button variant="link" size="sm">
        {row.action}
      </Button>
    ),
  },
];

function BlocksGroupsPage() {
  return (
    <PageFrame type="list" data-testid="blocks-groups">
      <PageHeader
        title="Problems"
        description="Rows grouped by what to fix, each opening to list its pages."
        breadcrumbs={<Trail page="Problems" />}
      />
      <ListView<FixtureProblem>
        columns={PROBLEM_COLUMNS}
        rows={PROBLEMS}
        getRowId={problem => problem.id}
        ariaLabel="Fixture problems"
        grouping={{
          groups: PROBLEM_GROUPS,
          groupOf: problem =>
            problem.severity === "Error" ? "fix-first" : "worth-a-look",
          collapsible: true,
        }}
        rowDetail={{
          hasDetail: problem => problem.pages.length > 0,
          defaultExpandedIds: ["shared-description"],
          toggleLabel: problem => `Pages with: ${problem.title}`,
          render: problem => (
            <ul
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                margin: 0,
                padding: 0,
                listStyle: "none",
              }}
            >
              {problem.pages.map(page => (
                <li key={page.id} style={{ display: "flex", gap: 10 }}>
                  <span>{page.name}</span>
                  <code>{page.path}</code>
                </li>
              ))}
            </ul>
          ),
        }}
        empty={{ title: "No problems found" }}
      />
    </PageFrame>
  );
}

/** The import flow's steps, the first two done and linking back. */
const IMPORT_STEPS = [
  {
    label: "Source: SEO (old) field group",
    href: "/admin/plugins/style-fixture/blocks-overview",
  },
  {
    label: "Fields matched",
    href: "/admin/plugins/style-fixture/blocks-settings",
  },
  { label: "Check the result" },
];

function BlocksStepsPage() {
  const [changed, setChanged] = useState(1);
  return (
    <PageFrame type="form" data-testid="blocks-steps">
      <PageHeader
        title="Import values"
        description="A flow of a few steps, and a save bar saying what changed."
        breadcrumbs={<Trail page="Import" />}
      />
      <Stepper aria-label="Import steps" steps={IMPORT_STEPS} current={2} />
      <Card>
        <CardContent>
          <Button variant="outline" onClick={() => setChanged(changed + 1)}>
            Change another page
          </Button>
        </CardContent>
      </Card>
      <FormActions
        dirty={changed > 0}
        message={changed === 1 ? "1 page changed" : `${changed} pages changed`}
      >
        <Button variant="outline" onClick={() => setChanged(0)}>
          Discard
        </Button>
        <Button onClick={() => setChanged(0)}>Save</Button>
      </FormActions>
    </PageFrame>
  );
}

registerComponents({
  [BLOCK_PAGE_PATHS["blocks-overview"]]: BlocksOverviewPage,
  [BLOCK_PAGE_PATHS["blocks-list"]]: BlocksListPage,
  [BLOCK_PAGE_PATHS["blocks-settings"]]: BlocksSettingsPage,
  [BLOCK_PAGE_PATHS["blocks-groups"]]: BlocksGroupsPage,
  [BLOCK_PAGE_PATHS["blocks-steps"]]: BlocksStepsPage,
});
