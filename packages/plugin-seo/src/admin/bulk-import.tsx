/**
 * The bulk edit screen's import panel: where the values come from (a field
 * group the site already has, or an export file from Yoast, Rank Math or
 * Payload), the matching of a group's fields, a dry run that changes
 * nothing, and the import of what the dry run showed, all or nothing.
 *
 * Every choice, the file read and the dry run are kept in the panel's own
 * state, never in the address: the admin mounts a plugin's page again when
 * its address changes, which would throw them away.
 *
 * @module admin/bulk-import
 */
import {
  apiErrorMessage,
  Button,
  toastMutationResult,
  usePluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { useRef, useState, type JSX } from "react";

import {
  IMPORT_APPLY_PATH,
  IMPORT_DRY_RUN_PATH,
  IMPORT_FILE_LIMIT,
  IMPORT_GROUPS_PATH,
  IMPORT_TARGET_LABELS,
  IMPORT_TARGETS,
  type ApplyBody,
  type DryRunBody,
  type ImportFileSource,
  type ImportGroup,
  type ImportGroupsBody,
  type ImportSource,
  type ImportTarget,
} from "../import/contract";
import { SEO_PLUGIN_NAME } from "../settings/contract";

import { Icon } from "./styles";

/** Where the person chose to import from. */
type SourceKind = "group" | ImportFileSource;

/** A file the person chose, read. */
interface ChosenFile {
  name: string;
  text: string;
}

/** The sources the panel offers, with what each says. */
const FILE_SOURCES: readonly {
  kind: ImportFileSource;
  title: string;
  detail: string;
  accept: string;
}[] = [
  {
    kind: "yoast",
    title: "Yoast SEO",
    detail: "From a WordPress export file",
    accept: ".xml,text/xml,application/xml",
  },
  {
    kind: "rankMath",
    title: "Rank Math",
    detail: "From a WordPress export file",
    accept: ".xml,.csv,text/xml,application/xml,text/csv",
  },
  {
    kind: "payload",
    title: "Payload's SEO plugin",
    detail: "From a Payload database export",
    accept: ".json,application/json",
  },
];

/** `n pages`, `1 page`. */
const pages = (n: number) => `${n} ${n === 1 ? "page" : "pages"}`;

/** An arrow pointing up, out of a tray: a file going in. */
function UploadIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5M12 3v12" />
    </svg>
  );
}

/** What the radio for the field groups says about what was found. */
function groupDetail(groups: readonly ImportGroup[]): string {
  const first = groups.find(group => !group.own) ?? groups[0];
  if (first === undefined) return "None found on your content types";
  if (first.own) return "Values typed with an earlier version of this plugin";
  const [type, ...others] = first.types;
  const where =
    others.length === 0
      ? (type?.label ?? "")
      : `${type?.label ?? ""} and ${others.length} other ${others.length === 1 ? "type" : "types"}`;
  const fields = first.fields.length;
  return `Found ${first.field} on ${where}, ${fields} ${fields === 1 ? "field" : "fields"}`;
}

/** The matching a group starts with: each field where its name says. */
function suggestedMap(
  group: ImportGroup | undefined
): Record<string, ImportTarget> {
  if (group === undefined) return {};
  return Object.fromEntries(
    group.fields.map(field => [field.name, field.suggested])
  );
}

