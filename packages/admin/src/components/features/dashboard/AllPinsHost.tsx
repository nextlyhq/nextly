"use client";

/**
 * Where "View all pins" is drawn: mounted once beside the admin's toaster, so
 * every screen can open it (`openAllPins`). It draws nothing until the dialog
 * is first opened, and the dialog itself is loaded then, so a screen that
 * never opens it pays for this and the store alone.
 *
 * @module components/features/dashboard/AllPinsHost
 */

import { lazy, Suspense, useEffect, useState, type JSX } from "react";

import { useAllPinsOpen } from "./all-pins";

const AllPinsDialog = lazy(() =>
  import("./AllPinsDialog").then(m => ({ default: m.AllPinsDialog }))
);

export function AllPinsHost(): JSX.Element | null {
  const open = useAllPinsOpen();
  // Kept once opened, so closing plays the dialog's own exit rather than
  // removing it at once.
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (open) setWanted(true);
  }, [open]);
  if (!open && !wanted) return null;
  return (
    <Suspense fallback={null}>
      <AllPinsDialog open={open} />
    </Suspense>
  );
}
