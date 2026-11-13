/**
 * Import, reached from Pages: bring in SEO values a site already has, in
 * three steps on the admin's shared stepper. Choose the source (a field
 * group of this site's own, or a file another tool exported), match its
 * fields to the plugin's places, and check the result, a dry run worked out
 * by the plugin's one import engine, before anything is written. The import
 * is applied in full or not at all, and says which it was.
 *
 * The screen decides nothing about values: the engine's dry run says, per
 * page and per value, what is set, left automatic, kept or skipped, and the
 * screen counts and words that.
 *
 * @module admin/SeoImportPage
 */
import {
  Alert,
  AlertDescription,
  AlertTitle,
  apiErrorMessage,
  Badge,
  Button,
  isApiError,
  Card,
  Checkbox,
  DataTableView,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FileDropArea,
  PageFrame,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  Stepper,
  usePluginRoute,
  writePluginRoute,
  type NextlyColumn,
} from "@nextlyhq/plugin-sdk/admin";
import { CircleCheck } from "lucide-react";
import { useId, useRef, useState, type JSX, type ReactNode } from "react";

import { PAGES_PAGE_HREF } from "../code-pages/contract";
import {
  IMPORT_APPLY_PATH,
  IMPORT_DRY_RUN_PATH,
  IMPORT_GROUPS_PATH,
  IMPORT_TARGET_LABELS,
  IMPORT_TARGETS,
  type ApplyBody,
  type DryRunBody,
  type ImportGroup,
  type ImportGroupsBody,
  type ImportReportEntry,
  type ImportSource,
  type ImportTarget,
  type TypeWithOwnSeo,
} from "../import/contract";
import { SEO_PLUGIN_NAME } from "../settings/contract";

import { ChoiceCards } from "./choices";
import {
  counted,
  IMPORT_TOOLS,
  isTooLarge,
  nothingIn,
  parsedIn,
  readSummary,
  sourceOfFile,
  toolOf,
  tooLarge,
  tooMuch,
  tooMuchToSend,
  unreadable,
  wrongFile,
  type FileProblem,
  type ImportTool,
} from "./import-files";
import {
  firstOfPage,
  neverServedWords,
  otherChanges,
  reportCsv,
  reportedPages,
  resultOf,
  RESULT_WORDS,
  showsVersions,
  valueCounts,
  versionWords,
} from "./import-report";
import { entryHref } from "./pages-view";
import { AdminLink, PAGES_STEP, SeoTrail } from "./section";

/** What was chosen on the first step. */
type Choice =
  | { kind: "group"; field: string }
  | { kind: "file"; tool: ImportTool };

/** A file read for a tool: its text, and what the engine made of it. */
interface ReadFile {
  tool: ImportTool;
  name: string;
  text: string;
  source: Extract<ImportSource, { kind: "records" }>;
  run: DryRunBody;
}

/** Where the flow is: one of the three steps, or its end. */
type Step = 0 | 1 | 2 | "imported" | "stopped";

/** A dry run of `source`, as the engine works it out. */
async function dryRun(
  source: ImportSource,
  includeNeverServed: boolean
): Promise<DryRunBody> {
  const body = await writePluginRoute<DryRunBody>({
    plugin: SEO_PLUGIN_NAME,
    path: IMPORT_DRY_RUN_PATH,
    body: { source, ...(includeNeverServed ? { includeNeverServed } : {}) },
  });
  if (body === undefined) throw new Error("The dry run answered nothing.");
  return body;
}

/** Where a group's fields go: each as the engine suggests, until changed. */
function suggestedMap(group: ImportGroup): Record<string, ImportTarget> {
  return Object.fromEntries(
    group.fields.map(field => [field.name, field.suggested])
  );
}

