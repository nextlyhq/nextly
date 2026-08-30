"use client";

/**
 * Release query hooks.
 *
 * ## Query keys
 *
 * - `["releases"]` — every release query, the invalidation root
 * - `["releases", "list", params]` — one window
 * - `["releases", "detail", id]` — one release
 * - `["releases", "members", id]` — its contents
 *
 * ## Why every mutation invalidates the LIST as well as the detail
 *
 * A release's list row shows its state and instant, and scheduling changes
 * both. Invalidating only the detail leaves the list showing "draft" for a
 * release the editor has just committed to Friday — and the list is where they
 * look to confirm it. Membership counts the same way once the list shows size.
 *
 * @module hooks/queries/useReleases
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import {
  addReleaseMember,
  cancelRelease,
  createRelease,
  fetchRelease,
  fetchReleaseMembers,
  fetchReleases,
  removeReleaseMember,
  scheduleRelease,
} from "@admin/services/releaseApi";
import type {
  AddReleaseMemberPayload,
  CreateReleasePayload,
  ReleaseListParams,
  ScheduleReleasePayload,
} from "@admin/types/releases";

export const releaseKeys = {
  all: () => ["releases"] as const,
  list: (params: ReleaseListParams) => ["releases", "list", params] as const,
  detail: (id: string) => ["releases", "detail", id] as const,
  members: (id: string) => ["releases", "members", id] as const,
};

export function useReleases(params: ReleaseListParams = {}, enabled = true) {
  return useQuery({
    queryKey: releaseKeys.list(params),
    queryFn: () => fetchReleases(params),
    // A caller can decline to ask. `/api/releases` is gated, so a component
    // that will not render its result — because the reader lacks the grant, or
    // because the surface is closed — would otherwise issue a request whose
    // only outcome is a 403 in everyone's network log.
    enabled,
  });
}

export function useRelease(id: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.detail(id ?? ""),
    queryFn: () => fetchRelease(id as string),
    // Not fetched without an id: the detail route renders before its parameter
    // resolves, and a request for `/releases/undefined` is a 404 the editor
    // would see as "this release is gone".
    enabled: Boolean(id),
  });
}

export function useReleaseMembers(id: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.members(id ?? ""),
    queryFn: () => fetchReleaseMembers(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Refresh everything a release write can have changed.
 *
 * Deliberately coarse. A release is small and read rarely, so the cost of
 * refetching a window is nothing against the cost of an editor reading a stale
 * schedule and concluding their release did not take.
 */
function useRefreshRelease() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: releaseKeys.all() });
    if (id) {
      void queryClient.invalidateQueries({ queryKey: releaseKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: releaseKeys.members(id) });
    }
  };
}

/**
 * Why every release mutation below sets `retry: false`.
 *
 * The app-wide `QueryProvider` retries failed mutations twice, which is right
 * for an idempotent write and wrong for every write here. None of these
 * endpoints takes an idempotency key, so a request that COMMITS and then loses
 * its response is indistinguishable from one that never arrived: `create`
 * repeated twice makes three releases, and `addMember` three membership rows.
 *
 * The state moves are safer but not silent — a retried `schedule` or `cancel`
 * lands on a release already in the target state and the fence answers with a
 * conflict, so the editor is told their action failed when it took. Both
 * failure modes are worse than the one retrying exists to prevent.
 */
const NO_RETRY = { retry: false } as const;

export function useCreateRelease() {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    mutationFn: (payload: CreateReleasePayload) => createRelease(payload),
    onSuccess: result => {
      refresh(result.item.id);
      toast.success("Release created.");
    },
  });
}

export function useScheduleRelease(id: string) {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    mutationFn: (payload: ScheduleReleasePayload) =>
      scheduleRelease(id, payload),
    onSuccess: () => {
      refresh(id);
      toast.success("Release scheduled.");
    },
  });
}

export function useCancelRelease(id: string) {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    mutationFn: () => cancelRelease(id),
    onSuccess: () => {
      refresh(id);
      toast.success("Release cancelled.");
    },
  });
}

export function useAddReleaseMember(releaseId: string) {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    mutationFn: (payload: AddReleaseMemberPayload) =>
      addReleaseMember(releaseId, payload),
    onSuccess: () => {
      refresh(releaseId);
      toast.success("Added to release.");
    },
  });
}

export function useRemoveReleaseMember(releaseId: string) {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    // The release id travels with the member id: the server refuses a member
    // belonging to another release, so a stale view cannot edit one the editor
    // never opened.
    mutationFn: (memberId: string) => removeReleaseMember(releaseId, memberId),
    onSuccess: () => {
      refresh(releaseId);
      toast.success("Removed from release.");
    },
  });
}
