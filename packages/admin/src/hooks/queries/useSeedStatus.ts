"use client";

/**
 * useSeedStatus — state machine for the dashboard SeedDemoContentCard.
 *
 * Composes two queries (probe + meta status) and two mutations (run seed,
 * skip) into a single discriminated-union state. The card consumes
 * `status.kind` to pick which markup to render, and calls `startSeed()` /
 * `skip()` to drive transitions.
 *
 * Persistence: completedAt and skippedAt live in nextly_meta (server-side)
 * so the card's hidden state survives across browsers and team members.
 * Local "overlay" state is layered on top of the queries to capture
 * mid-flight states (seeding, success, error) before the queries refetch.
 *
 * @module hooks/queries/useSeedStatus
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  seedApi,
  type SeedProbeResult,
  type SeedResult,
  type SeedStatus as SeedStatusRow,
} from "@admin/services/seedApi";

export type SeedStatus =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "idle"; template: { slug: string; label: string } }
  | { kind: "seeding" }
  | { kind: "success"; result: SeedResult }
  | { kind: "error"; message: string };

interface UseSeedStatusReturn {
  status: SeedStatus;
  startSeed: () => void;
  skip: () => void;
}

const QK_PROBE = ["seed", "probe"] as const;
const QK_STATUS = ["seed", "status"] as const;

export function useSeedStatus(): UseSeedStatusReturn {
  const qc = useQueryClient();

  // Mid-flight overlay: takes precedence over the queries while a
  // mutation is in-flight or has just resolved. Cleared when the user
  // navigates away or the component remounts (intentional — success
  // state already auto-hides via the card's setTimeout).
  const [overlay, setOverlay] = useState<SeedStatus | null>(null);

  const probeQ = useQuery<SeedProbeResult>({
    queryKey: QK_PROBE,
    queryFn: seedApi.probe,
    staleTime: Infinity,
    retry: false,
  });

  const statusQ = useQuery<SeedStatusRow>({
    queryKey: QK_STATUS,
    queryFn: seedApi.getStatus,
    staleTime: Infinity,
    retry: false,
    // Don't ask for status if probing tells us seeding isn't available.
    enabled: probeQ.data?.available === true,
  });

  const seedMut = useMutation<SeedResult, Error, void>({
    mutationFn: seedApi.runSeed,
    onMutate: () => {
      setOverlay({ kind: "seeding" });
    },
    onSuccess: result => {
      setOverlay({ kind: "success", result });
      // Refresh the meta read so reload-as-other-user sees completedAt.
      void qc.invalidateQueries({ queryKey: QK_STATUS });
    },
    onError: err => {
      setOverlay({ kind: "error", message: err.message });
    },
  });

  const skipMut = useMutation<void, Error, void>({
    mutationFn: seedApi.setSkipped,
    onMutate: () => {
      setOverlay({ kind: "hidden" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK_STATUS });
    },
  });

  const status: SeedStatus = (() => {
    if (overlay) return overlay;

    if (probeQ.isLoading) return { kind: "loading" };
    const probe = probeQ.data;
    if (!probe || probe.available === false) return { kind: "hidden" };

    if (statusQ.isLoading) return { kind: "loading" };
    const meta = statusQ.data;
    if (meta?.completedAt || meta?.skippedAt) return { kind: "hidden" };

    return { kind: "idle", template: probe.template };
  })();

  return {
    status,
    startSeed: () => seedMut.mutate(),
    skip: () => skipMut.mutate(),
  };
}
