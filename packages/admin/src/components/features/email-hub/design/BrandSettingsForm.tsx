"use client";

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
} from "@nextlyhq/ui";
import { type JSX, useEffect, useId, useState } from "react";

import { MediaPickerDialog } from "@admin/components/features/media-library/MediaPickerDialog";
import { Image as ImageIcon, Info, Plus, X } from "@admin/components/icons";
import type {
  BrandFont,
  BrandLink,
  BrandSettings,
  EmailSafeFontKey,
} from "@admin/services/emailBrandApi";
import type { Media } from "@admin/types/media";

import {
  absoluteLogoUrl,
  COLOUR_ROLES,
  logoFileName,
  normalizeHex,
  type ColourRole,
} from "./design-model";

/** The server's own bounds for the logo's width. */
const LOGO_WIDTH = { min: 16, max: 600 } as const;
/** As many links as the server keeps. */
const MAX_LINKS = 10;

type Edit = <K extends keyof BrandSettings>(
  key: K,
  value: BrandSettings[K]
) => void;

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function LogoThumb({
  url,
  background,
}: {
  url: string | null;
  background: string;
}) {
  if (!url) {
    return (
      <div className="flex h-20 w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-xs text-muted-foreground">
        <ImageIcon className="h-5 w-5" />
        No logo
      </div>
    );
  }
  return (
    <div
      className="flex h-20 w-32 shrink-0 items-center justify-center rounded-md border border-border p-2"
      // The email's own background, so a light logo is seen as the email shows it.
      style={{ backgroundColor: background }}
    >
      <img src={url} alt="" className="max-h-full max-w-full object-contain" />
    </div>
  );
}

function LogoField({
  draft,
  edit,
  disabled,
}: {
  draft: BrandSettings;
  edit: Edit;
  disabled: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [refused, setRefused] = useState(false);
  const choose = (media: Media[]) => {
    const picked = media[0];
    if (!picked) return;
    const url = absoluteLogoUrl(picked.url, window.location.origin);
    setRefused(url === null);
    if (url) edit("logoUrl", url);
  };
  const url = draft.logoUrl;
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Logo</div>
      <div className="flex flex-wrap items-start gap-4">
        <LogoThumb url={url} background={draft.backgroundColor} />
        <div className="min-w-0 space-y-2">
          {url ? (
            <div className="break-all font-mono text-xs">
              {logoFileName(url)}
            </div>
          ) : (
            <Hint>Emails go out without a logo.</Hint>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setPicking(true)}
            >
              <ImageIcon className="h-4 w-4" />
              {url ? "Change" : "Choose from the media library"}
            </Button>
            {url && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => edit("logoUrl", null)}
              >
                Remove
              </Button>
            )}
          </div>
          {refused && (
            <p role="alert" className="text-xs text-destructive">
              That image has no web address an email can load. Choose another.
            </p>
          )}
        </div>
      </div>
      <MediaPickerDialog
        mode="single"
        open={picking}
        onOpenChange={setPicking}
        onSelect={choose}
        accept="image/*"
        title="Choose a logo"
      />
    </div>
  );
}

function LogoWidthField({
  draft,
  edit,
  disabled,
}: {
  draft: BrandSettings;
  edit: Edit;
  disabled: boolean;
}) {
  const id = useId();
  const off = disabled || !draft.logoUrl;
  const set = (value: number) => {
    if (!Number.isFinite(value)) return;
    edit(
      "logoWidth",
      Math.min(LOGO_WIDTH.max, Math.max(LOGO_WIDTH.min, Math.round(value)))
    );
  };
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Logo width</Label>
      <div className="flex items-center gap-4">
        <div className="flex w-28 shrink-0 items-center gap-1">
          <Input
            id={id}
            type="number"
            min={LOGO_WIDTH.min}
            max={LOGO_WIDTH.max}
            value={draft.logoWidth}
            disabled={off}
            onChange={event => set(Number(event.target.value))}
          />
          <span className="text-xs text-muted-foreground">px</span>
        </div>
        <Slider
          aria-label="Logo width"
          className="min-w-0 flex-1"
          min={LOGO_WIDTH.min}
          max={LOGO_WIDTH.max}
          step={2}
          value={[draft.logoWidth]}
          disabled={off}
          onValueChange={([value]) => set(value)}
        />
      </div>
      <Hint>
        {draft.logoUrl
          ? "How wide the logo shows, in pixels. Phones shrink it to fit."
          : "Choose a logo to set its width."}
      </Hint>
    </div>
  );
}