/** The matching table: each field holding values, and where it goes. */
function MatchFields({
  group,
  map,
  busy,
  onMap,
}: {
  group: ImportGroup;
  map: Readonly<Record<string, ImportTarget>>;
  busy: boolean;
  onMap: (field: string, target: ImportTarget) => void;
}): JSX.Element {
  const holding = group.fields.filter(field => field.filled > 0);
  const empty = group.fields.length - holding.length;
  return (
    <div className="nx-seo-field">
      <span className="nx-seo-label">Match the fields</span>
      <p className="nx-seo-help">
        We matched what we could. Check each one; the dry run uses your choices.
      </p>
      <table className="nx-seo-map">
        <tbody>
          {holding.map(field => (
            <tr key={field.name}>
              <td>
                {field.name}
                <span className="nx-seo-help">
                  {field.filled} of {group.pages} pages
                </span>
              </td>
              <td>
                <Icon name="arrow" />
              </td>
              <td>
                <select
                  className="nx-seo-select"
                  aria-label={`Import ${field.name} into`}
                  disabled={busy}
                  value={map[field.name] ?? "skip"}
                  onChange={event =>
                    onMap(field.name, event.target.value as ImportTarget)
                  }
                >
                  {IMPORT_TARGETS.map(target => (
                    <option key={target} value={target}>
                      {IMPORT_TARGET_LABELS[target]}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {empty > 0 ? (
        <p className="nx-seo-help">
          + {empty} more {empty === 1 ? "field holds" : "fields hold"} no values
          and {empty === 1 ? "is" : "are"} left out.
        </p>
      ) : null}
    </div>
  );
}

/** The dry run's answer, line by line. */
function DryRun({
  run,
  remapped,
}: {
  run: DryRunBody;
  remapped: boolean;
}): JSX.Element {
  return (
    <div className="nx-seo-dry" aria-live="polite">
      {remapped ? (
        <p className="nx-seo-help">
          Updated for the matching you just changed.
        </p>
      ) : null}
      <div className="row">
        <span>{run.fromFile ? "Pages in the file" : "Pages checked"}</span>
        <b>{run.checked}</b>
      </div>
      {run.lines.map(line => (
        <div className="row" key={line.target}>
          <span>
            {IMPORT_TARGET_LABELS[line.target]}
            {line.from.length > 0 ? ` ← ${line.from.join(", ")}` : ""}
          </span>
          <b>
            {line.target === "hidden"
              ? `${pages(line.pages)} hidden`
              : pages(line.pages)}
          </b>
        </div>
      ))}
      <div className="row">
        <span>Pages that would change</span>
        <b>{run.pages}</b>
      </div>
      {run.same > 0 ? (
        <div className="row">
          <span>Same as automatic, left automatic</span>
          <b>{run.same}</b>
        </div>
      ) : null}
      {run.kept > 0 ? (
        <div className="row">
          <span>Typed here already, kept</span>
          <b>{run.kept}</b>
        </div>
      ) : null}
      {run.redirects > 0 ? (
        <div className="row">
          <span>Redirects added</span>
          <b>{run.redirects}</b>
        </div>
      ) : null}
      {run.left.length > 0 ? (
        <p className="nx-seo-help">Left out: {run.left.join(", ")}.</p>
      ) : null}
      {run.warnings.map(warning => (
        <p className="nx-seo-help nx-seo-warnc nx-seo-warnline" key={warning}>
          <Icon name="warn" /> {warning}
        </p>
      ))}
      <p className="nx-seo-help">
        Nothing has changed yet. Drafts and published versions are both moved.
      </p>
    </div>
  );
}

/** The file a source reads: what is chosen, and the button to choose it. */
function FilePick({
  kind,
  file,
  busy,
  onFile,
}: {
  kind: ImportFileSource;
  file: ChosenFile | undefined;
  busy: boolean;
  onFile: (file: File) => void;
}): JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const accept = FILE_SOURCES.find(each => each.kind === kind)?.accept;
  const matched =
    'Fields are matched for you: title, description, social image and "noindex".';
  return (
    <div className="nx-seo-upl">
      <div className="nx-seo-thumb">
        {file === undefined ? <UploadIcon /> : <Icon name="check" />}
      </div>
      <div className="nx-seo-upl-text nx-seo-help">
        {file === undefined ? (
          `Upload the export file. ${matched}`
        ) : (
          <>
            <b>{file.name}</b>
            <br />
            {matched}
          </>
        )}
      </div>
      <input
        ref={input}
        className="nx-seo-filepick"
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        {...(accept === undefined ? {} : { accept })}
        onChange={event => {
          const chosen = event.target.files?.[0];
          event.target.value = "";
          if (chosen !== undefined) onFile(chosen);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="nx-seo-sbtn"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {file === undefined ? "Choose file" : "Choose another"}
      </Button>
    </div>
  );
}

/** A file's text, read the way every browser can. */
function textOfFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsText(file);
  });
}

/** What the panel needs from the page around it. */
export interface ImportPanelProps {
  /** Read the table again, once an import has changed pages. */
  onImported: () => void;
}

/** A dry run, with the source it was run on, which the import applies. */
interface Run {
  body: DryRunBody;
  source: ImportSource;
}

/** An import that went through. */
interface Done {
  /** What the import says it did. */
  message: string;
  group?: string;
}

/**
 * The panel's state and what it does: the chosen source, each group's
 * matching, each kind's file, the dry run and the import. All of it kept
 * here, in the screen's own state.
 */
function useImportFlow(groups: readonly ImportGroup[], onImported: () => void) {
  const [kind, setKind] = useState<SourceKind>("group");
  const [field, setField] = useState<string | undefined>();
  const group =
    groups.find(each => each.field === field) ??
    groups.find(each => !each.own) ??
    groups[0];
  const [maps, setMaps] = useState<
    Record<string, Record<string, ImportTarget>>
  >({});
  const map =
    group === undefined ? {} : (maps[group.field] ?? suggestedMap(group));
  const [files, setFiles] = useState<
    Partial<Record<ImportFileSource, ChosenFile>>
  >({});
  const [run, setRun] = useState<Run | null>(null);
  const [remapped, setRemapped] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Which dry run is the current one: an answer to any earlier one, or to
  // one asked before the source changed, is dropped.
  const latest = useRef(0);

  const sourceOf = (
    current: Record<string, ImportTarget> = map
  ): ImportSource | undefined => {
    if (kind === "group") {
      return group === undefined
        ? undefined
        : { kind: "group", field: group.field, map: current };
    }
    const file = files[kind];
    return file === undefined
      ? undefined
      : { kind, fileName: file.name, text: file.text };
  };

  // Each write: busy while it runs, its refusal shown in the panel.
  const attempt = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailed(null);
    try {
      await work();
    } catch (error) {
      setFailed(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const dryRun = (source: ImportSource | undefined, again = false) => {
    const asked = ++latest.current;
    return attempt(async () => {
      if (source === undefined) return;
      const body = await writePluginRoute<DryRunBody>({
        plugin: SEO_PLUGIN_NAME,
        path: IMPORT_DRY_RUN_PATH,
        body: { source },
      });
      if (body === undefined || asked !== latest.current) return;
      setRun({ body, source });
      setRemapped(again);
    });
  };

  const apply = () =>
    attempt(async () => {
      if (run === null) return;
      // A refused import asks for another dry run, so this one is put away.
      setRun(null);
      const answer = await writePluginRoute<ApplyBody & { message: string }>({
        plugin: SEO_PLUGIN_NAME,
        path: IMPORT_APPLY_PATH,
        body: { source: run.source, plan: run.body.plan },
      });
      if (answer === undefined) return;
      toastMutationResult(answer.message, []);
      setDone({
        message: answer.message,
        ...(run.source.kind === "group" ? { group: run.source.field } : {}),
      });
      setRun(null);
      onImported();
    });

  const reset = () => {
    // A dry run still on its way is for the source being left.
    latest.current++;
    setRun(null);
    setDone(null);
    setFailed(null);
    setRemapped(false);
  };

  const chooseFile = (chosen: File) =>
    attempt(async () => {
      if (kind === "group") return;
      if (chosen.size > IMPORT_FILE_LIMIT) {
        throw new Error(
          "That file is larger than 20 MB, which is more than an import reads."
        );
      }
      const text = await textOfFile(chosen);
      setFiles(current => ({
        ...current,
        [kind]: { name: chosen.name, text },
      }));
      reset();
    });

  const remap = (name: string, target: ImportTarget) => {
    if (group === undefined) return;
    const next = { ...map, [name]: target };
    setMaps(current => ({ ...current, [group.field]: next }));
    setDone(null);
    // A dry run on screen is put away and run again for the matching it
    // now shows, so the import always applies what the person sees.
    const shown = run !== null;
    setRun(null);
    latest.current++;
    if (shown) void dryRun(sourceOf(next), true);
  };

  return {
    kind,
    choose: (next: SourceKind) => {
      setKind(next);
      reset();
    },
    group,
    chooseGroup: (next: string) => {
      setField(next);
      reset();
    },
    map,
    remap,
    files,
    chooseFile,
    run,
    remapped,
    done,
    busy,
    failed,
    ready: sourceOf() !== undefined,
    dryRun: () => void dryRun(sourceOf()),
    apply: () => void apply(),
  };
}

type ImportFlow = ReturnType<typeof useImportFlow>;

/** Where the values come from: the sources, and which group. */
function SourcePicker({
  flow,
  groups,
  pending,
}: {
  flow: ImportFlow;
  groups: readonly ImportGroup[];
  pending: boolean;
}): JSX.Element {
  const sources = [
    {
      kind: "group" as const,
      title: "An existing field group",
      detail: pending ? "Looking for field groups…" : groupDetail(groups),
    },
    ...FILE_SOURCES,
  ];
  return (
    <>
      <div className="nx-seo-rgroup" role="radiogroup" aria-label="Import from">
        {sources.map(source => (
          <label className="nx-seo-radio" key={source.kind}>
            <input
              type="radio"
              name="nx-seo-import-source"
              value={source.kind}
              disabled={flow.busy}
              checked={flow.kind === source.kind}
              onChange={() => flow.choose(source.kind)}
            />
            <span>
              <b>{source.title}</b>
              <span>{source.detail}</span>
            </span>
          </label>
        ))}
      </div>
      {flow.kind === "group" && groups.length > 1 ? (
        <div className="nx-seo-field">
          <label className="nx-seo-label" htmlFor="nx-seo-import-group">
            Group
          </label>
          <select
            id="nx-seo-import-group"
            className="nx-seo-select"
            disabled={flow.busy}
            value={flow.group?.field ?? ""}
            onChange={event => flow.chooseGroup(event.target.value)}
          >
            {groups.map(each => (
              <option key={each.field} value={each.field}>
                {each.own ? `${each.label} (this plugin's own)` : each.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </>
  );
}

/** What the chosen source needs: the matching, a note, or the file. */
function SourceDetail({ flow }: { flow: ImportFlow }): JSX.Element | null {
  if (flow.kind !== "group") {
    return (
      <FilePick
        kind={flow.kind}
        file={flow.files[flow.kind]}
        busy={flow.busy}
        onFile={chosen => void flow.chooseFile(chosen)}
      />
    );
  }
  if (flow.group === undefined) return null;
  if (flow.group.own) {
    return (
      <p className="nx-seo-help">
        Titles and descriptions typed the same as the automatic ones become
        automatic again, so a change to a pattern reaches them. Every other
        value stays as it is.
      </p>
    );
  }
  return (
    <MatchFields
      group={flow.group}
      map={flow.map}
      busy={flow.busy}
      onMap={flow.remap}
    />
  );
}

/** Why the dry run can't start yet, or what it does. */
function readyHelp(flow: ImportFlow): string {
  if (flow.ready)
    return "A dry run shows what would change and changes nothing.";
  return flow.kind === "group"
    ? "No field group was found on your content types."
    : "Choose the export file first; the dry run reads it.";
}

/** What the import button says it imports: pages, redirects, or both. */
function importWords(run: DryRunBody): string | undefined {
  const redirects = `${run.redirects} ${run.redirects === 1 ? "redirect" : "redirects"}`;
  const parts = [
    ...(run.pages > 0 ? [pages(run.pages)] : []),
    ...(run.redirects > 0 ? [redirects] : []),
  ];
  return parts.length === 0
    ? undefined
    : `Import ${parts.join(" and ")}, all or nothing`;
}

/** The dry run's button, its answer and the import, or what was imported. */
function RunArea({ flow }: { flow: ImportFlow }): JSX.Element | null {
  const { run, done } = flow;
  if (done !== null) {
    return (
      <div className="nx-seo-note ok" role="status">
        <Icon name="check" />
        <div>
          <b>{done.message}</b>{" "}
          {done.group !== undefined && done.group !== "seo"
            ? `The ${done.group} group can be removed in a later migration; its values stay until then.`
            : null}
        </div>
      </div>
    );
  }
  if (run === null) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          className="nx-seo-sidebtn"
          disabled={!flow.ready || flow.busy}
          onClick={flow.dryRun}
        >
          Do a dry run
        </Button>
        <p className="nx-seo-help">{readyHelp(flow)}</p>
      </>
    );
  }
  return (
    <>
      <DryRun run={run.body} remapped={flow.remapped} />
      <Button
        type="button"
        className="nx-seo-sidebtn"
        disabled={importWords(run.body) === undefined || flow.busy}
        onClick={flow.apply}
      >
        {importWords(run.body) ?? "Nothing to import"}
      </Button>
      <p className="nx-seo-help">
        If anything fails part-way, every value stays as it was.
      </p>
    </>
  );
}

/** The import panel, as the bulk edit screen draws it beside the table. */
export function ImportPanel({ onImported }: ImportPanelProps): JSX.Element {
  const read = usePluginRoute<ImportGroupsBody>({
    plugin: SEO_PLUGIN_NAME,
    path: IMPORT_GROUPS_PATH,
    staleTime: 0,
  });
  const groups = read.data?.groups ?? [];
  const flow = useImportFlow(groups, () => {
    onImported();
    read.refetch();
  });
  if (read.error !== null && read.data === undefined) {
    return (
      <>
        <h2>Import SEO values</h2>
        <p className="nx-seo-help">{apiErrorMessage(read.error)}</p>
      </>
    );
  }
  return (
    <>
      <h2>Import SEO values</h2>
      <p className="nx-seo-help nx-seo-lede">
        Bring titles and descriptions across from where they live today.
      </p>
      <SourcePicker flow={flow} groups={groups} pending={read.pending} />
      <SourceDetail flow={flow} />
      {flow.failed !== null ? (
        <p className="nx-seo-error" role="alert">
          {flow.failed}
        </p>
      ) : null}
      <RunArea flow={flow} />
    </>
  );
}
