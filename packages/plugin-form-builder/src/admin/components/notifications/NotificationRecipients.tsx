"use client";

/**
 * Who a notification goes to: the team, at addresses typed in, or the person
 * who submitted, at the address in one of the form's Email fields; where a
 * reply lands; and its Cc and Bcc.
 *
 * @module admin/components/notifications/NotificationRecipients
 */
import {
  Badge,
  Button,
  FormSection,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { type JSX, useId, useState } from "react";

import { starterTemplateFor } from "../../../emails/starter-messages";
import type { AnyFormField, FormNotification } from "../../../types";
import { parseFieldRef } from "../../../utils/field-references";
import {
  parseAddressList,
  teamAddressesOf,
} from "../../../utils/notification-model";
import { addressError, isValidEmail } from "../builder/notification-addresses";
import {
  ChoiceCards,
  descriptionIdOf,
  SettingRow,
} from "../builder/settings-rows";

import { NO_EMAIL_FIELD_REASON } from "./NotificationsList";

/** A change to the notification shown. */
export type NotificationUpdate = (changes: Partial<FormNotification>) => void;

const TRIGGER = "w-full bg-transparent border-input dark:bg-muted/50";

/**
 * Addresses as chips, with a box to add more: several typed at once (a
 * pasted list) are split, and one that is not an address is refused, saying
 * so, before it can be saved and fail at delivery.
 */
function AddressList({
  label,
  addresses,
  placeholder,
  onChange,
}: {
  label: string;
  addresses: string[];
  placeholder: string;
  onChange: (addresses: string[]) => void;
}): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const typed = parseAddressList(draft);
    if (typed.length === 0) return;
    const bad = typed.find(address => !isValidEmail(address));
    if (bad !== undefined) {
      setError(`${bad} is not an email address.`);
      return;
    }
    const known = new Set(addresses.map(address => address.toLowerCase()));
    onChange([
      ...addresses,
      ...typed.filter(address => !known.has(address.toLowerCase())),
    ]);
    setDraft("");
    setError(null);
  };
  return (
    <div className="flex flex-col gap-2">
      {addresses.length > 0 && (
        <ul aria-label={label} className="flex flex-wrap gap-1.5">
          {addresses.map(address => (
            <li key={address}>
              <Badge
                variant="outline"
                className="gap-1 py-0.5 pl-2 pr-1 text-xs font-medium"
              >
                {address}
                <button
                  type="button"
                  className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${address}`}
                  onClick={() =>
                    onChange(addresses.filter(each => each !== address))
                  }
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          aria-label={`Add to ${label}`}
          value={draft}
          placeholder={placeholder}
          onChange={event => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={event => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            }
          }}
          onBlur={add}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          // No width of its own: the page sets the form's measure, and the
          // input fills the row beside its Add button within it.
        />
        <Button type="button" variant="outline" onClick={add}>
          Add
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The form's Email fields, the ones a visitor's address can come from. */
function emailFieldsOf(fields: readonly AnyFormField[]): AnyFormField[] {
  return fields.filter(field => field.type === "email");
}

/** Where a reply lands, as the Reply-To choice reads it. */
function replyChoiceOf(notification: FormNotification): string {
  if (!notification.replyTo) return "message";
  const field = parseFieldRef(notification.replyTo);
  return field === null ? "custom" : `field:${field}`;
}

function ReplyTo({
  notification,
  fields,
  update,
}: {
  notification: FormNotification;
  fields: readonly AnyFormField[];
  update: NotificationUpdate;
}): JSX.Element {
  const choice = replyChoiceOf(notification);
  // Typing a new address is a choice of its own before anything is typed.
  const [typing, setTyping] = useState(choice === "custom");
  const shown = typing ? "custom" : choice;
  const team = notification.recipientType !== "field";
  const error = addressError("replyTo", notification.replyTo);
  return (
    <SettingRow
      label="Reply-To"
      htmlFor="notification-reply-to"
      description={
        team
          ? "Replying from your inbox answers the visitor."
          : "Where the visitor's reply lands."
      }
    >
      <div className="flex w-full flex-col gap-2 sm:w-72">
        <Select
          value={shown}
          onValueChange={value => {
            setTyping(value === "custom");
            if (value === "message") update({ replyTo: undefined });
            else if (value.startsWith("field:")) {
              update({ replyTo: `{{${value.slice("field:".length)}}}` });
            } else update({ replyTo: "" });
          }}
        >
          <SelectTrigger
            id="notification-reply-to"
            aria-describedby={descriptionIdOf("notification-reply-to")}
            className={TRIGGER}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {emailFieldsOf(fields).map(field => (
              <SelectItem key={field.name} value={`field:${field.name}`}>
                The visitor, field: {field.label || field.name}
              </SelectItem>
            ))}
            <SelectItem value="message">The message&apos;s Reply-To</SelectItem>
            <SelectItem value="custom">Another address</SelectItem>
          </SelectContent>
        </Select>
        {shown === "custom" && (
          <>
            <Input
              aria-label="Reply-To address"
              type="email"
              value={notification.replyTo ?? ""}
              placeholder="replies@example.com"
              onChange={event => update({ replyTo: event.target.value })}
              aria-invalid={error ? true : undefined}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </>
        )}
      </div>
    </SettingRow>
  );
}

/** One copy line, Cc or Bcc, with its addresses. */
function CopyList({
  label,
  addresses,
  onChange,
}: {
  label: "Cc" | "Bcc";
  addresses: string[];
  onChange: (addresses: string[]) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-semibold">{label}</Label>
      <AddressList
        label={label}
        addresses={addresses}
        placeholder="Add an address"
        onChange={onChange}
      />
    </div>
  );
}

/** Cc and Bcc, folded away until wanted or already set. */
function CopiesTo({
  notification,
  update,
}: {
  notification: FormNotification;
  update: NotificationUpdate;
}): JSX.Element {
  const cc = notification.cc ?? [];
  const bcc = notification.bcc ?? [];
  const [open, setOpen] = useState(cc.length + bcc.length > 0);
  const Icon = open ? ChevronUp : ChevronDown;
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        Cc and Bcc
      </button>
      {open && (
        <div className="grid gap-4 md:grid-cols-2">
          <CopyList
            label="Cc"
            addresses={cc}
            onChange={next => update({ cc: next })}
          />
          <CopyList
            label="Bcc"
            addresses={bcc}
            onChange={next => update({ bcc: next })}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Turn the notification to the team or to the visitor. Its message follows
 * to the other kind's starter while it is still on the starter for the old
 * one; a message the author chose stays.
 */
function turnedTo(
  notification: FormNotification,
  kind: "team" | "visitor",
  fields: readonly AnyFormField[]
): Partial<FormNotification> {
  const recipientType = kind === "visitor" ? "field" : "static";
  const templateSlug =
    notification.templateSlug === starterTemplateFor(notification.recipientType)
      ? starterTemplateFor(recipientType)
      : notification.templateSlug;
  const email = emailFieldsOf(fields)[0]?.name;
  return kind === "visitor"
    ? {
        kind,
        recipientType,
        to: email === undefined ? "" : `{{${email}}}`,
        recipients: undefined,
        templateSlug,
      }
    : { kind, recipientType, to: "", recipients: [], templateSlug };
}

export function NotificationRecipients({
  notification,
  fields,
  update,
}: {
  notification: FormNotification;
  fields: readonly AnyFormField[];
  update: NotificationUpdate;
}): JSX.Element {
  const emailFields = emailFieldsOf(fields);
  const kind = notification.recipientType === "field" ? "visitor" : "team";
  const addresses = teamAddressesOf(notification);
  const visitorField = parseFieldRef(notification.to) ?? "";
  return (
    <FormSection label="Who gets it">
      <ChoiceCards
        name="notification-recipient"
        label="Who gets it"
        value={kind}
        onChange={next => update(turnedTo(notification, next, fields))}
        choices={[
          {
            value: "team",
            title: "Your team",
            details: (
              <AddressList
                label="Team addresses"
                addresses={addresses}
                placeholder="Add an address"
                onChange={list =>
                  update({ recipients: list, to: list[0] ?? "" })
                }
              />
            ),
          },
          {
            value: "visitor",
            title: "The person who submitted",
            disabled: emailFields.length === 0 && kind !== "visitor",
            note:
              emailFields.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {NO_EMAIL_FIELD_REASON}
                </p>
              ) : undefined,
            details: (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  To the address in
                </span>
                <Select
                  value={visitorField}
                  onValueChange={name => update({ to: `{{${name}}}` })}
                >
                  <SelectTrigger
                    aria-label="Email field"
                    className={`${TRIGGER} sm:w-56`}
                  >
                    <SelectValue placeholder="Choose an Email field" />
                  </SelectTrigger>
                  <SelectContent>
                    {emailFields.map(field => (
                      <SelectItem key={field.name} value={field.name}>
                        {field.label || field.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ),
          },
        ]}
      />
      <ReplyTo notification={notification} fields={fields} update={update} />
      <CopiesTo notification={notification} update={update} />
    </FormSection>
  );
}
