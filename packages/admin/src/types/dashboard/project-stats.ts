import type { ReactNode } from "react";

/**
 * A single item in the project statistics grid (2×4 compact layout).
 * Each stat represents a project-wide metric with optional navigation.
 */
export interface ProjectStatItem {
  label: string;
  value: number;
  icon: ReactNode;
  href?: string; // Link to the relevant admin page
}