function ColourField({
  role,
  label,
  hint,
  value,
  edit,
  disabled,
}: {
  role: ColourRole;
  label: string;
  hint: string;
  value: string;
  edit: Edit;
  disabled: boolean;
}) {
  const id = useId();
  // What is typed, held apart from the setting until it is a colour.
  const [typed, setTyped] = useState<string | null>(null);
  // A change from elsewhere (Discard, Match my site) replaces what was typed;
  // what is typed becoming the setting does not.
  useEffect(() => {
    setTyped(current =>
      current !== null && normalizeHex(current) !== value ? null : current
    );
  }, [value]);
  const bad = typed !== null && normalizeHex(typed) === null;
  const change = (text: string) => {
    setTyped(text);
    const hex = normalizeHex(text);
    if (hex) edit(role, hex);
  };
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: pick a colour`}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1 disabled:cursor-not-allowed"
          value={value}
          disabled={disabled}
          onChange={event => {
            setTyped(null);
            edit(role, event.target.value.toLowerCase());
          }}
        />
        <Input
          id={id}
          className="font-mono"
          spellCheck={false}
          autoComplete="off"
          value={typed ?? value}
          disabled={disabled}
          aria-invalid={bad}
          onChange={event => change(event.target.value)}
          onBlur={() => {
            if (!bad) setTyped(null);
          }}
        />
      </div>
      {bad ? (
        <p role="alert" className="text-xs text-destructive">
          Use a hex colour, like #2f6b4f.
        </p>
      ) : (
        <Hint>{hint}</Hint>
      )}
    </div>
  );
}

function FontField({
  fonts,
  value,
  edit,
  disabled,
}: {
  fonts: BrandFont[];
  value: string;
  edit: Edit;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Font</Label>
      <Select
        value={value}
        disabled={disabled}
        // Only the server's own list is offered, so the choice is one of it.
        onValueChange={next => edit("fontFamily", next as EmailSafeFontKey)}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fonts.map(font => (
            <SelectItem key={font.key} value={font.key}>
              {font.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Hint>
        Only fonts nearly every email client has, so the email looks the same
        everywhere.
      </Hint>
    </div>
  );
}

function FooterTextField({
  value,
  edit,
  disabled,
}: {
  value: string | null;
  edit: Edit;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Footer text</Label>
      <Input
        id={id}
        className="font-mono"
        value={value ?? ""}
        placeholder="© {{year}} {{appName}}. All rights reserved."
        maxLength={500}
        disabled={disabled}
        // Empty is the standard line, so a cleared field puts it back.
        onChange={event => edit("footerText", event.target.value || null)}
      />
      <Hint>
        Leave it empty for the standard line. Liquid works here:{" "}
        <code className="font-mono">{"{{year}}"}</code> and{" "}
        <code className="font-mono">{"{{appName}}"}</code> fill in when the
        email is sent.
      </Hint>
    </div>
  );
}

function FooterLinkRow({
  link,
  index,
  onChange,
  onRemove,
  disabled,
}: {
  link: BrandLink;
  index: number;
  onChange: (link: BrandLink) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
      <Input
        aria-label={`Link ${index + 1} label`}
        placeholder="Label"
        value={link.label}
        disabled={disabled}
        onChange={event => onChange({ ...link, label: event.target.value })}
      />
      <Input
        aria-label={`Link ${index + 1} address`}
        placeholder="https://"
        className="col-span-2 row-start-2 font-mono sm:col-span-1 sm:row-start-auto"
        spellCheck={false}
        value={link.url}
        disabled={disabled}
        onChange={event => onChange({ ...link, url: event.target.value })}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto"
        aria-label={`Remove ${link.label || "this link"}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function FooterLinksField({
  links,
  edit,
  disabled,
}: {
  links: BrandLink[];
  edit: Edit;
  disabled: boolean;
}) {
  const replace = (index: number, link: BrandLink) =>
    edit(
      "footerLinks",
      links.map((current, at) => (at === index ? link : current))
    );
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Footer links</div>
      {links.length === 0 && <Hint>No links under the footer.</Hint>}
      {links.map((link, index) => (
        <FooterLinkRow
          key={index}
          link={link}
          index={index}
          disabled={disabled}
          onChange={next => replace(index, next)}
          onRemove={() =>
            edit(
              "footerLinks",
              links.filter((_, at) => at !== index)
            )
          }
        />
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled || links.length >= MAX_LINKS}
        onClick={() => edit("footerLinks", [...links, { label: "", url: "" }])}
      >
        <Plus className="h-4 w-4" />
        Add a link
      </Button>
      <Hint>
        Shown in small type under the footer. An address can be a web page or a
        mailto: link.
      </Hint>
    </div>
  );
}

/**
 * The brand settings, edited as a draft: each change is shown in the preview
 * at once and saved only from the save bar.
 */
export function BrandSettingsForm({
  draft,
  fonts,
  edit,
  readOnly,
  matchMySite,
}: {
  draft: BrandSettings;
  fonts: BrandFont[];
  edit: Edit;
  /** For a person who may read the settings but not change them. */
  readOnly: boolean;
  /** The Match my site button, where the site has colours to offer. */
  matchMySite?: React.ReactNode;
}): JSX.Element {
  return (
    <section
      aria-labelledby="brand-settings-heading"
      className="min-w-0 rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 id="brand-settings-heading" className="text-base font-semibold">
            Brand settings
          </h2>
          <p className="text-sm text-muted-foreground">
            The look of every email that uses the Default layout.
          </p>
        </div>
        {matchMySite}
      </div>
      <div className="space-y-6 p-4">
        <LogoField draft={draft} edit={edit} disabled={readOnly} />
        <LogoWidthField draft={draft} edit={edit} disabled={readOnly} />
        {COLOUR_ROLES.map(role => (
          <ColourField
            key={role.key}
            role={role.key}
            label={role.label}
            hint={role.hint}
            value={draft[role.key]}
            edit={edit}
            disabled={readOnly}
          />
        ))}
        <FontField
          fonts={fonts}
          value={draft.fontFamily}
          edit={edit}
          disabled={readOnly}
        />
        <FooterTextField
          value={draft.footerText}
          edit={edit}
          disabled={readOnly}
        />
        <FooterLinksField
          links={draft.footerLinks}
          edit={edit}
          disabled={readOnly}
        />
      </div>
      <div className="flex items-start gap-2 border-t border-border p-4 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Brand settings started from what the Default layout showed before, so
          no email changed until someone changed a setting.
        </span>
      </div>
    </section>
  );
}

export type { Edit as BrandEdit };
