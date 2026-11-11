"use client";

/**
 * The form editor's pieces that are not drawing: what the person may do from
 * it, the starting notification of a new form, and deleting the form.
 *
 * @module admin/form-editor-hooks
 */
import { toast } from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import type { NotificationDefaults } from "./components/builder/FormNotificationsTab";
import {
  createNotification,
  type FormNotification,
} from "./context/FormBuilderContext";
import { useAdminPermissions } from "./use-admin-permissions";

/** What the person may do from the form editor. */
export interface EditorAccess {
  /** Whether the permissions are known; until then nothing gated is said. */
  known: boolean;
  canDelete: boolean;
  /**
   * Whether submissions may be read. They carry what visitors sent, and their
   * collection is guarded on its own: reading a form does not allow it.
   */
  canReadSubmissions: boolean;
}

/**
 * The person's access, as the admin's permissions answer it. An action a
 * permission gates is offered once the answer says it may be, so nothing is
 * offered and then refused.
 */
export function useEditorAccess(
  formsSlug: string,
  submissionsSlug: string | undefined
): EditorAccess {
  const can = useAdminPermissions();
  return {
    known: can !== undefined,
    canDelete: can?.(`delete-${formsSlug}`) === true,
    canReadSubmissions:
      submissionsSlug !== undefined &&
      can?.(`read-${submissionsSlug}`) === true,
  };
}

/**
 * Seeds a new form with the default admin notification once the host's
 * defaults are known. Once only: deleting the seeded rule is final, so a list
 * the person emptied is never seeded again.
 */
export function useSeededNotification(
  isCreating: boolean,
  defaults: NotificationDefaults | null,
  seed: (rules: FormNotification[]) => void
): void {
  const seeded = useRef(false);
  useEffect(() => {
    if (!isCreating || defaults === null || seeded.current) return;
    seeded.current = true;
    seed([
      {
        ...createNotification(),
        name: "Admin notification",
        to: defaults.defaultToEmail ?? "",
      },
    ]);
  }, [isCreating, defaults, seed]);
}

/** What a refused delete tells the person: the server's words, or the status. */
function deleteFailureMessage(body: unknown, status: string): string {
  const error =
    typeof body === "object" && body !== null && "error" in body
      ? body.error
      : undefined;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? error.message
      : undefined;
  return typeof message === "string" && message !== ""
    ? message
    : `Couldn't delete the form${status === "" ? "." : `: ${status}`}`;
}

/** Deletes the form, as the admin's own Delete does, then reports it. */
export function useFormDelete(target: {
  collectionSlug: string;
  entryId: string | undefined;
  /** Writes held by a colleague's claim, read when the delete is confirmed. */
  writesHeld: boolean;
  /** Clears the unsaved changes, so leaving is not asked about. */
  markAsSaved: () => void;
  onDelete: (() => void) | undefined;
}): () => Promise<void> {
  const queryClient = useQueryClient();
  const { collectionSlug, entryId, writesHeld, markAsSaved, onDelete } = target;
  return useCallback(async () => {
    // The commit is where the refusal lives, as for Save: a colleague who
    // took the form while the question was open holds it now, and the claim
    // is advisory on the server, so nothing else would stop the delete.
    if (entryId === undefined || writesHeld) return;
    const response = await fetch(
      `/admin/api/collections/${collectionSlug}/entries/${entryId}`,
      { method: "DELETE", credentials: "include" }
    ).catch(() => undefined);
    if (response === undefined || !response.ok) {
      const body: unknown = await response?.json().catch(() => ({}));
      toast.error(deleteFailureMessage(body, response?.statusText ?? ""));
      return;
    }
    // Nothing is left to save, so leaving is not asked about.
    markAsSaved();
    void queryClient.invalidateQueries({
      queryKey: ["entries", "list", collectionSlug],
    });
    toast.success("Form deleted");
    onDelete?.();
  }, [entryId, writesHeld, collectionSlug, markAsSaved, queryClient, onDelete]);
}
