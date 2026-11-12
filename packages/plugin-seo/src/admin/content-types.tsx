/**
 * The Content types tab: each content type with SEO, where its pages live,
 * how their titles are made, whether the whole type is hidden from search,
 * and what its pages are described as in structured data, with the fields
 * each detail is read from.
 *
 * @module admin/content-types
 */
import { Button, Switch } from "@nextlyhq/plugin-sdk/admin";
import { useId, useState, type JSX } from "react";

import type {
  MappableField,
  SeoContentType,
  SwitchedOffType,
} from "../settings/contract";
import { tokenKey } from "../settings/patterns";
import {
  DETAIL_GUESSES,
  DETAIL_LABELS,
  STRUCTURED_DATA_TYPE_KEYS,
  STRUCTURED_DATA_TYPES,
  isStructuredDataTypeKey,
  type StructuredDataDetail,
  type StructuredDataTypeKey,
} from "../structured-data/catalog";
import type { DetailSource } from "../structured-data/rules";

import {
  FROM_THE_PAGE,
  holdsField,
  isHidden,
  mappingOf,
  missingDetails,
  patternOf,
  patternProblem,
  structuredTypeOf,
  withDetailField,
  withHidden,
  withStructuredType,
} from "./settings-draft";
import { Icon } from "./styles";
import { PatternEditor, type TabProps } from "./tabs";

/** The types that need details, which are the only ones with any to map. */
const MAPPABLE_TYPES: readonly StructuredDataTypeKey[] =
  STRUCTURED_DATA_TYPE_KEYS.filter(
    key => STRUCTURED_DATA_TYPES[key].needs.length > 0
  );

/** Which editor is open under a type's row, if any. */
type OpenEditor =
  | { key: string; kind: "pattern" }
  | { key: string; kind: "map"; type: StructuredDataTypeKey };

/** Where a type's pages live: their address, or that they have none yet. */
function TypeAddress({ type }: { type: SeoContentType }): JSX.Element {
  if (!type.public) {
    return (
      <>
        <span className="nx-seo-notpublic">
          <Icon name="warn" /> Not public yet
        </span>
        <p className="nx-seo-help">A developer sets where these pages live.</p>
      </>
    );
  }
  // One entry's address, shown as an example of where the type's pages live.
  return type.example?.address ? (
    <>
      <span className="nx-seo-eg">e.g.</span>{" "}
      <span className="nx-seo-code">{type.example.address}</span>
    </>
  ) : (
    <span className="nx-seo-help">Set in code</span>
  );
}

/** A type's structured data choice, and how many details it still lacks. */
function StructuredDataCell({
  type,
  draft,
  change,
  mapOpen,
  toggleMap,
}: TabProps & {
  type: SeoContentType;
  mapOpen: boolean;
  toggleMap: (structuredType: StructuredDataTypeKey) => void;
}): JSX.Element {
  const chosen = structuredTypeOf(draft, type.key);
  const needs = chosen === undefined ? [] : STRUCTURED_DATA_TYPES[chosen].needs;
  const missing =
    chosen === undefined ? [] : missingDetails(draft, type, chosen);
  return (
    <>
      <select
        className="nx-seo-select"
        aria-label={`Structured data for ${type.label}`}
        value={chosen ?? ""}
        onChange={event => {
          const value = event.target.value;
          change(current =>
            withStructuredType(
              current,
              type.key,
              isStructuredDataTypeKey(value) ? value : undefined
            )
          );
        }}
      >
        <option value="">Automatic</option>
        {STRUCTURED_DATA_TYPE_KEYS.map(key => (
          <option key={key} value={key}>
            {STRUCTURED_DATA_TYPES[key].label}
          </option>
        ))}
      </select>
      <div className="nx-seo-sdstate">
        {chosen === undefined ? (
          <span className="nx-seo-help">
            Article where a page has an author and a date, else Web page
          </span>
        ) : needs.length === 0 ? (
          <span className="nx-seo-help">Made from the page itself</span>
        ) : (
          <>
            <button
              type="button"
              className="nx-seo-linkbtn"
              aria-expanded={mapOpen}
              onClick={() => toggleMap(chosen)}
            >
              Map details
            </button>{" "}
            <span
              className={missing.length > 0 ? "nx-seo-warnc" : "nx-seo-help"}
            >
              · {missing.length > 0 ? `${missing.length} missing` : "all set"}
            </span>
          </>
        )}
      </div>
    </>
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

/** A fixed value the site's code gives a detail, in the field choice. */
const FIXED = "=fixed";

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
  if (source === undefined) return { ...base, value: "" };
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
      <option value="">
        {choice.guess?.label ?? FROM_THE_PAGE[detail] ?? "Not chosen yet"}
      </option>
      {choice.fixed === undefined ? null : (
        <option value={FIXED}>{`Always "${choice.fixed}"`}</option>
      )}
      {choice.gone === undefined ? null : (
        <option value={choice.gone}>{`${choice.gone}, not found`}</option>
      )}
      {choice.path === undefined ? null : (
        <option value={choice.path}>{choice.path}</option>
      )}
      {type.mappableFields
        // The field found by its name is the first option while unchosen.
        .filter(
          each => each.name !== choice.guess?.name || choice.value === each.name
        )
        .map(each => (
          <option key={each.name} value={each.name}>
            {labels.get(each.name)}
          </option>
        ))}
    </>
  );
}

