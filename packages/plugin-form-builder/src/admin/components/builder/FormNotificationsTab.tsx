"use client";

/**
 * A form's Notifications page: the list of its notifications, or one of them
 * on a page of its own when the address names it (`?notification=<id>`).
 * Both read and write the form held by the editor, so moving between them
 * keeps unsaved work, and the form's Save commits it.
 *
 * @module admin/components/builder/FormNotificationsTab
 */
import type { JSX } from "react";

import { useShownNotification } from "../notifications/notification-address";
import {
  type NotificationDefaults,
  useNotificationSources,
} from "../notifications/notification-sources";
import { NotificationPage } from "../notifications/NotificationPage";
import { NotificationsList } from "../notifications/NotificationsList";

export type { NotificationDefaults } from "../notifications/notification-sources";

interface FormNotificationsTabProps {
  /** `null` while the builder-config request is still settling. */
  defaults: NotificationDefaults | null;
}

export function FormNotificationsTab({
  defaults,
}: FormNotificationsTabProps): JSX.Element {
  const shown = useShownNotification();
  const sources = useNotificationSources();
  return shown === null ? (
    <NotificationsList templates={sources.templates} />
  ) : (
    <NotificationPage id={shown} sources={sources} defaults={defaults} />
  );
}

export default FormNotificationsTab;
