/**
 * TypeScript Type Generator Service
 *
 * Generates TypeScript interfaces from collection and single definitions. Provides strong typing for
 * collections, singles, entries, and input types.
 *
 * Generates:
 * - Collection interfaces with all fields typed
 * - Single interfaces with all fields typed
 * - Config interface mapping slugs to types (collections and singles)
 * - Create/Update input types for collections
 * - Update input types for singles
 * - Module augmentation for type-safe collection and single access
 *
 * @module services/schema/type-generator
 * @since 1.0.0
 */

import type { FieldConfig, DataFieldConfig } from "@nextly/collections";

import {
  isTextField,
  isTextareaField,
  isRichTextField,
  isEmailField,
  isPasswordField,
  isCodeField,
  isNumberField,
  isCheckboxField,
  isDateField,
  isSelectField,
  isRadioField,
  isUploadField,
  isRelationshipField,
  isRepeaterField,
  isGroupField,
  isJSONField,
  isComponentField,
  isDataField,
} from "../../../collections/fields/guards";
import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";
import type { DynamicComponentRecord } from "../../../schemas/dynamic-components/types";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";
import type { UserFieldDefinitionRecord } from "../../../schemas/user-field-definitions/types";

// ============================================================
// Types
// ============================================================

/**
 * Result of generating TypeScript types for a single collection.
 */
export interface GeneratedTypeInterface {
  /** Collection slug */
  collectionSlug: string;

  /** Generated TypeScript interface code */
  code: string;

  /** Interface name (e.g., "Post", "User") */
  interfaceName: string;
}

/**
 * Result of generating TypeScript types for a single Single.
 */
export interface GeneratedSingleTypeInterface {
  /** Single slug */
  singleSlug: string;

  /** Generated TypeScript interface code */
  code: string;

  /** Interface name (e.g., "SiteSettings", "Header") */
  interfaceName: string;
}

/**
 * Result of generating TypeScript types for a single Component.
 */
export interface GeneratedComponentTypeInterface {
  /** Component slug */
  componentSlug: string;

  /** Generated TypeScript interface code */
  code: string;

  /** Interface name (e.g., "SeoComponent", "HeroComponent") */
  interfaceName: string;
}

/**
 * Result of generating the complete payload-types.ts file.
 */
export interface GeneratedTypesFile {
  /** Generated TypeScript code for the types file */
  code: string;

  /** Suggested filename (default: "payload-types.ts") */
  filename: string;
}

/**
 * Options for TypeScript type generation.
 */
export interface TypeGeneratorOptions {
  /**
   * Whether to include JSDoc comments in generated code.
   * @default true
   */
  includeComments?: boolean;

  /**
   * Whether to generate Create and Update input types.
   * @default true
   */
  generateInputTypes?: boolean;

  /**
   * Whether to generate Config interface mapping.
   * @default true
   */
  generateConfig?: boolean;

  /**
   * Whether to generate module augmentation.
   * @default true
   */
  generateModuleAugmentation?: boolean;

  /**
   * Custom filename for generated types.
   * @default "payload-types.ts"
   */
  filename?: string;

  /**
   * Module to augment for GeneratedTypes.
   * @default "nextly"
   */
  moduleToAugment?: string;
}

// ============================================================
// TypeGenerator Class
// ============================================================

/**
 * Generates TypeScript type definitions from collection and single definitions.
 *
 * The generator creates TypeScript type definitions, providing strong typing
 * for all collections and singles.
 *
 * @example
 * ```typescript
 * const generator = new TypeGenerator();
 *
 * // Generate complete types file with collections only
 * const typesFile = generator.generateTypesFile(collections);
 * console.log(typesFile.code);
 *
 * // Generate complete types file with collections and singles
 * const typesFile = generator.generateTypesFile(collections, singles);
 * console.log(typesFile.code);
 *
 * // Generate interface for a single collection
 * const iface = generator.generateInterface(postsCollection);
 * console.log(iface.code);
 *
 * // Generate interface for a Single
 * const singleIface = generator.generateSingleInterface(siteSettingsSingle);
 * console.log(singleIface.code);
 * ```
 */
export class TypeGenerator {
  private readonly includeComments: boolean;
  private readonly generateInputTypes: boolean;
  private readonly generateConfig: boolean;
  private readonly generateModuleAugmentation: boolean;
  private readonly filename: string;
  private readonly moduleToAugment: string;

