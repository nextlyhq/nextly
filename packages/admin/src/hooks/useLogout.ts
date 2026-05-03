"use client";

import { useQueryClient } from "@tanstack/react-query";

import { resetSetupStatusCache } from "@admin/components/guards/PrivateRoute";
import { toast } from "@admin/components/ui";
import { getCsrfToken } from "@admin/lib/api/csrf";
import { invalidateSessionCache } from "@admin/lib/auth/session";
import { navigateTo } from "@admin/lib/navigation";

import { ROUTES } from "../constants/routes";

import { useApi } from "./useApi";

export function useLogout() {
  const { api } = useApi();
  const queryClient = useQueryClient();

  const logout = async () => {
    try {
      // Use the shared CSRF helper so the wire-shape contract lives in
      // one place (lib/api/csrf.ts). Pre-Phase-4 this hook duplicated the
      // fetch and read the legacy `{ data: { csrfToken } }` shape, which
      // silently broke after the dispatcher was migrated to canonical
      // `{ token }` per spec section 7.6.
      const csrfToken = await getCsrfToken();

      // Call logout endpoint (protected)
      await api.protected.post("/auth/logout", { csrfToken });
      // Clear all cached query data so the next user starts with a clean slate
      invalidateSessionCache();
      resetSetupStatusCache();
      queryClient.clear();
      // Show success message and redirect
      toast.success("You have been logged out successfully.");
      // Redirect to login page
      navigateTo(ROUTES.LOGIN);
    } catch (_error: unknown) {
      toast.error("Logout failed. Please try again later.");
    }
  };

  return logout;
}
