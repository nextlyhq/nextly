/**
 * The Settings screen's tabs: General, Content types, Share images,
 * Organization, Search engines and AI, and Connections; Content types and
 * Connections are modules of their own (`content-types`, `connections`).
 * Each draws part of one draft as a card of rows and reports changes to it;
 * the page saves them together.
 *
 * @module admin/tabs
 */
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  SegmentedChoice,
  SettingsRowGroup,
  Switch,
} from "@nextlyhq/plugin-sdk/admin";
import { Info, X } from "lucide-react";
import { useId, type JSX, type ReactNode } from "react";

import type { SeoContentType } from "../settings/contract";
import {
  defaultTitlePattern,
  fillPattern,
  SEPARATORS,
} from "../settings/patterns";
import { productionAddressProblem } from "../settings/production-addresses";
import { profileAddressProblem } from "../settings/stored-values";
import { characters, DESCRIPTION_LIMIT } from "../tab/problems";

import {
  AI_CHOICES,
  AI_CHOICES_NOTE,
  ChoiceCards,
  SITE_KIND_CHOICES,
} from "./choices";
import { CrawlerTable } from "./crawler-table";
import { MediaChoice } from "./MediaChoice";
import { OwnRulesRow, type RulesCheck } from "./robots-rules";
import {
  networkOf,
  patternOf,
  patternProblem,
  withSeparator,
  type SettingsDraft,
} from "./settings-draft";
import { ControlNote, SettingsCard, TextRow } from "./settings-parts";

/** What every tab is handed: the draft, and how to change it. */
export interface TabProps {
  draft: SettingsDraft;
  change: (next: (draft: SettingsDraft) => SettingsDraft) => void;
}

/** What a description's length reads as, under the field. */
function descriptionNote(description: string): {
  text: string;
  tone: "muted" | "warning";
} | null {
  const count = characters(description.trim());
  if (count === 0) return null;
  return count > DESCRIPTION_LIMIT
    ? {
        text: `${count} characters · Google shows about ${DESCRIPTION_LIMIT}`,
        tone: "warning",
      }
    : { text: `${count} characters · Good`, tone: "muted" };
}

/** A link-styled button, for a small action under a control. */
function TextButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className="mt-2 text-xs font-medium text-foreground underline underline-offset-2 hover:decoration-2"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A small button that removes one item of a list. */
function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onClick={onClick}
    >
      <X className="size-4" aria-hidden="true" />
    </Button>
  );
}

const PRODUCTION_ADDRESS_LABEL = "Production address";
const PRODUCTION_ADDRESS_HELP =
  "Canonicals and the sitemap use it. Every other host is kept out of search.";

/**
 * The site's production addresses, where the server names them: read-only,
 * since `NEXTLY_PRODUCTION_ADDRESSES` wins over anything saved here.
 */
function ServerAddresses({
  addresses,
}: {
  addresses: readonly string[];
}): JSX.Element {
  return (
    <TextRow
      label={PRODUCTION_ADDRESS_LABEL}
      description={PRODUCTION_ADDRESS_HELP}
      value={addresses.join(", ")}
      readOnly
      mono
      note="Set by NEXTLY_PRODUCTION_ADDRESSES on the server"
    />
  );
}

