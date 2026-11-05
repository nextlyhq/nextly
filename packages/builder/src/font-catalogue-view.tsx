/**
 * The Google Fonts catalogue, shown in the Fonts tab in place of the site's
 * fonts: search it, filter it by category, preview each family in itself, and
 * add one to the site.
 *
 * Adding never downloads anything in the editor. It names a family, its
 * weights, styles and scripts to the host, whose server downloads the files
 * into the site's media; visitors' browsers then load fonts only from the
 * site. Previews are the one thing the editor's browser fetches, from the
 * catalogue's file host, while an author browses ({@link font-preview}).
 *
 * @module font-catalogue-view
 */
import {
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  toast,
} from "@nextlyhq/ui";
import { ArrowLeft, Search } from "lucide-react";
import * as React from "react";

import { EDITOR_WORDS } from "./editor-words";
import { ChoiceMenu } from "./font-choice-menu";
import {
  licenceName,
  SPECIMEN,
  weightName,
  type SiteFamily,
} from "./font-library";
import { previewFamily, usePreview } from "./font-preview";

/** One family in the catalogue, as the host hands it over. */
export interface CatalogueFamilyView {
  readonly id: string;
  readonly family: string;
  readonly category: string;
  readonly weights: readonly number[];
  readonly styles: readonly ("normal" | "italic")[];
  readonly subsets: readonly string[];
  readonly defSubset: string;
  readonly variable: boolean;
  readonly licence: string;
  /**
   * How much the family is used, which "Popular" orders by: higher is more.
   * Absent when the host could not say, and the list is then ordered by name.
   */
  readonly popularity?: number;
}

/** What the Fonts tab asks the catalogue to add: names, never addresses. */
export interface CatalogueAddRequest {
  readonly id: string;
  readonly weights: readonly number[] | "variable";
  readonly styles: readonly ("normal" | "italic")[];
  readonly subsets: readonly string[];
}

/** The host's catalogue: where it reads, previews from and adds through. */
export interface FontCatalogue {
  /** The catalogue's families, read through the host's server. */
  readonly load: (
    signal: AbortSignal
  ) => Promise<{ readonly families: readonly CatalogueFamilyView[] }>;
  /** Where one preview file loads from, in the editor only. */
  readonly previewUrl: (
    family: CatalogueFamilyView,
    weight: number | "variable",
    style: "normal" | "italic"
  ) => string;
  /** Add a family to the site. Resolves to a message when refused. */
  readonly add: (request: CatalogueAddRequest) => Promise<string | undefined>;
}

/** The list before the catalogue has answered, kept so its order is too. */
const NO_FAMILIES: readonly CatalogueFamilyView[] = Object.freeze([]);

/** How many families mount before the author asks for more. */
const PAGE_SIZE = 30;

const CATEGORIES = [
  ["all", "All categories"],
  ["sans-serif", "Sans serif"],
  ["serif", "Serif"],
  ["display", "Display"],
  ["handwriting", "Handwriting"],
  ["monospace", "Monospace"],
] as const;

type Category = (typeof CATEGORIES)[number][0];

// "Popular first" rather than "Popular", which beside the category filter
// could read as a filter for popular families only.
const SORTS = [
  ["popular", "Popular first"],
  ["name", "A–Z"],
] as const;

type Sort = (typeof SORTS)[number][0];

/** Names in the order a reader expects, whatever their case or accents. */
const BY_NAME = new Intl.Collator(undefined, { sensitivity: "base" });

/**
 * The families in the order chosen: the most used first, then by name among
 * equals; or by name alone. The catalogue arrives in its own order, which is
 * not promised to be either.
 */
function ordered(
  families: readonly CatalogueFamilyView[],
  sort: Sort
): CatalogueFamilyView[] {
  return [...families].sort(
    (a, b) =>
      (sort === "popular" ? (b.popularity ?? 0) - (a.popularity ?? 0) : 0) ||
      BY_NAME.compare(a.family, b.family)
  );
}

/** Whether the host said how much any family is used, so "Popular" can mean something. */
function knowsPopularity(families: readonly CatalogueFamilyView[]): boolean {
  return families.some(family => family.popularity !== undefined);
}

/** A category in words. */
function categoryName(category: string): string {
  return CATEGORIES.find(([value]) => value === category)?.[1] ?? category;
}

/** Scripts in the words a reader of them would use. */
const SUBSET_NAMES: Readonly<Record<string, string>> = {
  latin: "Latin",
  "latin-ext": "Latin Extended",
  cyrillic: "Cyrillic",
  "cyrillic-ext": "Cyrillic Extended",
  greek: "Greek",
  "greek-ext": "Greek Extended",
  vietnamese: "Vietnamese",
};

