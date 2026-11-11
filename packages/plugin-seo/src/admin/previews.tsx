/**
 * The preview at the top of the SEO tab: the page as Google lists it, and as
 * a shared link's card, drawn from the page's answer as it is being typed.
 *
 * @module admin/previews
 */
import { EyeOff, ImageOff } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import type { SeoAnswer } from "../resolver/order";
import type { SeoTabContext } from "../tab/contract";
import {
  absoluteAddress,
  cutAt,
  hostOf,
  resultsAddress,
  shareImageFit,
} from "../tab/display";
import { DESCRIPTION_LIMIT } from "../tab/problems";

import { cx } from "./parts";

type PreviewKind = "google" | "share";

const KINDS: { kind: PreviewKind; label: string }[] = [
  { kind: "google", label: "Google" },
  { kind: "share", label: "When shared" },
];

/** About how many characters of a title a results page shows, with its cut. */
const RESULTS_TITLE_CUT = 61;

/** The preview card, with its two views. */
export function PreviewCard({
  answer,
  site,
  status,
  sharedTitleTyped,
  heading,
}: {
  /**
   * What heads the card where a surface says more than that it follows
   * typing: a template's panel names the page it previews with.
   */
  heading?: ReactNode;
  answer: SeoAnswer | undefined;
  site: SeoTabContext["site"] | undefined;
  /** Whether a different title for sharing is typed for this page. */
  sharedTitleTyped: boolean;
  /** Whether the automatic values are being read, or could not be. */
  status: "ready" | "loading" | "failed";
}): ReactNode {
  const [kind, setKind] = useState<PreviewKind>("google");
  const id = useId();
  return (
    <section
      aria-label="Preview"
      className="rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border-subtle py-2 pr-2.5 pl-3.5">
        {heading ?? (
          <span className="text-xs font-semibold text-muted-foreground">
            Preview · updates as you type
          </span>
        )}
        <div
          role="tablist"
          aria-label="Preview"
          className="inline-flex flex-wrap gap-0.5 rounded-[9px] bg-muted p-[3px]"
        >
          {KINDS.map(each => (
            <button
              key={each.kind}
              type="button"
              role="tab"
              id={`${id}-${each.kind}`}
              aria-selected={kind === each.kind}
              aria-controls={`${id}-panel`}
              onClick={() => setKind(each.kind)}
              className={cx(
                "cursor-pointer rounded-[7px] border-0 px-2.5 py-[5px] text-[13px]",
                kind === each.kind
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "bg-transparent font-medium text-muted-foreground hover:text-foreground"
              )}
            >
              {each.label}
            </button>
          ))}
        </div>
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${kind}`}
        className="@container px-5 pt-[18px] pb-5"
      >
        {status === "failed" && answer !== undefined ? (
          <p className="m-0 mb-3 text-xs text-warning-text">
            The automatic values could not be read again just now. This shows
            the last ones read.
          </p>
        ) : null}
        {answer === undefined || site === undefined ? (
          <p className="m-0 text-[13px] text-muted-foreground">
            {status === "failed"
              ? "The automatic values could not be read just now. What you type is still saved with the page."
              : "Reading this page's automatic values…"}
          </p>
        ) : kind === "google" ? (
          <SearchResult answer={answer} site={site} />
        ) : (
          <ShareCard
            answer={answer}
            site={site}
            sharedTitleTyped={sharedTitleTyped}
          />
        )}
      </div>
    </section>
  );
}

/** The page as one result on Google, with the overlay when it is hidden. */
function SearchResult({
  answer,
  site,
}: {
  answer: SeoAnswer;
  site: SeoTabContext["site"];
}): ReactNode {
  const address =
    answer.canonical === undefined
      ? site.origin
      : absoluteAddress(site.origin, answer.canonical.value);
  const name = site.name ?? hostOf(site.origin);
  const hidden = !answer.robots.value.index;
  const result = (
    <div
      data-testid="seo-search-result"
      className={cx(
        "max-w-[600px] font-[Arial,sans-serif]",
        hidden && "opacity-35"
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid size-[26px] place-items-center rounded-full border border-border bg-muted text-[11px] font-bold text-foreground"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="text-sm leading-tight text-foreground">{name}</div>
          <div className="truncate text-xs leading-snug text-muted-foreground">
            {resultsAddress(address)}
          </div>
        </div>
      </div>
      <div
        data-testid="seo-search-title"
        className="mt-[7px] mb-[3px] text-xl leading-[1.3] [overflow-wrap:anywhere] text-info-text"
      >
        {answer.title === undefined
          ? name
          : cutAt(answer.title.value, RESULTS_TITLE_CUT)}
      </div>
      <div
        data-testid="seo-search-description"
        className="text-sm leading-[1.58] [overflow-wrap:anywhere] text-muted-foreground"
      >
        {answer.description === undefined
          ? "Google will pick text from the page, since nothing is set."
          : cutAt(answer.description.value, DESCRIPTION_LIMIT)}
      </div>
    </div>
  );
  if (!hidden) return result;
  return (
    <div className="relative">
      {result}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[13px] font-semibold text-foreground shadow-md">
          <EyeOff aria-hidden="true" className="size-4 text-muted-foreground" />
          Hidden from search: Google won&apos;t list this page
        </span>
      </div>
    </div>
  );
}

/** The card a shared link shows, and what each network does with it. */
function ShareCard({
  answer,
  site,
  sharedTitleTyped,
}: {
  answer: SeoAnswer;
  site: SeoTabContext["site"];
  sharedTitleTyped: boolean;
}): ReactNode {
  const image = answer.image?.value;
  const fit = shareImageFit(image);
  return (
    <div className="grid gap-[18px] @xl:grid-cols-[minmax(0,500px)_1fr] @xl:items-start">
      <div
        data-testid="seo-share-card"
        className="overflow-hidden rounded-lg border border-border bg-card"
      >
        <div className="relative aspect-[1.91/1] overflow-hidden bg-muted">
          {image === undefined ? (
            <div className="grid h-full place-items-center text-muted-foreground">
              <ImageOff aria-hidden="true" className="size-6" />
            </div>
          ) : (
            <img
              src={image.url}
              alt={image.alt ?? ""}
              className="size-full object-cover"
            />
          )}
          {/* Where the card cuts a picture taller than itself. The line sits
              over the picture whatever the theme, so it is drawn light. */}
          {fit?.cutTopAndBottom ? (
            <span
              aria-hidden="true"
              data-testid="seo-share-crop"
              className="absolute inset-x-0 top-0 border-t border-dashed border-white/70"
            />
          ) : null}
        </div>
        <div className="border-t border-border-subtle bg-muted px-3 py-2.5">
          <div className="text-xs text-muted-foreground lowercase">
            {hostOf(site.origin)}
          </div>
          <div
            data-testid="seo-share-title"
            className="mt-0.5 text-[15px] leading-[1.3] font-semibold [overflow-wrap:anywhere] text-foreground"
          >
            {answer.socialTitle?.value ?? site.name ?? hostOf(site.origin)}
          </div>
          {answer.socialDescription === undefined ? null : (
            <div className="mt-0.5 line-clamp-2 text-[13px] leading-[1.4] text-muted-foreground">
              {answer.socialDescription.value}
            </div>
          )}
        </div>
      </div>
      <ul className="m-0 grid list-none gap-1.5 p-0 text-[12.5px] leading-[1.55] text-muted-foreground">
        <li>
          <b className="font-semibold text-foreground">
            LinkedIn, Slack, Facebook and WhatsApp
          </b>{" "}
          show a card like this. Each trims the text a little differently.
        </li>
        <li>
          <b className="font-semibold text-foreground">X</b> shows the image and
          the site name only.
        </li>
        {fit === undefined ? null : (
          <li
            data-testid="seo-share-fit"
            className={cx(!fit.fits && "font-semibold text-warning-text")}
          >
            {fit.text}
          </li>
        )}
        <li>
          {sharedTitleTyped
            ? "Using the different title for sharing, set under Advanced."
            : "The shared title is the Google title. Set a different one under Advanced."}
        </li>
        {image === undefined ? (
          <li>
            There is no share image yet, so networks show the text alone. Choose
            one under Advanced.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