/** The site's production addresses: one field each, and room for another. */
function ProductionAddresses({ draft, change }: TabProps): JSX.Element {
  // Each field's problem, by id, is its description for a screen reader.
  const problemsId = useId();
  const addresses =
    draft.productionAddresses.length === 0 ? [""] : draft.productionAddresses;
  const set = (index: number, value: string) =>
    change(current => {
      const next = [...addresses];
      next[index] = value;
      return { ...current, productionAddresses: next };
    });
  return (
    <SettingsRowGroup
      label={PRODUCTION_ADDRESS_LABEL}
      description={PRODUCTION_ADDRESS_HELP}
    >
      <div className="grid gap-2">
        {addresses.map((address, index) => {
          const problem =
            address.trim() === "" ? null : productionAddressProblem(address);
          const name =
            index === 0
              ? PRODUCTION_ADDRESS_LABEL
              : `${PRODUCTION_ADDRESS_LABEL} ${index + 1}`;
          return (
            <div key={index}>
              <div className="flex items-center gap-2">
                <Input
                  className="font-mono text-[13px]"
                  value={address}
                  placeholder="https://"
                  aria-label={name}
                  aria-invalid={problem !== null}
                  aria-describedby={
                    problem === null ? undefined : `${problemsId}-${index}`
                  }
                  onChange={event => set(index, event.target.value)}
                />
                {index > 0 ? (
                  <RemoveButton
                    label={`Remove ${address || "this address"}`}
                    onClick={() =>
                      change(current => ({
                        ...current,
                        productionAddresses: addresses.filter(
                          (_, at) => at !== index
                        ),
                      }))
                    }
                  />
                ) : null}
              </div>
              {problem === null ? null : (
                <ControlNote id={`${problemsId}-${index}`} tone="danger">
                  {problem}
                </ControlNote>
              )}
            </div>
          );
        })}
      </div>
      <TextButton
        onClick={() =>
          change(current => ({
            ...current,
            productionAddresses: [...addresses, ""],
          }))
        }
      >
        Add an address for a language on its own domain
      </TextButton>
    </SettingsRowGroup>
  );
}

/** The separator between a title and the site's name, with an example. */
function SeparatorChoice({ draft, change }: TabProps): JSX.Element {
  const example =
    fillPattern(
      defaultTitlePattern(draft.separator),
      {
        title: "Pricing",
        siteName:
          draft.siteName.trim() === "" ? "Your site" : draft.siteName.trim(),
      },
      {}
    ) ?? "";
  const labelId = useId();
  return (
    <SettingsRowGroup
      label="Title separator"
      description="Between a page's title and the site name."
    >
      <span id={labelId} className="sr-only">
        Title separator
      </span>
      <SegmentedChoice
        size="bordered"
        aria-labelledby={labelId}
        options={SEPARATORS.map(separator => ({
          value: separator,
          label: separator,
          spoken: `Separator ${separator}`,
        }))}
        value={draft.separator}
        onSelect={next => {
          const separator = SEPARATORS.find(each => each === next);
          if (separator !== undefined) {
            change(current => withSeparator(current, separator));
          }
        }}
      />
      <ControlNote>
        Example: <b className="font-medium text-foreground">{example}</b>.
        Changes every pattern that uses it.
      </ControlNote>
    </SettingsRowGroup>
  );
}

/** The site's name, address and fallbacks. */
export function GeneralTab({
  draft,
  change,
  serverAddresses,
}: TabProps & {
  /** The production addresses the server names, which win where set. */
  serverAddresses: readonly string[];
}): JSX.Element {
  const note = descriptionNote(draft.description);
  return (
    <SettingsCard>
      <TextRow
        label="Site name"
        description="Ends titles, names the site to search engines."
        value={draft.siteName}
        onChange={siteName => change(current => ({ ...current, siteName }))}
      />
      {serverAddresses.length > 0 ? (
        <ServerAddresses addresses={serverAddresses} />
      ) : (
        <ProductionAddresses draft={draft} change={change} />
      )}
      <SeparatorChoice draft={draft} change={change} />
      <TextRow
        label="Default description"
        description="For a page with none of its own and no pattern."
        value={draft.description}
        multiline
        {...(note === null ? {} : { note: note.text, noteTone: note.tone })}
        onChange={description =>
          change(current => ({ ...current, description }))
        }
      />
    </SettingsCard>
  );
}

/** The image shared links show when a page has none of its own. */
export function ShareImagesTab({ draft, change }: TabProps): JSX.Element {
  return (
    <SettingsCard>
      <MediaChoice
        label="Default share image"
        description="Shown when a page is shared and has no image of its own."
        value={draft.image}
        onChange={image => change(current => ({ ...current, image }))}
        emptyHelp="1200 × 630 shows in full everywhere."
        chosenHelp="used when a page has none"
      />
    </SettingsCard>
  );
}

