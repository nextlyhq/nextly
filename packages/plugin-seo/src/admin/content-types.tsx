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

import type { SeoContentType } from "../settings/contract";
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

import {
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
  return type.example?.address ? (
    <span className="nx-seo-code">{type.example.address}</span>
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

/** The field the page's markup reads `detail` from when none is chosen. */
function guessedField(
  type: SeoContentType,
  detail: StructuredDataDetail
): string | undefined {
  const guesses = new Set(DETAIL_GUESSES[detail].map(tokenKey));
  return type.mappableFields.find(field => guesses.has(tokenKey(field.name)))
    ?.label;
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
  const label = STRUCTURED_DATA_TYPES[structuredType].label;
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
        {STRUCTURED_DATA_TYPES[structuredType].needs.map(detail => {
          const chosen = mapping[detail];
          const field = typeof chosen === "string" ? chosen : "";
          const guess = guessedField(type, detail);
          const lacking = missing.includes(detail);
          const chosenLabel = type.mappableFields.find(
            each => each.name === field
          )?.label;
          return (
            <div key={detail} className="nx-seo-mapline">
              <span className="nx-seo-label">{DETAIL_LABELS[detail]}</span>
              <select
                className="nx-seo-select"
                aria-label={`Field that holds ${DETAIL_LABELS[detail]}`}
                aria-invalid={lacking}
                value={field}
                onChange={event => {
                  const value = event.target.value;
                  change(current =>
                    withDetailField(
                      current,
                      type.key,
                      structuredType,
                      detail,
                      value
                    )
                  );
                }}
              >
                <option value="">
                  {guess === undefined
                    ? "Not chosen yet"
                    : `${guess}, by its name`}
                </option>
                {type.mappableFields.map(each => (
                  <option key={each.name} value={each.name}>
                    {each.label}
                  </option>
                ))}
              </select>
              <span className="nx-seo-help">
                {chosenLabel !== undefined
                  ? `from each entry's ${chosenLabel}`
                  : guess !== undefined
                    ? `from each entry's ${guess}`
                    : `Google needs this for ${label}`}
              </span>
            </div>
          );
        })}
      </div>
      <p className="nx-seo-help">
        {missing.length > 0
          ? `Until every detail has a field, ${label} details are left out of these pages and listed in Problems.`
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
  const { pattern, own } = patternOf(draft, type.key);
  const patternOpen = open?.key === type.key && open.kind === "pattern";
  const map = open?.key === type.key && open.kind === "map" ? open : null;
  const problem = patternOpen ? null : patternProblem(pattern, type);
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
          {type.count === undefined ? null : (
            <small>
              {type.count === 0
                ? "No entries yet"
                : `${type.count} ${type.count === 1 ? "entry" : "entries"}`}
            </small>
          )}
        </td>
        <td data-label="Public address">
          <TypeAddress type={type} />
        </td>
        <td data-label="Title pattern">
          <button
            type="button"
            className="nx-seo-pattern"
            aria-expanded={patternOpen}
            aria-label={`Edit the title pattern for ${type.label}`}
            onClick={() =>
              setOpen(patternOpen ? null : { key: type.key, kind: "pattern" })
            }
          >
            {pattern}
            {own ? null : <small>default</small>}
          </button>
          {problem === null ? null : <p className="nx-seo-error">{problem}</p>}
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
  editing,
  setEditing,
}: TabProps & {
  types: readonly SeoContentType[];
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