  constructor(options: TypeGeneratorOptions = {}) {
    this.includeComments = options.includeComments ?? true;
    this.generateInputTypes = options.generateInputTypes ?? true;
    this.generateConfig = options.generateConfig ?? true;
    this.generateModuleAugmentation =
      options.generateModuleAugmentation ?? true;
    this.filename = options.filename ?? "payload-types.ts";
    this.moduleToAugment = options.moduleToAugment ?? "@revnixhq/nextly";
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Generates the complete payload-types.ts file with all collections, singles, components, and user type.
   *
   * @param collections - Array of collection records
   * @param singles - Optional array of single records
   * @param components - Optional array of component records
   * @param userFields - Optional array of custom user field definitions
   * @returns Generated types file with code and filename
   */
  generateTypesFile(
    collections: DynamicCollectionRecord[],
    singles: DynamicSingleRecord[] = [],
    components: DynamicComponentRecord[] = [],
    userFields: UserFieldDefinitionRecord[] = []
  ): GeneratedTypesFile {
    const lines: string[] = [];

    // File header
    lines.push("/* tslint:disable */");
    lines.push("/* eslint-disable */");
    lines.push("/**");
    lines.push(" * This file was automatically generated by Nextly.");
    lines.push(
      " * DO NOT MODIFY IT BY HAND. Instead, modify your source collections,"
    );
    lines.push(
      " * and run `npx nextly generate:types` to regenerate this file."
    );
    lines.push(" */");
    lines.push("");

    // Generate interfaces for each component (before collections/singles since they may reference components)
    for (const component of components) {
      const iface = this.generateComponentInterface(
        component,
        components,
        collections
      );
      lines.push(iface.code);
      lines.push("");
    }

    // Generate interfaces for each collection
    for (const collection of collections) {
      const iface = this.generateInterface(collection, collections, components);
      lines.push(iface.code);
      lines.push("");
    }

    // Generate interfaces for each single
    for (const single of singles) {
      const iface = this.generateSingleInterface(
        single,
        collections,
        components
      );
      lines.push(iface.code);
      lines.push("");
    }

    // Generate User interface
    const userInterface = this.generateUserInterface(userFields);
    lines.push(userInterface);
    lines.push("");

    // Generate input types if enabled
    if (this.generateInputTypes) {
      // Collection input types (Create and Update)
      for (const collection of collections) {
        const inputTypes = this.generateCollectionInputTypes(collection);
        lines.push(inputTypes);
        lines.push("");
      }

      // Single input types (Update only - no Create since singles auto-create)
      for (const single of singles) {
        const inputTypes = this.generateSingleUpdateInput(single);
        lines.push(inputTypes);
        lines.push("");
      }
    }

    // Generate Config interface if enabled
    if (this.generateConfig) {
      const config = this.generateConfigInterface(
        collections,
        singles,
        components
      );
      lines.push(config);
      lines.push("");
    }

    // Generate module augmentation if enabled
    if (this.generateModuleAugmentation) {
      const augmentation = this.generateModuleAugmentationCode();
      lines.push(augmentation);
      lines.push("");
    }

    return {
      code: lines.join("\n"),
      filename: this.filename,
    };
  }

  /**
   * Generates a TypeScript interface for a single collection.
   *
   * @param collection - The collection record to generate interface for
   * @param allCollections - Optional array of all collections for relationship type resolution
   * @param allComponents - Optional array of all components for component field type resolution
   * @returns Generated interface with code and metadata
   */
  generateInterface(
    collection: DynamicCollectionRecord,
    allCollections: DynamicCollectionRecord[] = [],
    allComponents: DynamicComponentRecord[] = []
  ): GeneratedTypeInterface {
    const interfaceName = this.toPascalCase(collection.slug);
    const lines: string[] = [];

    // Interface JSDoc comment
    if (this.includeComments) {
      lines.push("/**");
      lines.push(` * ${collection.labels.singular} document type.`);
      if (collection.description) {
        lines.push(" *");
        lines.push(` * ${collection.description}`);
      }
      lines.push(" *");
      lines.push(" * @generated by Nextly TypeGenerator");
      lines.push(" */");
    }

    // Interface definition
    lines.push(`export interface ${interfaceName} {`);
    lines.push("  id: string;");

    // Generate field types
    for (const field of collection.fields) {
      if (!isDataField(field)) continue;

      const fieldType = this.generateFieldType(
        field,
        allCollections,
        allComponents
      );
      if (fieldType) {
        lines.push(fieldType);
      }
    }

    // Add timestamp fields if collection has timestamps
    if (collection.timestamps) {
      lines.push("  createdAt: string;");
      lines.push("  updatedAt: string;");
    }

    lines.push("}");

    return {
      collectionSlug: collection.slug,
      code: lines.join("\n"),
      interfaceName,
    };
  }

  /**
   * Generates all interfaces for multiple collections.
   *
   * @param collections - Array of collection records
   * @returns Array of generated interfaces
   */
  generateAllInterfaces(
    collections: DynamicCollectionRecord[]
  ): GeneratedTypeInterface[] {
    return collections.map(collection =>
      this.generateInterface(collection, collections)
    );
  }

  /**
   * Generates a TypeScript interface for a Single.
   *
   * @param single - The single record to generate interface for
   * @param allCollections - Optional array of all collections for relationship type resolution
   * @param allComponents - Optional array of all components for component field type resolution
   * @returns Generated interface with code and metadata
   */
  generateSingleInterface(
    single: DynamicSingleRecord,
    allCollections: DynamicCollectionRecord[] = [],
    allComponents: DynamicComponentRecord[] = []
  ): GeneratedSingleTypeInterface {
    const interfaceName = this.toPascalCase(single.slug);
    const lines: string[] = [];

    // Interface JSDoc comment
    if (this.includeComments) {
      lines.push("/**");
      lines.push(` * ${single.label} document type.`);
      if (single.description) {
        lines.push(" *");
        lines.push(` * ${single.description}`);
      }
      lines.push(" *");
      lines.push(" * @generated by Nextly TypeGenerator");
      lines.push(" */");
    }

    // Interface definition
    lines.push(`export interface ${interfaceName} {`);
    lines.push("  id: string;");

    // Generate field types
    for (const field of single.fields) {
      if (!isDataField(field)) continue;

      const fieldType = this.generateFieldType(
        field,
        allCollections,
        allComponents
      );
      if (fieldType) {
        lines.push(fieldType);
      }
    }

    // Singles always have updatedAt (no createdAt)
    lines.push("  updatedAt: string;");

    lines.push("}");

    return {
      singleSlug: single.slug,
      code: lines.join("\n"),
      interfaceName,
    };
  }

  /**
   * Generates all interfaces for multiple singles.
   *
   * @param singles - Array of single records
   * @param allCollections - Optional array of all collections for relationship type resolution
   * @returns Array of generated interfaces
   */
  generateAllSingleInterfaces(
    singles: DynamicSingleRecord[],
    allCollections: DynamicCollectionRecord[] = []
  ): GeneratedSingleTypeInterface[] {
    return singles.map(single =>
      this.generateSingleInterface(single, allCollections)
    );
  }

  /**
   * Generates a TypeScript interface for a Component.
   *
   * @param component - The component record to generate interface for
   * @param allComponents - Optional array of all components for nested component type resolution
   * @param allCollections - Optional array of all collections for relationship type resolution
   * @returns Generated interface with code and metadata
   */
  generateComponentInterface(
    component: DynamicComponentRecord,
    allComponents: DynamicComponentRecord[] = [],
    allCollections: DynamicCollectionRecord[] = []
  ): GeneratedComponentTypeInterface {
    const interfaceName = this.toComponentInterfaceName(component.slug);
    const lines: string[] = [];

    // Interface JSDoc comment
    if (this.includeComments) {
      lines.push("/**");
      lines.push(` * ${component.label} component type.`);
      if (component.description) {
        lines.push(" *");
        lines.push(` * ${component.description}`);
      }
      lines.push(" *");
      lines.push(" * @generated by Nextly TypeGenerator");
      lines.push(" */");
    }

    // Interface definition
    lines.push(`export interface ${interfaceName} {`);
    lines.push("  id: string;");
    // Add discriminator property for type narrowing in dynamic zones
    lines.push(`  _componentType: "${component.slug}";`);

    // Generate field types
    for (const field of component.fields) {
      if (!isDataField(field)) continue;

      const fieldType = this.generateFieldType(
        field,
        allCollections,
        allComponents
      );
      if (fieldType) {
        lines.push(fieldType);
      }
    }

    lines.push("}");

    return {
      componentSlug: component.slug,
      code: lines.join("\n"),
      interfaceName,
    };
  }

  /**
   * Generates all interfaces for multiple components.
   *
   * @param components - Array of component records
   * @param allCollections - Optional array of all collections for relationship type resolution
   * @returns Array of generated interfaces
   */
  generateAllComponentInterfaces(
    components: DynamicComponentRecord[],
    allCollections: DynamicCollectionRecord[] = []
  ): GeneratedComponentTypeInterface[] {
    return components.map(component =>
      this.generateComponentInterface(component, components, allCollections)
    );
  }

  /**
   * Generates a TypeScript interface for the User type.
   *
   * Includes hardcoded base fields (id, email, name, etc.) plus any
   * custom fields from user field definitions.
   *
   * @param userFields - Array of custom user field definition records
   * @returns Generated User interface code
   */
  generateUserInterface(userFields: UserFieldDefinitionRecord[] = []): string {
    const lines: string[] = [];

    if (this.includeComments) {
      lines.push("/**");
      lines.push(" * User document type.");
      lines.push(" *");
      lines.push(
        " * Includes base user fields and any custom fields defined via"
      );
      lines.push(
        " * `defineConfig()` or the admin Settings > User Fields tab."
      );
      lines.push(" *");
      lines.push(" * @generated by Nextly TypeGenerator");
      lines.push(" */");
    }

    lines.push("export interface User {");

    // Base user fields (hardcoded, matches MinimalUser / users table schema)
    lines.push("  id: string;");
    lines.push("  email: string;");
    lines.push("  name: string | null;");
    lines.push("  image: string | null;");
    lines.push("  emailVerified: string | null;");
    lines.push("  isActive: boolean;");
    lines.push("  roles: string[];");
    lines.push("  createdAt: string;");
    lines.push("  updatedAt: string;");

    // Custom user fields from merged field definitions
    for (const field of userFields) {
      const fieldLine = this.generateUserFieldType(field);
      if (fieldLine) {
        lines.push(fieldLine);
      }
    }

    lines.push("}");

    return lines.join("\n");
  }

  // ============================================================
  // Interface Generation
  // ============================================================

  /**
   * Generates a TypeScript type string for a single field.
   */
  private generateFieldType(
    field: DataFieldConfig,
    allCollections: DynamicCollectionRecord[] = [],
    allComponents: DynamicComponentRecord[] = []
  ): string | null {
    // Skip fields without names
    if (!("name" in field) || !field.name) {
      return null;
    }

    const fieldName = field.name;
    const isRequired = "required" in field && field.required;
    const optional = isRequired ? "" : "?";

    let tsType: string;

    // Text fields (supports hasMany for array of strings)
    if (isTextField(field)) {
      const textField = field as { hasMany?: boolean };
      tsType = textField.hasMany ? "string[]" : "string";
    }
    // Textarea fields
    else if (isTextareaField(field)) {
      tsType = "string";
    }
    // RichText fields (stored as HTML/Lexical JSON string)
    else if (isRichTextField(field)) {
      tsType = "string";
    }
    // Email fields
    else if (isEmailField(field)) {
      tsType = "string";
    }
    // Password fields
    else if (isPasswordField(field)) {
      tsType = "string";
    }
    // Code fields
    else if (isCodeField(field)) {
      tsType = "string";
    }
    // Number fields (supports hasMany for array of numbers)
    else if (isNumberField(field)) {
      const numField = field as { hasMany?: boolean };
      tsType = numField.hasMany ? "number[]" : "number";
    }
    // Checkbox fields
    else if (isCheckboxField(field)) {
      tsType = "boolean";
    }
    // Date fields
    else if (isDateField(field)) {
      tsType = "string";
    }
    // Select fields
    else if (isSelectField(field)) {
      tsType = this.buildSelectType(field);
    }
    // Radio fields
    else if (isRadioField(field)) {
      tsType = this.buildRadioType(field);
    }
    // Upload fields
    else if (isUploadField(field)) {
      tsType = this.buildUploadType(field, allCollections);
    }
    // Relationship fields
    else if (isRelationshipField(field)) {
      tsType = this.buildRelationshipType(field, allCollections);
    }
    // Array fields
    else if (isRepeaterField(field)) {
      tsType = this.buildArrayType(field, allCollections, allComponents);
    }
    // Group fields
    else if (isGroupField(field)) {
      tsType = this.buildGroupType(field, allCollections, allComponents);
    }
    // JSON fields
    else if (isJSONField(field)) {
      tsType = "unknown";
    }
    // Component fields
    else if (isComponentField(field)) {
      tsType = this.buildComponentType(field, allComponents);
    }
    // Unknown field type
    else {
      tsType = "unknown";
    }

    return `  ${fieldName}${optional}: ${tsType};`;
  }

  // ============================================================
  // Field Type Builders
  // ============================================================

  /**
   * Generates a TypeScript type line for a custom user field definition.
   *
   * Code-sourced fields get precise types (e.g., select → union of option values).
   * UI-sourced fields get `string` for select/radio since options aren't known at compile time.
   */
  private generateUserFieldType(
    field: UserFieldDefinitionRecord
  ): string | null {
    if (!field.name) {
      return null;
    }

    const isCodeSourced = field.source === "code";
    const isRequired = field.required;
    const optional = isRequired ? "" : "?";

    let tsType: string;

    switch (field.type) {
      case "text":
      case "textarea":
      case "email":
      case "date":
        tsType = "string";
        break;

      case "number":
        tsType = "number";
        break;

      case "checkbox":
        tsType = "boolean";
        break;

      case "select":
      case "radio":
        if (isCodeSourced && field.options && field.options.length > 0) {
          // Code-sourced: precise union of option values
          tsType = field.options
            .map(opt => `"${this.escapeString(opt.value)}"`)
            .join(" | ");
        } else {
          // UI-sourced or no options: generic string
          tsType = "string";
        }
        break;

      default:
        tsType = "string";
        break;
    }

    return `  ${field.name}${optional}: ${tsType};`;
  }

  /**
   * Builds TypeScript type for select fields.
   */
  private buildSelectType(field: DataFieldConfig): string {
    const selectField = field as {
      options?: Array<{ value: string; label: string } | string>;
      hasMany?: boolean;
    };

    if (!selectField.options || selectField.options.length === 0) {
      return selectField.hasMany ? "string[]" : "string";
    }

    const values = selectField.options.map(opt => {
      if (typeof opt === "string") {
        return `"${this.escapeString(opt)}"`;
      }
      return `"${this.escapeString(opt.value)}"`;
    });

    const unionType = values.join(" | ");

    if (selectField.hasMany) {
      return `(${unionType})[]`;
    }

    return unionType;
  }

  /**
   * Builds TypeScript type for radio fields.
   */
  private buildRadioType(field: DataFieldConfig): string {
    const radioField = field as {
      options?: Array<{ value: string; label: string } | string>;
    };

    if (!radioField.options || radioField.options.length === 0) {
      return "string";
    }

    const values = radioField.options.map(opt => {
      if (typeof opt === "string") {
        return `"${this.escapeString(opt)}"`;
      }
      return `"${this.escapeString(opt.value)}"`;
    });

    return values.join(" | ");
  }

  /**
   * Builds TypeScript type for upload fields.
   * Returns union type of string (ID) or related type.
   */
  private buildUploadType(
    field: DataFieldConfig,
    _allCollections: DynamicCollectionRecord[]
  ): string {
    const uploadField = field as {
      relationTo?: string | string[];
      hasMany?: boolean;
    };

    const relationTo = uploadField.relationTo;

    if (!relationTo) {
      return uploadField.hasMany ? "string[]" : "string";
    }

    let relationType: string;

    if (Array.isArray(relationTo)) {
      // Polymorphic relationship - union of all possible types
      const types = relationTo.map(rel => {
        const typeName = this.toPascalCase(rel);
        return `string | ${typeName}`;
      });
      relationType = types.join(" | ");
    } else {
      // Single relationship type
      const typeName = this.toPascalCase(relationTo);
      relationType = `string | ${typeName}`;
    }

    if (uploadField.hasMany) {
      return `(${relationType})[]`;
    }

    return relationType;
  }

  /**
   * Builds TypeScript type for relationship fields.
   * Returns union type of string (ID) or related type.
   */
  private buildRelationshipType(
    field: DataFieldConfig,
    _allCollections: DynamicCollectionRecord[]
  ): string {
    const relField = field as {
      relationTo?: string | string[];
      hasMany?: boolean;
    };

    const relationTo = relField.relationTo;

    if (!relationTo) {
      return relField.hasMany ? "string[]" : "string";
    }

    let relationType: string;

    if (Array.isArray(relationTo)) {
      // Polymorphic relationship - union of all possible types
      const types = relationTo.map(rel => {
        const typeName = this.toPascalCase(rel);
        return `string | ${typeName}`;
      });
      relationType = types.join(" | ");
    } else {
      // Single relationship type
      const typeName = this.toPascalCase(relationTo);
      relationType = `string | ${typeName}`;
    }

    if (relField.hasMany) {
      return `(${relationType})[]`;
    }

    return relationType;
  }

  /**
   * Builds TypeScript type for array fields.
   */
  private buildArrayType(
    field: DataFieldConfig,
    allCollections: DynamicCollectionRecord[],
    allComponents: DynamicComponentRecord[] = []
  ): string {
    const arrayField = field as {
      fields?: FieldConfig[];
    };

    if (!arrayField.fields || arrayField.fields.length === 0) {
      return "unknown[]";
    }

    // Build inline object type for array items
    const properties = this.buildObjectProperties(
      arrayField.fields,
      allCollections,
      allComponents
    );

    return `Array<{
${properties}
  }>`;
  }

  /**
   * Builds TypeScript type for group fields.
   */
  private buildGroupType(
    field: DataFieldConfig,
    allCollections: DynamicCollectionRecord[],
    allComponents: DynamicComponentRecord[] = []
  ): string {
    const groupField = field as {
      fields?: FieldConfig[];
    };

    if (!groupField.fields || groupField.fields.length === 0) {
      return "Record<string, unknown>";
    }

    // Build inline object type for group
    const properties = this.buildObjectProperties(
      groupField.fields,
      allCollections,
      allComponents
    );

    return `{
${properties}
  }`;
  }

  /**
   * Builds TypeScript type for component fields.
   *
   * Handles:
   * - Single component mode: returns ComponentNameComponent (or null if not required)
   * - Multi-component mode (dynamic zone): returns union of component types
   * - Repeatable: wraps in array
   */
  private buildComponentType(
    field: DataFieldConfig,
    allComponents: DynamicComponentRecord[]
  ): string {
    const componentField = field as {
      component?: string;
      components?: string[];
      repeatable?: boolean;
    };

    const { component, components, repeatable } = componentField;

    let baseType: string;

    if (component) {
      // Single component mode
      baseType = this.toComponentInterfaceName(component);
    } else if (components && components.length > 0) {
      // Multi-component mode (dynamic zone) - create union type
      const componentTypes = components.map(slug =>
        this.toComponentInterfaceName(slug)
      );
      baseType = componentTypes.join(" | ");
    } else {
      // No component specified - fallback to unknown
      return "unknown";
    }

    // Wrap in array if repeatable
    if (repeatable) {
      if (components && components.length > 1) {
        // Multi-component array needs parentheses
        return `(${baseType})[]`;
      }
      return `${baseType}[]`;
    }

    return baseType;
  }

  /**
   * Builds object properties for nested fields (array items, groups).
   */
  private buildObjectProperties(
    fields: FieldConfig[],
    allCollections: DynamicCollectionRecord[],
    allComponents: DynamicComponentRecord[] = []
  ): string {
    const lines: string[] = [];

    for (const field of fields) {
      if (!isDataField(field)) continue;

      const fieldType = this.generateFieldType(
        field,
        allCollections,
        allComponents
      );
      if (fieldType) {
        // Add extra indentation for nested properties
        lines.push("  " + fieldType);
      }
    }

    return lines.join("\n");
  }

  // ============================================================
  // Input Types Generation
  // ============================================================

  /**
   * Generates Create and Update input types for a collection.
   */
  private generateCollectionInputTypes(
    collection: DynamicCollectionRecord
  ): string {
    const interfaceName = this.toPascalCase(collection.slug);
    const lines: string[] = [];

    // Create input type (omit id and timestamps)
    if (this.includeComments) {
      lines.push("/**");
      lines.push(` * ${collection.labels.singular} create input type.`);
      lines.push(" * Omits id and timestamp fields.");
      lines.push(" *");
      lines.push(" * @generated by Nextly TypeGenerator");
      lines.push(" */");
    }

    const omitFields = ["id"];
    if (collection.timestamps) {
      omitFields.push("createdAt", "updatedAt");
    }

    lines.push(
      `export type ${interfaceName}CreateInput = Omit<${interfaceName}, ${omitFields.map(f => `"${f}"`).join(" | ")}>;`
    );
    lines.push("");

    // Update input type (all fields optional except id)
    if (this.includeComments) {
      lines.push("/**");
      lines.push(` * ${collection.labels.singular} update input type.`);
      lines.push(" * All fields are optional except id.");
      lines.push(" *");
      lines.push(" * @generated by Nextly TypeGenerator");
      lines.push(" */");
    }

    lines.push(
      `export type ${interfaceName}UpdateInput = Partial<${interfaceName}> & { id: string };`
    );

    return lines.join("\n");
  }

  /**
   * Generates Update input type for a Single.
   * Singles don't have a Create input type since they auto-create on first access.
   */
  private generateSingleUpdateInput(single: DynamicSingleRecord): string {
    const interfaceName = this.toPascalCase(single.slug);
    const lines: string[] = [];

    // Update input type (all fields optional, omit id and updatedAt)
    if (this.includeComments) {
      lines.push("/**");
      lines.push(` * ${single.label} update input type.`);
      lines.push(" * All fields are optional. Omits id and updatedAt.");
      lines.push(" *");
      lines.push(" * @generated by Nextly TypeGenerator");
      lines.push(" */");
    }

    lines.push(
      `export type ${interfaceName}UpdateInput = Partial<Omit<${interfaceName}, "id" | "updatedAt">>;`
    );

    return lines.join("\n");
  }

  // ============================================================
  // Config Interface Generation
  // ============================================================

  /**
   * Generates the Config interface that maps slugs to types.
   */
  private generateConfigInterface(
    collections: DynamicCollectionRecord[],
    singles: DynamicSingleRecord[] = [],
    components: DynamicComponentRecord[] = []
  ): string {
    const lines: string[] = [];

    if (this.includeComments) {
      lines.push("/**");
      lines.push(
        " * Configuration interface mapping collection, single, and component slugs to their types."
      );
      lines.push(" *");
      lines.push(" * @generated by Nextly TypeGenerator");
      lines.push(" */");
    }

    lines.push("export interface Config {");

    // Collections section
    lines.push("  collections: {");
    for (const collection of collections) {
      const interfaceName = this.toPascalCase(collection.slug);
      lines.push(`    "${collection.slug}": ${interfaceName};`);
    }
    lines.push("  };");

    // Singles section
    lines.push("  singles: {");
    for (const single of singles) {
      const interfaceName = this.toPascalCase(single.slug);
      lines.push(`    "${single.slug}": ${interfaceName};`);
    }
    lines.push("  };");

    // Components section
    lines.push("  components: {");
    for (const component of components) {
      const interfaceName = this.toComponentInterfaceName(component.slug);
      lines.push(`    "${component.slug}": ${interfaceName};`);
    }
    lines.push("  };");

    // User section
    lines.push("  user: User;");

    lines.push("}");

    return lines.join("\n");
  }

  // ============================================================
  // Module Augmentation Generation
  // ============================================================

  /**
   * Generates module augmentation for type-safe collection access.
   */
  private generateModuleAugmentationCode(): string {
    const lines: string[] = [];

    if (this.includeComments) {
      lines.push("/**");
      lines.push(" * Module augmentation for type-safe collection access.");
      lines.push(" * This extends the Nextly module with generated types.");
      lines.push(" *");
      lines.push(" * @generated by Nextly TypeGenerator");
      lines.push(" */");
    }

    lines.push(`declare module "${this.moduleToAugment}" {`);
    lines.push("  export interface GeneratedTypes extends Config {}");
    lines.push("}");

    return lines.join("\n");
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Converts a slug to PascalCase.
   * e.g., "blog-posts" -> "BlogPosts", "blog_posts" -> "BlogPosts"
   */
  private toPascalCase(slug: string): string {
    return slug
      .split(/[-_]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("");
  }

  /**
   * Converts a component slug to interface name with Component suffix.
   * e.g., "seo" -> "SeoComponent", "hero-section" -> "HeroSectionComponent"
   */
  private toComponentInterfaceName(slug: string): string {
    return this.toPascalCase(slug) + "Component";
  }

  /**
   * Escapes a string for use in TypeScript string literal.
   */
  private escapeString(str: string): string {
    return str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }
}
