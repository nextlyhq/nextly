/**
 * The SEO settings screen's tabs: General, Content types, Brand and
 * Crawlers. Each draws part of one draft and reports changes to it; the page
 * saves them together.
 *
 * @module admin/tabs
 */
import { Button, Input, Textarea } from "@nextlyhq/plugin-sdk/admin";
import { useId, useRef, type JSX } from "react";

import type { SeoContentType } from "../settings/contract";
import {
  defaultTitlePattern,
  fillPattern,
  SEPARATORS,
  SITE_NAME_TOKEN,
  TITLE_TOKEN,
} from "../settings/patterns";
import { productionAddressProblem } from "../settings/production-addresses";
import { profileAddressProblem } from "../settings/stored-values";

import {
  AI_CHOICES,
  AI_CHOICES_NOTE,
  ChoiceCards,
  SITE_KIND_CHOICES,
} from "./choices";
import { MediaChoice } from "./MediaChoice";
import {
  networkOf,
  patternOf,
  patternProblem,
  previewOf,
  withSeparator,
  type SettingsDraft,
} from "./settings-draft";
import { Icon } from "./styles";

/** What every tab is handed: the draft, and how to change it. */
export interface TabProps {
  draft: SettingsDraft;
  change: (next: (draft: SettingsDraft) => SettingsDraft) => void;
}

/** The longest title Google shows in full, about. */
const TITLE_LIMIT = 60;

/** A labelled text field with one plain sentence under it. */
function TextField({
  label,
  help,
  value,
  onChange,
  placeholder,
  multiline = false,
  readOnly = false,
  mono = false,
  wide = false,
}: {
  label: string;
  help: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  readOnly?: boolean;
  mono?: boolean;
  wide?: boolean;
}): JSX.Element {
  const id = useId();
  const helpId = `${id}-help`;
  const shared = {
    id,
    value,
    placeholder,
    readOnly,
    "aria-describedby": helpId,
    className: mono ? "nx-seo-mono" : undefined,
  };
  return (
    <div className={wide ? "nx-seo-field nx-seo-wide" : "nx-seo-field"}>
      <label className="nx-seo-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <Textarea
          {...shared}
          rows={2}
          onChange={event => onChange?.(event.target.value)}
        />
      ) : (
        <Input {...shared} onChange={event => onChange?.(event.target.value)} />
      )}
      <p className="nx-seo-help" id={helpId}>
        {help}
      </p>
    </div>
  );
}

