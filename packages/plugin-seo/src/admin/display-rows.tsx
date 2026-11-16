/**
 * The Advanced section's rows about how search results may show the page:
 * its image preview size, the text under its link, its images in image
 * search, a date to drop from search, and, closed away, the controls only
 * other search engines read. Each is Google's, from its robots meta tag
 * page; the words say what each costs, since a mistake here is quiet.
 *
 * @module admin/display-rows
 */
import type { PageImagePreview } from "@nextlyhq/plugin-sdk";
import {
  Input,
  navigateTo,
  SegmentedChoice,
  Switch,
} from "@nextlyhq/plugin-sdk/admin";
import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { SETTINGS_PAGE_HREF } from "../settings/contract";

import type { AdvancedProps } from "./advanced";
import { Chip, cx, LinkAction, Note, SourceRow } from "./parts";
import { keyOf, Row, RowButton, useOutsideChange } from "./rows";

/** Where the site's default for image previews is set. */
const SITE_DEFAULT_HREF = `${SETTINGS_PAGE_HREF}?tab=crawlers`;

/** The names of the `seo` group's display fields, which the rows are offered for. */
export const DISPLAY_FIELDS = [
  "maxImagePreview",
  "maxSnippet",
  "nosnippet",
  "noimageindex",
  "unavailableAfter",
  "noarchive",
  "nocache",
] as const;

/** Whether the group declares `name`, or is not known yet. */
function declares(props: AdvancedProps, name: string): boolean {
  return props.context === undefined || props.context.fields.includes(name);
}

/** The rows, under their heading, for the display fields the group declares. */
export function DisplayRows(props: AdvancedProps): ReactNode {
  const has = (name: string) => declares(props, name);
  return (
    <>
      <div className="border-t border-border-subtle px-3.5 pt-3.5 pb-1 text-[12.5px] font-medium text-muted-foreground">
        How search results may show this page
      </div>
      {has("maxImagePreview") ? <ImagePreviewRow {...props} /> : null}
      {has("maxSnippet") || has("nosnippet") ? <SnippetRow {...props} /> : null}
      {has("noimageindex") ? <ImageSearchRow {...props} /> : null}
      {has("unavailableAfter") ? <DropDateRow {...props} /> : null}
      {has("noarchive") || has("nocache") ? (
        <OtherEnginesRows {...props} />
      ) : null}
    </>
  );
}

/** A link within the admin, opened as the admin's own links are. */
function AdminLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}): ReactNode {
  return (
    <a
      href={href}
      className="font-medium text-foreground underline underline-offset-2 hover:decoration-2"
      onClick={event => {
        // A new tab or window is the browser's to open.
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigateTo(href);
      }}
    >
      {children}
    </a>
  );
}

const SIZE_OPTIONS = [
  { value: "large", label: "Large" },
  { value: "standard", label: "Standard" },
  { value: "none", label: "None" },
] as const;

/** What each size the page chose for itself means. */
const SIZE_MEANS: Readonly<Record<PageImagePreview, string>> = {
  large:
    "Google may show a big picture from this page in results and in Discover.",
  standard:
    "Google may show a picture of the usual size from this page in results and in Discover.",
  none: "Google shows no picture from this page in results or in Discover.",
};

function ImagePreviewRow({
  answer,
  context,
  writable,
  errors,
  onSet,
}: AdvancedProps): ReactNode {
  const id = useId();
  const preview = answer?.display?.imagePreview;
  // The size the site's default gives, which a page need not store.
  const siteSize =
    context?.levels.site.largeImagePreviews === false ? undefined : "large";
  return (
    <Row
      error={errors.maxImagePreview}
      label="Image preview size"
      labelId={`${id}-label`}
      help="How big a picture from this page Google may show in results and in Discover."
      control={
        <SegmentedChoice
          aria-labelledby={`${id}-label`}
          size="bordered"
          options={SIZE_OPTIONS}
          value={preview?.value}
          disabled={!writable}
          onSelect={next =>
            onSet("maxImagePreview", next === siteSize ? null : next)
          }
        />
      }
    >
      {preview?.from === "page" ? (
        <SourceRow>
          <Chip kind="typed">Set for this page</Chip>
          <span>{SIZE_MEANS[preview.value]}</span>
          <span className="basis-full">
            <LinkAction
              disabled={!writable}
              onClick={() => onSet("maxImagePreview", null)}
            >
              Go back to the site&apos;s default
            </LinkAction>
          </span>
        </SourceRow>
      ) : (
        <SourceRow>
          <Chip>Automatic</Chip>
          <span>
            {siteSize === undefined
              ? "Google's own size: large previews are off in "
              : "the site's default, set in "}
            <AdminLink href={SITE_DEFAULT_HREF}>
              Settings › Search engines and AI
            </AdminLink>
          </span>
        </SourceRow>
      )}
    </Row>
  );
}

const SNIPPET_OPTIONS = [
  { value: "any", label: "Any length" },
  { value: "shorter", label: "Shorter" },
  { value: "none", label: "None" },
] as const;

