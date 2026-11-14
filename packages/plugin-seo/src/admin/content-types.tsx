/**
 * The Content types tab: one row per content type with SEO, saying where its
 * pages live, how their titles are made, whether the whole type is hidden
 * from search, and what its pages are described as in structured data, with
 * the fields each detail is read from; then the types the site's code gives
 * no SEO, greyed.
 *
 * Drawn as the other Settings tabs are, a card of rows from the admin's own
 * parts, so the tab reads like the rest of the screen.
 *
 * @module admin/content-types
 */
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  SegmentedChoice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nextlyhq/plugin-sdk/admin";
import { ChevronRight, CircleCheck, Info, Lock, Search } from "lucide-react";
import { useId, useRef, useState, type JSX, type ReactNode } from "react";

import { IMPORT_PAGE_HREF } from "../overview/contract";
import type {
  ContentTypeSource,
  MappableField,
  SeoContentType,
  SwitchedOffType,
} from "../settings/contract";
import { SITE_NAME_TOKEN, TITLE_TOKEN, tokenKey } from "../settings/patterns";
import {
  DETAIL_GUESSES,
  DETAIL_LABELS,
  STRUCTURED_DATA_TYPE_KEYS,
  STRUCTURED_DATA_TYPES,
  isStructuredDataTypeKey,
  structuredDataChoiceText,
  type StructuredDataDetail,
  type StructuredDataTypeKey,
} from "../structured-data/catalog";
import type { DetailSource } from "../structured-data/rules";
import { characters, TITLE_LIMIT } from "../tab/problems";

import { AdminLink } from "./section";
import {
  FROM_THE_PAGE,
  holdsField,
  isHidden,
  isSeoOn,
  mappingOf,
  missingDetails,
  patternOf,
  patternProblem,
  previewOf,
  structuredTypeOf,
  withDetailField,
  withHidden,
  withSeoOn,
  withStructuredType,
} from "./settings-draft";
import { ControlNote, SettingsCard } from "./settings-parts";
import type { TabProps } from "./tabs";

/**
 * The types described with details, which are the only ones with any to
 * map: one a type needs, or one it states where the page has it.
 */
const MAPPABLE_TYPES: readonly StructuredDataTypeKey[] =
  STRUCTURED_DATA_TYPE_KEYS.filter(
    key =>
      STRUCTURED_DATA_TYPES[key].needs.length > 0 ||
      STRUCTURED_DATA_TYPES[key].uses.length > 0
  );

/**
 * The choice of no structured data type, and of no field for a detail. The
 * admin's select takes no empty value, so each "none" has a name no type or
 * field can have.
 */
const AUTOMATIC = "=automatic";
const FOUND = "=found";
/** A fixed value the site's code gives a detail, in the field choice. */
const FIXED = "=fixed";

