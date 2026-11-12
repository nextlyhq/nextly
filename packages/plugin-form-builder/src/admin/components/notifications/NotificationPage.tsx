"use client";

/**
 * One notification on a page of its own: its name and whether it is active,
 * then who gets it, when it sends, and the email it sends. Every edit is
 * written to the form as it is made and saved with the form's own Save, so
 * moving between the list and a notification keeps unsaved work.
 *
 * @module admin/components/notifications/NotificationPage
 */
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Switch,
} from "@nextlyhq/ui";
import { ChevronLeft, Copy, MoreHorizontal, Trash2 } from "lucide-react";
import type { JSX, MouseEvent } from "react";

import {
  useFieldBookkeeping,
  useFormBuilder,
} from "../../context/FormBuilderContext";

import { notificationHref, showNotification } from "./notification-address";
import type {
  NotificationDefaults,
  NotificationSources,
} from "./notification-sources";
import { NotificationConditions } from "./NotificationConditions";
import { NotificationEmail } from "./NotificationEmail";
import { NotificationRecipients } from "./NotificationRecipients";

function BackToList(): JSX.Element {
  return (
    <a
      href={notificationHref(null)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        showNotification(null);
      }}
      className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      All notifications
    </a>
  );
}

export function NotificationPage({
  id,
  sources,
  defaults,
}: {
  id: string;
  sources: NotificationSources;
  defaults: NotificationDefaults | null;
}): JSX.Element {
  const {
    notifications,
    fields,
    updateNotification,
    duplicateNotification,
    deleteNotification,
  } = useFormBuilder();
  const notification = notifications.find(each => each.id === id);
  // After an Undo the sections draw afresh from the restored rule, so a
  // choice they hold for themselves (typing another Reply-To) follows it.
  const { restored } = useFieldBookkeeping();

  if (!notification) {
    return (
      <div className="flex flex-col gap-3">
        <BackToList />
        <p className="text-sm text-muted-foreground">
          This notification is not on the form. It may have been deleted.
        </p>
      </div>
    );
  }

  const update = (changes: Parameters<typeof updateNotification>[1]) =>
    updateNotification(notification.id, changes);

  return (
    <div className="flex max-w-[56rem] flex-col gap-6">
      <BackToList />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="notification-name" className="text-sm font-semibold">
            Name
          </Label>
          <Input
            id="notification-name"
            value={notification.name}
            onChange={event => update({ name: event.target.value })}
            placeholder="Notify your team"
            className="sm:max-w-md"
          />
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor="notification-active" className="text-sm">
            Active
          </Label>
          <Switch
            id="notification-active"
            checked={notification.enabled}
            onCheckedChange={enabled => update({ enabled })}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="More for this notification"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => duplicateNotification(notification.id)}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => {
                  deleteNotification(notification.id);
                  showNotification(null);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <NotificationRecipients
        key={`recipients:${restored}`}
        notification={notification}
        fields={fields}
        update={update}
      />
      <NotificationConditions
        notification={notification}
        fields={fields}
        update={update}
      />
      <NotificationEmail
        notification={notification}
        fields={fields}
        sources={sources}
        defaults={defaults}
        update={update}
      />
    </div>
  );
}
