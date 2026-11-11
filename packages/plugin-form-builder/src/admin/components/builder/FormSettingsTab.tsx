"use client";

/**
 * A form's Settings after its Form section: what happens after someone
 * submits, whether it is taking submissions, how many responses one person
 * may send, and its spam protection.
 *
 * Every control here is consumed somewhere (the submit handler or the
 * confirmation flow): a setting that does nothing does not get a control.
 * Spam controls are per-form OVERRIDES of the plugin's options: "Site
 * default" follows them, and the value it follows is shown.
 *
 * @module admin/components/builder/FormSettingsTab
 */

import {
  FormSection,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@nextlyhq/ui";
import type React from "react";

import { DEFAULT_FORM_SETTINGS } from "../../../config/defaults";
import type { FormSettings, OneResponseMode } from "../../../types";
import { parseRedirectReference } from "../../../utils/redirect-reference";
import { useFormBuilder } from "../../context/FormBuilderContext";

import {
  type BotCheckSiteDefaults,
  BotCheckNotices,
  BotCheckRow,
  RateLimitRow,
} from "./BotCheckRows";
import { ClosingTimeRow, SubmissionLimitRow } from "./ClosingRows";
import { RedirectPagePicker } from "./RedirectPagePicker";
import {
  type Choice,
  ChoiceCards,
  descriptionIdOf,
  SettingRow,
} from "./settings-rows";

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
  /** The trigger's id; its row's description is read with it. */
  id: string;
  value: boolean | undefined;
  inherited: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}) {
  const inheritedLabel =
    inherited === undefined
      ? "Site default"
      : `Site default (${inherited ? "on" : "off"})`;
  return (
    <Select
      value={value === undefined ? "inherit" : value ? "on" : "off"}
      onValueChange={selected =>
        onChange(selected === "inherit" ? undefined : selected === "on")
      }
    >
      <SelectTrigger
        id={id}
        aria-describedby={descriptionIdOf(id)}
        className="w-48 bg-transparent border-input dark:bg-muted/50"
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

export interface SpamDefaults extends BotCheckSiteDefaults {
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

type ConfirmationType = NonNullable<FormSettings["confirmationType"]>;

/**
 * The "Go to a page on this site" choice, or none when it is not offered.
 *
 * Selectable only when there are collections to pick from. In every other
 * state choosing it leads to a save the server must refuse: the rule requires
 * a page, and a page can only come from a configured collection.
 * `stored-only` shows what is already saved; it is not an invitation to
 * switch a different form into that state.
 */
function pageChoice({
  redirectCollections,
  configFailed,
  settings,
  updateSettings,
}: {
  redirectCollections: string[] | null;
  configFailed: boolean;
  settings: FormSettings;
  updateSettings: (patch: Partial<FormSettings>) => void;
}): Choice<ConfirmationType> | null {
  const state = redirectOptionState({
    hasStoredPage: hasStoredRedirectPage(settings),
    collections: redirectCollections,
    configFailed,
  });
  if (state === "hidden") return null;
  return {
    value: "relationship",
    title: "Go to a page on this site",
    description: "Picks a page; the link follows if the page moves.",
    disabled: state !== "ready",
    note:
      state === "ready" ? undefined : (
        <p className="text-xs text-muted-foreground">
          {configFailed
            ? "The redirect configuration could not be loaded, so the pages you can choose from are not listed. Reload to try again."
            : "No collection is configured as a redirect target right now. The page below is still saved, and stays until you choose a different confirmation."}
        </p>
      ),
    // Mounted whenever a page is stored, including with NO configured
    // collections: the picker is what recovers the stored target by id and
    // labels it, so leaving it out there tells an author a page is saved
    // without telling them which.
    details: (
      <RedirectPagePicker
        collections={redirectCollections ?? []}
        value={settings.redirectPage}
        onChange={next => updateSettings({ redirectPage: next })}
      />
    ),
  };
}

function AfterSubmitSection({
  redirectCollections,
  redirectConfigFailed,
}: Pick<
  FormSettingsTabProps,
  "redirectCollections" | "redirectConfigFailed"
>): React.JSX.Element {
  const { settings, updateSettings } = useFormBuilder();
  const page = pageChoice({
    redirectCollections,
    configFailed: redirectConfigFailed,
    settings,
    updateSettings,
  });
  const choices: Choice<ConfirmationType>[] = [
    {
      value: "message",
      title: "Show a message",
      description: "Replaces the form on the page.",
      details: (
        <Textarea
          aria-label="Message after submitting"
          value={settings.successMessage ?? ""}
          onChange={event =>
            updateSettings({ successMessage: event.target.value })
          }
          rows={3}
          placeholder="Thank you for your submission!"
        />
      ),
    },
    ...(page ? [page] : []),
    {
      value: "redirect",
      title: "Go to a web address",
      details: (
        <Input
          aria-label="Web address"
          type="url"
          className="font-mono"
          value={settings.redirectUrl ?? ""}
          onChange={event =>
            updateSettings({ redirectUrl: event.target.value || undefined })
          }
          placeholder="https://example.com/thanks"
        />
      ),
    },
  ];
  return (
    <FormSection label="After someone submits">
      <SettingRow label="Button text" htmlFor="settings-submit-text">
        <Input
          id="settings-submit-text"
          type="text"
          className="w-full sm:w-72"
          value={settings.submitButtonText ?? ""}
          onChange={event =>
            updateSettings({ submitButtonText: event.target.value })
          }
        />
      </SettingRow>
      <SettingRow label="Then" stack>
        <ChoiceCards
          name="settings-confirm"
          label="What happens after someone submits"
          value={settings.confirmationType ?? "message"}
          onChange={confirmationType => updateSettings({ confirmationType })}
          choices={choices}
        />
      </SettingRow>
    </FormSection>
  );
}

/** What "Accepting submissions" says, by the form's status as edited. */
const ACCEPTING_DESCRIPTION = {
  draft:
    "This form is a draft. Make it live from the status in the bar to start taking submissions.",
  published: "Turn off to close the form now. Visitors see the closed message.",
  closed:
    "The form is closed: visitors see the closed message. Turn on to open it.",
} as const satisfies Record<"draft" | "published" | "closed", string>;

function AvailabilitySection(): React.JSX.Element {
  const { formData, updateFormData } = useFormBuilder();
  const status = formData.status;
  return (
    <FormSection label="Availability">
      <SettingRow
        label="Accepting submissions"
        htmlFor="settings-accepting"
        description={ACCEPTING_DESCRIPTION[status]}
      >
        <Switch
          id="settings-accepting"
          aria-describedby={descriptionIdOf("settings-accepting")}
          checked={status === "published"}
          // A draft is opened from the status menu, where Live is chosen on
          // purpose; this switch only closes and reopens a live form.
          disabled={status === "draft"}
          onCheckedChange={accepting =>
            updateFormData({ status: accepting ? "published" : "closed" })
          }
        />
      </SettingRow>
      <ClosingTimeRow />
      <SubmissionLimitRow />
      <SettingRow
        label="Message when closed"
        htmlFor="settings-closed-message"
        description="Shown to anyone who reaches this form while it is closed. Left empty, they are told only that it is not taking submissions."
        stack
      >
        <Textarea
          id="settings-closed-message"
          aria-describedby={descriptionIdOf("settings-closed-message")}
          value={formData.closedMessage ?? ""}
          onChange={event =>
            updateFormData({ closedMessage: event.target.value })
          }
          rows={3}
          placeholder="e.g., Applications closed on 31 March. Thank you to everyone who applied."
        />
      </SettingRow>
    </FormSection>
  );
}

/** Every way a form can limit responses, by how Settings names it. */
const ONE_RESPONSE_TITLES = {
  off: "Allow several responses",
  email: "One per email address",
  browser: "One per browser",
  ip: "One per network (IP address)",
} as const satisfies Record<OneResponseMode, string>;

/** The ways offered: the ones the submit handler enforces today. */
const ONE_RESPONSE_CHOICES: readonly Choice<OneResponseMode>[] = [
  { value: "off", title: ONE_RESPONSE_TITLES.off },
  {
    value: "ip",
    title: ONE_RESPONSE_TITLES.ip,
    description:
      "People in one office or home count as one person, so only one of them can respond.",
  },
];

/** Why a stored way that is not offered is shown, and cannot be chosen. */
const NOT_ENFORCED = "Saved on this form, and not yet applied to submissions.";

/**
 * The choices for a form, with its stored way added when it is not one of
 * those offered (one written through the API): left out, the list would show
 * nothing chosen while the stored value is saved again on the next save.
 */
function oneResponseChoices(
  current: OneResponseMode
): readonly Choice<OneResponseMode>[] {
  return ONE_RESPONSE_CHOICES.some(choice => choice.value === current)
    ? ONE_RESPONSE_CHOICES
    : [
        ...ONE_RESPONSE_CHOICES,
        {
          value: current,
          title: ONE_RESPONSE_TITLES[current],
          description: NOT_ENFORCED,
          disabled: true,
        },
      ];
}

function OneResponseSection(): React.JSX.Element {
  const { settings, updateSettings } = useFormBuilder();
  // Always set once the settings are read; the default covers the type.
  const current = settings.oneResponse ?? DEFAULT_FORM_SETTINGS.oneResponse;
  return (
    <FormSection label="One response per person">
      <SettingRow label="Who may respond again" stack>
        <ChoiceCards
          name="settings-one-response"
          label="One response per person"
          value={current}
          onChange={oneResponse => updateSettings({ oneResponse })}
          choices={oneResponseChoices(current)}
        />
      </SettingRow>
    </FormSection>
  );
}

function SpamSection({
  spamDefaults,
}: Pick<FormSettingsTabProps, "spamDefaults">): React.JSX.Element {
  const { settings, updateSettings } = useFormBuilder();
  return (
    <FormSection label="Spam protection">
      <SettingRow
        label="Hidden trap field"
        htmlFor="settings-honeypot"
        description="A field people never see; bots fill it in."
      >
        <InheritToggle
          id="settings-honeypot"
          value={settings.honeypotEnabled}
          inherited={spamDefaults?.honeypot}
          onChange={honeypotEnabled => updateSettings({ honeypotEnabled })}
        />
      </SettingRow>
      <BotCheckRow defaults={spamDefaults} />
      <BotCheckNotices defaults={spamDefaults} />
      <RateLimitRow defaults={spamDefaults} />
    </FormSection>
  );
}

export function FormSettingsTab({
  spamDefaults,
  redirectCollections,
  redirectConfigFailed,
}: FormSettingsTabProps): React.JSX.Element {
  return (
    // The page's shell spaces the sections, and the Form section above.
    <>
      <AfterSubmitSection
        redirectCollections={redirectCollections}
        redirectConfigFailed={redirectConfigFailed}
      />
      <AvailabilitySection />
      <OneResponseSection />
      <SpamSection spamDefaults={spamDefaults} />
    </>
  );
}

export default FormSettingsTab;