/** A script in words: known ones by name, others from their own spelling. */
function subsetName(subset: string): string {
  const known = SUBSET_NAMES[subset];
  if (known !== undefined) return known;
  const words = subset.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How many styles a family offers: one per weight and style. */
function styleCount(family: CatalogueFamilyView): number {
  return family.weights.length * family.styles.length;
}

/** `Sans serif · 18 styles · Variable`. */
function metaLine(family: CatalogueFamilyView): string {
  const count = styleCount(family);
  return [
    categoryName(family.category),
    `${String(count)} ${count === 1 ? "style" : "styles"}`,
    ...(family.variable ? ["Variable"] : []),
  ].join(" · ");
}

type Load =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; families: readonly CatalogueFamilyView[] };

/** The catalogue, read once per opening, and read again on "Try again". */
function useCatalogue(catalogue: FontCatalogue): {
  load: Load;
  retry: () => void;
} {
  const [attempt, setAttempt] = React.useState(0);
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  React.useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    catalogue.load(controller.signal).then(
      read => {
        if (!controller.signal.aborted) {
          setLoad({ status: "ready", families: read.families });
        }
      },
      () => {
        if (!controller.signal.aborted) setLoad({ status: "failed" });
      }
    );
    return () => controller.abort();
  }, [catalogue, attempt]);
  return { load, retry: () => setAttempt(count => count + 1) };
}

export function FontCatalogueView({
  catalogue,
  onBack,
  initialQuery = "",
  onSite,
}: {
  catalogue: FontCatalogue;
  /** Back to the site's fonts. */
  onBack: () => void;
  /** The search to open on, such as one the site's fonts found nothing for. */
  initialQuery?: string;
  /** The families already on the site. */
  onSite: readonly SiteFamily[];
}): React.JSX.Element {
  const { load, retry } = useCatalogue(catalogue);
  const [query, setQuery] = React.useState(initialQuery);
  const [category, setCategory] = React.useState<Category>("all");
  const [sort, setSort] = React.useState<Sort>("popular");
  const [sample, setSample] = React.useState("");
  const [pages, setPages] = React.useState(1);
  const search = React.useRef<HTMLInputElement>(null);

  // The view opens on its search box, so typing starts the search.
  React.useEffect(() => {
    search.current?.focus();
  }, []);

  const needle = query.trim().toLowerCase();
  const families = load.status === "ready" ? load.families : NO_FAMILIES;
  // Without figures "Popular" would be a promise the list cannot keep, so the
  // choice is not offered and the list reads by name.
  const sortable = knowsPopularity(families);
  const sorted = React.useMemo(
    () => ordered(families, sortable ? sort : "name"),
    [families, sortable, sort]
  );
  const matching =
    load.status === "ready"
      ? sorted.filter(
          family =>
            (category === "all" || family.category === category) &&
            family.family.toLowerCase().includes(needle)
        )
      : [];
  const shown = matching.slice(0, pages * PAGE_SIZE);
  const hidden = matching.length - shown.length;

  return (
    <div className="nx-vars nx-fonts nx-fonts-catalogue">
      <div className="nx-fonts-catalogue__head">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="nx-fonts-catalogue__back"
          aria-label={`Back to this site’s ${EDITOR_WORDS.fonts.toLowerCase()}`}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" size={14} />
          {EDITOR_WORDS.fonts}
        </Button>
        <h3 className="nx-fonts-catalogue__title">Google Fonts</h3>
      </div>
      <div className="nx-vars__search">
        <Search aria-hidden="true" size={16} />
        <Input
          ref={search}
          type="search"
          aria-label="Search Google Fonts"
          placeholder="Search Google Fonts"
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setPages(1);
          }}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.preventDefault();
              onBack();
            }
          }}
        />
      </div>
      <div className="nx-fonts-catalogue__filters">
        <div className="nx-fonts-catalogue__choices">
          <ChoiceMenu
            label="Category"
            value={category}
            options={CATEGORIES}
            onChange={next => {
              setCategory(next);
              setPages(1);
            }}
          />
          {sortable ? (
            <ChoiceMenu
              label="Sort"
              value={sort}
              options={SORTS}
              onChange={next => {
                setSort(next);
                setPages(1);
              }}
            />
          ) : null}
        </div>
        <Input
          type="text"
          aria-label="Preview text"
          placeholder="Type to preview"
          value={sample}
          onChange={event => setSample(event.target.value)}
        />
      </div>
      <div className="nx-vars__body">
        {load.status === "loading" ? <Loading /> : null}
        {load.status === "failed" ? (
          <div className="nx-fonts-catalogue__failed">
            <p className="nx-vars__alert" role="alert">
              Google Fonts could not be reached. The fonts already on this site
              still work.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="nx-vars-editor__button"
              onClick={retry}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {load.status === "ready" && matching.length === 0 ? (
          <p className="nx-vars__empty">No Google Fonts match this search.</p>
        ) : null}
        {shown.length > 0 ? (
          <ul className="nx-vars__list">
            {shown.map(family => (
              <CatalogueRow
                key={family.id}
                family={family}
                catalogue={catalogue}
                sample={sample}
                site={onSite.find(
                  each => each.key === family.family.toLowerCase()
                )}
              />
            ))}
          </ul>
        ) : null}
        <ShowMore
          count={Math.min(hidden, PAGE_SIZE)}
          onMore={() => setPages(count => count + 1)}
        />
        <p className="nx-vars__note">
          Previews load from Fontsource while you browse. Fonts you add are
          stored on your site.
        </p>
      </div>
    </div>
  );
}

