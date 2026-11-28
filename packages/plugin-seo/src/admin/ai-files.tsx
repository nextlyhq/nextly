/**
 * The Search engines and AI tab's rows for shaping the files for AI tools:
 * llms.txt's sections (renamed, ordered, merged by sharing a heading, left
 * out or listed under "Optional"), the site's own sections of links, what
 * llms-full.txt holds and how large it may grow, the folders with llms files
 * of their own, and a preview of llms.txt as the choices being edited would
 * write it. Each edits the draft's `aiFiles`; the page saves it with the rest.
 *
 * @module admin/ai-files
 */
import {
  Button,
  Checkbox,
  Input,
  SegmentedChoice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRowGroup,
  Textarea,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
} from "react";

import {
  AI_FILES_LIMITS,
  AI_FILES_PREVIEW_ROUTE_PATH,
  aiFilesProblem,
  extraSectionProblem,
  folderProblem,
  FULL_MB_CHOICES,
  FULL_MB_DEFAULT,
  keptFolder,
  OPTIONAL_HEADING,
  PREVIEW_LINES,
  storedAiFiles,
  type AiFiles,
  type AiFilesFullContents,
  type AiFilesGroup,
  type AiFilesGroupListed,
  type AiFilesPreviewBody,
} from "../settings/ai-files";
import { SEO_PLUGIN_NAME, type SeoContentType } from "../settings/contract";

import { ControlNote } from "./settings-parts";
import type { TabProps } from "./tabs";

/** What holds a save up while the AI files' choices are unfinished, said beside Save. */
export function aiFilesDraftProblem(files: AiFiles): string | null {
  return aiFilesProblem(files) === null
    ? null
    : "Fix the AI files' choices first.";
}

/** The draft's choices changed by `next`. */
type ChangeFiles = (next: (files: AiFiles) => AiFiles) => void;

/** What the preview holds: nothing asked yet, asking, an answer, or why there is none. */
type Preview =
  | { state: "idle" }
  | { state: "asking" }
  | { state: "done"; body: AiFilesPreviewBody }
  | { state: "failed"; why: string };

/**
 * The preview of llms.txt for `files`, asked once at first and again on
 * `refresh`: the groups the section list offers come with it. Choices the
 * screen refuses are not sent, and the preview says to fix them first.
 */
function useAiFilesPreview(files: AiFiles): {
  preview: Preview;
  refresh: () => void;
} {
  const [preview, setPreview] = useState<Preview>({ state: "idle" });
  const asking = useRef<AbortController | null>(null);
  const latest = useRef(files);
  latest.current = files;
  const refresh = useCallback(() => {
    asking.current?.abort();
    const asked = latest.current;
    if (aiFilesProblem(asked) !== null) {
      setPreview({ state: "failed", why: "Fix the choices above to preview." });
      return;
    }
    const controller = new AbortController();
    asking.current = controller;
    setPreview({ state: "asking" });
    writePluginRoute<AiFilesPreviewBody>({
      plugin: SEO_PLUGIN_NAME,
      path: AI_FILES_PREVIEW_ROUTE_PATH,
      body: { aiFiles: storedAiFiles(asked) },
      signal: controller.signal,
    }).then(
      body => {
        if (controller.signal.aborted) return;
        setPreview(
          body === undefined
            ? { state: "failed", why: "The preview could not be made." }
            : { state: "done", body }
        );
      },
      () => {
        if (!controller.signal.aborted) {
          setPreview({
            state: "failed",
            why: "The preview could not be made.",
          });
        }
      }
    );
  }, []);
  useEffect(() => {
    refresh();
    return () => asking.current?.abort();
  }, [refresh]);
  return { preview, refresh };
}

/**
 * The groups the list shows, in the order llms.txt writes them: those the
 * site placed, in its order, then the rest as the preview lists them. A
 * group placed but holding no pages now is still shown, so its choices can
 * be undone.
 */
export function orderedGroups(
  files: AiFiles,
  listed: readonly AiFilesGroupListed[]
): AiFilesGroupListed[] {
  const byKey = new Map(listed.map(group => [group.key, group]));
  const placed = (files.groups ?? []).map(
    group =>
      byKey.get(group.key) ?? {
        key: group.key,
        defaultHeading: group.key,
        pages: 0,
      }
  );
  const placedKeys = new Set(placed.map(group => group.key));
  return [...placed, ...listed.filter(group => !placedKeys.has(group.key))];
}

