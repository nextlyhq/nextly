"use client";

import { useEffect, useState } from "react";

/**
 * Hook to safely handle hydration mismatches
 * Returns true only after client-side hydration is complete
 */
export function useHydration(): boolean {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  return isHydrated;
}