/** The types a group is on, as a sentence names them: "Posts and 11 Singles". */
function typesText(group: ImportGroup): string {
  const singles = group.types.filter(type => type.slug.startsWith("single:"));
  const collections = group.types
    .filter(type => !type.slug.startsWith("single:"))
    .map(type => type.label);
  const parts = [
    ...collections,
    ...(singles.length === 0
      ? []
      : [
          singles.length === 1
            ? (singles[0]?.label ?? "1 Single")
            : `${singles.length} Singles`,
        ]),
  ];
  if (parts.length <= 1) return parts[0] ?? "no type";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

/** What a group's card says under its name. */
function groupDetail(group: ImportGroup): string {
  return `A field group on ${typesText(group)}. ${counted(group.withText, "page has", "pages have")} a title or description in it.`;
}

/** The name the steps give the source once chosen. */
function sourceName(
  choice: Choice | undefined,
  groups: readonly ImportGroup[]
): string {
  if (choice === undefined) return "";
  if (choice.kind === "file") return `${toolOf(choice.tool).title} file`;
  return groups.find(group => group.field === choice.field)?.label ?? "";
}

/**
 * The three steps, each named for where the flow is; a step already done
 * goes back to it.
 */
function stepsOf(
  step: number,
  name: string,
  back: ((to: 0 | 1) => void) | undefined
): { label: string; onSelect?: () => void }[] {
  const way = (to: 0 | 1) =>
    back === undefined ? {} : { onSelect: () => back(to) };
  return [
    {
      label: step === 0 ? "Choose the source" : `Source: ${name}`,
      ...way(0),
    },
    {
      label: step === 2 ? "Fields matched" : "Match the fields",
      ...way(1),
    },
    { label: "Check the result" },
  ];
}

/** What the header says on each step. */
function leadOf(step: Step, name: string): string {
  if (step === 1) {
    return `Each field in ${name} goes to one place in the plugin. We matched them by name; change any that's wrong.`;
  }
  if (step === 2) {
    return "Nothing is written until you import. Values already typed in the SEO tab are never replaced.";
  }
  return "Bring in titles and descriptions you already have. You'll see exactly what changes before anything is written.";
}

/** A heading over part of a step. */
function PartHeading({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <h2 id={id} className="text-sm font-semibold text-foreground">
      {children}
    </h2>
  );
}

/** The one notice a file that can't be used gets. */
function FileNotice({ problem }: { problem: FileProblem }): JSX.Element {
  return (
    <Alert variant="destructive">
      <div className="grid gap-0.5">
        <AlertTitle>{problem.title}</AlertTitle>
        <AlertDescription>{problem.text}</AlertDescription>
      </div>
    </Alert>
  );
}

/** A file once read: its name, what was read, and the way to another. */
function FileRead({
  file,
  again,
}: {
  file: ReadFile;
  again: () => void;
}): JSX.Element {
  return (
    <Card
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
    >
      <div className="grid min-w-0 gap-0.5">
        <strong className="truncate text-sm font-semibold text-foreground">
          {file.name}
        </strong>
        <span className="text-xs text-muted-foreground">
          {readSummary(file.tool, file.run)}
        </span>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={again}>
        Choose another file
      </Button>
    </Card>
  );
}

/** The drop area for one tool's file, its result once read, or why not. */
function FileStep({
  tool,
  file,
  reading,
  problem,
  onFile,
  again,
}: {
  tool: ImportTool;
  file: ReadFile | undefined;
  reading: boolean;
  problem: FileProblem | undefined;
  onFile: (file: File) => void;
  again: () => void;
}): JSX.Element {
  const words = toolOf(tool);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <PartHeading id={headingId}>{words.heading}</PartHeading>
      {file === undefined ? (
        <FileDropArea
          label="Choose the export file. Drag it here, or press Enter to browse."
          title={
            reading ? (
              "Reading the file…"
            ) : (
              <>
                Drag the file here, or{" "}
                <span className="text-primary underline underline-offset-2">
                  choose it
                </span>
              </>
            )
          }
          description={words.takes}
          accept={words.accept}
          disabled={reading}
          onFiles={files => {
            const [first] = files;
            if (first !== undefined) onFile(first);
          }}
        />
      ) : (
        <FileRead file={file} again={again} />
      )}
      {problem === undefined ? null : <FileNotice problem={problem} />}
    </section>
  );
}

/**
 * What importing a type's own `seo` field takes, as the dialog says it: the
 * plugin can't rename a field the site defines, so the person renames it,
 * and the import then reads it under its new name.
 */
