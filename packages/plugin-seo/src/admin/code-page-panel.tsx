/**
 * The panel that sets the SEO of one page built in code, beside the Pages
 * and addresses list: whether what is set reaches the page, a preview that
 * follows what is typed, the title and description, and under Advanced
 * hiding from search, the official address and a share image.
 *
 * @module admin/code-page-panel
 */
import {
  apiErrorMessage,
  Button,
  MediaPickerDialog,
  toastMutationResult,
  useMediaItem,
  usePluginRouteMutation,
} from "@nextlyhq/plugin-sdk/admin";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type Ref,
} from "react";

import {
  ADDRESSES_ROUTE_PATH,
  CODE_PAGE_SEO_ROUTE_PATH,
  type CodePageSeoInput,
  type SiteAddress,
} from "../code-pages/contract";
import { SEO_PLUGIN_NAME } from "../settings/contract";

import { Chevron } from "./pages-styles";
import {
  cut,
  developerNote,
  hostOf,
  resultAddress,
  valueSource,
} from "./pages-view";
import { Icon } from "./styles";

/** Where each source of an address is said to come from. */
export const SOURCE_LABELS: Record<SiteAddress["source"], string> = {
  entry: "Entry",
  built: "Built route",
  dynamic: "Declared by a dynamic route",
};

/** What the panel holds while a person edits. */
interface Draft {
  title: string;
  description: string;
  hidden: boolean;
  image: string | null;
}

/** A count of characters against what Google usually shows. */
function Count({ length, max }: { length: number; max: number }): JSX.Element {
  const over = length > max;
  return (
    <span
      className={over ? "nx-seo-count over" : "nx-seo-count"}
      title={over ? `Google usually shows about ${max} characters` : ""}
    >
      {length} / {max}
    </span>
  );
}

/** Where a field's value comes from, under the field. */
function Source({
  item,
  field,
  typed,
  onAutomatic,
}: {
  item: SiteAddress;
  field: "title" | "description";
  typed: boolean;
  onAutomatic: () => void;
}): JSX.Element {
  const source = valueSource(item, field, typed);
  switch (source.kind) {
    case "typed":
      return (
        <div className="nx-seo-src">
          <span className="nx-seo-chip typed">Typed for this address</span>
          <button
            type="button"
            className="nx-seo-linkbtn"
            onClick={onAutomatic}
          >
            Go back to automatic
          </button>
        </div>
      );
    case "code":
      return (
        <div className="nx-seo-src">
          <span className="nx-seo-chip code">Set in code</span>
          <span>
            by <code>{item.from}</code>.{" "}
            {source.connected
              ? "What you type here wins."
              : "What you type here wins once the route is connected."}
          </span>
        </div>
      );
    case "pattern":
      return (
        <div className="nx-seo-src">
          <span className="nx-seo-chip">Automatic</span>
          <span>
            from the site pattern <code>{source.pattern}</code>, with the
            route's page name, {item.name}
          </span>
        </div>
      );
    case "site":
      return (
        <div className="nx-seo-src">
          <span className="nx-seo-chip">Automatic</span>
          <span>{siteSourceText(source.field, source.found)}</span>
        </div>
      );
  }
}

/** What an automatic value from the site's defaults is said to be. */
function siteSourceText(
  field: "title" | "description",
  found: boolean
): string {
  if (field === "title") return found ? "the site's name" : "none yet";
  return found
    ? "the site's default description"
    : "none yet: the site has no default description";
}

/** Copies the note for a developer, and says so. */
function copyNote(item: SiteAddress): void {
  void navigator.clipboard
    ?.writeText(developerNote(item))
    .then(() =>
      toastMutationResult(
        `Copied a note for a developer about ${item.path}.`,
        undefined
      )
    );
}

