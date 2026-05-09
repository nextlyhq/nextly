import { describe, it, expect } from "vitest";

import { getSearchableFields } from "../../../domains/collections/services/collection-utils";

describe("CollectionEntryService - Search Fix", () => {
  it("should not include id, createdAt, and updatedAt in default searchable fields", () => {
    const mockCollection = {
      schemaDefinition: {
        fields: [
          { name: "title", type: "text" },
          { name: "description", type: "textarea" },
        ],
      },
    };

    const searchableFields = getSearchableFields(mockCollection);

    expect(searchableFields).toContain("slug");
    expect(searchableFields).toContain("title");
    expect(searchableFields).toContain("description");
    expect(searchableFields).not.toContain("id");
    expect(searchableFields).not.toContain("createdAt");
    expect(searchableFields).not.toContain("updatedAt");
  });

  it("should honor explicit searchableFields in config", () => {
    const mockCollection = {
      search: {
        searchableFields: ["title", "custom_field"],
      },
      schemaDefinition: {
        fields: [
          { name: "title", type: "text" },
          { name: "custom_field", type: "text" },
          { name: "other", type: "text" },
        ],
      },
    };

    const searchableFields = getSearchableFields(mockCollection);

    expect(searchableFields).toEqual(["title", "custom_field"]);
  });

  it("should include fields marked as searchable: true", () => {
    const mockCollection = {
      schemaDefinition: {
        fields: [
          { name: "title", type: "text" },
          { name: "secret", type: "text", searchable: false }, // explicitly false (though default for text is true)
          { name: "metadata", type: "json", searchable: true }, // explicitly search-enabled even if non-text
        ],
      },
    };

    const searchableFields = getSearchableFields(mockCollection);

    expect(searchableFields).toContain("title");
    expect(searchableFields).toContain("metadata");
    // Note: getSearchableFields currently doesn't check for searchable: false to exclude
    // it only checks for searchable: true to include.
  });
});
