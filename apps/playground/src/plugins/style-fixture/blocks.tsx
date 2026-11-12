"use client";

/**
 * Plugin pages drawn the way a plugin author draws one, from the SDK's page
 * building blocks only: an overview with a checklist, a list page on the
 * admin's list surface, and a settings form in the settings row layout. Each
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
  Textarea,
  useTableColumns,
  type BadgeProps,
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

registerComponents({
  [BLOCK_PAGE_PATHS["blocks-overview"]]: BlocksOverviewPage,
  [BLOCK_PAGE_PATHS["blocks-list"]]: BlocksListPage,
  [BLOCK_PAGE_PATHS["blocks-settings"]]: BlocksSettingsPage,
});
