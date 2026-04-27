"use client";

import { useQueryClient } from "@tanstack/react-query";

import { resetSetupStatusCache } from "@admin/components/guards/PrivateRoute";
import { toast } from "@admin/components/ui";
import { invalidateSessionCache } from "@admin/lib/auth/session";
import { navigateTo } from "@admin/lib/navigation";

import { ROUTES } from "../constants/routes";

import { useApi } from "./useApi";

export function useLogout() {
  const { api } = useApi();
  const queryClient = useQueryClient();

  const logout = async () => {
    try {
      // Get CSRF token, for now we fetch it directly
      const csrfRes = await fetch("/admin/api/auth/csrf", {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!csrfRes.ok) {
        throw new Error("Failed to fetch CSRF token");
      }

      const csrfData = await csrfRes.json();
      // Custom auth returns { data: { csrfToken: "..." } }
      const csrfToken = csrfData.data?.csrfToken || csrfData.csrfToken;

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