/**
 * `files` with the group `key` changed by `next`, every group the list
 * shows placed in the order shown, so a move or a change keeps the order.
 */
export function withGroup(
  files: AiFiles,
  shown: readonly AiFilesGroupListed[],
  key: string,
  next: (group: AiFilesGroup) => AiFilesGroup
): AiFiles {
  const chosen = new Map((files.groups ?? []).map(group => [group.key, group]));
  return {
    ...files,
    groups: shown.map(group => {
      const own = chosen.get(group.key) ?? { key: group.key };
      return group.key === key ? next(own) : own;
    }),
  };
}

/** `files` with the group at `from` moved to `to`, every shown group placed. */
export function withMoved(
  files: AiFiles,
  shown: readonly AiFilesGroupListed[],
  from: number,
  to: number
): AiFiles {
  const order = [...shown];
  const [moved] = order.splice(from, 1);
  if (moved === undefined) return files;
  order.splice(to, 0, moved);
  const chosen = new Map((files.groups ?? []).map(group => [group.key, group]));
  return {
    ...files,
    groups: order.map(group => chosen.get(group.key) ?? { key: group.key }),
  };
}

/** One group's row: its heading, its place, Optional and Leave out. */
function GroupRow({
  group,
  choice,
  first,
  last,
  move,
  set,
}: {
  group: AiFilesGroupListed;
  choice: AiFilesGroup | undefined;
  first: boolean;
  last: boolean;
  move: (by: -1 | 1) => void;
  set: (next: (group: AiFilesGroup) => AiFilesGroup) => void;
}): JSX.Element {
  const id = useId();
  const heading = choice?.heading ?? "";
  const shown = heading.trim() === "" ? group.defaultHeading : heading.trim();
  return (
    // Stacked at every width: the control column is narrow beside the row's
    // label, so the heading takes the whole line and its choices sit below.
    <li className="grid gap-2 border-b border-border px-3 py-3 last:border-b-0">
      <div className="grid gap-1">
        <label htmlFor={`${id}-heading`} className="sr-only">
          Heading for {group.defaultHeading}
        </label>
        <Input
          id={`${id}-heading`}
          value={heading}
          placeholder={group.defaultHeading}
          disabled={choice?.leftOut === true}
          onChange={event => {
            const next = event.target.value;
            set(current => ({ ...current, heading: next }));
          }}
        />
        <span className="text-xs text-muted-foreground">
          {group.pages === 1 ? "1 page" : `${group.pages} pages`}
          {shown === group.defaultHeading
            ? ""
            : ` · listed as ${shown}, not ${group.defaultHeading}`}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={choice?.optional === true}
            disabled={choice?.leftOut === true}
            onCheckedChange={checked =>
              set(current => ({ ...current, optional: checked === true }))
            }
          />
          {OPTIONAL_HEADING}
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={choice?.leftOut === true}
            onCheckedChange={checked =>
              set(current => ({ ...current, leftOut: checked === true }))
            }
          />
          Leave out
        </label>
        <span className="ml-auto flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={first}
            aria-label={`Move ${shown} up`}
            onClick={() => move(-1)}
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={last}
            aria-label={`Move ${shown} down`}
            onClick={() => move(1)}
          >
            <ArrowDown aria-hidden="true" className="size-4" />
          </Button>
        </span>
      </div>
    </li>
  );
}

/** llms.txt's sections, as the preview lists the site's groups of pages. */
function SectionsRow({
  files,
  changeFiles,
  listed,
}: {
  files: AiFiles;
  changeFiles: ChangeFiles;
  listed: readonly AiFilesGroupListed[] | undefined;
}): JSX.Element {
  const shown = orderedGroups(files, listed ?? []);
  const chosen = new Map((files.groups ?? []).map(group => [group.key, group]));
  return (
    <SettingsRowGroup
      label="Sections of llms.txt"
      description="The headings your pages are listed under, in this order. Give two the same heading to list them as one."
    >
      {listed === undefined ? (
        <ControlNote>
          The sections show once the preview below is made.
        </ControlNote>
      ) : shown.length === 0 ? (
        <ControlNote>No pages are listed yet.</ControlNote>
      ) : (
        <ul
          aria-label="Sections of llms.txt"
          className="overflow-hidden rounded-md border border-border bg-card"
        >
          {shown.map((group, at) => (
            <GroupRow
              key={group.key}
              group={group}
              choice={chosen.get(group.key)}
              first={at === 0}
              last={at === shown.length - 1}
              move={by =>
                changeFiles(current => withMoved(current, shown, at, at + by))
              }
              set={next =>
                changeFiles(current =>
                  withGroup(current, shown, group.key, next)
                )
              }
            />
          ))}
        </ul>
      )}
      <ControlNote>
        Optional sections are listed last, under {OPTIONAL_HEADING}, which AI
        tools may skip when they need less. A section left out stays in the
        sitemap.
      </ControlNote>
    </SettingsRowGroup>
  );
}