/** The note at the top of the panel: whether what is set reaches the page. */
function ConnectionNote({ item }: { item: SiteAddress }): JSX.Element {
  if (item.standing === "not-connected") {
    return (
      <div className="nx-seo-dnote warn">
        <Icon name="warn" />
        <div className="t">
          <b>
            {item.name} is built in code and doesn't call the SEO function yet —
            ask a developer to add one line.
          </b>{" "}
          What you set here is kept, and reaches the page once that line is in.
          <div className="acts">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copyNote(item)}
            >
              Copy a note for a developer
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (item.source === "dynamic") {
    return (
      <div className="nx-seo-dnote">
        <Icon name="info" />
        <div className="t">
          Declared by <code>{item.from}</code>. What you set here applies to{" "}
          {item.path} only.
        </div>
      </div>
    );
  }
  return (
    <div className="nx-seo-dnote ok">
      <Icon name="check" />
      <div className="t">
        Connected: <code>{item.from}</code> calls the SEO function, so what you
        set here reaches the page.
      </div>
    </div>
  );
}

/** What the preview shows, as the panel stands. */
interface Shown {
  item: SiteAddress;
  siteName: string;
  address: string;
  title: string;
  description: string;
  hidden: boolean;
  imageUrl: string | undefined;
  /** Where the image shown comes from: chosen here, or automatic. */
  imageFrom: "chosen" | "code" | "site";
}

/** The page in Google's results, faded where it is hidden from search. */
function GoogleResult({ shown }: { shown: Shown }): JSX.Element {
  const result = (
    <div className="nx-seo-serp">
      <div className="site">
        <span className="fav" aria-hidden="true">
          {shown.siteName.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <div className="sname">{shown.siteName}</div>
          <div className="surl">{resultAddress(shown.address)}</div>
        </div>
      </div>
      <div className="stitle">{cut(shown.title, 61)}</div>
      <div className="sdesc">{cut(shown.description, 160)}</div>
    </div>
  );
  if (!shown.hidden) return result;
  return (
    <div className="nx-seo-pv-hidden">
      {result}
      <div className="over">
        <span>Hidden from search</span>
      </div>
    </div>
  );
}

/** What the card says of the image it shows. */
const IMAGE_HELP: Record<Shown["imageFrom"], string> = {
  chosen: "Uses the share image chosen for this address.",
  code: "Uses the share image the route's code sets.",
  site: "Uses the site's default share image.",
};

/** The card a link to the page makes when shared. */
function SharedCard({ shown }: { shown: Shown }): JSX.Element {
  const domain = hostOf(shown.address) ?? shown.address;
  const help =
    shown.imageUrl === undefined
      ? "No share image yet: choose one under Advanced, or set the site's default in SEO settings."
      : IMAGE_HELP[shown.imageFrom];
  return (
    <>
      <div className="nx-seo-card">
        <div className="img">
          {shown.imageUrl === undefined ? (
            <div className="art">
              <small>{domain}</small>
              <strong>{shown.item.name}</strong>
              <small>{shown.siteName}</small>
            </div>
          ) : (
            <img src={shown.imageUrl} alt="" />
          )}
        </div>
        <div className="meta">
          <div className="dom">{domain}</div>
          <div className="ct">{shown.title}</div>
          <div className="cd">{shown.description}</div>
        </div>
      </div>
      <p className="nx-seo-help nx-seo-card-help">{help}</p>
    </>
  );
}

/** How the page looks in Google's results and when shared, as typed. */
function Preview({ shown }: { shown: Shown }): JSX.Element {
  const [view, setView] = useState<"google" | "share">("google");
  const tab = (name: "google" | "share", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === name}
      onClick={() => setView(name)}
    >
      {label}
    </button>
  );
  return (
    <div className="nx-seo-pv">
      <div className="nx-seo-pv-head">
        <span className="lbl">Preview · updates as you type</span>
        <div className="nx-seo-seg" role="tablist" aria-label="Preview">
          {tab("google", "Google")}
          {tab("share", "When shared")}
        </div>
      </div>
      <div className="nx-seo-pv-body">
        {view === "google" ? (
          <GoogleResult shown={shown} />
        ) : (
          <SharedCard shown={shown} />
        )}
      </div>
    </div>
  );
}

/** A title or description, with its count, help and source. */
function TextField({
  item,
  field,
  value,
  shownLength,
  placeholder,
  onChange,
  inputRef,
}: {
  item: SiteAddress;
  field: "title" | "description";
  value: string;
  shownLength: number;
  placeholder: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}): JSX.Element {
  const id = `nx-seo-pages-${field}`;
  const isTitle = field === "title";
  return (
    <div className="nx-seo-sf">
      <div className="nx-seo-sf-head">
        <label htmlFor={id}>
          {isTitle ? "Title on Google" : "Description on Google"}
        </label>
        <Count length={shownLength} max={isTitle ? 60 : 160} />
      </div>
      <p className="nx-seo-help">
        {isTitle
          ? "The blue link people click in Google's results."
          : "The grey text under the link."}
      </p>
      {isTitle ? (
        <input
          ref={inputRef}
          id={id}
          className="nx-seo-inp"
          placeholder={placeholder}
          value={value}
          onChange={event => onChange(event.target.value)}
        />
      ) : (
        <textarea
          id={id}
          className="nx-seo-inp"
          rows={3}
          placeholder={placeholder}
          value={value}
          onChange={event => onChange(event.target.value)}
        />
      )}
      <Source
        item={item}
        field={field}
        typed={value.trim() !== ""}
        onAutomatic={() => onChange("")}
      />
    </div>
  );
}

/** The share image chosen for the address, or the site's default. */
function ShareImageRow({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}): JSX.Element {
  const [picking, setPicking] = useState(false);
  const chosen = useMediaItem(value ?? undefined).data;
  return (
    <div className="nx-seo-arow">
      <div>
        <div className="lab">Share image</div>
        <p className="nx-seo-help">
          {value === null
            ? "The site's default share image."
            : mediaSummary(chosen)}
        </p>
      </div>
      <div className="nx-seo-row">
        {value === null ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
          >
            Remove
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPicking(true)}
        >
          {value === null ? "Choose an image" : "Replace"}
        </Button>
      </div>
      <MediaPickerDialog
        mode="single"
        open={picking}
        onOpenChange={setPicking}
        accept="image/*"
        title="Share image"
        onSelect={picked => {
          const [first] = picked;
          if (first !== undefined) onChange(String(first.id));
          setPicking(false);
        }}
      />
    </div>
  );
}

/** A chosen image's name and size, or that it is still loading. */
function mediaSummary(
  media:
    | {
        originalFilename?: string | null;
        filename?: string | null;
        width?: number | null;
        height?: number | null;
      }
    | undefined
): string {
  if (media === undefined) return "Loading…";
  const name = media.originalFilename ?? media.filename ?? "Chosen image";
  return media.width && media.height
    ? `${name} · ${media.width} × ${media.height}`
    : name;
}

/** Hiding from search, the official address and the share image. */
function Advanced({
  item,
  address,
  draft,
  change,
}: {
  item: SiteAddress;
  address: string;
  draft: Draft;
  change: (next: Partial<Draft>) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="nx-seo-adv">
      <button
        type="button"
        className="nx-seo-adv-toggle"
        aria-expanded={open}
        aria-controls="nx-seo-pages-adv"
        onClick={() => setOpen(!open)}
      >
        <b>Advanced</b>
        <span className="sum">
          Hiding from search, official address, share image
        </span>
        <span className="chev">
          <Chevron />
        </span>
      </button>
      <div id="nx-seo-pages-adv" hidden={!open}>
        <div className="nx-seo-arow">
          <div>
            <div className="lab">Hide this page from search</div>
            <p className="nx-seo-help">
              Search engines won't list it, and it leaves the sitemap.
            </p>
          </div>
          <button
            type="button"
            className="nx-seo-sw"
            role="switch"
            aria-checked={draft.hidden}
            aria-label="Hide this page from search"
            onClick={() => change({ hidden: !draft.hidden })}
          />
        </div>
        <div className="nx-seo-arow">
          <div>
            <div className="lab">Official address</div>
            <p className="nx-seo-help">
              The one address search engines should credit for this page.
            </p>
          </div>
          <span />
          <div className="full">
            <div className="nx-seo-src">
              <span className="nx-seo-chip">Automatic</span>
              <span className="mono">{item.canonical ?? address}</span>
            </div>
          </div>
        </div>
        <ShareImageRow
          value={draft.image}
          onChange={image => change({ image })}
        />
      </div>
    </div>
  );
}

/** What the panel opens with: what was typed for the address. */
function initialDraft(item: SiteAddress): Draft {
  const typed = item.seo?.typed;
  return {
    title: typed?.title ?? "",
    description: typed?.description ?? "",
    hidden: typed?.hidden === true,
    image: typed?.image ?? null,
  };
}

/** The values beneath what a person types, shown where nothing is. */
function automaticOf(item: SiteAddress): {
  title: string;
  description: string;
} {
  const automatic = item.seo?.automatic;
  return {
    title: automatic?.title?.value ?? item.name,
    description: automatic?.description?.value ?? "",
  };
}

/** Text typed, or the automatic value where none is. */
const orAutomatic = (typed: string, automatic: string) =>
  typed.trim() === "" ? automatic : typed;

/**
 * What the preview shows for `draft`: the image chosen, or the site's
 * default while none is.
 */
function shownOf(
  item: SiteAddress,
  host: string,
  draft: Draft,
  chosenUrl: string | undefined
): Shown {
  const automatic = automaticOf(item);
  // With no image chosen, the one the page falls back to: its route's or
  // the site's default.
  const fallback = item.seo?.automatic.image?.url;
  return {
    item,
    siteName: item.seo?.siteName ?? host,
    address: item.canonical ?? `https://${host}${item.path}`,
    title: orAutomatic(draft.title, automatic.title),
    description: orAutomatic(draft.description, automatic.description),
    hidden: draft.hidden,
    imageUrl: draft.image === null ? fallback : chosenUrl,
    imageFrom:
      draft.image !== null
        ? "chosen"
        : item.seo?.automatic.image?.from === "code"
          ? "code"
          : "site",
  };
}

/** What a save says it did, by whether the route is connected yet. */
function savedMessage(item: SiteAddress): string {
  return item.standing === "not-connected"
    ? `Saved for ${item.path}. It reaches the page once the route calls the SEO function.`
    : `Saved for ${item.path}. The page uses it from the next visit.`;
}

/** The draft of one page's SEO, what it shows, and its save. */
function useCodePageDraft(
  item: SiteAddress,
  host: string,
  onSaved: () => void
) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(item));
  const chosen = useMediaItem(draft.image ?? undefined).data;
  const save = usePluginRouteMutation<CodePageSeoInput, { path: string }>({
    plugin: SEO_PLUGIN_NAME,
    path: CODE_PAGE_SEO_ROUTE_PATH,
    invalidates: [ADDRESSES_ROUTE_PATH],
  });
  const shown = shownOf(item, host, draft, chosen?.url ?? undefined);
  const submit = async () => {
    const saved = await save.write({ path: item.path, ...draft });
    if (saved === undefined) return;
    toastMutationResult(savedMessage(item), undefined);
    onSaved();
  };
  const change = (next: Partial<Draft>) => setDraft({ ...draft, ...next });
  return {
    draft,
    change,
    automatic: automaticOf(item),
    shown,
    address: shown.address,
    save,
    submit,
  };
}