/** One detail's row: the field it is read from, and where that leaves it. */
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
    (choice.value === "" ? choice.guess : undefined);
  const needed = required
    ? `Google needs this for ${typeLabel}`
    : `Optional for ${typeLabel}`;
  return (
    <div className="nx-seo-mapline">
      <span className="nx-seo-label">{DETAIL_LABELS[detail]}</span>
      <select
        className="nx-seo-select"
        aria-label={`Field that holds ${DETAIL_LABELS[detail]}`}
        aria-invalid={lacking}
        value={choice.value}
        onChange={event => {
          const next = event.target.value;
          if (next !== FIXED) choose(next);
        }}
      >
        <DetailOptions type={type} detail={detail} choice={choice} />
      </select>
      <span className="nx-seo-help">
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
  const id = useId();
  const mapping = mappingOf(draft, type.key, structuredType);
  const missing = missingDetails(draft, type, structuredType);
  const { label, needs } = STRUCTURED_DATA_TYPES[structuredType];
  const isDefault = structuredTypeOf(draft, type.key) === structuredType;
  return (
    <div className="nx-seo-pedit">
      <div className="nx-seo-row nx-seo-mapfor">
        <label className="nx-seo-label" htmlFor={id}>
          Details for
        </label>
        <select
          id={id}
          className="nx-seo-select nx-seo-select-fit"
          value={structuredType}
          onChange={event => {
            const value = event.target.value;
            if (isStructuredDataTypeKey(value)) setType(value);
          }}
        >
          {MAPPABLE_TYPES.map(key => (
            <option key={key} value={key}>
              {STRUCTURED_DATA_TYPES[key].label}
            </option>
          ))}
        </select>
        <span className="nx-seo-help">
          on {type.label}
          {isDefault ? " (this type's default)" : ", for pages that choose it"}
        </span>
      </div>
      <div className="nx-seo-mapgrid">
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
      <p className="nx-seo-help">
        {missing.length > 0
          ? `Until every needed detail has a field, ${label} details are left out of these pages and listed in Problems.`
          : "All set. Only details visible on the page are used."}{" "}
        If no field fits, a developer can add one.
      </p>
      <div>
        <Button type="button" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** How many entries a type has, when the reader may count them. */
function EntryCount({
  count,
}: {
  count: number | undefined;
}): JSX.Element | null {
  const text = countText(count);
  return text === undefined ? null : <small>{text}</small>;
}

/** A type's entry count in words, where the reader may count them. */
function countText(count: number | undefined): string | undefined {
  if (count === undefined) return undefined;
  if (count === 0) return "No entries yet";
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

/** A type the site's code gives no SEO: greyed, with nothing to set. */
function SwitchedOffRow({ type }: { type: SwitchedOffType }): JSX.Element {
  const count = countText(type.count);
  return (
    <tr className="nx-seo-off">
      <td className="nx-seo-switchcell">
        <Switch
          checked={false}
          disabled
          aria-label={`SEO for ${type.label}`}
          title="Set in the site's configuration by a developer"
        />
      </td>
      <td className="nx-seo-tname">
        <b>{type.label}</b>
        <small>
          {count === undefined
            ? "SEO switched off in code"
            : `${count} · SEO switched off in code`}
        </small>
      </td>
      <td data-label="Public address">
        <span className="nx-seo-help">
          {type.public ? "Public, without SEO" : "No public pages"}
        </span>
      </td>
      <td aria-hidden="true" />
      <td aria-hidden="true" />
      <td aria-hidden="true" />
    </tr>
  );
}

/** A type's title pattern as a chip that opens its editor, with any problem under it. */
function PatternCell({
  type,
  draft,
  open,
  toggle,
}: {
  type: SeoContentType;
  draft: TabProps["draft"];
  open: boolean;
  toggle: () => void;
}): JSX.Element {
  const { pattern, own } = patternOf(draft, type.key);
  const problem = open ? null : patternProblem(pattern, type);
  return (
    <>
      <button
        type="button"
        className="nx-seo-pattern"
        aria-expanded={open}
        aria-label={`Edit the title pattern for ${type.label}`}
        onClick={toggle}
      >
        {pattern}
        {own ? null : <small>default</small>}
      </button>
      {problem === null ? null : <p className="nx-seo-error">{problem}</p>}
    </>
  );
}

/** One content type's row, and the editor open under it, if any. */
function TypeRows({
  type,
  draft,
  change,
  open,
  setOpen,
}: TabProps & {
  type: SeoContentType;
  open: OpenEditor | null;
  setOpen: (open: OpenEditor | null) => void;
}): JSX.Element {
  const patternOpen = open?.key === type.key && open.kind === "pattern";
  const map = open?.key === type.key && open.kind === "map" ? open : null;
  const hidden = isHidden(draft, type.key);
  return (
    <>
      <tr>
        <td className="nx-seo-switchcell">
          <Switch
            checked
            disabled
            aria-label={`SEO for ${type.label}`}
            title="Set in the site's configuration by a developer"
          />
        </td>
        <td className="nx-seo-tname">
          <b>{type.label}</b>
          <EntryCount count={type.count} />
        </td>
        <td data-label="Public address">
          <TypeAddress type={type} />
        </td>
        <td data-label="Title pattern">
          <PatternCell
            type={type}
            draft={draft}
            open={patternOpen}
            toggle={() =>
              setOpen(patternOpen ? null : { key: type.key, kind: "pattern" })
            }
          />
        </td>
        <td data-label="Hide whole group">
          <Switch
            checked={hidden}
            aria-label={`Hide all ${type.label} from search`}
            onCheckedChange={checked =>
              change(current => withHidden(current, type.key, checked))
            }
          />
        </td>
        <td data-label="Structured data">
          <StructuredDataCell
            type={type}
            draft={draft}
            change={change}
            mapOpen={map !== null}
            toggleMap={structuredType =>
              setOpen(
                map === null
                  ? { key: type.key, kind: "map", type: structuredType }
                  : null
              )
            }
          />
        </td>
      </tr>
      {patternOpen || map !== null ? (
        <tr className="nx-seo-editrow">
          <td className="nx-seo-switchcell" aria-hidden="true" />
          <td colSpan={5}>
            {map === null ? (
              <PatternEditor
                type={type}
                draft={draft}
                change={change}
                onDone={() => setOpen(null)}
              />
            ) : (
              <DetailsEditor
                type={type}
                structuredType={map.type}
                draft={draft}
                change={change}
                setType={structuredType =>
                  setOpen({ key: type.key, kind: "map", type: structuredType })
                }
                onDone={() => setOpen(null)}
              />
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Where each kind of page lives and how its titles are made. */
export function ContentTypesTab({
  draft,
  change,
  types,
  switchedOff = [],
  editing,
  setEditing,
}: TabProps & {
  types: readonly SeoContentType[];
  /** The site's other types, which the site's code gives no SEO. */
  switchedOff?: readonly SwitchedOffType[];
  /** The type whose title pattern is open, kept by the page across saves. */
  editing: string | null;
  setEditing: (key: string | null) => void;
}): JSX.Element {
  const [mapping, setMapping] = useState<OpenEditor | null>(null);
  const open: OpenEditor | null =
    editing !== null ? { key: editing, kind: "pattern" } : mapping;
  const setOpen = (next: OpenEditor | null) => {
    setEditing(next?.kind === "pattern" ? next.key : null);
    setMapping(next?.kind === "map" ? next : null);
  };
  if (types.length === 0) {
    return (
      <p className="nx-seo-help">
        No content type has SEO yet. A developer chooses which do in the
        site&apos;s configuration.
      </p>
    );
  }
  return (
    <>
      {/* Wide enough for every column, scrolling sideways where the screen is
          narrower, as the admin's other wide tables do; a phone stacks it. */}
      <div className="nx-seo-tbox nx-seo-typescroll">
        <table className="nx-seo-tbl nx-seo-types">
          <thead>
            <tr>
              <th scope="col" className="nx-seo-switchcell">
                SEO
              </th>
              <th scope="col">Content type</th>
              <th scope="col">Public address</th>
              <th scope="col">Title pattern</th>
              <th scope="col">Hide whole group</th>
              <th scope="col">Structured data</th>
            </tr>
          </thead>
          <tbody>
            {types.map(type => (
              <TypeRows
                key={type.key}
                type={type}
                draft={draft}
                change={change}
                open={open}
                setOpen={setOpen}
              />
            ))}
            {switchedOff.map(type => (
              <SwitchedOffRow key={type.key} type={type} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="nx-seo-help nx-seo-lock">
        <Icon name="lock" />
        <span>
          The SEO switch for a content type is set in the site&apos;s
          configuration by a developer, so the database and the admin always
          agree. Hiding a whole group keeps every page in it out of search,
          whatever each page says.
        </span>
      </p>
    </>
  );
}
