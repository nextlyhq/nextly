/**
 * The panel that sets the SEO of one page built in code, beside the Pages
 * and addresses list: whether what is set reaches the page, a preview that
 * follows what is typed, the title and description, and under Advanced
 * hiding from search, the official address and a share image.
 *
 * Drawn with the SEO panel's own parts (`SeoTextField`, `PreviewCard`,
 * `AdvancedFrame`, the rows, chips and notes), so a page built in code is
 * edited as an entry's SEO tab edits one; only what is said of a value set
 * in the route's code, and the save, are its own.
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
import { Switch } from "@nextlyhq/ui";
import { Check, Info } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from "react";

import {
  ADDRESSES_ROUTE_PATH,
  CODE_PAGE_SEO_ROUTE_PATH,
  LONGEST_SEO_TEXT,
  type AutomaticValue,
  type CodePageSeoInput,
  type SiteAddress,
} from "../code-pages/contract";
import type { SeoAnswer, Sourced } from "../resolver/order";
import { SEO_PLUGIN_NAME } from "../settings/contract";
import { characters, DESCRIPTION_LIMIT, TITLE_LIMIT } from "../tab/problems";

import { AdvancedFrame } from "./advanced";
import { developerNote, valueSource } from "./pages-view";
import { Chip, LinkAction, Note, SourceRow } from "./parts";
import { PreviewCard } from "./previews";
import { Row, RowButton } from "./rows";
import { SeoTextField } from "./SeoPanel";
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

/** Code text, as the SEO panel's source lines set it. */
function Code({ children }: { children: ReactNode }): JSX.Element {
  return (
    <code className="rounded bg-muted px-[5px] py-px font-mono text-xs text-foreground [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

/** Where a field's value comes from, under the field. */
function Source({
  id,
  item,
  field,
  typed,
  onAutomatic,
}: {
  id: string;
  item: SiteAddress;
  field: "title" | "description";
  typed: boolean;
  onAutomatic: () => void;
}): JSX.Element {
  const source = valueSource(item, field, typed);
  switch (source.kind) {
    case "typed":
      return (
        <SourceRow id={id}>
          <Chip kind="typed">Typed for this address</Chip>
          <LinkAction onClick={onAutomatic}>Go back to automatic</LinkAction>
        </SourceRow>
      );
    case "code":
      return (
        <SourceRow id={id}>
          <Chip kind="code">Set in code</Chip>
          <span>
            by <Code>{item.from}</Code>.{" "}
            {source.connected
              ? "What you type here wins."
              : "What you type here wins once the route is connected."}
          </span>
        </SourceRow>
      );
    case "pattern":
      return (
        <SourceRow id={id}>
          <Chip>Automatic</Chip>
          <span>
            from the site pattern <Code>{source.pattern}</Code>, with the
            route's page name, {item.name}
          </span>
        </SourceRow>
      );
    case "site":
      return (
        <SourceRow id={id}>
          <Chip>Automatic</Chip>
          <span>{siteSourceText(source.field, source.found)}</span>
        </SourceRow>
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
      <Note tone="warning">
        <b className="font-semibold">
          {item.name} is built in code and doesn't call the SEO function yet —
          ask a developer to add one line.
        </b>{" "}
        What you set here is kept, and reaches the page once that line is in.
        <div className="mt-2 flex flex-wrap gap-1.5">
          <RowButton onClick={() => copyNote(item)}>
            Copy a note for a developer
          </RowButton>
        </div>
      </Note>
    );
  }
  if (item.source === "dynamic") {
    return (
      <Note icon={<Info className="size-4" />}>
        Declared by <Code>{item.from}</Code>. What you set here applies to{" "}
        {item.path} only.
      </Note>
    );
  }
  return (
    <Note tone="success" icon={<Check className="size-4" />}>
      Connected: <Code>{item.from}</Code> calls the SEO function, so what you
      set here reaches the page.
    </Note>
  );
}

/** What the Advanced share image row says of the image the page shows. */
const IMAGE_HELP = {
  chosen: "Uses the share image chosen for this address.",
  code: "Uses the share image the route's code sets.",
  site: "The site's default share image.",
} as const;

/** The share image chosen for the address, or the one the page falls back to. */
function ShareImageRow({
  item,
  value,
  onChange,
}: {
  item: SiteAddress;
  value: string | null;
  onChange: (value: string | null) => void;
}): JSX.Element {
  const [picking, setPicking] = useState(false);
  const chosen = useMediaItem(value ?? undefined).data;
  const fallback = item.seo?.automatic.image?.from === "code" ? "code" : "site";
  return (
    <Row
      label="Share image"
      help={
        value === null
          ? IMAGE_HELP[fallback]
          : `${IMAGE_HELP.chosen} ${mediaSummary(chosen)}`
      }
      control={
        <div className="flex flex-wrap justify-end gap-1.5">
          {value === null ? null : (
            <RowButton onClick={() => onChange(null)}>Remove</RowButton>
          )}
          <RowButton onClick={() => setPicking(true)}>
            {value === null ? "Choose an image" : "Replace"}
          </RowButton>
        </div>
      }
    >
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
    </Row>
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
  const hide = "Hide this page from search";
  return (
    <AdvancedFrame
      summary="Hiding from search, official address, share image"
      open={open}
      onOpenChange={setOpen}
    >
      <Row
        label={hide}
        help="Search engines won't list it, and it leaves the sitemap."
        control={
          <Switch
            aria-label={hide}
            checked={draft.hidden}
            onCheckedChange={checked => change({ hidden: checked })}
          />
        }
      />
      <Row
        label="Official address"
        help="The one address search engines should credit for this page."
      >
        <SourceRow>
          <Chip>Automatic</Chip>
          <span className="font-mono text-xs text-foreground [overflow-wrap:anywhere]">
            {item.canonical ?? address}
          </span>
        </SourceRow>
      </Row>
      <ShareImageRow
        item={item}
        value={draft.image}
        onChange={image => change({ image })}
      />
    </AdvancedFrame>
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

/**
 * The value used for a title or description: what is typed, else the
 * automatic one, else the page's own name where one stands in, else none.
 * Blank text is no value.
 */
function usedText(
  typed: string,
  automatic: AutomaticValue | undefined,
  named?: string
): Sourced<string> | undefined {
  if (typed.trim() !== "") return { value: typed, from: "page" };
  if (automatic !== undefined && automatic.value.trim() !== "") {
    return { value: automatic.value, from: automatic.from };
  }
  return named === undefined ? undefined : { value: named, from: "content" };
}

/**
 * The page's answer as the panel stands, for the preview: what is typed on
 * top of the automatic values, the image chosen or the one it falls back
 * to, and hidden from search where it is switched so.
 */
function previewAnswer(
  item: SiteAddress,
  address: string,
  draft: Draft,
  chosen: { url: string; width?: number; height?: number } | undefined
): SeoAnswer {
  const automatic = item.seo?.automatic;
  const title = usedText(draft.title, automatic?.title, item.name);
  const description = usedText(draft.description, automatic?.description, "");
  const image = shownImage(draft, automatic?.image, chosen);
  return {
    ...(title === undefined ? {} : { title, socialTitle: title }),
    ...(description === undefined
      ? {}
      : { description, socialDescription: description }),
    ...(image === undefined ? {} : { image: { value: image, from: "page" } }),
    canonical: { value: address, from: "address" },
    robots: {
      value: { index: !draft.hidden, follow: true },
      from: draft.hidden ? "page" : "site",
    },
  };
}

/** The image the preview shows: the one chosen, else the one the page falls back to. */
function shownImage(
  draft: Draft,
  fallback: { url: string; width?: number; height?: number } | undefined,
  chosen: { url: string; width?: number; height?: number } | undefined
): { url: string; width?: number; height?: number } | undefined {
  if (draft.image !== null) return chosen;
  return fallback === undefined ? undefined : withSize(fallback);
}

/** An image with only the sizes it has. */
function withSize(image: {
  url: string;
  width?: number | undefined;
  height?: number | undefined;
}): { url: string; width?: number; height?: number } {
  return {
    url: image.url,
    ...(image.width === undefined ? {} : { width: image.width }),
    ...(image.height === undefined ? {} : { height: image.height }),
  };
}

/** What a save says it did, by whether the route is connected yet. */
function savedMessage(item: SiteAddress): string {
  return item.standing === "not-connected"
    ? `Saved for ${item.path}. It reaches the page once the route calls the SEO function.`
    : `Saved for ${item.path}. The page uses it from the next visit.`;
}

/** A chosen media item's address and size, where it has been read. */
function chosenImage(
  media:
    | { url?: string | null; width?: number | null; height?: number | null }
    | undefined
): { url: string; width?: number; height?: number } | undefined {
  if (media?.url === undefined || media.url === null) return undefined;
  return withSize({
    url: media.url,
    width: media.width ?? undefined,
    height: media.height ?? undefined,
  });
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
  const address = item.canonical ?? `https://${host}${item.path}`;
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
    answer: previewAnswer(item, address, draft, chosenImage(chosen)),
    site: {
      ...(item.seo?.siteName === undefined ? {} : { name: item.seo.siteName }),
      origin: `https://${host}`,
    },
    address,
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
  const { draft, change, automatic, answer, site, address, save, submit } =
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
  // Nothing is edited while a save is on its way, so what it sends is what
  // the panel holds when it closes.
  const writable = !save.pending;
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
        <PreviewCard answer={answer} site={site} status="ready" />
        <fieldset className="nx-seo-fields" disabled={save.pending}>
          <SeoTextField
            label="Title on Google"
            help="The blue link people click in Google's results."
            value={draft.title}
            placeholder={automatic.title}
            count={characters(answer.title?.value ?? "")}
            limit={TITLE_LIMIT}
            maxLength={LONGEST_SEO_TEXT}
            writable={writable}
            inputRef={titleField}
            onChange={title => change({ title: title ?? "" })}
            source={id => (
              <Source
                id={id}
                item={item}
                field="title"
                typed={draft.title.trim() !== ""}
                onAutomatic={() => change({ title: "" })}
              />
            )}
          />
          <SeoTextField
            multiline
            label="Description on Google"
            help="The grey text under the link."
            value={draft.description}
            placeholder={automatic.description}
            count={characters(answer.description?.value ?? "")}
            limit={DESCRIPTION_LIMIT}
            maxLength={LONGEST_SEO_TEXT}
            writable={writable}
            onChange={description => change({ description: description ?? "" })}
            source={id => (
              <Source
                id={id}
                item={item}
                field="description"
                typed={draft.description.trim() !== ""}
                onAutomatic={() => change({ description: "" })}
              />
            )}
          />
          <Advanced
            item={item}
            address={address}
            draft={draft}
            change={change}
          />
        </fieldset>
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