/** The style placing the panel `top` pixels down the window. */
function drawerTop(
  top: number
): CSSProperties & Record<"--nx-seo-drawer-top", string> {
  return { "--nx-seo-drawer-top": `${top}px` };
}

/** The panel that sets the SEO of one page built in code. */
export function CodePagePanel({
  item,
  host,
  onClose,
}: {
  item: SiteAddress;
  host: string;
  onClose: () => void;
}): JSX.Element {
  const { draft, change, automatic, shown, address, save, submit } =
    useCodePageDraft(item, host, onClose);
  const titleField = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  // The panel opens below the admin's top bar: from where the page's main
  // region starts, which the admin's layout decides.
  const [top, setTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const main = panel.current?.closest("main");
    if (main) setTop(Math.max(0, main.getBoundingClientRect().top));
  }, []);
  useEffect(() => {
    titleField.current?.focus();
  }, []);
  return (
    <aside
      ref={panel}
      style={top === undefined ? undefined : drawerTop(top)}
      className="nx-seo-drawer"
      role="dialog"
      aria-modal="false"
      aria-labelledby="nx-seo-pages-dh"
      onKeyDown={event => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="nx-seo-dh">
        <div>
          <h2 id="nx-seo-pages-dh">SEO for {item.path}</h2>
          <span className="nx-seo-help">
            {SOURCE_LABELS[item.source]} · <span>{item.from}</span>
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="x" />
        </Button>
      </div>
      <div className="nx-seo-db">
        <ConnectionNote item={item} />
        <Preview shown={shown} />
        <TextField
          item={item}
          field="title"
          value={draft.title}
          shownLength={shown.title.length}
          placeholder={automatic.title}
          onChange={title => change({ title })}
          inputRef={titleField}
        />
        <TextField
          item={item}
          field="description"
          value={draft.description}
          shownLength={shown.description.length}
          placeholder={automatic.description}
          onChange={description => change({ description })}
        />
        <Advanced item={item} address={address} draft={draft} change={change} />
        {save.error ? (
          <p className="nx-seo-error" role="alert">
            Not saved. {apiErrorMessage(save.error)}
          </p>
        ) : null}
      </div>
      <div className="nx-seo-df">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={save.pending}
          onClick={() => void submit()}
        >
          {save.pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </aside>
  );
}