/** Why typed characters are not a limit, or none where they are one. */
function snippetProblem(text: string): string | undefined {
  if (text.trim() === "") return undefined;
  if (!/^\d+$/.test(text.trim())) return "Type a whole number of characters.";
  if (Number(text) === 0) {
    return '0 means no text at all. Choose "None" for that, so the warning about AI Overviews shows.';
  }
  return undefined;
}

/** The limit typed, as stored: a whole number above 0, else none. */
function limitOf(text: string): number | null {
  return snippetProblem(text) === undefined && text.trim() !== ""
    ? Number(text)
    : null;
}

/**
 * The text under the link: any length, a limit in characters, or none. A
 * limit of 0 is refused and points to None, the one choice that says what
 * hiding the text costs.
 */
function SnippetRow(props: AdvancedProps): ReactNode {
  const { values, writable, errors, onSet } = props;
  const id = useId();
  // Each choice only where the group declares the field it writes, so the
  // tab never sets a directive a site's own `seo` fields leave out.
  const offered = SNIPPET_OPTIONS.filter(
    option =>
      option.value === "any" ||
      declares(props, option.value === "shorter" ? "maxSnippet" : "nosnippet")
  );
  const stored =
    typeof values.maxSnippet === "number" ? values.maxSnippet : undefined;
  const none = values.nosnippet === true;
  // Shorter stays chosen while its number is being typed, before one is kept.
  const [shorter, setShorter] = useState(stored !== undefined);
  const [text, setText] = useState(stored === undefined ? "" : String(stored));
  const wrote = useOutsideChange(
    keyOf(values.maxSnippet, values.nosnippet),
    () => {
      setShorter(typeof values.maxSnippet === "number");
      setText(
        typeof values.maxSnippet === "number" ? String(values.maxSnippet) : ""
      );
    }
  );
  const write = (maxSnippet: number | null, nosnippet: boolean) => {
    wrote(keyOf(maxSnippet, nosnippet));
    if (declares(props, "maxSnippet") && maxSnippet !== (stored ?? null)) {
      onSet("maxSnippet", maxSnippet);
    }
    if (declares(props, "nosnippet") && nosnippet !== none) {
      onSet("nosnippet", nosnippet);
    }
  };
  const choose = (next: string) => {
    setShorter(next === "shorter");
    if (next === "any") setText("");
    write(next === "shorter" ? limitOf(text) : null, next === "none");
  };
  const chosen = none ? "none" : shorter ? "shorter" : "any";
  return (
    <Row
      error={errors.maxSnippet ?? errors.nosnippet}
      label="Text under the link"
      labelId={`${id}-label`}
      help="Google writes a short text from the page to show under its link. You can make it shorter or stop it."
      control={
        <SegmentedChoice
          aria-labelledby={`${id}-label`}
          size="bordered"
          options={offered}
          value={chosen}
          disabled={!writable}
          onSelect={choose}
        />
      }
    >
      {chosen === "shorter" ? (
        <ShorterLimit
          text={text}
          writable={writable}
          onType={next => {
            setText(next);
            // Only a limit is kept: what is not one stays in the field with
            // its reason, and the stored limit stays until a valid one, or
            // Any length, replaces it.
            if (snippetProblem(next) === undefined) write(limitOf(next), false);
          }}
        />
      ) : null}
      {chosen === "none" ? <NoSnippetWarning /> : null}
    </Row>
  );
}

/** The number of characters a shorter text may hold, and what it means. */
function ShorterLimit({
  text,
  writable,
  onType,
}: {
  text: string;
  writable: boolean;
  onType: (text: string) => void;
}): ReactNode {
  const id = useId();
  const problem = snippetProblem(text);
  return (
    <>
      <div className="flex items-center gap-2.5 text-[13px] text-foreground">
        <Input
          autoFocus
          inputMode="numeric"
          aria-label="Characters at most"
          aria-invalid={problem !== undefined}
          aria-describedby={id}
          value={text}
          disabled={!writable}
          className="h-8 w-[88px]"
          onChange={event => onType(event.target.value)}
        />
        characters at most
      </div>
      <p
        id={id}
        role={problem === undefined ? undefined : "alert"}
        className={cx(
          "m-0 text-[12.5px] leading-[1.45]",
          problem === undefined
            ? "text-muted-foreground"
            : "font-medium text-danger-text"
        )}
      >
        {problem ??
          "Google may still show less. Any length is right for most pages."}
      </p>
    </>
  );
}

/**
 * What no text under the link costs. Google's robots meta tag page: nosnippet
 * applies to every result, AI Overviews and AI Mode included, and keeps the
 * page from being a direct input to them.
 */
function NoSnippetWarning(): ReactNode {
  return (
    <Note tone="warning">
      <b className="font-semibold">
        No text will show under this page&apos;s link in any Google result.
      </b>{" "}
      Google also won&apos;t use the page as a direct source in AI Overviews or
      AI Mode. The page itself stays in search. To keep one passage out instead,
      turn on &quot;Never quote this&quot; for that section in Page Builder.
    </Note>
  );
}

