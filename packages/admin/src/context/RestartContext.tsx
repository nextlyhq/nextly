"use client";

// Context for managing the schema apply overlay state.
// Shows a brief overlay while schema changes are being applied,
// then invalidates caches and shows success/error toast.
"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

interface RestartContextValue {
  isRestarting: boolean;
  statusMessage: string;
  statusDetail: string;
  startRestart: () => void;
  stopRestart: (success: boolean, message?: string) => void;
}

const RestartContext = createContext<RestartContextValue | null>(null);

export function useRestart() {
  const ctx = useContext(RestartContext);
  if (!ctx) {
    throw new Error("useRestart must be used within RestartProvider");
  }
  return ctx;
}

// What: overlay is forced to stay visible for at least this many milliseconds.
// Why: apply operations often complete in 50-100ms for metadata-only changes.
// Without a floor, React batches the isRestarting false -> true -> false
// transition in the same render cycle and the overlay never paints. Users
// need to see SOMETHING happened. 800ms is long enough to register
// visually but short enough not to feel sluggish.
const MIN_OVERLAY_DISPLAY_MS = 800;

export function RestartProvider({ children }: { children: ReactNode }) {
  const [isRestarting, setIsRestarting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Applying schema changes");
  const [statusDetail, setStatusDetail] = useState(
    "Updating tables and refreshing..."
  );
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks when startRestart was called so stopRestart can enforce the minimum
  // display time regardless of how fast the underlying apply completes.
  const startedAtRef = useRef<number | null>(null);
  const queryClient = useQueryClient();

  const startRestart = useCallback(() => {
    setIsRestarting(true);
    setStatusMessage("Applying schema changes");
    setStatusDetail("Updating tables and refreshing...");
    startedAtRef.current = Date.now();

    // Safety timeout: hide overlay after 30s if stopRestart was never called
    timeoutRef.current = setTimeout(() => {
      setIsRestarting(false);
      startedAtRef.current = null;
      toast.error("Schema apply timed out. Check your terminal for errors.");
    }, 30000);
  }, []);

  const stopRestart = useCallback(
    (success: boolean, message?: string) => {
      // Clear safety timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      const elapsed =
        startedAtRef.current !== null ? Date.now() - startedAtRef.current : 0;
      const remaining = Math.max(0, MIN_OVERLAY_DISPLAY_MS - elapsed);

      // The toast + cache invalidation happen immediately on result so the
      // user sees the outcome quickly. Only the overlay hide is delayed.
      if (success) {
        toast.success(message ?? "Schema changes applied successfully");
        // Invalidate all collection + entry caches so UI refetches fresh data
        void queryClient.invalidateQueries({ queryKey: ["collections"] });
        void queryClient.invalidateQueries({ queryKey: ["entries"] });
        void queryClient.invalidateQueries({ queryKey: ["singles"] });
        void queryClient.invalidateQueries({ queryKey: ["components"] });
      } else {
        toast.error(message ?? "Failed to apply schema changes");
      }

      if (remaining === 0) {
        setIsRestarting(false);
        startedAtRef.current = null;
      } else {
        setTimeout(() => {
          setIsRestarting(false);
          startedAtRef.current = null;
        }, remaining);
      }
    },
    [queryClient]
  );

  return (
    <RestartContext.Provider
      value={{
        isRestarting,
        statusMessage,
        statusDetail,
        startRestart,
        stopRestart,
      }}
    >
      {children}
    </RestartContext.Provider>
  );
}
