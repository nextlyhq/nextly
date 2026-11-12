"use client";

/**
 * A form's notifications as a list: each one's name and when it sends, who it
 * goes to and by which message, and whether it is active. A row opens the
 * notification's own page; "Add notification" starts one from a preset, to the
 * team or a confirmation to the person who submitted.
 *
 * @module admin/components/notifications/NotificationsList
 */
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch,
} from "@nextlyhq/ui";
import {
  ChevronRight,
  Mail,
  Plus,
  Send,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { JSX, MouseEvent } from "react";

import type { AnyFormField, FormNotification } from "../../../types";
import {
  createNotification,
  useFormBuilder,
} from "../../context/FormBuilderContext";

import { notificationHref, showNotification } from "./notification-address";
import type { TemplateOption } from "./notification-sources";
import {
  messageOf,
  recipientSummary,
  whenSummary,
} from "./notification-summary";

/** Why "Confirm to the visitor" cannot be chosen on a form with no Email field. */
export const NO_EMAIL_FIELD_REASON =
  "Add an Email field to the form to confirm to the visitor.";

/** Follow a row's link through the admin, keeping the unsaved form. */
function open(event: MouseEvent<HTMLAnchorElement>, id: string): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) {
    return;
  }
  event.preventDefault();
  showNotification(id);
}

function AddNotification({
  fields,
  onAdd,
}: {
  fields: readonly AnyFormField[];
  onAdd: (kind: "team" | "visitor") => void;
}): JSX.Element {
  const hasEmailField = fields.some(field => field.type === "email");
  return (
    // Not modal: the page around the menu stays as it is to assistive tech.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add notification
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem
          onSelect={() => onAdd("team")}
          className="items-start"
        >
          <Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="font-medium">Notify your team</span>
            <span className="text-xs text-muted-foreground">
              An email to addresses you choose
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onAdd("visitor")}
          disabled={!hasEmailField}
          className="items-start"
        >
          <Send className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="font-medium">Confirm to the visitor</span>
            <span className="text-xs text-muted-foreground">
              {hasEmailField
                ? "An email to the address they typed"
                : NO_EMAIL_FIELD_REASON}
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({
  notification,
  fields,
  templates,
  onActive,
}: {
  notification: FormNotification;
  fields: readonly AnyFormField[];
  templates: readonly TemplateOption[];
  onActive: (enabled: boolean) => void;
}): JSX.Element {
  const message = messageOf(notification, templates);
  const name = notification.name.trim() || "Untitled notification";
  return (
    <li
      className={`grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] ${
        notification.enabled ? "" : "text-muted-foreground"
      }`}
    >
      <div className="min-w-0">
        <a
          href={notificationHref(notification.id)}
          onClick={event => open(event, notification.id)}
          className="block truncate text-sm font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {name}
        </a>
        <p className="truncate text-xs text-muted-foreground">
          {whenSummary(notification, fields)}
        </p>
      </div>
      <div className="col-span-2 min-w-0 sm:col-span-1 sm:row-start-1 sm:col-start-2">
        <p className="truncate text-sm">
          {recipientSummary(notification, fields)}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {notification.templateSlug ? (
            <>Message: {message?.name ?? notification.templateSlug}</>
          ) : (
            // The warning colour is on the icon; the words stay in the
            // foreground colour, readable at this size in both themes.
            <span className="inline-flex items-center gap-1 text-foreground">
              <TriangleAlert
                className="h-3 w-3 shrink-0 text-destructive"
                aria-hidden="true"
              />
              No message: will not send
            </span>
          )}
        </p>
      </div>
      <div className="col-start-2 row-start-1 flex items-center gap-2 sm:col-start-3">
        <Switch
          checked={notification.enabled}
          onCheckedChange={onActive}
          aria-label={`${name} active`}
        />
        <ChevronRight
          className="h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
    </li>
  );
}

export function NotificationsList({
  templates,
}: {
  templates: readonly TemplateOption[];
}): JSX.Element {
  const { notifications, fields, addNotification, updateNotification } =
    useFormBuilder();

  // A new notification is added at once and opened on its own page.
  const add = (kind: "team" | "visitor") => {
    const created = createNotification(kind, fields);
    addNotification(created);
    showNotification(created.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[60ch] text-sm text-muted-foreground">
          Emails sent when someone submits this form. Each one uses a message
          from Settings › Email, where its wording and design live.
        </p>
        <div className="shrink-0">
          <AddNotification fields={fields} onAdd={add} />
        </div>
      </div>
      {notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-6 py-12 text-center">
          <Mail className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">No notifications yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Email your team about each submission, or send the visitor a
            confirmation.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div
            aria-hidden="true"
            className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] gap-x-4 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground sm:grid"
          >
            <span>Notification</span>
            <span>Sent to</span>
            <span>Active</span>
          </div>
          <ul aria-label="Notifications" className="divide-y divide-border">
            {notifications.map(notification => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                fields={fields}
                templates={templates}
                onActive={enabled =>
                  updateNotification(notification.id, { enabled })
                }
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