/** The brand's social profiles: one address each, its network read from it. */
function SocialProfiles({ draft, change }: TabProps): JSX.Element {
  const profiles = draft.socialProfiles;
  const set = (index: number, url: string) =>
    change(current => ({
      ...current,
      socialProfiles: current.socialProfiles.map((profile, at) =>
        at === index ? { network: networkOf(url), url } : profile
      ),
    }));
  return (
    <SettingsRowGroup
      label="Social profiles"
      description="Your official accounts, so Google can link them to your company."
    >
      <div className="grid gap-2">
        {profiles.map((profile, index) => {
          const network = networkOf(profile.url) || profile.network;
          const problem =
            profile.url.trim() === ""
              ? null
              : profileAddressProblem(profile.url.trim());
          return (
            <div key={index}>
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate text-xs font-medium text-muted-foreground">
                  {network || "Profile"}
                </span>
                <Input
                  className="font-mono text-[13px]"
                  value={profile.url}
                  placeholder="https://"
                  aria-label={
                    network ? `${network} profile` : "Profile address"
                  }
                  aria-invalid={problem !== null}
                  onChange={event => set(index, event.target.value)}
                />
                <RemoveButton
                  label={`Remove ${network || "this profile"}`}
                  onClick={() =>
                    change(current => ({
                      ...current,
                      socialProfiles: current.socialProfiles.filter(
                        (_, at) => at !== index
                      ),
                    }))
                  }
                />
              </div>
              {problem === null ? null : (
                <ControlNote tone="danger">
                  {problem.charAt(0).toUpperCase() + problem.slice(1)}
                </ControlNote>
              )}
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={profiles.length > 0 ? "mt-2" : undefined}
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
        Add a profile
      </Button>
    </SettingsRowGroup>
  );
}

/** One record of facts about the organization behind the site. */
export function BrandTab({ draft, change }: TabProps): JSX.Element {
  return (
    <SettingsCard>
      <SettingsRowGroup
        label="Kind of site"
        description="This decides which details Google gets about your pages."
      >
        <ChoiceCards
          name="seo-site-kind"
          label="Kind of site"
          choices={SITE_KIND_CHOICES}
          value={draft.siteKind}
          columns={2}
          onChange={siteKind => change(current => ({ ...current, siteKind }))}
        />
      </SettingsRowGroup>
      <TextRow
        label="Name"
        description="The name Google shows for your company."
        value={draft.brandName}
        placeholder={draft.siteName}
        onChange={brandName => change(current => ({ ...current, brandName }))}
      />
      <TextRow
        label="Other names"
        description="Names people also search for. Separate with commas."
        value={draft.brandOtherNames}
        onChange={brandOtherNames =>
          change(current => ({ ...current, brandOtherNames }))
        }
      />
      <MediaChoice
        label="Logo"
        description="Shown beside your pages in Google's results."
        shape="square"
        value={draft.logo}
        onChange={logo => change(current => ({ ...current, logo }))}
        emptyHelp="Square works best, at least 112 × 112."
      />
      <SocialProfiles draft={draft} change={change} />
    </SettingsCard>
  );
}

/** One on-or-off output: its row, and the switch that sets it. */
function SwitchRow({
  label,
  description,
  on,
  set,
}: {
  label: string;
  description: ReactNode;
  on: boolean;
  set: (on: boolean) => void;
}): JSX.Element {
  return (
    <SettingsRowGroup label={label} description={description}>
      <Switch aria-label={label} checked={on} onCheckedChange={set} />
    </SettingsRowGroup>
  );
}

/** The host the site is served from, for the sentences that name it. */
function siteHostOf(
  draft: SettingsDraft,
  serverAddresses: readonly string[] = []
): string {
  for (const address of [...serverAddresses, ...draft.productionAddresses]) {
    try {
      return new URL(address.trim()).host;
    } catch {
      // A half-typed address names no host yet; try the next.
    }
  }
  return typeof window === "undefined" ? "your-site" : window.location.host;
}

/**
 * What robots.txt can't do for Google's AI answers, beside the choices that
 * might suggest it can: they read pages with Google Search's own crawler,
 * so only a page's snippet controls keep its text out of them.
 */
function AiOverviewsRow(): JSX.Element {
  return (
    <SettingsRowGroup
      label="Google's AI Overviews and AI Mode"
      description="Answers Google shows above its results."
    >
      <Alert variant="info" role="note">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <AlertDescription>
          robots.txt can&apos;t take your site out of them. They read pages with
          Google Search&apos;s own crawler, so blocking it would take you out of
          Google Search too. To keep a page&apos;s text out, set its{" "}
          <b className="font-semibold">Text under the link</b> to None on that
          page; that also removes the text from normal results.
        </AlertDescription>
      </Alert>
    </SettingsRowGroup>
  );
}

/** Which automated readers may use the site's pages, and what they are given. */
export function CrawlersTab({
  draft,
  change,
  serverAddresses,
  rulesCheck,
  retryRulesCheck,
}: TabProps & {
  serverAddresses: readonly string[];
  /** Which sitemap pages the own rules being typed block. */
  rulesCheck: RulesCheck;
  retryRulesCheck: () => void;
}): JSX.Element {
  const host = siteHostOf(draft, serverAddresses);
  return (
    <SettingsCard>
      <SettingsRowGroup
        label="Search engines"
        description="Google, Bing and the others."
      >
        <p className="text-sm text-foreground">
          Always allowed, except where your own rules below say otherwise.
        </p>
        <ControlNote>
          To keep pages out of search, hide them on the page or by content type.
        </ControlNote>
      </SettingsRowGroup>
      <SettingsRowGroup
        label="AI tools"
        description="What tools that read pages for AI may do."
      >
        <ChoiceCards
          name="seo-ai-tools"
          label="AI tools"
          choices={AI_CHOICES}
          value={draft.aiCrawlers}
          onChange={aiCrawlers =>
            change(current => ({ ...current, aiCrawlers }))
          }
        />
        <ControlNote>{AI_CHOICES_NOTE}</ControlNote>
        <CrawlerTable choice={draft.aiCrawlers} />
      </SettingsRowGroup>
      <AiOverviewsRow />
      <OwnRulesRow
        draft={draft}
        change={change}
        check={rulesCheck}
        retry={retryRulesCheck}
      />
      <SwitchRow
        label="llms.txt"
        description={`A plain list of your pages at ${host}/llms.txt, for AI tools to read. Off by default; few tools use it today. It lists the same pages and words people see.`}
        on={draft.llmsTxt}
        set={llmsTxt => change(current => ({ ...current, llmsTxt }))}
      />
      <SwitchRow
        label="Plain-text copies"
        description="Adds a text version of each page, the same words people see, for AI tools. Off by default."
        on={draft.plainTextCopies}
        set={plainTextCopies =>
          change(current => ({ ...current, plainTextCopies }))
        }
      />
    </SettingsCard>
  );
}

/**
 * The tabs, in order, each with its id in the address (`?tab=`). The ids
 * stay those links already use: `brand` is Organization and `crawlers` is
 * Search engines and AI.
 */
export const TABS = [
  { id: "general", label: "General" },
  { id: "types", label: "Content types" },
  { id: "images", label: "Share images" },
  { id: "brand", label: "Organization" },
  { id: "crawlers", label: "Search engines and AI" },
  { id: "connections", label: "Connections" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

/** Whether a value names one of the tabs. */
export function isTabId(value: unknown): value is TabId {
  return TABS.some(tab => tab.id === value);
}

/** Any problem that stops the draft being saved, said beside Save. */
export function draftProblem(
  draft: SettingsDraft,
  types: readonly SeoContentType[],
  /** The addresses the server sets, which the saved ones then give way to. */
  serverAddresses: readonly string[] = []
): string | null {
  // Where the server sets them the saved ones are neither shown nor used,
  // so they hold nothing up.
  const saved = serverAddresses.length > 0 ? [] : draft.productionAddresses;
  for (const address of saved) {
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
