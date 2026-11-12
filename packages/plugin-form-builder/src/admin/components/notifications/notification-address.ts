/**
 * Which notification a form's Notifications page shows: none, the list; or
 * one, by its id in the address's `notification` query. A query rather than a
 * further path segment, because a form page is one segment of the form's
 * address, and the query gives each notification an address of its own that
 * survives a reload and can be shared.
 *
 * Read through the admin's own navigation: the admin announces each move with
 * a `locationchange` event (and the browser's Back with `popstate`), so the
 * page follows without a reload and keeps the unsaved form.
 *
 * @module admin/components/notifications/notification-address
 */
import { navigateTo } from "@nextlyhq/plugin-sdk/admin";
import { useSyncExternalStore } from "react";

/** The query key naming the notification shown. */
const NOTIFICATION_PARAM = "notification";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("locationchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("locationchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function shownId(): string | null {
  return new URLSearchParams(window.location.search).get(NOTIFICATION_PARAM);
}

/** The id of the notification the address names, or null for the list. */
export function useShownNotification(): string | null {
  return useSyncExternalStore(subscribe, shownId, () => null);
}

/** The address of one notification, or of the list for null. */
export function notificationHref(id: string | null): string {
  const query = new URLSearchParams(window.location.search);
  if (id === null) query.delete(NOTIFICATION_PARAM);
  else query.set(NOTIFICATION_PARAM, id);
  const search = query.toString();
  return `${window.location.pathname}${search ? `?${search}` : ""}`;
}

/**
 * Show one notification, or the list for null. Inside the admin it moves
 * through the admin's navigation; a form not yet saved has no address of its
 * own to move under, so the change stays in the browser's history only.
 */
export function showNotification(id: string | null): void {
  const href = notificationHref(id);
  if (window.location.pathname.startsWith("/admin/")) {
    navigateTo(href);
    return;
  }
  window.history.pushState(null, "", href);
  window.dispatchEvent(new Event("locationchange"));
}