/** The site's own sections of links, each a heading and its links. */
function ExtraSectionsRow({
  files,
  changeFiles,
}: {
  files: AiFiles;
  changeFiles: ChangeFiles;
}): JSX.Element {
  const sections = files.extraSections ?? [];
  const id = useId();
  const setAt = (
    at: number,
    next: Partial<{ heading: string; links: string }>
  ) =>
    changeFiles(current => ({
      ...current,
      extraSections: (current.extraSections ?? []).map((section, place) =>
        place === at ? { ...section, ...next } : section
      ),
    }));
  return (
    <SettingsRowGroup
      label="Your own sections"
      description="Links llms.txt lists besides your pages: an API reference, a changelog elsewhere. One link a line."
    >
      <div className="grid gap-4">
        {sections.map((section, at) => {
          const blank =
            section.heading.trim() === "" && section.links.trim() === "";
          const problem = blank ? null : extraSectionProblem(section);
          return (
            <div key={at} className="grid gap-2">
              <div className="flex items-center gap-2">
                <label htmlFor={`${id}-${at}-heading`} className="sr-only">
                  Heading of section {at + 1}
                </label>
                <Input
                  id={`${id}-${at}-heading`}
                  value={section.heading}
                  placeholder="Heading, such as Docs"
                  onChange={event => setAt(at, { heading: event.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove section ${section.heading.trim() || at + 1}`}
                  onClick={() =>
                    changeFiles(current => ({
                      ...current,
                      extraSections: (current.extraSections ?? []).filter(
                        (_, place) => place !== at
                      ),
                    }))
                  }
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </div>
              <label htmlFor={`${id}-${at}-links`} className="sr-only">
                Links of section {at + 1}
              </label>
              <Textarea
                id={`${id}-${at}-links`}
                rows={3}
                className="font-mono text-[13px]"
                value={section.links}
                placeholder="- [API reference](https://example.com/api): Every endpoint"
                aria-invalid={problem !== null}
                onChange={event => setAt(at, { links: event.target.value })}
              />
              {problem === null ? null : (
                <ControlNote tone="danger">{problem}</ControlNote>
              )}
            </div>
          );
        })}
        {sections.length >= AI_FILES_LIMITS.extraSections ? null : (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                changeFiles(current => ({
                  ...current,
                  extraSections: [
                    ...(current.extraSections ?? []),
                    { heading: "", links: "" },
                  ],
                }))
              }
            >
              <Plus aria-hidden="true" className="size-4" />
              Add a section
            </Button>
          </div>
        )}
      </div>
      <ControlNote>
        A section with a heading of your pages&apos; joins it. One named{" "}
        {OPTIONAL_HEADING} is listed last.
      </ControlNote>
    </SettingsRowGroup>
  );
}

/** Lines of `text`, trimmed, the blank ones dropped. */
const linesOf = (text: string): string[] =>
  text
    .split(/\r\n?|\n/)
    .map(line => line.trim())
    .filter(line => line !== "");

/** The three choices of what llms-full.txt holds. */
const FULL_CHOICES = [
  { value: "everything", label: "Every page" },
  { value: "groups", label: "Some sections" },
  { value: "addresses", label: "Some addresses" },
] as const;

/** What llms-full.txt holds, and the most it may hold. */
function FullContentsRow({
  files,
  changeFiles,
  listed,
  host,
}: {
  files: AiFiles;
  changeFiles: ChangeFiles;
  listed: readonly AiFilesGroupListed[] | undefined;
  host: string;
}): JSX.Element {
  const labelId = useId();
  const contents: AiFilesFullContents = files.fullContents ?? {
    include: "everything",
  };
  // The prefixes as typed, so a half-typed line stays while it is edited.
  const [prefixText, setPrefixText] = useState(
    contents.include === "addresses" ? contents.prefixes.join("\n") : ""
  );
  const setContents = (next: AiFilesFullContents) =>
    changeFiles(current => ({ ...current, fullContents: next }));
  const problem =
    contents.include === "everything"
      ? null
      : aiFilesProblem({ fullContents: contents });
  return (
    <SettingsRowGroup
      label="What llms-full.txt holds"
      description={`Of the pages llms.txt lists, the ones ${host}/llms-full.txt writes out in full.`}
    >
      <div className="grid gap-3">
        <span id={labelId} className="sr-only">
          What llms-full.txt holds
        </span>
        <SegmentedChoice
          size="bordered"
          aria-labelledby={labelId}
          options={FULL_CHOICES.map(choice => ({ ...choice }))}
          value={contents.include}
          onSelect={next => {
            if (next === "groups") {
              setContents({ include: "groups", groups: [] });
            } else if (next === "addresses") {
              setContents({
                include: "addresses",
                prefixes: linesOf(prefixText),
              });
            } else {
              setContents({ include: "everything" });
            }
          }}
        />
        {contents.include === "groups" ? (
          <div className="grid gap-2">
            {(listed ?? []).map(group => (
              <label
                key={group.key}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <Checkbox
                  checked={contents.groups.includes(group.key)}
                  onCheckedChange={checked =>
                    setContents({
                      include: "groups",
                      groups:
                        checked === true
                          ? [...contents.groups, group.key]
                          : contents.groups.filter(key => key !== group.key),
                    })
                  }
                />
                {group.defaultHeading}
              </label>
            ))}
          </div>
        ) : null}
        {contents.include === "addresses" ? (
          <Textarea
            aria-label="Addresses llms-full.txt holds"
            rows={2}
            className="font-mono text-[13px]"
            value={prefixText}
            placeholder="/docs/"
            onChange={event => {
              setPrefixText(event.target.value);
              setContents({
                include: "addresses",
                prefixes: linesOf(event.target.value),
              });
            }}
          />
        ) : null}
        {problem === null ? null : (
          <ControlNote tone="danger">{problem}</ControlNote>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-foreground">Stops at</span>
          <Select
            value={String(files.fullMaxMegabytes ?? FULL_MB_DEFAULT)}
            onValueChange={value =>
              changeFiles(current => ({
                ...current,
                fullMaxMegabytes: Number(value),
              }))
            }
          >
            <SelectTrigger
              className="w-28"
              aria-label="Most llms-full.txt holds"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FULL_MB_CHOICES.map(size => (
                <SelectItem key={size} value={String(size)}>
                  {size} MB
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <ControlNote>
        A file that reaches its size stops before the next page and points to
        llms.txt for the rest; Problems says so.
      </ControlNote>
    </SettingsRowGroup>
  );
}

/** The folders with llms files of their own. */
function FolderFilesRow({
  files,
  changeFiles,
  host,
}: {
  files: AiFiles;
  changeFiles: ChangeFiles;
  host: string;
}): JSX.Element {
  const [text, setText] = useState((files.folderFiles ?? []).join("\n"));
  const problem =
    linesOf(text)
      .map(folderProblem)
      .find(each => each !== null) ?? null;
  const folders = linesOf(text).map(keptFolder);
  return (
    <SettingsRowGroup
      label="Folders with their own files"
      description="A part of the site AI tools may read alone, such as your docs. One folder a line."
    >
      <Textarea
        aria-label="Folders with their own files"
        rows={2}
        className="font-mono text-[13px]"
        value={text}
        placeholder="docs"
        aria-invalid={problem !== null}
        onChange={event => {
          setText(event.target.value);
          const next = linesOf(event.target.value);
          changeFiles(current => ({ ...current, folderFiles: next }));
        }}
      />
      {problem !== null ? (
        <ControlNote tone="danger">{problem}</ControlNote>
      ) : folders.length > 0 ? (
        <ControlNote>
          Served at{" "}
          {folders.map(folder => `${host}/${folder}/llms.txt`).join(", ")}, each
          listing only the pages under its folder, with its own llms-full.txt
          while llms-full.txt is on.
        </ControlNote>
      ) : (
        <ControlNote>
          Each is served at its folder, such as {host}/docs/llms.txt.
        </ControlNote>
      )}
    </SettingsRowGroup>
  );
}

/** The preview of llms.txt, as the choices being edited would write it. */
function PreviewRow({
  preview,
  refresh,
}: {
  preview: Preview;
  refresh: () => void;
}): JSX.Element {
  return (
    <SettingsRowGroup
      label="Preview of llms.txt"
      description={`The first ${PREVIEW_LINES} lines, with the choices above, before you save.`}
    >
      <div className="grid gap-2">
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={preview.state === "asking"}
            onClick={refresh}
          >
            {preview.state === "asking"
              ? "Making the preview…"
              : "Preview again"}
          </Button>
        </div>
        {preview.state === "done" ? (
          <>
            <pre
              aria-label="Preview of llms.txt"
              // It scrolls, so it takes focus, for a keyboard to scroll it.
              tabIndex={0}
              className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {preview.body.preview}
            </pre>
            <ControlNote>
              {preview.body.lines > PREVIEW_LINES
                ? `The first ${PREVIEW_LINES} of ${preview.body.lines} lines.`
                : preview.body.lines === 1
                  ? "The whole file, one line."
                  : `The whole file, ${preview.body.lines} lines.`}
            </ControlNote>
          </>
        ) : preview.state === "failed" ? (
          <ControlNote tone="warning">{preview.why}</ControlNote>
        ) : null}
      </div>
    </SettingsRowGroup>
  );
}

/** The rows shaping the files for AI tools, under the llms switches. */
export function AiFilesRows({
  draft,
  change,
  host,
}: TabProps & { host: string }): JSX.Element {
  const files = draft.aiFiles;
  const changeFiles: ChangeFiles = next =>
    change(current => ({ ...current, aiFiles: next(current.aiFiles) }));
  const { preview, refresh } = useAiFilesPreview(files);
  const listed = preview.state === "done" ? preview.body.groups : undefined;
  return (
    <>
      <SectionsRow files={files} changeFiles={changeFiles} listed={listed} />
      <ExtraSectionsRow files={files} changeFiles={changeFiles} />
      <FullContentsRow
        files={files}
        changeFiles={changeFiles}
        listed={listed}
        host={host}
      />
      <FolderFilesRow files={files} changeFiles={changeFiles} host={host} />
      <PreviewRow preview={preview} refresh={refresh} />
    </>
  );
}

/** Why a field is left out whatever the list says, as the list says it. */
const LEFT_OUT_WHY: Readonly<Record<"code" | "kind", string>> = {
  code: "left out in the site's code",
  kind: "left out; copies don't write this kind of field",
};

/** `files` with `field` of the type `key` in its copies or left out. */
function withCopyField(
  files: AiFiles,
  key: string,
  field: string,
  included: boolean
): AiFiles {
  const leftOut = new Set(files.copyLeftOut?.[key] ?? []);
  if (included) leftOut.delete(field);
  else leftOut.add(field);
  const { [key]: _type, ...others } = files.copyLeftOut ?? {};
  return {
    ...files,
    copyLeftOut:
      leftOut.size === 0 ? others : { ...others, [key]: [...leftOut] },
  };
}

/**
 * A content type's "In plain-text copies" list: each of its top-level
 * fields, ticked while its copies and llms-full.txt write it, in the order
 * its copies do. A field the site's code leaves out, or one holding no
 * words, is shown greyed with why.
 */
export function CopyFieldsChoice({
  type,
  draft,
  change,
}: TabProps & { type: SeoContentType }): JSX.Element | null {
  const fields = type.copyFields ?? [];
  const labelId = useId();
  if (fields.length === 0) return null;
  const leftOut = new Set(draft.aiFiles.copyLeftOut?.[type.key] ?? []);
  return (
    <div className="grid gap-2" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-sm font-medium text-foreground">
        In plain-text copies
      </span>
      <span className="text-xs text-muted-foreground">
        The fields a page&apos;s .md copy and llms-full.txt write, in this
        order. Pictures drawn in SVG are always left out.
      </span>
      <ul className="grid gap-1.5">
        {fields.map(field => (
          <li key={field.name}>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <Checkbox
                className="mt-0.5"
                checked={
                  field.leftOut === undefined && !leftOut.has(field.name)
                }
                disabled={field.leftOut !== undefined}
                onCheckedChange={checked =>
                  change(current => ({
                    ...current,
                    aiFiles: withCopyField(
                      current.aiFiles,
                      type.key,
                      field.name,
                      checked === true
                    ),
                  }))
                }
              />
              {/* The reason sits under the name, so a narrow screen wraps
                  neither. */}
              <span className="grid gap-0.5">
                <span
                  className={
                    field.leftOut === undefined ? "" : "text-muted-foreground"
                  }
                >
                  {field.label}
                </span>
                {field.leftOut === undefined ? null : (
                  <span className="text-xs text-muted-foreground">
                    {LEFT_OUT_WHY[field.leftOut]}
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
