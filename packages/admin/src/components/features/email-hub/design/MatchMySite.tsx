"use client";

import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Info, Sparkles } from "@admin/components/icons";
import type { BrandFont, BrandSettings } from "@admin/services/emailBrandApi";
import { singleApi } from "@admin/services/singleApi";

import {
  COLOUR_ROLES,
  emailSafeFontFor,
  siteStyleOf,
  suggestedColours,
  type ColourRole,
  type SiteColour,
  type SiteStyle,
} from "./design-model";

/** The page builder keeps the site's design variables in this Single. */
const SITE_STYLE_SLUG = "site-style";

/**
 * The site's design variables, or null when there are none to offer: no page
 * builder, no permission to read them, or no colours in them.
 */
export function useSiteStyle() {
  return useQuery<SiteStyle | null>({
    queryKey: ["emailBrand", "siteStyle"],
    queryFn: async () => {
      try {
        const document = await singleApi.getDocument(SITE_STYLE_SLUG);
        return siteStyleOf(document.tokens);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** What Match my site puts in the draft. */
export type SiteMatch = Pick<
  BrandSettings,
  "accentColor" | "backgroundColor" | "contentColor"
> &
  Partial<Pick<BrandSettings, "fontFamily">>;

function Swatch({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 shrink-0 rounded-sm border border-border"
      style={{ backgroundColor: colour }}
    />
  );
}

function SiteColours({ colours }: { colours: SiteColour[] }) {
  return (
    <ul
      aria-label="Your site's colours"
      className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-4"
    >
      {colours.map(colour => (
        <li key={colour.name} className="min-w-0 space-y-1">
          <div
            className="h-8 rounded-md border border-border"
            style={{ backgroundColor: colour.value }}
          />
          <div className="truncate font-mono text-xs">{colour.name}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {colour.value}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Choice({
  selected,
  onSelect,
  colour,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  colour: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left font-mono text-xs ${
        selected ? "border-foreground ring-1 ring-foreground" : "border-border"
      }`}
    >
      <Swatch colour={colour} />
      {children}
    </button>
  );
}

function RoleChoices({
  label,
  hint,
  colours,
  current,
  suggested,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  colours: SiteColour[];
  current: string;
  suggested: SiteColour | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm">
        <span className="font-medium">{label}</span>{" "}
        <span className="text-muted-foreground">{hint}</span>
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-2"
      >
        {colours.map(colour => (
          <Choice
            key={colour.name}
            colour={colour.value}
            selected={value === colour.value}
            onSelect={() => onChange(colour.value)}
          >
            {colour.name}
            {suggested?.name === colour.name && (
              <Badge variant="outline" className="font-sans">
                Suggested
              </Badge>
            )}
          </Choice>
        ))}
        <Choice
          colour={current}
          selected={!colours.some(colour => colour.value === value)}
          onSelect={() => onChange(current)}
        >
          Keep {current}
        </Choice>
      </div>
    </div>
  );
}

function FontNote({
  site,
  fonts,
}: {
  site: string | null;
  fonts: BrandFont[];
}) {
  const match = site ? emailSafeFontFor(site, fonts) : null;
  const text = !match
    ? "Your site's design variables name no font, so the font stays as it is."
    : match.same
      ? `Your site uses ${match.family}, which email clients have. We'll use it.`
      : `Your site uses ${match.family}, which email clients don't have. We'll use ${match.font.label}, the closest email-safe font.`;
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Font</div>
      <Alert role="status">
        <Info className="h-4 w-4" />
        <AlertDescription>{text}</AlertDescription>
      </Alert>
    </div>
  );
}

/** The first choice for each role: the suggestion, else what is set now. */
function initialPicks(
  site: SiteStyle,
  current: BrandSettings
): Record<ColourRole, string> {
  const suggested = suggestedColours(site.colours);
  return {
    accentColor: suggested.accentColor?.value ?? current.accentColor,
    backgroundColor:
      suggested.backgroundColor?.value ?? current.backgroundColor,
    contentColor: suggested.contentColor?.value ?? current.contentColor,
  };
}

function MatchDialogBody({
  site,
  current,
  fonts,
  onApply,
  onCancel,
}: {
  site: SiteStyle;
  current: BrandSettings;
  fonts: BrandFont[];
  onApply: (match: SiteMatch) => void;
  onCancel: () => void;
}) {
  const [picks, setPicks] = useState(() => initialPicks(site, current));
  const suggested = suggestedColours(site.colours);
  const font = site.font ? emailSafeFontFor(site.font, fonts) : null;
  return (
    <>
      <div className="max-h-[60vh] space-y-5 overflow-y-auto">
        <SiteColours colours={site.colours} />
        {COLOUR_ROLES.map(role => (
          <RoleChoices
            key={role.key}
            label={role.label}
            hint={role.hint}
            colours={site.colours}
            current={current[role.key]}
            suggested={suggested[role.key]}
            value={picks[role.key]}
            onChange={value => setPicks({ ...picks, [role.key]: value })}
          />
        ))}
        <FontNote site={site.font} fonts={fonts} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() =>
            onApply(font ? { ...picks, fontFamily: font.font.key } : picks)
          }
        >
          Apply
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Match my site: the site's colours and font, put in the draft. Offered only
 * where the site's design variables have colours to offer.
 */
export function MatchMySite({
  site,
  current,
  fonts,
  onApply,
}: {
  site: SiteStyle;
  current: BrandSettings;
  fonts: BrandFont[];
  onApply: (match: SiteMatch) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="h-4 w-4" />
        Match my site
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Match my site</DialogTitle>
            <DialogDescription>
              Pick one of your site&apos;s colours for each part of the email.
              These are the light-theme values of your site&apos;s design
              variables.
            </DialogDescription>
          </DialogHeader>
          {open && (
            <MatchDialogBody
              site={site}
              current={current}
              fonts={fonts}
              onCancel={() => setOpen(false)}
              onApply={match => {
                onApply(match);
                setOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