/** The next page of families, named by how many it adds; nothing at the end. */
function ShowMore({
  count,
  onMore,
}: {
  count: number;
  onMore: () => void;
}): React.JSX.Element | null {
  if (count <= 0) return null;
  return (
    <button className="nx-vars__link" type="button" onClick={onMore}>
      {`Show ${String(count)} more`}
    </button>
  );
}

/** Six placeholder rows, still, and a status for a screen reader. */
function Loading(): React.JSX.Element {
  return (
    <>
      <p className="nx-vars__note" role="status">
        Loading Google Fonts&hellip;
      </p>
      <ul className="nx-vars__list" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <li className="nx-fonts__skeleton" key={index}>
            <span />
            <span />
          </li>
        ))}
      </ul>
    </>
  );
}

/** The preview's family when it has loaded; the admin's font until then. */
function previewStyle(
  family: CatalogueFamilyView,
  loaded: boolean
): React.CSSProperties | undefined {
  return loaded ? { fontFamily: `"${previewFamily(family.id)}"` } : undefined;
}

/** The weight a family's preview file is drawn from. */
function previewWeight(family: CatalogueFamilyView): number | "variable" {
  if (family.variable) return "variable";
  return family.weights.includes(400) ? 400 : (family.weights[0] ?? 400);
}

