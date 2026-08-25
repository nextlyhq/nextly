"use client";

/**
 * Form Settings Tab
 *
 * Per-form behavior on the canonical settings shape: every control here is
 * consumed somewhere (the submit handler or the confirmation flow) — a
 * setting that does nothing does not get a toggle. Spam controls are
 * per-form OVERRIDES of the plugin's global config: blank means inherit,
 * and the inherited value is shown rather than hidden.
 *
 * @module admin/components/builder/FormSettingsTab
 */

import {
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@nextlyhq/ui";
import type React from "react";

import { parseRedirectReference } from "../../../utils/redirect-reference";
import { useFormBuilder } from "../../context/FormBuilderContext";

import { RedirectPagePicker } from "./RedirectPagePicker";

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 py-2">
      <div className="space-y-1">
        <Label
          htmlFor={htmlFor}
          className="text-[13px] font-semibold text-foreground tracking-tight"
        >
          {label}
        </Label>
        {description && (
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0 flex items-center justify-end min-w-25">
        {children}
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border pb-3">
      <h3 className="text-[16px] font-bold text-foreground tracking-tight">
        {children}
      </h3>
    </div>
  );
}

/**
 * Tri-state override select: inherit from the plugin config (showing the
 * effective value), or force on/off for this form.
 */
function InheritToggle({
  id,
  value,
  inherited,
  onChange,
}: {
  id: string;
  value: boolean | undefined;
  inherited: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}) {
  const inheritedLabel =
    inherited === undefined
      ? "Inherit"
      : `Inherit (${inherited ? "on" : "off"})`;
  return (
    <Select
      value={value === undefined ? "inherit" : value ? "on" : "off"}
      onValueChange={selected =>
        onChange(selected === "inherit" ? undefined : selected === "on")
      }
    >
      <SelectTrigger
        id={id}
        className="w-40 bg-transparent border-input dark:bg-muted/50"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="inherit">{inheritedLabel}</SelectItem>
        <SelectItem value="on">On</SelectItem>
        <SelectItem value="off">Off</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SpamDefaults {
  honeypot?: boolean;
  recaptchaEnabled?: boolean;
}

interface FormSettingsTabProps {
  /** Plugin-level spam defaults (from builder-config); null while loading. */
  spamDefaults: SpamDefaults | null;
  /**
   * Collections a form may redirect to (from builder-config); null while
   * loading. Empty means the site configured none, and the option is not
   * offered — choosing it could only ever produce a form with no destination.
   */
  redirectCollections: string[] | null;
  /**
   * The configuration request failed, as distinct from returning nothing. An
   * empty list is a valid answer; a failure is not an answer at all, and
   * saying "no collection is configured" on a 403 states something false.
   */
  redirectConfigFailed: boolean;
}

/**
 * The "Redirect to a page" choice and its picker.
 *
 * Shown when the site configures a redirect collection, AND whenever this form
 * ALREADY redirects to a page. Hiding a stored confirmation leaves the radio
 * group holding a value none of its items carry, so nothing appears selected —
 * while that stored value is still posted on the next save. The author would
 * be looking at a form that says one thing and saves another.
 *
 * Configuration can be removed after a form was saved, and the builder-config
 * request can fail; both arrive here as an empty list, which is why the stored
 * value rather than the configuration decides whether this renders.
 */
/**
 * What the "Redirect to a page" option should show.
 *
 * Four outcomes, named because they were four nested conditions and the
 * difference between two of them is not visual — an empty configuration is an
 * ANSWER, a failed configuration read is not, and stating the first when the
 * second happened tells an author something false about their site.
 */
/**
 * Whether these settings actually NAME a page — not whether the page-redirect
 * option happens to be selected.
 *
 * Conflating the two let an author choose the option while the configuration
 * was unknown, which classified the state as "a page is stored" with nothing
 * stored: a picker with no collections to offer, and a save that could only be
 * refused. Selecting a confirmation is not a destination.
 *
 * A BARE id counts. `parseRedirectReference` resolves one only when exactly
 * one collection is configured, which is the right rule for "which document is
 * this" — but the question here is "is anything stored at all", and the answer
 * must not depend on configuration that may have failed to load or been
 * removed. Those are precisely the states where an author needs to be shown
 * what is already saved.
 */
export function hasStoredRedirectPage(settings: {
  redirectPage?: unknown;
}): boolean {
  const value = settings.redirectPage;
  if (typeof value === "string") return value.trim().length > 0;
  return parseRedirectReference(value, []) !== null;
}

export type RedirectOptionState =
  /** Not offered: nothing stored, nothing configured, nothing unknown. */
  | "hidden"
  /** Offered but not selectable: the choices could not be loaded. */
  | "unknown"
  /** Offered because a page IS stored, though none can be chosen now. */
  | "stored-only"
  /** Offered with choices. */
  | "ready";

export function redirectOptionState(input: {
  /** A page is actually stored — not merely that this option is selected. */
  hasStoredPage: boolean;
  collections: string[] | null;
  configFailed: boolean;
}): RedirectOptionState {
  const configured = input.collections !== null && input.collections.length > 0;
  if (configured) return "ready";
  // A STORED page outranks a failed request: it is a fact about this form,
  // and the author needs to see it to change it.
  if (input.hasStoredPage) return "stored-only";
  return input.configFailed ? "unknown" : "hidden";
}

function PageRedirectOption({
  redirectCollections,
  configFailed,
  settings,
  updateSettings,
}: {
  redirectCollections: string[] | null;
  configFailed: boolean;
  settings: { confirmationType?: string; redirectPage?: unknown };
  updateSettings: (patch: { redirectPage?: unknown }) => void;
}) {
  const state = redirectOptionState({
    hasStoredPage: hasStoredRedirectPage(settings),
    collections: redirectCollections,
    configFailed,
  });
  if (state === "hidden") return null;

  return (
    <div className="flex items-start gap-3">
      {/* Selectable only when there are collections to pick from. In every
          other state choosing it leads to a save the server must refuse: the
          rule requires a page, and a page can only come from a configured
          collection. `stored-only` shows what is already saved; it is not an
          invitation to switch a different form into that state. */}
      <RadioGroupItem
        value="relationship"
        id="settings-confirm-page"
        className="mt-0.5"
        disabled={state !== "ready"}
      />
      <div className="w-full space-y-2">
        <Label htmlFor="settings-confirm-page">Redirect to a page</Label>

        {state !== "ready" && (
          <p className="text-[12px] text-muted-foreground">
            {configFailed
              ? "The redirect configuration could not be loaded, so the pages you can choose from are not listed. Reload to try again."
              : "No collection is configured as a redirect target right now. The page below is still saved, and stays until you choose a different confirmation."}
          </p>
        )}

        {/* Mounted whenever a page is stored, including with NO configured
            collections: the picker is what recovers the stored target by id
            and labels it, so leaving it out there tells an author a page is
            saved without telling them which. */}
        {state === "stored-only" || state === "ready"
          ? settings.confirmationType === "relationship" && (
              <RedirectPagePicker
                collections={redirectCollections ?? []}
                value={settings.redirectPage}
                onChange={next => updateSettings({ redirectPage: next })}
              />
            )
          : null}
      </div>
    </div>
  );
}

export function FormSettingsTab({
  spamDefaults,
  redirectCollections,
  redirectConfigFailed,
}: FormSettingsTabProps) {
  const { settings, updateSettings } = useFormBuilder();

  return (
    // The measure belongs to the page's shell, not to this tab.
    <div className="flex flex-col gap-10">
      {/* Submission */}
      <section>
        <SectionHeading>Submission</SectionHeading>
        <div className="flex flex-col gap-1 pt-2">
          <SettingRow
            label="Submit button text"
            description="Label on the form's primary action button"
            htmlFor="settings-submit-text"
          >
            <Input
              id="settings-submit-text"
              type="text"
              className="w-56"
              value={settings.submitButtonText ?? ""}
              onChange={e =>
                updateSettings({ submitButtonText: e.target.value })
              }
            />
          </SettingRow>

          <SettingRow
            label="Allow multiple submissions"
            description="When off, the same visitor (by IP) can submit this form only once. Best-effort: IP-based, so shared networks count as one visitor."
            htmlFor="settings-multiple"
          >
            <Switch
              id="settings-multiple"
              checked={settings.allowMultipleSubmissions ?? true}
              onCheckedChange={checked =>
                updateSettings({ allowMultipleSubmissions: checked })
              }
            />
          </SettingRow>
        </div>
      </section>

      {/* After submission */}
      <section>
        <SectionHeading>After submission</SectionHeading>
        <div className="flex flex-col gap-4 pt-4">
          <RadioGroup
            value={settings.confirmationType ?? "message"}
            onValueChange={value =>
              updateSettings({
                confirmationType: value as
                  | "message"
                  | "redirect"
                  | "relationship",
              })
            }
            className="flex flex-col gap-3"
          >
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value="message"
                id="settings-confirm-message"
                className="mt-0.5"
              />
              <div className="w-full space-y-2">
                <Label htmlFor="settings-confirm-message">Show a message</Label>
                {(settings.confirmationType ?? "message") === "message" && (
                  <Textarea
                    aria-label="Success message"
                    value={settings.successMessage ?? ""}
                    onChange={e =>
                      updateSettings({ successMessage: e.target.value })
                    }
                    rows={3}
                    placeholder="Thank you for your submission!"
                  />
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value="redirect"
                id="settings-confirm-redirect"
                className="mt-0.5"
              />
              <div className="w-full space-y-2">
                <Label htmlFor="settings-confirm-redirect">
                  Redirect to a URL
                </Label>
                {settings.confirmationType === "redirect" && (
                  <Input
                    aria-label="Redirect URL"
                    type="url"
                    value={settings.redirectUrl ?? ""}
                    onChange={e =>
                      updateSettings({
                        redirectUrl: e.target.value || undefined,
                      })
                    }
                    placeholder="https://example.com/thanks"
                  />
                )}
              </div>
            </div>
            <PageRedirectOption
              redirectCollections={redirectCollections}
              configFailed={redirectConfigFailed}
              settings={settings}
              updateSettings={updateSettings}
            />
          </RadioGroup>
        </div>
      </section>

      {/* Spam protection */}
      <section>
        <SectionHeading>Spam protection</SectionHeading>
        <div className="flex flex-col gap-1 pt-2">
          <SettingRow
            label="Honeypot"
            description="Invisible trap field for bots. Inherits the plugin default unless overridden here."
            htmlFor="settings-honeypot"
          >
            <InheritToggle
              id="settings-honeypot"
              value={settings.honeypotEnabled}
              inherited={spamDefaults?.honeypot}
              onChange={honeypotEnabled => updateSettings({ honeypotEnabled })}
            />
          </SettingRow>

          <SettingRow
            label="reCAPTCHA"
            description="Challenge-based bot check. Inherits the plugin default unless overridden here."
            htmlFor="settings-captcha"
          >
            <InheritToggle
              id="settings-captcha"
              value={settings.captchaEnabled}
              inherited={spamDefaults?.recaptchaEnabled}
              onChange={captchaEnabled => updateSettings({ captchaEnabled })}
            />
          </SettingRow>

          {settings.captchaEnabled === true && (
            <SettingRow
              label="reCAPTCHA site key"
              description="The client-facing site key for this form"
              htmlFor="settings-captcha-key"
            >
              <Input
                id="settings-captcha-key"
                type="text"
                className="w-72 font-mono"
                value={settings.captchaSiteKey ?? ""}
                onChange={e =>
                  updateSettings({
                    captchaSiteKey: e.target.value || undefined,
                  })
                }
              />
            </SettingRow>
          )}
        </div>
      </section>
    </div>
  );
}

export default FormSettingsTab;
