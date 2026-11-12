"use client";

/**
 * The email a notification sends: the Email hub message it uses (its wording
 * and design live there), the form's file fields whose files go with it, and
 * the From and Provider it sends with, the message's own unless picked here.
 *
 * @module admin/components/notifications/NotificationEmail
 */
import {
  Button,
  Checkbox,
  FormSection,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { ExternalLink, Mail, TriangleAlert } from "lucide-react";
import type { JSX } from "react";

import {
  FORM_CONFIRMATION_TEMPLATE,
  starterTemplateFor,
} from "../../../emails/starter-messages";
import type { AnyFormField, FormNotification } from "../../../types";
import { attachFieldsOf } from "../../../utils/notification-model";
import { addressError } from "../builder/notification-addresses";
import { descriptionIdOf, SettingRow } from "../builder/settings-rows";

import {
  emailHubEditHref,
  type NotificationDefaults,
  type NotificationSources,
  type TemplateOption,
} from "./notification-sources";
import { messageOf } from "./notification-summary";
import type { NotificationUpdate } from "./NotificationRecipients";

const TRIGGER = "w-full bg-transparent border-input dark:bg-muted/50";

/** What the message is, or that there is none, with its starter to hand. */
function MessageDetails({
  notification,
  message,
  update,
}: {
  notification: FormNotification;
  message: TemplateOption | undefined;
  update: NotificationUpdate;
}): JSX.Element {
  if (!notification.templateSlug) {
    const starter = starterTemplateFor(notification.recipientType);
    return (
      <div className="min-w-0 flex-1 space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <TriangleAlert
            className="h-4 w-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          No message: this notification never sends
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => update({ templateSlug: starter })}
        >
          Use{" "}
          {starter === FORM_CONFIRMATION_TEMPLATE
            ? "Form confirmation"
            : "Form submission"}
        </Button>
      </div>
    );
  }
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <p className="text-sm font-semibold">
        {message?.name ?? notification.templateSlug}
      </p>
      {message?.subject && (
        <p className="truncate text-xs text-muted-foreground">
          Subject: <code className="font-mono">{message.subject}</code>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Its wording and design are edited in Settings › Email.
      </p>
    </div>
  );
}

/** Open the message in the Email hub, or choose another. */
function MessageActions({
  notification,
  message,
  sources,
  update,
}: {
  notification: FormNotification;
  message: TemplateOption | undefined;
  sources: NotificationSources;
  update: NotificationUpdate;
}): JSX.Element {
  const sendable = sources.templates.filter(
    each => each.isActive && each.kind !== "layout"
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {sources.canEditTemplates && message && (
        // A new tab, so the unsaved form is not left to edit the email.
        <Button asChild variant="outline" size="sm">
          <a
            href={emailHubEditHref(message.id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Edit in Email
          </a>
        </Button>
      )}
      <Select
        value={notification.templateSlug ?? ""}
        onValueChange={templateSlug => update({ templateSlug })}
      >
        <SelectTrigger aria-label="Message" className={`${TRIGGER} sm:w-48`}>
          <SelectValue placeholder="Choose a message" />
        </SelectTrigger>
        <SelectContent>
          {sendable.map(each => (
            <SelectItem key={each.id} value={each.slug}>
              {each.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The Email hub message the notification sends. */
function MessageCard({
  notification,
  sources,
  update,
}: {
  notification: FormNotification;
  sources: NotificationSources;
  update: NotificationUpdate;
}): JSX.Element {
  const message = messageOf(notification, sources.templates);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-start">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
        <Mail className="h-4 w-4" aria-hidden="true" />
      </span>
      <MessageDetails
        notification={notification}
        message={message}
        update={update}
      />
      <MessageActions
        notification={notification}
        message={message}
        sources={sources}
        update={update}
      />
    </div>
  );
}

function AttachFiles({
  notification,
  fields,
  update,
}: {
  notification: FormNotification;
  fields: readonly AnyFormField[];
  update: NotificationUpdate;
}): JSX.Element {
  const files = fields.filter(field => field.type === "file");
  const chosen = attachFieldsOf(notification, fields);
  return (
    <SettingRow
      label="Attach files from"
      description="The form's file fields whose files go with this email."
      stack={files.length > 0}
    >
      {files.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          This form has no file fields
        </span>
      ) : (
        <ul aria-label="Attach files from" className="flex flex-col gap-2">
          {files.map(field => {
            const id = `attach-${field.name}`;
            return (
              <li key={field.name} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={chosen.includes(field.name)}
                  onCheckedChange={checked =>
                    update({
                      attachFields:
                        checked === true
                          ? [...chosen, field.name]
                          : chosen.filter(name => name !== field.name),
                    })
                  }
                />
                <Label htmlFor={id} className="text-sm font-normal">
                  {field.label || field.name}
                </Label>
              </li>
            );
          })}
        </ul>
      )}
    </SettingRow>
  );
}

/** The address a notification sends from when its From is blank. */
/**
 * Where a blank From sends from, in the order sending decides it: the
 * plugin's default sender (`notifications.defaultFrom`), which the send path
 * passes as the sender, then the message's own, then the provider's.
 */
function inheritedSender(
  message: TemplateOption | undefined,
  defaults: NotificationDefaults | null
): { address: string; source: string } {
  if (defaults?.defaultFrom) {
    return {
      address: defaults.defaultFrom,
      source: "the site's default sender",
    };
  }
  if (message?.fromOverride) {
    return { address: message.fromOverride, source: "the message's setting" };
  }
  return {
    address: "the provider's address",
    source: "the provider's setting",
  };
}

/** The provider the message sends through, or the site's default. */
function inheritedProvider(
  message: TemplateOption | undefined,
  providers: NotificationSources["providers"]
): string {
  const chosen =
    providers.find(each => each.id === message?.providerId) ??
    providers.find(each => each.isDefault);
  return chosen ? ` (${chosen.name})` : "";
}

function FromRow({
  notification,
  inherited,
  update,
}: {
  notification: FormNotification;
  inherited: { address: string; source: string };
  update: NotificationUpdate;
}): JSX.Element {
  const error = addressError("senderEmail", notification.senderEmail);
  return (
    <SettingRow
      label="From"
      htmlFor="notification-from"
      description={`Leave blank to send from ${inherited.address}, ${inherited.source}.`}
    >
      <div className="flex w-full flex-col gap-1 sm:w-72">
        <Input
          id="notification-from"
          aria-describedby={descriptionIdOf("notification-from")}
          type="email"
          value={notification.senderEmail ?? ""}
          placeholder={inherited.address}
          onChange={event =>
            update({ senderEmail: event.target.value || undefined })
          }
          aria-invalid={error ? true : undefined}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </SettingRow>
  );
}

function ProviderRow({
  notification,
  providers,
  inherited,
  update,
}: {
  notification: FormNotification;
  providers: NotificationSources["providers"];
  inherited: string;
  update: NotificationUpdate;
}): JSX.Element {
  return (
    <SettingRow
      label="Provider"
      htmlFor="notification-provider"
      description="The message's provider unless you pick another."
    >
      <Select
        value={notification.providerId ?? "__message"}
        onValueChange={value =>
          update({ providerId: value === "__message" ? undefined : value })
        }
      >
        <SelectTrigger
          id="notification-provider"
          aria-describedby={descriptionIdOf("notification-provider")}
          className={`${TRIGGER} sm:w-72`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__message">
            The message&apos;s{inherited}
          </SelectItem>
          {providers.map(each => (
            <SelectItem key={each.id} value={each.id}>
              {each.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

export function NotificationEmail({
  notification,
  fields,
  sources,
  defaults,
  update,
}: {
  notification: FormNotification;
  fields: readonly AnyFormField[];
  sources: NotificationSources;
  defaults: NotificationDefaults | null;
  update: NotificationUpdate;
}): JSX.Element {
  const message = messageOf(notification, sources.templates);
  return (
    <FormSection label="The email">
      <MessageCard
        notification={notification}
        sources={sources}
        update={update}
      />
      <AttachFiles
        notification={notification}
        fields={fields}
        update={update}
      />
      <FromRow
        notification={notification}
        inherited={inheritedSender(message, defaults)}
        update={update}
      />
      <ProviderRow
        notification={notification}
        providers={sources.providers}
        inherited={inheritedProvider(message, sources.providers)}
        update={update}
      />
    </FormSection>
  );
}