/** One family: a two-line row that opens its add editor beside the panel. */
function CatalogueRow({
  family,
  catalogue,
  sample,
  site,
}: {
  family: CatalogueFamilyView;
  catalogue: FontCatalogue;
  sample: string;
  site: SiteFamily | undefined;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [element, setElement] = React.useState<HTMLButtonElement | null>(null);
  const loaded = usePreview(
    element,
    family.id,
    catalogue.previewUrl(family, previewWeight(family), startingStyle(family))
  );
  const meta = metaLine(family);
  return (
    <li>
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <button
            ref={setElement}
            type="button"
            className="nx-vars__row nx-fonts-catalogue__row"
            aria-label={`${family.family}, ${meta}${site === undefined ? "" : ", added"}`}
            data-catalogue-family={family.id}
          >
            <span className="nx-fonts-catalogue__text">
              {/* The name whole on hover: cut when long, or drawn over by
                  the preview text. */}
              <span
                className="nx-fonts-catalogue__preview"
                style={previewStyle(family, loaded)}
                title={family.family}
              >
                {sample.trim() === "" ? family.family : sample}
              </span>
              <span className="nx-fonts-catalogue__meta">{meta}</span>
            </span>
            {site === undefined ? null : (
              <span className="nx-vars__chip nx-fonts__added">Added</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          className="nx-vars-editor nx-fonts-add"
          aria-label={`Add ${family.family}`}
        >
          <AddEditor
            family={family}
            catalogue={catalogue}
            sample={sample}
            loaded={loaded}
            site={site}
            onAdded={() => {
              setOpen(false);
              element?.focus();
            }}
          />
        </PopoverContent>
      </Popover>
    </li>
  );
}

/** The style a family starts from: its regular, or its italic when that's all it has. */
function startingStyle(family: CatalogueFamilyView): "normal" | "italic" {
  return family.styles.includes("normal") ? "normal" : "italic";
}

/** The weights to start with: Regular and Bold where offered, else the first. */
function startingWeights(family: CatalogueFamilyView): Set<number> {
  const both = family.weights.filter(
    weight => weight === 400 || weight === 700
  );
  const first = family.weights[0];
  return new Set(both.length > 0 ? both : first === undefined ? [] : [first]);
}

/**
 * The styles the site already has of a family, as `weight|style|script`: the
 * same cut in another script is another file, and still addable. A face that
 * names no script matches none, as the server's comparison of ranges does.
 */
function presentStyles(
  family: CatalogueFamilyView,
  site: SiteFamily | undefined
): Set<string> {
  const present = new Set<string>();
  for (const face of site?.faces ?? []) {
    const style = face.style === "italic" ? "italic" : "normal";
    // The weight as stored, so a static 400 is never taken for the variable
    // file's whole range; the planner compares faces the same way.
    const weight = (face.weight ?? "400").trim().replace(/\s+/g, " ");
    // A face that names no script (an upload, the site's code) covers no
    // catalogue script: the server adds the catalogue's file beside it.
    const subset = face.source?.subset ?? "";
    present.add(`${weight}|${style}|${subset}`);
  }
  return present;
}

/** A cut as a stored face declares its weight: a variable file its range. */
function declaredWeight(
  family: CatalogueFamilyView,
  cut: number | "variable"
): string {
  if (cut !== "variable") return String(cut);
  const low = Math.min(...family.weights);
  const high = Math.max(...family.weights);
  return low === high ? String(low) : `${String(low)} ${String(high)}`;
}

/** What the add button says, and whether it can be pressed. */
function addLabel(
  name: string,
  chosen: number,
  fresh: number,
  hasSome: boolean
): { label: string; ready: boolean } {
  const styles = (count: number): string =>
    `${String(count)} ${count === 1 ? "style" : "styles"}`;
  if (hasSome) {
    return fresh === 0
      ? { label: "Already on this site", ready: false }
      : {
          label: `Add ${String(fresh)} more ${fresh === 1 ? "style" : "styles"}`,
          ready: true,
        };
  }
  return chosen === 0
    ? { label: `Add ${name}`, ready: false }
    : { label: `Add ${name} \u00b7 ${styles(chosen)}`, ready: true };
}

/**
 * What an add asks for, from the editor's choices and the faces the site
 * has: the styles, the scripts, the weights (held ones included), whether a
 * cut is already on the site in every chosen script, and the button.
 */
function addSelection(
  family: CatalogueFamilyView,
  present: ReadonlySet<string>,
  choices: {
    weights: ReadonlySet<number>;
    italics: boolean;
    subsets: ReadonlySet<string>;
  }
): {
  base: "normal" | "italic";
  offersBoth: boolean;
  styles: Array<"normal" | "italic">;
  chosenSubsets: string[];
  held: (cut: number | "variable", style: string) => boolean;
  cuts: Array<number | "variable">;
  label: string;
  ready: boolean;
} {
  // A family that comes only in italic starts from its italic; italics are a
  // choice only where it has both.
  const base = startingStyle(family);
  const offersBoth = base === "normal" && family.styles.includes("italic");
  const styles: Array<"normal" | "italic"> =
    choices.italics && offersBoth ? [base, "italic"] : [base];
  const chosenSubsets = family.subsets.filter(subset =>
    choices.subsets.has(subset)
  );
  /** Whether the site has a cut in every script chosen. */
  const held = (cut: number | "variable", style: string): boolean =>
    chosenSubsets.length > 0 &&
    chosenSubsets.every(subset =>
      present.has(`${declaredWeight(family, cut)}|${style}|${subset}`)
    );
  const cuts: Array<number | "variable"> = family.variable
    ? ["variable"]
    : family.weights.filter(
        weight => choices.weights.has(weight) || held(weight, base)
      );
  const combos = cuts.flatMap(cut => styles.map(style => ({ cut, style })));
  // A style counts as new when any chosen script of it is missing.
  const fresh = combos.filter(combo => !held(combo.cut, combo.style)).length;
  const { label, ready } = addLabel(
    family.family,
    combos.length,
    fresh,
    present.size > 0
  );
  return { base, offersBoth, styles, chosenSubsets, held, cuts, label, ready };
}

/** The editor that adds one family: weights, italics, scripts, licence. */
function AddEditor({
  family,
  catalogue,
  sample,
  loaded,
  site,
  onAdded,
}: {
  family: CatalogueFamilyView;
  catalogue: FontCatalogue;
  sample: string;
  loaded: boolean;
  site: SiteFamily | undefined;
  onAdded: () => void;
}): React.JSX.Element {
  const ids = React.useId();
  const present = presentStyles(family, site);
  const [weights, setWeights] = React.useState(() => startingWeights(family));
  const [italics, setItalics] = React.useState(false);
  const [subsets, setSubsets] = React.useState(
    () => new Set([family.defSubset])
  );
  const [busy, setBusy] = React.useState(false);
  const [issue, setIssue] = React.useState<string | null>(null);

  const { base, offersBoth, styles, chosenSubsets, held, cuts, label, ready } =
    addSelection(family, present, { weights, italics, subsets });

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const submit = async (): Promise<void> => {
    if (!ready || busy || subsets.size === 0) return;
    setBusy(true);
    setIssue(null);
    try {
      const refusal = await catalogue.add({
        id: family.id,
        weights: family.variable
          ? "variable"
          : cuts.filter((cut): cut is number => cut !== "variable"),
        styles,
        subsets: chosenSubsets,
      });
      if (refusal !== undefined) {
        setIssue(refusal);
        return;
      }
      toast.success(`${family.family} is now on this site.`);
      onAdded();
    } finally {
      setBusy(false);
    }
  };

  const drawn = previewStyle(family, loaded);
  const low = Math.min(...family.weights);
  const high = Math.max(...family.weights);

  return (
    <div className="nx-vars-editor__body">
      <div className="nx-fonts__heading">
        <span className="nx-fonts__title nx-fonts__title--large" style={drawn}>
          {family.family}
        </span>
        <span className="nx-fonts__sample" style={drawn}>
          {sample.trim() === "" ? SPECIMEN : sample}
        </span>
      </div>

      {family.variable ? (
        <p className="nx-fonts__hint">
          {`Every weight from ${String(low)} to ${String(high)}, in one file.`}
        </p>
      ) : (
        <fieldset className="nx-fonts__fieldset">
          <legend className="nx-vars-editor__label">Weights</legend>
          <div className="nx-fonts__weights">
            {family.weights.map(weight => {
              const have = held(weight, base);
              const id = `${ids}-w${String(weight)}`;
              return (
                <div className="nx-fonts__check" key={weight}>
                  <Checkbox
                    id={id}
                    checked={have || weights.has(weight)}
                    disabled={busy || have}
                    onCheckedChange={() =>
                      setWeights(current => toggle(current, weight))
                    }
                  />
                  <label
                    htmlFor={id}
                    style={
                      loaded ? { ...drawn, fontWeight: weight } : undefined
                    }
                  >
                    {weightName(weight)}
                  </label>
                </div>
              );
            })}
          </div>
          <span className="nx-fonts__hint">Fewer styles load faster.</span>
        </fieldset>
      )}

      {offersBoth ? (
        <div className="nx-fonts__check">
          <Checkbox
            id={`${ids}-italic`}
            checked={italics}
            disabled={busy}
            onCheckedChange={checked => setItalics(checked === true)}
          />
          <label htmlFor={`${ids}-italic`}>Include italics</label>
        </div>
      ) : null}

      {family.subsets.length > 1 ? (
        <fieldset className="nx-fonts__fieldset">
          <legend className="nx-vars-editor__label">Languages</legend>
          {family.subsets.map(subset => {
            const id = `${ids}-s-${subset}`;
            return (
              <div className="nx-fonts__check" key={subset}>
                <Checkbox
                  id={id}
                  checked={subsets.has(subset)}
                  disabled={busy}
                  onCheckedChange={() =>
                    setSubsets(current => toggle(current, subset))
                  }
                />
                <label htmlFor={id}>{subsetName(subset)}</label>
              </div>
            );
          })}
        </fieldset>
      ) : null}

      <p className="nx-fonts__meta">{licenceName(family.licence)}</p>

      {issue === null ? null : (
        <p className="nx-vars-editor__issue" role="alert">
          {issue}
        </p>
      )}
      <p className="nx-fonts__live" role="status" aria-live="polite">
        {busy ? `Downloading ${family.family} to your site…` : ""}
      </p>

      <div className="nx-vars-editor__actions">
        <Button
          type="button"
          size="sm"
          className="nx-vars-editor__button nx-fonts__add-button"
          disabled={busy || !ready || subsets.size === 0}
          onClick={() => void submit()}
        >
          {busy ? (
            <>
              <Spinner aria-hidden="true" size="sm" />
              {`Adding ${family.family}…`}
            </>
          ) : (
            label
          )}
        </Button>
      </div>
    </div>
  );
}
