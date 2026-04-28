/**
 * Submissions Filter Component
 *
 * A filter component that appears above the form-submissions list table.
 * Allows users to filter submissions by selecting a specific form.
 *
 * @module admin/components/SubmissionsFilter
 * @since 0.1.0
 */

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// Import styles - uses aliased path that resolves to dist/styles in consuming apps
import "@revnixhq/plugin-form-builder/styles/submissions-filter.css";

// ============================================================================
// Types
// ============================================================================

interface Form {
  id: string;
  name: string;
  slug: string;
}

export interface SubmissionsFilterProps {
  /** Collection slug (should be "form-submissions") */
  collectionSlug: string;
  /** Collection configuration */
  collection: Record<string, unknown>;
}

// ============================================================================
// Component
// ============================================================================

/**
 * SubmissionsFilter - Filter submissions by form
 *
 * Displays a dropdown of all forms. When a form is selected,
 * updates the URL query params to filter the submissions list.
 */
export function SubmissionsFilter({
  collectionSlug,
}: SubmissionsFilterProps): React.ReactElement | null {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [forms, setForms] = useState<Form[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFormId, setSelectedFormId] = useState<string>("");

  // Get current filter from URL
  useEffect(() => {
    const whereParam = searchParams.get("where");
    if (whereParam) {
      try {
        const where = JSON.parse(whereParam);
        if (where.form?.equals) {
          setSelectedFormId(where.form.equals);
        }
      } catch {
        // Invalid JSON, ignore
      }
    }
  }, [searchParams]);

  // Fetch all forms
  useEffect(() => {
    async function fetchForms() {
      try {
        const response = await fetch("/admin/api/collections/forms/entries");
        if (response.ok) {
          const data = await response.json();
          const docs =
            data.data?.data?.docs || data.data?.docs || data.docs || [];
          setForms(docs);
        }
      } catch (error) {
        console.error("Failed to fetch forms:", error);
      } finally {
        setIsLoading(false);
      }
    }

    void fetchForms();
  }, []);

  // Handle form selection
  const handleFormChange = useCallback(
    (formId: string) => {
      setSelectedFormId(formId);

      // Build new URL with filter
      const params = new URLSearchParams(searchParams.toString());

      if (formId) {
        // Set the where parameter to filter by form
        const where = JSON.stringify({ form: { equals: formId } });
        params.set("where", where);
      } else {
        // Clear the filter
        params.delete("where");
      }

      // Reset to page 1 when filter changes
      params.delete("page");

      // Navigate with new params (route is /admin/collection/ singular)
      router.push(`/admin/collection/${collectionSlug}?${params.toString()}`);
    },
    [router, searchParams, collectionSlug]
  );

  // Don't render if not on form-submissions collection
  if (collectionSlug !== "form-submissions") {
    return null;
  }

  return (
    <div className="submissions-filter">
      <div className="submissions-filter-container">
        <label htmlFor="form-filter" className="submissions-filter-label">
          Filter by Form:
        </label>
        <select
          id="form-filter"
          value={selectedFormId}
          onChange={e => handleFormChange(e.target.value)}
          className="submissions-filter-select"
          disabled={isLoading}
        >
          <option value="">All Forms</option>
          {forms.map(form => (
            <option key={form.id} value={form.id}>
              {form.name}
            </option>
          ))}
        </select>
        {selectedFormId && (
          <button
            type="button"
            onClick={() => handleFormChange("")}
            className="submissions-filter-clear"
            title="Clear filter"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export default SubmissionsFilter;