function ImageSearchRow({
  values,
  writable,
  errors,
  onSet,
}: AdvancedProps): ReactNode {
  const label = "Show this page's images in image search";
  return (
    <Row
      error={errors.noimageindex}
      label={label}
      help="Off asks Google not to index the pictures on this page. A picture used on another page can still appear from there."
      control={
        <Switch
          aria-label={label}
          checked={values.noimageindex !== true}
          disabled={!writable}
          onCheckedChange={shown => onSet("noimageindex", !shown)}
        />
      }
    />
  );
}

/** A stored moment as a `datetime-local` value in UTC: `2026-12-31T23:59`. */
function inputValueOf(value: unknown): string {
  const at =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string"
        ? Date.parse(value)
        : Number.NaN;
  return Number.isNaN(at) ? "" : new Date(at).toISOString().slice(0, 16);
}

/** A `datetime-local` value, read as UTC, as the moment stored; none for blank. */
function storedMomentOf(input: string): string | null {
  if (input === "") return null;
  const at = Date.parse(`${input}:00.000Z`);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/**
 * A date and time, in UTC, after which Google stops showing the page. The
 * page stays online; once the date passes it is hidden from search, which
 * the row and the page's problems say.
 */
function DropDateRow({
  values,
  answer,
  writable,
  errors,
  onSet,
}: AdvancedProps): ReactNode {
  const id = useId();
  const held = inputValueOf(values.unavailableAfter);
  const [setting, setSetting] = useState(held !== "");
  const wrote = useOutsideChange(keyOf(values.unavailableAfter), () =>
    setSetting(inputValueOf(values.unavailableAfter) !== "")
  );
  const write = (next: string | null) => {
    wrote(keyOf(next));
    onSet("unavailableAfter", next);
  };
  const passed = answer?.display?.unavailableAfter?.passed === true;
  return (
    <Row
      error={errors.unavailableAfter}
      label="Drop from search after a date"
      help="Google stops showing the page after the date. The page itself stays online."
      control={
        setting ? (
          <RowButton
            disabled={!writable}
            onClick={() => {
              setSetting(false);
              write(null);
            }}
          >
            Remove the date
          </RowButton>
        ) : (
          <RowButton disabled={!writable} onClick={() => setSetting(true)}>
            Set a date
          </RowButton>
        )
      }
    >
      {setting ? (
        <>
          <Input
            autoFocus={held === ""}
            type="datetime-local"
            aria-label="Drop from search after"
            aria-describedby={`${id}-date`}
            value={held}
            disabled={!writable}
            className="h-8 w-[220px]"
            onChange={event => write(storedMomentOf(event.target.value))}
          />
          {passed ? (
            <p
              id={`${id}-date`}
              className="m-0 text-[12.5px] leading-[1.45] font-medium text-warning-text"
            >
              That date has passed. Google may already have dropped the page.
              Remove the date to bring it back.
            </p>
          ) : (
            <p
              id={`${id}-date`}
              className="m-0 text-[12.5px] leading-[1.45] text-muted-foreground"
            >
              Times are UTC. To take the page down, unpublish it instead.
            </p>
          )}
        </>
      ) : undefined}
    </Row>
  );
}

/** What is switched on among the controls for other search engines. */
function otherEnginesSummary(noarchive: boolean, nocache: boolean): string {
  if (noarchive && nocache) return "noarchive and nocache on";
  if (noarchive) return "noarchive on";
  if (nocache) return "nocache on";
  return "Both off. Google ignores them.";
}

/**
 * `noarchive` and `nocache`, closed away and off by default, each its own
 * switch. Google uses neither; what they do elsewhere is not described here.
 */
function OtherEnginesRows({
  values,
  context,
  writable,
  errors,
  onSet,
}: AdvancedProps): ReactNode {
  const id = useId();
  const noarchive = values.noarchive === true;
  const nocache = values.nocache === true;
  // Open where one is on, so what is set is in view.
  const [open, setOpen] = useState(noarchive || nocache);
  const has = (name: string) =>
    context === undefined || context.fields.includes(name);
  return (
    <div className="border-t border-border-subtle">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3.5 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronRight
          aria-hidden="true"
          className={cx(
            "size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90"
          )}
        />
        <b className="text-[13px] font-semibold text-foreground">
          Controls for other search engines
        </b>
        <span className="text-xs text-muted-foreground">
          {otherEnginesSummary(noarchive, nocache)}
        </span>
      </button>
      <div id={`${id}-body`} hidden={!open}>
        {has("noarchive") ? (
          <Row
            error={errors.noarchive}
            label="noarchive"
            help="Asks search engines not to keep a stored copy of this page. Google doesn't use it."
            control={
              <Switch
                aria-label="noarchive"
                checked={noarchive}
                disabled={!writable}
                onCheckedChange={on => onSet("noarchive", on)}
              />
            }
          />
        ) : null}
        {has("nocache") ? (
          <Row
            error={errors.nocache}
            label="nocache"
            help="A similar request some search engines read. Google doesn't use it."
            control={
              <Switch
                aria-label="nocache"
                checked={nocache}
                disabled={!writable}
                onCheckedChange={on => onSet("nocache", on)}
              />
            }
          />
        ) : null}
      </div>
    </div>
  );
}