/** A type's entry count in words, where the reader may count them. */
function countText(count: number | undefined): string | undefined {
  if (count === undefined) return undefined;
  if (count === 0) return "No entries yet";
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

/** What a type's row says under its name: how many, and where they live. */
function typeSummary(type: SeoContentType): string {
  const parts: string[] = [];
  const count = countText(type.count);
  if (count !== undefined) parts.push(count);
  if (!type.public)
    parts.push("Not public yet: a developer sets where these pages live");
  else if (type.example?.address) parts.push(`e.g. ${type.example.address}`);
  else parts.push("Address set in code");
  return parts.join(" · ");
}

/** A type's title pattern: the field, its variables, and an example. */
function PatternEditor({
  type,
  draft,
  change,
}: TabProps & { type: SeoContentType }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const { pattern, own } = patternOf(draft, type.key);
  const problem = patternProblem(pattern, type);
  const preview = previewOf(pattern, type, draft.siteName);
  const siteName = draft.siteName.trim() || "your site's name";
  const setPattern = (title: string) =>
    change(current => ({
      ...current,
      patterns: {
        ...current.patterns,
        [type.key]: { ...current.patterns[type.key], title },
      },
    }));
  const insert = (token: string) => {
    const field = input.current;
    const text = `{${token}}`;
    const start = field?.selectionStart ?? pattern.length;
    const end = field?.selectionEnd ?? start;
    setPattern(pattern.slice(0, start) + text + pattern.slice(end));
    // Back to the field, just after what was added.
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + text.length, start + text.length);
    });
  };
  const reset = () =>
    change(current => {
      const { title: _title, ...rest } = current.patterns[type.key] ?? {};
      const patterns = { ...current.patterns };
      if (Object.keys(rest).length === 0) delete patterns[type.key];
      else patterns[type.key] = rest;
      return { ...current, patterns };
    });
  const tokens = [
    TITLE_TOKEN,
    ...type.fields.map(field => field.token),
    SITE_NAME_TOKEN,
  ];
  const length = characters(preview.title);
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          Title pattern
          <span className="sr-only"> for {type.label}</span>
        </label>
        {own ? (
          <button
            type="button"
            className="text-xs font-medium text-foreground underline underline-offset-2 hover:decoration-2"
            onClick={reset}
          >
            Reset to default
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">Default</span>
        )}
      </div>
      <Input
        ref={input}
        id={id}
        className="font-mono text-[13px]"
        value={pattern}
        aria-invalid={problem !== null}
        aria-describedby={`${id}-example ${id}-problem`}
        onChange={event => setPattern(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Click to add:</span>
        {tokens.map(token => (
          <Button
            key={token}
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 font-mono text-xs"
            onClick={() => insert(token)}
          >
            {`{${token}}`}
          </Button>
        ))}
      </div>
      <p
        id={`${id}-example`}
        aria-live="polite"
        className="text-xs text-muted-foreground"
      >
        Example: <b className="font-medium text-foreground">{preview.title}</b>{" "}
        <span
          className={
            length > TITLE_LIMIT ? "font-semibold text-warning-text" : undefined
          }
        >
          {length} / {TITLE_LIMIT}
        </span>
      </p>
      {preview.gaveWay ? (
        <ControlNote>
          This page leaves a variable empty, so it keeps its own title, as it
          will on the site.
        </ControlNote>
      ) : null}
      <p
        id={`${id}-problem`}
        role="alert"
        className="text-xs font-medium text-danger-text empty:hidden"
      >
        {problem}
      </p>
      <ControlNote>
        A page&apos;s own title wins over this pattern. &quot;
        {`${draft.separator} ${siteName}`}&quot; is never added to a title that
        already ends with {siteName}.
      </ControlNote>
    </div>
  );
}

/**
 * The field the page's markup reads `detail` from when none is chosen: the
 * first of its guesses, in the order the markup tries them, the type has.
 */