function OwnSeoDialog({
  type,
  close,
}: {
  type: TypeWithOwnSeo;
  close: () => void;
}): JSX.Element {
  const where =
    type.definedIn === "code"
      ? "It is defined in the site's code, so Nextly can't replace it from here. Rename it in the code, for example to legacySeo, and deploy."
      : "Rename it in the Schema Builder, for example to legacySeo, and save the type.";
  return (
    <Dialog open onOpenChange={open => (open ? undefined : close())}>
      <DialogContent>
        {/* Room for the close button, so a long title wraps before it. */}
        <DialogHeader className="pr-6">
          <DialogTitle>{`Import the ${type.label}' own "seo" field`}</DialogTitle>
          <DialogDescription>
            {`${type.label} already have a field called "seo". ${where} Then import from that field here: its values move across, and the plugin's SEO group takes the seo name.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={close}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The site's types with a field of their own named `seo`, each with how to import it. */
function OwnSeoTypes({
  types,
}: {
  types: readonly TypeWithOwnSeo[];
}): JSX.Element | null {
  const [open, setOpen] = useState<TypeWithOwnSeo | undefined>(undefined);
  if (types.length === 0) return null;
  return (
    <>
      {types.map(type => (
        <Card
          key={type.slug}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <span className="text-sm text-foreground">
            {`${type.label} have a field of their own called "seo".`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(type)}
          >
            How to import it
          </Button>
        </Card>
      ))}
      {open === undefined ? null : (
        <OwnSeoDialog type={open} close={() => setOpen(undefined)} />
      )}
    </>
  );
}

/** The choice of another group than the first, as its card names it. */
const ANOTHER = "=another";

/** The cards for this site's groups: the first, then any other. */
function GroupCards({
  groups,
  choice,
  choose,
}: {
  groups: readonly ImportGroup[];
  choice: Choice | undefined;
  choose: (choice: Choice) => void;
}): JSX.Element | null {
  const [first, ...others] = groups;
  if (first === undefined) return null;
  const chosen = choice?.kind === "group" ? choice.field : undefined;
  const another = chosen !== undefined && chosen !== first.field;
  return (
    <>
      <ChoiceCards
        name="seo-import-group"
        label="From this site"
        value={chosen === undefined ? null : another ? ANOTHER : first.field}
        choices={[
          {
            value: first.field,
            title: first.label,
            detail: groupDetail(first),
          },
          ...(others.length === 0
            ? []
            : [
                {
                  value: ANOTHER,
                  title: "Another field group",
                  detail:
                    "Pick any group on your content types and match its fields.",
                },
              ]),
        ]}
        onChange={value =>
          choose({
            kind: "group",
            field: value === ANOTHER ? (others[0]?.field ?? "") : value,
          })
        }
      />
      {another ? (
        <Select
          value={chosen}
          onValueChange={field => choose({ kind: "group", field })}
        >
          <SelectTrigger className="w-72" aria-label="Field group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {others.map(group => (
              <SelectItem key={group.field} value={group.field}>
                {group.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </>
  );
}

/** "From this site": its field groups, or why there are none to offer. */
function SiteSources({
  groups,
  ownSeo,
  groupsFailed,
  choice,
  choose,
}: {
  groups: readonly ImportGroup[];
  ownSeo: readonly TypeWithOwnSeo[];
  groupsFailed: string | undefined;
  choice: Choice | undefined;
  choose: (choice: Choice) => void;
}): JSX.Element {
  const id = useId();
  let offered: ReactNode = (
    <GroupCards groups={groups} choice={choice} choose={choose} />
  );
  if (groupsFailed !== undefined) {
    offered = (
      <Alert variant="destructive">
        <AlertDescription>
          This site&apos;s field groups could not be read. {groupsFailed}
        </AlertDescription>
      </Alert>
    );
  } else if (groups.length === 0 && ownSeo.length === 0) {
    offered = (
      <p className="text-sm text-muted-foreground">
        No content type here holds a field group with SEO values.
      </p>
    );
  }
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <PartHeading id={id}>From this site</PartHeading>
      {offered}
      <OwnSeoTypes types={ownSeo} />
    </section>
  );
}

/** The first step: this site's field groups first, then a file. */
function SourceStep({
  groups,
  ownSeo,
  groupsFailed,
  choice,
  choose,
  file,
  reading,
  problem,
  onFile,
  again,
}: {
  groups: readonly ImportGroup[];
  ownSeo: readonly TypeWithOwnSeo[];
  groupsFailed: string | undefined;
  choice: Choice | undefined;
  choose: (choice: Choice) => void;
  file: ReadFile | undefined;
  reading: boolean;
  problem: FileProblem | undefined;
  onFile: (file: File) => void;
  again: () => void;
}): JSX.Element {
  const fileId = useId();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <SiteSources
        groups={groups}
        ownSeo={ownSeo}
        groupsFailed={groupsFailed}
        choice={choice}
        choose={choose}
      />
      <section aria-labelledby={fileId} className="grid gap-3">
        <PartHeading id={fileId}>From a file another tool exported</PartHeading>
        <ChoiceCards
          name="seo-import-file"
          label="From a file another tool exported"
          columns={3}
          value={choice?.kind === "file" ? choice.tool : null}
          choices={IMPORT_TOOLS.map(each => ({
            value: each.tool,
            title: each.title,
            detail: each.detail,
          }))}
          onChange={tool => choose({ kind: "file", tool })}
        />
      </section>
      {choice?.kind === "file" ? (
        <FileStep
          tool={choice.tool}
          file={file}
          reading={reading}
          problem={problem}
          onFile={onFile}
          again={again}
        />
      ) : null}
    </div>
  );
}

/** One field of a group, as the match table lists it. */
interface FieldRow {
  id: string;
  label: string;
  example: string;
  filled: number;
}

/** The second step for a group: where each of its fields goes. */
function MatchTable({
  group,
  map,
  setTarget,
}: {
  group: ImportGroup;
  map: Readonly<Record<string, ImportTarget>>;
  setTarget: (field: string, target: ImportTarget) => void;
}): JSX.Element {
  const columns: NextlyColumn<FieldRow>[] = [
    {
      name: "field",
      header: `Field in ${group.label}`,
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.label}</span>
      ),
    },
    {
      name: "example",
      header: "Example value",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.example}</span>
      ),
    },
    {
      name: "to",
      header: "Goes to",
      cell: ({ row }) => (
        <Select
          value={map[row.id] ?? "skip"}
          onValueChange={value => {
            const target = IMPORT_TARGETS.find(each => each === value);
            if (target !== undefined) setTarget(row.id, target);
          }}
        >
          <SelectTrigger
            className="w-56"
            aria-label={`Where ${row.label} goes`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IMPORT_TARGETS.map(target => (
              <SelectItem key={target} value={target}>
                {target === "skip"
                  ? "Don't import"
                  : IMPORT_TARGET_LABELS[target]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      name: "filled",
      header: "Pages with a value",
      cell: ({ row }) => row.filled.toLocaleString(),
    },
  ];
  return (
    <DataTableView<FieldRow>
      columns={columns}
      rows={group.fields.map(field => ({
        id: field.name,
        label: field.label,
        example: field.example ?? "",
        filled: field.filled,
      }))}
      getRowId={row => row.id}
    />
  );
}

/** One value a file holds, as the match table lists it for a file. */
interface FileLine {
  id: string;
  from: string;
  target: ImportTarget;
  pages: number;
}

/** The second step for a file: where its values go, as the engine reads it. */
function FileTable({ run }: { run: DryRunBody }): JSX.Element {
  const columns: NextlyColumn<FileLine>[] = [
    {
      name: "from",
      header: "Field in the file",
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.from}</span>
      ),
    },
    {
      name: "to",
      header: "Goes to",
      cell: ({ row }) => IMPORT_TARGET_LABELS[row.target],
    },
    {
      name: "pages",
      header: "Pages with a value",
      cell: ({ row }) => row.pages.toLocaleString(),
    },
  ];
  return (
    <DataTableView<FileLine>
      columns={columns}
      rows={run.lines.map(line => ({
        id: line.target,
        from: line.from.join(", "),
        target: line.target,
        pages: line.pages,
      }))}
      getRowId={row => row.id}
      emptyMessage="Nothing in the file goes to a page here."
    />
  );
}

/**
 * The values the import leaves out as never served, since each page's own
 * code sets them, with the choice to include them anyway.
 */
function NeverServedNote({
  run,
  sourceLabel,
  include,
  setInclude,
}: {
  run: DryRunBody | undefined;
  sourceLabel: string;
  include: boolean;
  setInclude: (include: boolean) => void;
}): JSX.Element | null {
  const id = useId();
  const words = neverServedWords(run, include, sourceLabel);
  if (words === undefined) return null;
  return (
    <Card className="flex flex-wrap items-start justify-between gap-4 bg-muted px-4 py-3">
      <div className="grid min-w-0 flex-1 gap-1">
        <strong className="text-sm font-semibold text-foreground">
          {words.title}
        </strong>
        <span className="text-[13px] text-muted-foreground">{words.text}</span>
      </div>
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <Checkbox
          id={id}
          checked={include}
          onCheckedChange={checked => setInclude(checked === true)}
        />
        Include anyway
      </label>
    </Card>
  );
}

/** A page's title or description in the report, with its result under it. */
function ValueCell({
  entry,
  place,
}: {
  entry: ImportReportEntry;
  place: "title" | "description";
}): JSX.Element {
  const result = resultOf(entry, place);
  const value = entry.values[place];
  return (
    <div className="flex items-start justify-between gap-3">
      {/* At most 13rem wide and two lines, so the table, which sizes its
          columns to their content, fits its card with every result in view;
          the whole value is the line's title. */}
      <span
        className="line-clamp-2 min-w-0 max-w-52 whitespace-normal text-muted-foreground [overflow-wrap:anywhere]"
        title={value ?? undefined}
      >
        {value ?? ""}
      </span>
      {result === "none" ? null : (
        <span className="grid shrink-0 justify-items-end gap-0.5 text-xs">
          <Badge variant={result === "set" ? "success" : "default"}>
            {RESULT_WORDS[result].label}
          </Badge>
          {RESULT_WORDS[result].why === undefined ? null : (
            <span className="text-muted-foreground">
              {RESULT_WORDS[result].why}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** The four counts of the dry run, in values. */
function Counts({ run }: { run: DryRunBody }): JSX.Element {
  const counts = valueCounts(run);
  const cards: { label: string; value: number; note: string }[] = [
    {
      label: "Will set",
      value: counts.set.values,
      note: `on ${counted(counts.set.pages, "page")}`,
    },
    {
      label: "Same as automatic",
      value: counts.same.values,
      note: "left empty, so the automatic value keeps working",
    },
    {
      label: "Kept as they are",
      value: counts.kept.values,
      note: "already typed in the SEO tab",
    },
    {
      label: "Skipped",
      value: counts.neverServed.values,
      note: `on ${counted(counts.neverServed.pages, "page")}, never served`,
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(card => (
        <Card key={card.label} className="px-4 py-3">
          <Stat label={card.label} value={counted(card.value, "value")} />
          <p className="mt-1 text-xs text-muted-foreground">{card.note}</p>
        </Card>
      ))}
    </div>
  );
}

/** A row's key: its page and its version. */
function rowKey(row: ImportReportEntry): string {
  return `${row.type ?? ""}|${row.id ?? row.label}|${row.locale ?? ""}|${row.version ?? ""}`;
}

/**
 * Where a reported page is edited, on its SEO tab; none for a record that
 * matched no page. Types are keyed by collection slug, or `single:<slug>`.
 */
function reportedPageHref(row: ImportReportEntry): string | undefined {
  if (row.type === undefined || row.id === undefined) return undefined;
  const single = row.type.startsWith("single:");
  return entryHref(
    {
      kind: single ? "single" : "collection",
      slug: single ? row.type.slice("single:".length) : row.type,
      id: row.id,
    },
    "seo"
  );
}

/**
 * A reported page's name, opening the page in a new tab so the dry run
 * stays here; a record that matched no page is its name alone. A page's
 * versions after its first are named for a screen reader only, the name
 * shown once on its first row.
 */
function ReportedPage({
  row,
  named,
}: {
  row: ImportReportEntry;
  named: boolean;
}): JSX.Element {
  const href = reportedPageHref(row);
  const others = otherChanges(row);
  return (
    <div className="grid gap-0.5">
      {!named ? (
        <span className="sr-only">{row.label}</span>
      ) : href === undefined ? (
        <span className="font-medium text-foreground">{row.label}</span>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground hover:underline"
        >
          {row.label}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
      {/* Its other places, which have no column: each with its result. */}
      {others.map(change => (
        <span
          key={change.place}
          className="whitespace-normal text-xs text-muted-foreground"
        >
          {`${change.label}: ${RESULT_WORDS[change.result].label}`}
        </span>
      ))}
    </div>
  );
}

/**
 * The last step: the dry run's counts and each page's result, one row per
 * version where a page is in several languages or has a draft, its name on
 * the first of them.
 */
function CheckStep({ run }: { run: DryRunBody }): JSX.Element {
  const rows = reportedPages(run);
  const versions = showsVersions(rows);
  const named = new Set(
    rows.filter((_row, at) => firstOfPage(rows, at)).map(rowKey)
  );
  const columns: NextlyColumn<ImportReportEntry>[] = [
    {
      name: "page",
      header: "Page",
      cell: ({ row }) => (
        <ReportedPage row={row} named={named.has(rowKey(row))} />
      ),
    },
    ...(versions
      ? [
          {
            name: "version",
            header: "Version",
            cell: ({ row }: { row: ImportReportEntry }) => (
              <span className="whitespace-nowrap text-foreground">
                {versionWords(row)}
              </span>
            ),
          },
        ]
      : []),
    {
      name: "title",
      header: "Title on Google",
      cell: ({ row }) => <ValueCell entry={row} place="title" />,
    },
    {
      name: "description",
      header: "Description on Google",
      cell: ({ row }) => <ValueCell entry={row} place="description" />,
    },
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Counts run={run} />
      <DataTableView<ImportReportEntry>
        columns={columns}
        rows={rows}
        getRowId={rowKey}
        emptyMessage="The source holds no title or description for a page here."
      />
      {run.warnings.length === 0 ? null : (
        <Alert variant="warning" role="status">
          <AlertDescription>
            <ul className="grid list-disc gap-1 pl-4">
              {run.warnings.map(warning => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** Saves the report of `run` as a CSV file. */
function downloadReport(run: DryRunBody): void {
  const url = URL.createObjectURL(
    new Blob([reportCsv(run)], { type: "text/csv;charset=utf-8" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "seo-import-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/** What an applied import says: what it set, and what it left. */
function Imported({ run }: { run: DryRunBody }): JSX.Element {
  const counts = valueCounts(run);
  const skipped = counts.neverServed;
  return (
    <Card className="grid gap-3 px-6 py-5" role="status">
      <h2 className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
        <CircleCheck className="size-6 text-success-text" aria-hidden="true" />
        {`${counted(counts.set.values, "value")} imported on ${counted(counts.set.pages, "page")}${run.redirects > 0 ? `, and ${counted(run.redirects, "redirect")} added` : ""}`}
      </h2>
      <p className="text-sm text-muted-foreground">
        {skipped.values > 0
          ? `${counted(skipped.values, "value")} skipped (never served on ${skipped.labels.join(", ")}). `
          : ""}
        The old fields are untouched, so nothing is lost.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <AdminLink href={PAGES_PAGE_HREF}>See the pages</AdminLink>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => downloadReport(run)}
        >
          Download the report
        </Button>
      </div>
    </Card>
  );
}

/** What a refused import says: that nothing was written, and why. */
function Stopped({
  why,
  confirmed,
  again,
}: {
  why: string;
  /**
   * Whether the server answered that it wrote nothing; false where no
   * answer arrived, so whether the import finished is not known.
   */
  confirmed: boolean;
  again: () => void;
}): JSX.Element {
  if (!confirmed) {
    return (
      <Alert variant="warning">
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <AlertTitle>The import&apos;s answer didn&apos;t arrive</AlertTitle>
            <AlertDescription>
              {`Nextly couldn't confirm whether it finished (${why.replace(/\.$/, "")}). Check again to see what is still to import: whatever was imported is already in place.`}
            </AlertDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={again}>
            Check again
          </Button>
        </div>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <AlertTitle>Nothing was imported</AlertTitle>
          <AlertDescription>
            {`The import stopped part-way (${why.replace(/\.$/, "")}), so every page was left exactly as it was. You can run it again safely.`}
          </AlertDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={again}>
          Try again
        </Button>
      </div>
    </Alert>
  );
}

/** The groups this site holds, as the first step offers them. */
function useGroups(): {
  groups: ImportGroup[];
  ownSeo: TypeWithOwnSeo[];
  language: string | undefined;
  failed: string | undefined;
} {
  const read = usePluginRoute<ImportGroupsBody>({
    plugin: SEO_PLUGIN_NAME,
    path: IMPORT_GROUPS_PATH,
    staleTime: 0,
  });
  return {
    groups: read.data?.groups ?? [],
    ownSeo: read.data?.ownSeo ?? [],
    language: read.data?.language,
    failed: read.error === null ? undefined : apiErrorMessage(read.error),
  };
}

/**
 * What the chosen source is: its group with the matching for it (each
 * field where the engine suggests until changed), or the file read for it.
 */
function selectionOf(
  choice: Choice | undefined,
  groups: readonly ImportGroup[],
  maps: Readonly<Record<string, Record<string, ImportTarget>>>,
  file: ReadFile | undefined
): {
  group: ImportGroup | undefined;
  map: Record<string, ImportTarget>;
  fileRead: ReadFile | undefined;
} {
  if (choice?.kind === "file") {
    return {
      group: undefined,
      map: {},
      fileRead: file?.tool === choice.tool ? file : undefined,
    };
  }
  const group =
    choice === undefined
      ? undefined
      : groups.find(each => each.field === choice.field);
  return {
    group,
    map: group === undefined ? {} : (maps[group.field] ?? suggestedMap(group)),
    fileRead: undefined,
  };
}

/**
 * Applies the dry run `run` worked out for `source`: nothing where it went
 * through, else why not, and whether the server said nothing was written.
 * Only an answer from the server says so: a request that got none may have
 * been applied before the answer was lost.
 */
async function applyRun(
  source: ImportSource,
  run: DryRunBody,
  include: boolean
): Promise<{ why: string; confirmed: boolean } | undefined> {
  try {
    await writePluginRoute<ApplyBody & { message: string }>({
      plugin: SEO_PLUGIN_NAME,
      path: IMPORT_APPLY_PATH,
      body: {
        source,
        plan: run.plan,
        ...(include ? { includeNeverServed: true } : {}),
      },
    });
    return undefined;
  } catch (error) {
    return { why: apiErrorMessage(error), confirmed: isApiError(error) };
  }
}

/** A file read for a tool, with what reading it found wrong, if anything. */
async function readFor(
  tool: ImportTool,
  chosen: File,
  language: string | undefined
): Promise<ReadFile | FileProblem> {
  if (isTooLarge(chosen)) return tooLarge(tool);
  try {
    const text = await chosen.text();
    const kind = sourceOfFile(tool, text);
    if (kind === undefined) return wrongFile(tool);
    // Read here, by the import's own readers, so only what the file holds
    // for each page is sent: an export is mostly page content, which a
    // request could not carry whole.
    const parsed = parsedIn(kind, text, language);
    if (!("records" in parsed)) return parsed;
    if (tooMuchToSend(parsed)) return tooMuch(tool);
    const source = {
      kind: "records" as const,
      tool: kind,
      fileName: chosen.name,
      parsed,
    };
    const run = await dryRun(source, false);
    if (run.held === 0 && run.redirects === 0) return nothingIn(tool);
    return { tool, name: chosen.name, text, source, run };
  } catch (error) {
    return unreadable(apiErrorMessage(error));
  }
}

/**
 * The latest dry run, whether one is on its way, and why the last failed:
 * an earlier one answering after a later was asked is dropped.
 */
function useDryRuns() {
  const [run, setRun] = useState<DryRunBody | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const latest = useRef(0);
  /** Works the import out again, keeping the answer only if still asked for. */
  const check = async (
    source: ImportSource | undefined,
    included: boolean
  ): Promise<void> => {
    if (source === undefined) return;
    const asked = ++latest.current;
    setBusy(true);
    setFailure(undefined);
    try {
      const body = await dryRun(source, included);
      if (asked === latest.current) setRun(body);
    } catch (error) {
      if (asked === latest.current) setFailure(apiErrorMessage(error));
    } finally {
      if (asked === latest.current) setBusy(false);
    }
  };
  return { run, setRun, busy, setBusy, failure, setFailure, check };
}

/**
 * Import's state and what it does: the source chosen, each group's
 * matching, the file read, whether never-served values are included, the
 * latest dry run, and the import itself. The engine decides; this keeps
 * what it last said.
 */
function useImportFlow() {
  const { groups, ownSeo, language, failed: groupsFailed } = useGroups();
  const [step, setStep] = useState<Step>(0);
  const [choice, setChoice] = useState<Choice | undefined>(undefined);
  const [maps, setMaps] = useState<
    Record<string, Record<string, ImportTarget>>
  >({});
  const [file, setFile] = useState<ReadFile | undefined>(undefined);
  const [fileProblem, setFileProblem] = useState<FileProblem | undefined>();
  const [include, setInclude] = useState(false);
  const { run, setRun, busy, setBusy, failure, setFailure, check } =
    useDryRuns();
  const [stopped, setStopped] = useState<{
    why: string;
    confirmed: boolean;
  }>({ why: "", confirmed: true });
  // The dry run an applied import wrote, kept for its result whatever the
  // flow does after.
  const [applied, setApplied] = useState<DryRunBody | undefined>(undefined);

  const { group, map, fileRead } = selectionOf(choice, groups, maps, file);

  const sourceOf = (
    groupMap: Record<string, ImportTarget> = map
  ): ImportSource | undefined => {
    if (group !== undefined) {
      return { kind: "group", field: group.field, map: groupMap };
    }
    return fileRead?.source;
  };

  const apply = async () => {
    const source = sourceOf();
    if (source === undefined || run === undefined) return;
    setBusy(true);
    setFailure(undefined);
    const outcome = await applyRun(source, run, include);
    setBusy(false);
    if (outcome === undefined) {
      setApplied(run);
      setStep("imported");
    } else {
      setStopped(outcome);
      setStep("stopped");
    }
  };

  return {
    groups,
    ownSeo,
    language,
    applied,
    groupsFailed,
    step,
    choice,
    group,
    map,
    file: fileRead,
    fileProblem,
    include,
    run,
    busy,
    failure,
    stopped,
    name: sourceName(choice, groups),
    ready: group !== undefined || fileRead !== undefined,
    /** Moves to `next`, the dry run worked out again for it. */
    goTo: (next: 0 | 1 | 2) => {
      setStep(next);
      if (next > 0) void check(sourceOf(), include);
    },
    choose: (next: Choice) => {
      setChoice(next);
      setFileProblem(undefined);
      setRun(undefined);
    },
    readFile: async (chosen: File) => {
      // A file is read in the site's own language, known once the groups
      // are read: until then the drop area takes nothing.
      if (choice?.kind !== "file" || language === undefined) return;
      setFileProblem(undefined);
      setBusy(true);
      const read = await readFor(choice.tool, chosen, language);
      setBusy(false);
      if ("source" in read) setFile(read);
      else setFileProblem(read);
    },
    forgetFile: () => {
      setFile(undefined);
      setFileProblem(undefined);
    },
    setTarget: (field: string, target: ImportTarget) => {
      if (group === undefined) return;
      const next = { ...map, [field]: target };
      setMaps(was => ({ ...was, [group.field]: next }));
      void check(sourceOf(next), include);
    },
    includeAnyway: (next: boolean) => {
      setInclude(next);
      void check(sourceOf(), next);
    },
    apply: () => void apply(),
  };
}

type ImportFlow = ReturnType<typeof useImportFlow>;

/** The second step: where each field goes, and values never served. */
function MatchStep({ flow }: { flow: ImportFlow }): JSX.Element {
  let matching: ReactNode = null;
  if (flow.group?.own === true) {
    // The plugin's own group, as an earlier version kept it: nothing to
    // match, since its fields are the plugin's own places.
    matching = (
      <p className="text-sm text-muted-foreground">
        Titles and descriptions typed the same as the automatic ones become
        automatic again, so a change to a pattern reaches them. Every other
        value stays as it is.
      </p>
    );
  } else if (flow.group !== undefined) {
    matching = (
      <MatchTable
        group={flow.group}
        map={flow.map}
        setTarget={flow.setTarget}
      />
    );
  } else if (flow.run !== undefined) {
    matching = <FileTable run={flow.run} />;
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {matching}
      <NeverServedNote
        run={flow.run}
        sourceLabel={flow.name}
        include={flow.include}
        setInclude={flow.includeAnyway}
      />
    </div>
  );
}

/** What the current step shows. */
function StepBody({ flow }: { flow: ImportFlow }): JSX.Element {
  if (flow.step === "imported" && flow.applied !== undefined) {
    return <Imported run={flow.applied} />;
  }
  if (flow.step === "stopped") {
    return (
      <Stopped
        why={flow.stopped.why}
        confirmed={flow.stopped.confirmed}
        again={() => flow.goTo(2)}
      />
    );
  }
  if (flow.step === 0) {
    return (
      <SourceStep
        groups={flow.groups}
        ownSeo={flow.ownSeo}
        groupsFailed={flow.groupsFailed}
        choice={flow.choice}
        choose={flow.choose}
        file={flow.file}
        reading={flow.busy || flow.language === undefined}
        problem={flow.fileProblem}
        onFile={chosen => void flow.readFile(chosen)}
        again={flow.forgetFile}
      />
    );
  }
  if (flow.step === 1) return <MatchStep flow={flow} />;
  return flow.run === undefined ? (
    <p className="text-sm text-muted-foreground" role="status">
      Working out what would change…
    </p>
  ) : (
    <CheckStep run={flow.run} />
  );
}

/** The import's screen, as the admin mounts it. */
export function SeoImportPage(): JSX.Element {
  const flow = useImportFlow();
  const current = typeof flow.step === "number" ? flow.step : 3;
  return (
    <PageFrame type="form">
      <PageHeader
        title="Import SEO values"
        description={leadOf(flow.step, flow.name)}
        breadcrumbs={<SeoTrail steps={[PAGES_STEP, { label: "Import" }]} />}
      />
      {/* One column no wider than the screen: a wide table scrolls inside
          its own frame rather than widening every step around it. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        {current < 3 ? (
          <Stepper
            aria-label="Steps"
            current={current}
            // No way back while a step's work is on its way, an import
            // being applied above all.
            steps={stepsOf(
              current,
              flow.name,
              flow.busy ? undefined : flow.goTo
            )}
          />
        ) : null}
        <StepBody flow={flow} />
        {flow.failure === undefined ? null : (
          <Alert variant="destructive">
            <AlertDescription>{flow.failure}</AlertDescription>
          </Alert>
        )}
        <Actions flow={flow} />
      </div>
    </PageFrame>
  );
}

/** What the import button says it imports: values, redirects, or both. */
function importLabel(values: number, redirects: number): string {
  if (redirects === 0) return `Import ${counted(values, "value")}`;
  if (values === 0) return `Import ${counted(redirects, "redirect")}`;
  return `Import ${counted(values, "value")} and ${counted(redirects, "redirect")}`;
}

/** The step's buttons: back and on, or none once the import is done. */
function Actions({ flow }: { flow: ImportFlow }): JSX.Element | null {
  const { step, busy } = flow;
  if (typeof step !== "number") return null;
  const valuesToSet =
    flow.run === undefined ? 0 : valueCounts(flow.run).set.values;
  // Redirects a file names are imported too, with or without values.
  const redirects = flow.run?.redirects ?? 0;
  const label =
    step === 0
      ? "Continue"
      : step === 1
        ? "Check the result"
        : importLabel(valuesToSet, redirects);
  return (
    <div className="flex justify-end gap-2">
      {step === 0 ? (
        <Button variant="outline" asChild>
          <AdminLink href={PAGES_PAGE_HREF}>Cancel</AdminLink>
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => flow.goTo(step === 2 ? 1 : 0)}
        >
          Back
        </Button>
      )}
      <Button
        type="button"
        disabled={
          busy ||
          !flow.ready ||
          (step === 2 && valuesToSet === 0 && redirects === 0)
        }
        onClick={() =>
          step === 2 ? flow.apply() : flow.goTo(step === 0 ? 1 : 2)
        }
      >
        {label}
      </Button>
    </div>
  );
}
