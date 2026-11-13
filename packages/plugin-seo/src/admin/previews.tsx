/**
 * The preview at the top of the SEO tab: the page as Google lists it beside
 * a shared link's card, drawn from the page's answer as it is being typed.
 *
 * @module admin/previews
 */
import { EyeOff, ImageOff } from "lucide-react";
import type { ReactNode } from "react";

import type { SeoAnswer } from "../resolver/order";
import type { SeoTabContext } from "../tab/contract";
import {
  absoluteAddress,
  cutAt,
  fileNameOf,
  hostOf,
  resultsAddress,
  shareImageFit,
} from "../tab/display";
import { DESCRIPTION_LIMIT } from "../tab/problems";

import { cx } from "./parts";

/** About how many characters of a title a results page shows, with its cut. */
const RESULTS_TITLE_CUT = 61;

/** One of the two preview cards: its small heading, and what it shows. */
function PreviewFrame({
  label,
  children,
  flush = false,
}: {
  label?: string;
  children: ReactNode;
  /** Drawn edge to edge, for the share card's picture. */
  flush?: boolean;
}): ReactNode {
  return (
    <div
      className={cx(
        "min-w-0 overflow-hidden rounded-lg border border-border bg-card",
        !flush && "px-4 py-3.5"
      )}
    >
      {label === undefined ? null : (
        // 12px, the smallest text the admin draws.
        <div className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * The preview at the top of the panel: the page on Google beside the card a
 * shared link shows, side by side where there is room.
 */
export function PreviewCard({
  answer,
  site,
  status,
  heading,
}: {
  /**
   * What heads the cards where a surface says more than that it follows
   * typing: a template's panel names the page it previews with.
   */
  heading?: ReactNode;
  answer: SeoAnswer | undefined;
  site: SeoTabContext["site"] | undefined;
  /**
   * Whether a different title for sharing is typed for this page; absent
   * where the page has no such title to set.
   */
  sharedTitleTyped?: boolean | undefined;
  /** Whether the automatic values are being read, or could not be. */
  status: "ready" | "loading" | "failed";
}): ReactNode {
  return (
    <section aria-label="Preview" className="grid gap-2">
      {heading ?? null}
      {status === "failed" && answer !== undefined ? (
        <p className="m-0 text-xs text-warning-text">
          The automatic values could not be read again just now. This shows the
          last ones read.
        </p>
      ) : null}
      {answer === undefined || site === undefined ? (
        <PreviewFrame>
          <p className="m-0 text-[13px] text-muted-foreground">
            {status === "failed"
              ? "The automatic values could not be read just now. What you type is still saved with the page."
              : "Reading this page's automatic values…"}
          </p>
        </PreviewFrame>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <PreviewFrame label="On Google">
            <SearchResult answer={answer} site={site} />
          </PreviewFrame>
          <PreviewFrame flush>
            <ShareCard answer={answer} site={site} />
          </PreviewFrame>
        </div>
      )}
    </section>
  );
}

/**
 * The text under the result's link: none where the page asks for none, else
 * its description cut where Google cuts it, or sooner where the page set a
 * shorter limit.
 */
function resultText(answer: SeoAnswer): string {
  if (answer.display?.nosnippet) return "No text under the link";
  if (answer.description === undefined) {
    return "Google will pick text from the page, since nothing is set.";
  }
  return cutAt(
    answer.description.value,
    Math.min(answer.display?.maxSnippet ?? DESCRIPTION_LIMIT, DESCRIPTION_LIMIT)
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
      className={cx("min-w-0", hidden && "opacity-35")}
    >
      <div className="truncate text-xs leading-snug text-muted-foreground">
        {/* As Google writes it now: the host, then the path's parts. */}
        {resultsAddress(address).replace(/^https?:\/\//, "")}
      </div>
      <div
        data-testid="seo-search-title"
        className="mt-1 text-lg leading-[1.3] [overflow-wrap:anywhere] text-info-text"
      >
        {answer.title === undefined
          ? name
          : cutAt(answer.title.value, RESULTS_TITLE_CUT)}
      </div>
      <div
        data-testid="seo-search-description"
        className={cx(
          "mt-1 text-[13px] leading-normal [overflow-wrap:anywhere] text-muted-foreground",
          answer.display?.nosnippet && "italic"
        )}
      >
        {resultText(answer)}
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

/** The card a shared link shows. */
function ShareCard({
  answer,
  site,
}: {
  answer: SeoAnswer;
  site: SeoTabContext["site"];
}): ReactNode {
  const image = answer.image?.value;
  const fit = shareImageFit(image);
  return (
    <div data-testid="seo-share-card">
      {/* At the ratio networks draw a share card at, so a picture that
          fits shows uncut. */}
      <div className="relative grid aspect-[1.91/1] place-items-center overflow-hidden bg-muted text-muted-foreground">
        {image === undefined ? (
          <span className="flex items-center gap-1.5 text-xs">
            <ImageOff aria-hidden="true" className="size-4" />
            No share image
          </span>
        ) : (
          <>
            <img
              src={image.url}
              alt={image.alt ?? ""}
              className="absolute inset-0 size-full object-cover"
            />
            <span className="sr-only">{fileNameOf(image.url)}</span>
          </>
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
      <div className="border-t border-border px-3.5 py-2.5">
        <div className="text-xs text-muted-foreground lowercase">
          {hostOf(site.origin)}
        </div>
        <div
          data-testid="seo-share-title"
          className="mt-0.5 text-sm leading-[1.3] font-semibold [overflow-wrap:anywhere] text-foreground"
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
  );
}
