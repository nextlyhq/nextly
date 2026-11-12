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
  Button,
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
  neverServedWords,
  reportCsv,
  reportedPages,
  resultOf,
  RESULT_WORDS,
  valueCounts,
} from "./import-report";
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
  back: (to: 0 | 1) => void
): { label: string; onSelect?: () => void }[] {
  return [
    {
      label: step === 0 ? "Choose the source" : `Source: ${name}`,
      onSelect: () => back(0),
    },
    {
      label: step === 2 ? "Fields matched" : "Match the fields",
      onSelect: () => back(1),
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
        <DialogHeader>
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
    <div className="grid gap-6">
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
      <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
        {value ?? ""}
      </span>
      {result === "none" ? null : (
        <span className="grid shrink-0 justify-items-end text-xs">
          <b className="font-semibold text-foreground">
            {RESULT_WORDS[result].label}
          </b>
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

/** The last step: the dry run's counts and each page's result. */
function CheckStep({ run }: { run: DryRunBody }): JSX.Element {
  const columns: NextlyColumn<ImportReportEntry>[] = [
    {
      name: "page",
      header: "Page",
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.label}</span>
      ),
    },
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
    <div className="grid gap-4">
      <Counts run={run} />
      <DataTableView<ImportReportEntry>
        columns={columns}
        rows={reportedPages(run)}
        getRowId={row => `${row.type ?? ""}|${row.id ?? row.label}`}
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
        {`${counted(counts.set.values, "value")} imported on ${counted(counts.set.pages, "page")}`}
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
  again,
}: {
  why: string;
  again: () => void;
}): JSX.Element {
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
    if (run.held === 0) return nothingIn(tool);
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
  const [stopped, setStopped] = useState<string>("");

  const group =
    choice?.kind === "group"
      ? groups.find(each => each.field === choice.field)
      : undefined;
  const map =
    group === undefined ? {} : (maps[group.field] ?? suggestedMap(group));
  const fileRead =
    choice?.kind === "file" && file?.tool === choice.tool ? file : undefined;

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
      setStep("imported");
    } catch (error) {
      setStopped(apiErrorMessage(error));
      setStep("stopped");
    } finally {
      setBusy(false);
    }
  };

  return {
    groups,
    ownSeo,
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
      if (choice?.kind !== "file") return;
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

/** What the current step shows. */
function StepBody({ flow }: { flow: ImportFlow }): JSX.Element {
  if (flow.step === "imported" && flow.run !== undefined) {
    return <Imported run={flow.run} />;
  }
  if (flow.step === "stopped") {
    return <Stopped why={flow.stopped} again={() => flow.goTo(2)} />;
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
        reading={flow.busy}
        problem={flow.fileProblem}
        onFile={chosen => void flow.readFile(chosen)}
        again={flow.forgetFile}
      />
    );
  }
  if (flow.step === 1) {
    return (
      <div className="grid gap-4">
        {flow.group !== undefined ? (
          <MatchTable
            group={flow.group}
            map={flow.map}
            setTarget={flow.setTarget}
          />
        ) : flow.run === undefined ? null : (
          <FileTable run={flow.run} />
        )}
        <NeverServedNote
          run={flow.run}
          sourceLabel={flow.name}
          include={flow.include}
          setInclude={flow.includeAnyway}
        />
      </div>
    );
  }
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
      <div className="grid gap-6">
        {current < 3 ? (
          <Stepper
            aria-label="Steps"
            current={current}
            steps={stepsOf(current, flow.name, flow.goTo)}
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

/** The step's buttons: back and on, or none once the import is done. */
function Actions({ flow }: { flow: ImportFlow }): JSX.Element | null {
  const { step, busy } = flow;
  if (typeof step !== "number") return null;
  const valuesToSet =
    flow.run === undefined ? 0 : valueCounts(flow.run).set.values;
  const label =
    step === 0
      ? "Continue"
      : step === 1
        ? "Check the result"
        : `Import ${counted(valuesToSet, "value")}`;
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
        disabled={busy || !flow.ready || (step === 2 && valuesToSet === 0)}
        onClick={() =>
          step === 2 ? flow.apply() : flow.goTo(step === 0 ? 1 : 2)
        }
      >
        {label}
      </Button>
    </div>
  );
}