/** The site's production addresses: one field each, and room for another. */
function ProductionAddresses({ draft, change }: TabProps): JSX.Element {
  const labelId = useId();
  const addresses =
    draft.productionAddresses.length === 0 ? [""] : draft.productionAddresses;
  const set = (index: number, value: string) =>
    change(current => {
      const next = [...addresses];
      next[index] = value;
      return { ...current, productionAddresses: next };
    });
  return (
    <div className="nx-seo-field" role="group" aria-labelledby={labelId}>
      <span className="nx-seo-label" id={labelId}>
        Production address
      </span>
      <div className="nx-seo-addrs">
        {addresses.map((address, index) => {
          const problem =
            address.trim() === "" ? null : productionAddressProblem(address);
          const errorId = `${labelId}-error-${index}`;
          return (
            <div key={index} className="nx-seo-field">
              <div className="nx-seo-addr">
                <Input
                  className="nx-seo-mono"
                  value={address}
                  placeholder="https://"
                  aria-label={
                    index === 0
                      ? "Production address"
                      : `Production address ${index + 1}`
                  }
                  aria-invalid={problem !== null}
                  aria-describedby={problem === null ? undefined : errorId}
                  onChange={event => set(index, event.target.value)}
                />
                {index > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${address || "this address"}`}
                    onClick={() =>
                      change(current => ({
                        ...current,
                        productionAddresses: addresses.filter(
                          (_, at) => at !== index
                        ),
                      }))
                    }
                  >
                    <Icon name="x" />
                  </Button>
                ) : null}
              </div>
              {problem === null ? null : (
                <p className="nx-seo-error" id={errorId}>
                  {problem}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="nx-seo-help">
        Every other address, like previews, is kept out of search.
      </p>
      <button
        type="button"
        className="nx-seo-linkbtn"
        onClick={() =>
          change(current => ({
            ...current,
            productionAddresses: [...addresses, ""],
          }))
        }
      >
        Add an address for a language on its own domain
      </button>
    </div>
  );
}

/** The separator between a title and the site's name, with an example. */
function SeparatorChoice({ draft, change }: TabProps): JSX.Element {
  const labelId = useId();
  const example =
    fillPattern(
      defaultTitlePattern(draft.separator),
      {
        title: "Pricing",
        ...(draft.siteName.trim() === ""
          ? { siteName: "Your site" }
          : { siteName: draft.siteName.trim() }),
      },
      {}
    ) ?? "";
  return (
    <div className="nx-seo-field">
      <span className="nx-seo-label" id={labelId}>
        Between the title and the site name
      </span>
      <div className="nx-seo-seg" role="group" aria-labelledby={labelId}>
        {SEPARATORS.map(separator => (
          <button
            key={separator}
            type="button"
            aria-pressed={draft.separator === separator}
            aria-label={`Separator ${separator}`}
            onClick={() => change(current => withSeparator(current, separator))}
          >
            {separator}
          </button>
        ))}
      </div>
      <p className="nx-seo-help">
        Example: <b>{example}</b>. Changes every pattern that uses it.
      </p>
    </div>
  );
}

/** The site's name, address and fallbacks. */
export function GeneralTab({ draft, change }: TabProps): JSX.Element {
  return (
    <div className="nx-seo-form2">
      <TextField
        label="Site name"
        help="Added to the end of titles by the content type patterns."
        value={draft.siteName}
        onChange={siteName => change(current => ({ ...current, siteName }))}
      />
      <ProductionAddresses draft={draft} change={change} />
      <SeparatorChoice draft={draft} change={change} />
      <MediaChoice
        label="Default share image"
        value={draft.image}
        onChange={image => change(current => ({ ...current, image }))}
        emptyHelp="Used when a page has no image of its own. 1200 × 630 shows in full everywhere."
        chosenHelp="used when a page has none"
      />
      <TextField
        label="Default description"
        help="Used only when a page has no description and nothing to make one from."
        value={draft.description}
        multiline
        wide
        onChange={description =>
          change(current => ({ ...current, description }))
        }
      />
    </div>
  );
}

/** The count of a title's characters against what Google shows in full. */
function TitleCount({ length }: { length: number }): JSX.Element {
  return (
    <span
      className={length > TITLE_LIMIT ? "nx-seo-count over" : "nx-seo-count"}
    >
      {length} / {TITLE_LIMIT}
    </span>
  );
}

/** The editor of one type's title pattern, under its row. */
export function PatternEditor({
  type,
  draft,
  change,
  onDone,
}: TabProps & { type: SeoContentType; onDone: () => void }): JSX.Element {
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

  return (
    <div className="nx-seo-pedit">
      <div className="nx-seo-field">
        <label className="nx-seo-label" htmlFor={id}>
          Title pattern for {type.label}
        </label>
        <Input
          ref={input}
          id={id}
          className="nx-seo-mono"
          value={pattern}
          aria-invalid={problem !== null}
          aria-describedby={`${id}-example ${id}-problem`}
          onChange={event => setPattern(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && problem === null) onDone();
          }}
        />
      </div>
      <div className="nx-seo-vars">
        <span className="nx-seo-help">Click to add:</span>
        {tokens.map(token => (
          <button
            key={token}
            type="button"
            className="nx-seo-var"
            onClick={() => insert(token)}
          >
            {`{${token}}`}
          </button>
        ))}
      </div>
      <div className="nx-seo-ex" id={`${id}-example`} aria-live="polite">
        <span>Example:</span>
        <b>{preview.title}</b>
        <TitleCount length={preview.title.length} />
      </div>
      {preview.gaveWay ? (
        <p className="nx-seo-help">
          This page leaves a variable empty, so it keeps its own title, as it
          will on the site.
        </p>
      ) : null}
      <p className="nx-seo-error" id={`${id}-problem`} role="alert">
        {problem}
      </p>
      <p className="nx-seo-help">
        A page&apos;s own title wins over this pattern. &quot;
        {`${draft.separator} ${siteName}`}&quot; is never added to a title that
        already ends with {siteName}.
      </p>
      <div className="nx-seo-row">
        <Button
          type="button"
          size="sm"
          disabled={problem !== null}
          onClick={onDone}
        >
          Done
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!own}
          onClick={reset}
        >
          Reset to default
        </Button>
      </div>
    </div>
  );
}

/** The brand's social profiles: one address each, its network read from it. */
function SocialProfiles({ draft, change }: TabProps): JSX.Element {
  const labelId = useId();
  const profiles = draft.socialProfiles;
  const set = (index: number, url: string) =>
    change(current => ({
      ...current,
      socialProfiles: current.socialProfiles.map((profile, at) =>
        at === index ? { network: networkOf(url), url } : profile
      ),
    }));
  return (
    <div
      className="nx-seo-field nx-seo-wide"
      role="group"
      aria-labelledby={labelId}
    >
      <span className="nx-seo-label" id={labelId}>
        Social profiles
      </span>
      <p className="nx-seo-help">
        Your official accounts, so Google can link them to your company.
      </p>
      <div className="nx-seo-addrs nx-seo-profiles">
        {profiles.map((profile, index) => {
          const network = networkOf(profile.url) || profile.network;
          const problem =
            profile.url.trim() === ""
              ? null
              : profileAddressProblem(profile.url.trim());
          return (
            <div key={index} className="nx-seo-field">
              <div className="nx-seo-profile">
                <span className={network ? "nx-seo-net" : "nx-seo-net empty"}>
                  {network || "Profile"}
                </span>
                <Input
                  className="nx-seo-mono"
                  value={profile.url}
                  placeholder="https://"
                  aria-label={
                    network ? `${network} profile` : "Profile address"
                  }
                  aria-invalid={problem !== null}
                  onChange={event => set(index, event.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${network || "this profile"}`}
                  onClick={() =>
                    change(current => ({
                      ...current,
                      socialProfiles: current.socialProfiles.filter(
                        (_, at) => at !== index
                      ),
                    }))
                  }
                >
                  <Icon name="x" />
                </Button>
              </div>
              {problem === null ? null : (
                <p className="nx-seo-error">
                  {problem.charAt(0).toUpperCase() + problem.slice(1)}
                </p>
              )}
            </div>
          );
        })}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              change(current => ({
                ...current,
                socialProfiles: [
                  ...current.socialProfiles,
                  { network: "", url: "" },
                ],
              }))
            }
          >
            <Icon name="plus" /> Add a profile
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One record of facts about the site's owner. */
export function BrandTab({ draft, change }: TabProps): JSX.Element {
  const kindLabel = useId();
  return (
    <div className="nx-seo-form2">
      <div
        className="nx-seo-field nx-seo-wide"
        role="group"
        aria-labelledby={kindLabel}
      >
        <span className="nx-seo-label" id={kindLabel}>
          What kind of site is this?
        </span>
        <ChoiceCards
          name="seo-site-kind"
          label="Kind of site"
          choices={SITE_KIND_CHOICES}
          value={draft.siteKind}
          columns={2}
          onChange={siteKind => change(current => ({ ...current, siteKind }))}
        />
      </div>
      <TextField
        label="Name"
        help="The name Google shows for your company."
        value={draft.brandName}
        placeholder={draft.siteName}
        onChange={brandName => change(current => ({ ...current, brandName }))}
      />
      <TextField
        label="Other names"
        help="Names people also search for. Separate with commas."
        value={draft.brandOtherNames}
        onChange={brandOtherNames =>
          change(current => ({ ...current, brandOtherNames }))
        }
      />
      <MediaChoice
        label="Logo"
        shape="square"
        value={draft.logo}
        onChange={logo => change(current => ({ ...current, logo }))}
        emptyHelp="Square works best, at least 112 × 112."
      />
      <TextField
        label="Main address"
        help="The production address, from General."
        value={draft.productionAddresses[0] ?? ""}
        placeholder="Set on the General tab"
        readOnly
        mono
      />
      <SocialProfiles draft={draft} change={change} />
    </div>
  );
}

/** Which automated readers may use the site's pages. */
export function CrawlersTab({ draft, change }: TabProps): JSX.Element {
  const labelId = useId();
  return (
    <div className="nx-seo-stack">
      <div className="nx-seo-note">
        <Icon name="info" />
        <span>
          <b>Search engines are always allowed.</b> To keep pages out of Google,
          hide them on the page or by content type.
        </span>
      </div>
      <div className="nx-seo-field" role="group" aria-labelledby={labelId}>
        <span className="nx-seo-label" id={labelId}>
          AI tools
        </span>
        <ChoiceCards
          name="seo-ai-tools"
          label="AI tools"
          choices={AI_CHOICES}
          value={draft.aiCrawlers}
          onChange={aiCrawlers =>
            change(current => ({ ...current, aiCrawlers }))
          }
        />
        <p className="nx-seo-help">{AI_CHOICES_NOTE}</p>
      </div>
    </div>
  );
}

/** Which tab the screen opens on and each one's id in the address. */
export const TABS = [
  {
    id: "general",
    label: "General",
    lead: "The site's name, address and fallbacks.",
  },
  {
    id: "types",
    label: "Content types",
    lead: "Where each kind of page lives and how its titles are made.",
  },
  {
    id: "brand",
    label: "Brand",
    lead: "One record of facts about your company, used everywhere.",
  },
  {
    id: "crawlers",
    label: "Crawlers",
    lead: "Which automated readers may use your pages.",
  },
] as const;

export type TabId = (typeof TABS)[number]["id"];

/** Whether a value names one of the tabs. */
export function isTabId(value: unknown): value is TabId {
  return TABS.some(tab => tab.id === value);
}

/** Any problem that stops the draft being saved, for the Save button. */
export function draftProblem(
  draft: SettingsDraft,
  types: readonly SeoContentType[]
): string | null {
  for (const address of draft.productionAddresses) {
    if (address.trim() !== "" && productionAddressProblem(address) !== null) {
      return "Fix the production address first.";
    }
  }
  for (const type of types) {
    if (draft.patterns[type.key]?.title === undefined) continue;
    if (patternProblem(patternOf(draft, type.key).pattern, type) !== null) {
      return `Fix the title pattern for ${type.label} first.`;
    }
  }
  for (const profile of draft.socialProfiles) {
    const url = profile.url.trim();
    if (url !== "" && profileAddressProblem(url) !== null) {
      return "Fix the social profile address first.";
    }
  }
  return null;
}