function guessedField(
  type: SeoContentType,
  detail: StructuredDataDetail
): MappableField | undefined {
  for (const guess of DETAIL_GUESSES[detail]) {
    // Among the entry's own fields only, as the markup looks: a field in a
    // group is read only when chosen.
    const found = type.mappableFields.find(
      field =>
        !field.name.includes(".") && tokenKey(field.name) === tokenKey(guess)
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Each field's label in a choice, with its name where two share a label. */
function optionLabels(fields: readonly MappableField[]): Map<string, string> {
  const uses = new Map<string, number>();
  for (const field of fields) {
    uses.set(field.label, (uses.get(field.label) ?? 0) + 1);
  }
  return new Map(
    fields.map(field => [
      field.name,
      (uses.get(field.label) ?? 0) > 1
        ? `${field.label} (${field.name})`
        : field.label,
    ])
  );
}

/** What a detail's row says under its choice. */
function detailHelp(
  type: SeoContentType,
  detail: StructuredDataDetail,
  source: DetailSource | undefined,
  shown: MappableField | undefined,
  needed: string
): string {
  if (typeof source === "object") return "set in the site's code";
  if (source !== undefined && !holdsField(type, source)) {
    return "That field is gone: choose another";
  }
  if (shown !== undefined) return `from each entry's ${shown.label}`;
  const fromPage = FROM_THE_PAGE[detail];
  return fromPage === undefined
    ? needed
    : `from each page's ${fromPage.replace(/^The page's /, "")}`;
}

/** What a detail's choice shows: the value chosen and the options round it. */
interface DetailChoice {
  value: string;
  /**
   * The field the markup finds by its name while none is chosen, which the
   * choice of no field is shown as.
   */
  guess?: MappableField;
  fixed?: string;
  /** A field chosen once that the type no longer has. */
  gone?: string;
  /** A path into one of the type's fields that no option names. */
  path?: string;
}

/** The choice for a detail read from `source`, or found by its name. */
function detailChoice(
  type: SeoContentType,
  detail: StructuredDataDetail,
  source: DetailSource | undefined
): DetailChoice {
  const guess = guessedField(type, detail);
  const base = guess === undefined ? {} : { guess };
  if (typeof source === "object") {
    return { ...base, value: FIXED, fixed: source.value };
  }
  if (source === undefined) return { ...base, value: FOUND };
  if (!holdsField(type, source))
    return { ...base, value: source, gone: source };
  return type.mappableFields.some(field => field.name === source)
    ? { ...base, value: source }
    : { ...base, value: source, path: source };
}

/** The options of a detail's choice. */
function DetailOptions({
  type,
  detail,
  choice,
}: {
  type: SeoContentType;
  detail: StructuredDataDetail;
  choice: DetailChoice;
}): JSX.Element {
  const labels = optionLabels(type.mappableFields);
  return (
    <>
      {/* No field chosen: the markup finds one by its name, shown as that
          field, or reads the page's own, so choosing it again returns a
          detail to being found that way. */}
      <SelectItem value={FOUND}>
        {choice.guess?.label ?? FROM_THE_PAGE[detail] ?? "Not chosen yet"}
      </SelectItem>
      {choice.fixed === undefined ? null : (
        <SelectItem value={FIXED}>{`Always "${choice.fixed}"`}</SelectItem>
      )}
      {choice.gone === undefined ? null : (
        <SelectItem
          value={choice.gone}
        >{`${choice.gone}, not found`}</SelectItem>
      )}
      {choice.path === undefined ? null : (
        <SelectItem value={choice.path}>{choice.path}</SelectItem>
      )}
      {type.mappableFields
        // The field found by its name is the first option while unchosen.
        .filter(
          each => each.name !== choice.guess?.name || choice.value === each.name
        )
        .map(each => (
          <SelectItem key={each.name} value={each.name}>
            {labels.get(each.name)}
          </SelectItem>
        ))}
    </>
  );
}

/** One detail's line: the field it is read from, and where that leaves it. */
function DetailLine({
  type,
  detail,
  source,
  lacking,
  required,
  typeLabel,
  choose,
}: {
  type: SeoContentType;
  detail: StructuredDataDetail;
  source: DetailSource | undefined;
  lacking: boolean;
  required: boolean;
  typeLabel: string;
  choose: (field: string) => void;
}): JSX.Element {
  // A field chosen is saved as chosen; no field chosen is shown as the one
  // the markup finds by its name.
  const choice = detailChoice(type, detail, source);
  const shown =
    type.mappableFields.find(field => field.name === choice.value) ??
    (choice.value === FOUND ? choice.guess : undefined);
  const needed = required
    ? `Google needs this for ${typeLabel}`
    : `Optional for ${typeLabel}`;
  return (
    <div className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[120px_minmax(0,220px)_1fr]">
      <span className="text-sm font-medium text-foreground">
        {DETAIL_LABELS[detail]}
      </span>
      <Select
        value={choice.value}
        onValueChange={next => {
          if (next === FIXED) return;
          choose(next === FOUND ? "" : next);
        }}
      >
        <SelectTrigger
          aria-label={`Field that holds ${DETAIL_LABELS[detail]}`}
          aria-invalid={lacking}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <DetailOptions type={type} detail={detail} choice={choice} />
        </SelectContent>
      </Select>
      <span
        className={
          lacking
            ? "text-xs font-medium text-warning-text"
            : "text-xs text-muted-foreground"
        }
      >
        {detailHelp(type, detail, source, shown, needed)}
      </span>
    </div>
  );
}

/** Which field each detail of a structured data type is read from. */
function DetailsEditor({
  type,
  structuredType,
  draft,
  change,
  setType,
  onDone,
}: TabProps & {
  type: SeoContentType;
  structuredType: StructuredDataTypeKey;
  setType: (structuredType: StructuredDataTypeKey) => void;
  onDone: () => void;
}): JSX.Element {
  const mapping = mappingOf(draft, type.key, structuredType);
  const missing = missingDetails(draft, type, structuredType);
  const { label, needs } = STRUCTURED_DATA_TYPES[structuredType];
  const isDefault = structuredTypeOf(draft, type.key) === structuredType;
  return (
    <div className="grid gap-3 rounded-md border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">Details for</span>
        <Select
          value={structuredType}
          onValueChange={value => {
            if (isStructuredDataTypeKey(value)) setType(value);
          }}
        >
          <SelectTrigger className="w-auto" aria-label="Details for">
            {/* The type's name alone: the list beside it carries its note. */}
            <SelectValue>{label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {MAPPABLE_TYPES.map(key => (
              <SelectItem key={key} value={key}>
                {structuredDataChoiceText(key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          on {type.label}
          {isDefault ? " (this type's default)" : ", for pages that choose it"}
        </span>
      </div>
      <div className="grid gap-2">
        {[...needs, ...STRUCTURED_DATA_TYPES[structuredType].uses].map(
          detail => (
            <DetailLine
              key={detail}
              type={type}
              detail={detail}
              source={mapping[detail]}
              lacking={missing.includes(detail)}
              required={needs.includes(detail)}
              typeLabel={label}
              choose={field =>
                change(current =>
                  withDetailField(
                    current,
                    type.key,
                    structuredType,
                    detail,
                    field
                  )
                )
              }
            />
          )
        )}
      </div>
      <ControlNote>
        {missing.length > 0
          ? `Until every needed detail has a field, ${label} details are left out of these pages and listed in Problems.`
          : "All set. Only details visible on the page are used."}{" "}
        If no field fits, a developer can add one.
      </ControlNote>
      <div>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** A content type's choice of type as its closed chooser names it. */
function typeName(chosen: StructuredDataTypeKey | undefined): string {
  return chosen === undefined
    ? "Automatic"
    : STRUCTURED_DATA_TYPES[chosen].label;
}

/** A type's structured data choice, and the way to map its details. */
function StructuredData({
  type,
  draft,
  change,
  mapping,
  setMapping,
}: TabProps & {
  type: SeoContentType;
  /** The type whose details are being mapped, if any. */
  mapping: StructuredDataTypeKey | null;
  setMapping: (structuredType: StructuredDataTypeKey | null) => void;
}): JSX.Element {
  const id = useId();
  const chosen = structuredTypeOf(draft, type.key);
  // A type with details to map, needed or only used where the page has
  // them, offers the mapping; one made from the page alone does not.
  const mappable = chosen !== undefined && MAPPABLE_TYPES.includes(chosen);
  const missing =
    chosen === undefined ? [] : missingDetails(draft, type, chosen);
  return (
    <div className="grid gap-2">
      <span id={id} className="text-sm font-medium text-foreground">
        Structured data
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={chosen ?? AUTOMATIC}
          onValueChange={value => {
            const next = isStructuredDataTypeKey(value) ? value : undefined;
            change(current => withStructuredType(current, type.key, next));
            // Open details follow the type chosen, or close where it has
            // none to map, so they are never saved under the type left.
            if (mapping !== null) {
              setMapping(
                next !== undefined && MAPPABLE_TYPES.includes(next)
                  ? next
                  : null
              );
            }
          }}
        >
          <SelectTrigger
            className="w-56"
            aria-label={`Structured data for ${type.label}`}
          >
            {/* The type's name alone: the list carries its note. */}
            <SelectValue>{typeName(chosen)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTOMATIC}>Automatic</SelectItem>
            {STRUCTURED_DATA_TYPE_KEYS.map(key => (
              <SelectItem key={key} value={key}>
                {structuredDataChoiceText(key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {chosen === undefined ? (
          <span className="text-xs text-muted-foreground">
            Article where a page has an author and a date, else Web page
          </span>
        ) : !mappable ? (
          <span className="text-xs text-muted-foreground">
            Made from the page itself
          </span>
        ) : (
          <span className="text-xs">
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2 hover:decoration-2"
              aria-expanded={mapping !== null}
              onClick={() => setMapping(mapping === null ? chosen : null)}
            >
              Map details
            </button>{" "}
            <span
              className={
                missing.length > 0
                  ? "font-medium text-warning-text"
                  : "text-muted-foreground"
              }
            >
              · {missing.length > 0 ? `${missing.length} missing` : "all set"}
            </span>
          </span>
        )}
      </div>
      {mapping === null ? null : (
        <DetailsEditor
          type={type}
          structuredType={mapping}
          draft={draft}
          change={change}
          setType={setMapping}
          onDone={() => setMapping(null)}
        />
      )}
    </div>
  );
}

/** One content type's settings: its title pattern, hiding, and structured data. */
function TypeSettings({
  type,
  draft,
  change,
}: TabProps & { type: SeoContentType }): JSX.Element {
  const [mapping, setMapping] = useState<StructuredDataTypeKey | null>(null);
  const hidden = isHidden(draft, type.key);
  const hideId = useId();
  return (
    <div className="grid gap-5">
      <PatternEditor type={type} draft={draft} change={change} />
      <div className="flex items-start gap-3">
        <Switch
          id={hideId}
          checked={hidden}
          aria-label={`Hide all ${type.label} from search`}
          onCheckedChange={checked =>
            change(current => withHidden(current, type.key, checked))
          }
        />
        <label htmlFor={hideId} className="grid gap-0.5">
          <span className="text-sm font-medium text-foreground">
            Hide the whole group from search
          </span>
          <span className="text-xs text-muted-foreground">
            Its pages stay out of search, whatever each page says.
          </span>
        </label>
      </div>
      <StructuredData
        type={type}
        draft={draft}
        change={change}
        mapping={mapping}
        setMapping={setMapping}
      />
    </div>
  );
}

/** Where a type was made, as its chip says. */
const SOURCE_TEXT: Readonly<Record<ContentTypeSource, string>> = {
  code: "In code",
  builder: "Schema Builder",
};

/** A type's name, the chip saying where it was made, and any other chip. */
function TypeName({
  type,
  hidden = false,
}: {
  type: SeoContentType | SwitchedOffType;
  hidden?: boolean;
}): JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold">{type.label}</span>
      {type.source === undefined ? null : (
        <Badge variant="outline">{SOURCE_TEXT[type.source]}</Badge>
      )}
      {hidden ? <Badge variant="default">Hidden from search</Badge> : null}
    </span>
  );
}

/** What a row with SEO says under its name. */
function rowSummary(
  type: SeoContentType,
  savedOff: boolean,
  on: boolean
): string {
  if (type.kind === "single") {
    const where = !type.public
      ? "No page of its own"
      : type.example?.address !== undefined
        ? type.example.address
        : "Address set in code";
    return savedOff && !on
      ? "Single · SEO off · its SEO values are kept"
      : `Single · ${where}`;
  }
  if (savedOff && !on) {
    return [countText(type.count), "SEO off · their SEO values are kept"]
      .filter(Boolean)
      .join(" · ");
  }
  return typeSummary(type);
}

/** What changes once a switch is saved: off, or back on. */
function SwitchNote({
  type,
  on,
  savedOff,
}: {
  type: SeoContentType;
  on: boolean;
  savedOff: boolean;
}): JSX.Element | null {
  if (!on && !savedOff) {
    // Counted only where the type has entries: "saved on no entries" says
    // nothing true.
    const entries =
      type.count === undefined || type.count === 0
        ? undefined
        : countText(type.count)?.toLowerCase();
    return (
      <Alert variant="info" role="note">
        <Info aria-hidden="true" />
        <AlertDescription>
          <p>
            <b className="font-semibold">
              SEO is off for {type.label} once you save.
            </b>{" "}
            {type.kind === "single"
              ? "It loses its SEO tab, and its page leaves the sitemap and llms.txt and gets no title, description or structured data from Nextly."
              : "Their entries lose the SEO tab, and their pages leave the sitemap and llms.txt and get no titles, descriptions or structured data from Nextly."}{" "}
            The values saved{entries === undefined ? "" : ` on ${entries}`} are
            kept; switch it back on and they return as they were.
          </p>
          <p className="mt-2">
            Off doesn&apos;t hide these pages from search. To do that, leave SEO
            on and use{" "}
            <b className="font-semibold">Hide the whole group from search</b>.
          </p>
        </AlertDescription>
      </Alert>
    );
  }
  if (on && savedOff) {
    return (
      <Alert variant="success" role="status">
        <CircleCheck aria-hidden="true" />
        <AlertDescription>
          SEO is back on for {type.label} once you save. The values saved on its
          entries are used again.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

/**
 * One content type with SEO: its name, where it was made and what it holds,
 * its switch, and, opened, its settings. A switch-off says what it does
 * before it is saved, and deletes nothing.
 */
function TypeRow({
  type,
  draft,
  change,
  open,
  toggle,
  savedOff,
  canChange,
}: TabProps & {
  type: SeoContentType;
  open: boolean;
  toggle: () => void;
  savedOff: boolean;
  canChange: boolean;
}): JSX.Element {
  const on = isSeoOn(draft, type.key);
  const panelId = useId();
  return (
    <div
      role="group"
      aria-label={type.label}
      className="border-b border-border px-4 py-3 last:border-b-0"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-3 rounded-sm text-left text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          <ChevronRight
            aria-hidden="true"
            className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span className="grid min-w-0 gap-1">
            <TypeName type={type} hidden={on && isHidden(draft, type.key)} />
            <span className="text-xs text-muted-foreground">
              {rowSummary(type, savedOff, on)}
            </span>
          </span>
        </button>
        <Switch
          checked={on}
          disabled={!canChange}
          aria-label={`SEO for ${type.label}`}
          onCheckedChange={checked =>
            change(current => withSeoOn(current, type.key, checked))
          }
        />
      </div>
      <div className="mt-3 pl-7 empty:hidden">
        <SwitchNote type={type} on={on} savedOff={savedOff} />
      </div>
      {open ? (
        <div id={panelId} className="mt-4 pl-7">
          <TypeSettings type={type} draft={draft} change={change} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * A site's own type the code gives no SEO, greyed with the reason in place
 * of the switch: left out by a developer, or holding its own `seo` field,
 * whose values can be imported.
 */
function LockedRow({ type }: { type: SwitchedOffType }): JSX.Element {
  const count = countText(type.count);
  const ownSeo = type.reason === "own-seo";
  const summary = ownSeo
    ? [count, "Has its own field named seo, so Nextly leaves it as it is"]
    : [count, type.public ? "Public, without SEO" : "No public pages"];
  return (
    <div
      role="group"
      aria-label={type.label}
      className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
    >
      <span className="grid min-w-0 flex-1 gap-1 pl-7 text-muted-foreground">
        <TypeName type={type} />
        <span className="text-xs">{summary.filter(Boolean).join(" · ")}</span>
      </span>
      {ownSeo ? (
        <AdminLink
          href={IMPORT_PAGE_HREF}
          className="text-xs font-medium text-foreground underline underline-offset-2 hover:decoration-2"
        >
          Import its values
        </AdminLink>
      ) : (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock aria-hidden="true" className="size-3.5" />
          Left out in the site&apos;s code
        </span>
      )}
      <Switch checked={false} disabled aria-hidden="true" tabIndex={-1} />
    </div>
  );
}

/** Which types the list shows by their switch. */
type SwitchFilter = "all" | "on" | "off";

/** How many types bring the search and the filter. */
const SEARCH_FROM = 11;

/** A group of rows (Collections or Singles) under its heading. */
function TypeGroup({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}): JSX.Element {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <h3 id={id} className="text-sm font-medium text-foreground">
        {heading}
      </h3>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="flex justify-between border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span className="pl-7">Type</span>
          <span>SEO</span>
        </div>
        {children}
      </div>
    </section>
  );
}

/**
 * Every content type and its SEO switch, collections then Singles, each
 * opening to its title pattern, hiding and structured data; then the types
 * the site's code gives no SEO, greyed.
 */
export function ContentTypesTab({
  draft,
  change,
  types,
  switchedOff = [],
  savedOff = [],
  canChange = true,
}: TabProps & {
  types: readonly SeoContentType[];
  /** The site's other types, which the site's code gives no SEO. */
  switchedOff?: readonly SwitchedOffType[];
  /** The types whose SEO is off in the saved settings. */
  savedOff?: readonly string[];
  /** Whether the reader may change the settings, and so the switches. */
  canChange?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SwitchFilter>("all");
  const total = types.length + switchedOff.length;
  if (total === 0) {
    return (
      <SettingsCard>
        <div className="grid gap-1.5 p-4">
          <p className="text-sm font-semibold text-foreground">
            No content types yet
          </p>
          <p className="text-sm text-muted-foreground">
            Each type you add, in code or in the Schema Builder, shows here with
            SEO already on. Users, Media and plugins&apos; own collections never
            get SEO.
          </p>
        </div>
      </SettingsCard>
    );
  }
  const searching = total >= SEARCH_FROM;
  const words = query.trim().toLowerCase();
  const matches = (type: SeoContentType | SwitchedOffType) =>
    !searching || words === "" || type.label.toLowerCase().includes(words);
  const onCount = types.filter(type => isSeoOn(draft, type.key)).length;
  // The filter counts what is saved, as it filters by it. Off means a type
  // with SEO switched off: a type the site's code leaves out has no switch,
  // so it is neither on nor off and shows under All only.
  const offCount = types.filter(type => savedOff.includes(type.key)).length;
  // Filtered by the saved switch, so a row moved here stays in view, with
  // its note, until the change is saved.
  const shownTypes = types.filter(
    type =>
      matches(type) &&
      (!searching ||
        filter === "all" ||
        !savedOff.includes(type.key) === (filter === "on"))
  );
  const shownLocked = switchedOff.filter(
    type => matches(type) && (!searching || filter === "all")
  );
  const rowOf = (type: SeoContentType) => (
    <TypeRow
      key={type.key}
      type={type}
      draft={draft}
      change={change}
      open={open === type.key}
      toggle={() =>
        setOpen(current => (current === type.key ? null : type.key))
      }
      savedOff={savedOff.includes(type.key)}
      canChange={canChange}
    />
  );
  const collections = shownTypes.filter(type => type.kind !== "single");
  const singles = shownTypes.filter(type => type.kind === "single");
  const lockedCollections = shownLocked.filter(type => type.kind !== "single");
  const lockedSingles = shownLocked.filter(type => type.kind === "single");
  const nothingShown = shownTypes.length === 0 && shownLocked.length === 0;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Every content type gets SEO, including ones made in the Schema
          Builder. Switch it off for a type that isn&apos;t web pages.
        </p>
        <p className="text-xs text-muted-foreground">
          {total} {total === 1 ? "type" : "types"} · {onCount} with SEO after
          saving
        </p>
      </div>
      {searching ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label="Find a type"
              placeholder="Find a type"
              className="pl-8"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </div>
          <SegmentedChoice
            aria-label="Show types"
            size="bordered"
            options={[
              { value: "all", label: `All ${total}` },
              { value: "on", label: `SEO on ${types.length - offCount}` },
              { value: "off", label: `SEO off ${offCount}` },
            ]}
            value={filter}
            onSelect={next =>
              setFilter(next === "on" || next === "off" ? next : "all")
            }
          />
        </div>
      ) : null}
      {nothingShown ? (
        <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {words === "" ? (
            "No type is shown by this filter."
          ) : (
            <>
              No type matches &quot;{query.trim()}&quot;.{" "}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-2 hover:decoration-2"
                onClick={() => setQuery("")}
              >
                Clear the search
              </button>
            </>
          )}
        </div>
      ) : null}
      {collections.length + lockedCollections.length === 0 ? null : (
        <TypeGroup heading="Collections">
          {collections.map(rowOf)}
          {lockedCollections.map(type => (
            <LockedRow key={type.key} type={type} />
          ))}
        </TypeGroup>
      )}
      {singles.length + lockedSingles.length === 0 ? null : (
        <TypeGroup heading="Singles">
          {singles.map(rowOf)}
          {lockedSingles.map(type => (
            <LockedRow key={type.key} type={type} />
          ))}
        </TypeGroup>
      )}
      <div className="grid gap-1 text-xs text-muted-foreground">
        {canChange ? null : (
          <p>
            Only people who can change the site&apos;s SEO settings can switch
            SEO on or off for a type.
          </p>
        )}
        <p>Users, Media and plugins&apos; own collections never get SEO.</p>
      </div>
    </div>
  );
}
