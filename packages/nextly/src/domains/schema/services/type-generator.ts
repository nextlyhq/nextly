/**
 * TypeScript Type Generator Service
 *
 * Generates TypeScript interfaces from collection and single definitions. Provides strong typing for
 * collections, singles, entries, and input types.
 *
 * Generates:
 * - Collection interfaces with all fields typed
 * - Single interfaces with all fields typed
 * - Config interface mapping slugs to types (collections, singles, field groups)
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
  isChipsField,
  isFieldGroupField,
  isDataField,
} from "../../../collections/fields/guards";
import { NextlyError } from "../../../errors";
import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";
import type { DynamicFieldGroupRecord } from "../../../schemas/dynamic-field-groups/types";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";
import type { UserFieldDefinitionRecord } from "../../../schemas/user-field-definitions/types";
import { extractFieldGroupReferences } from "../../field-groups/storage/field-group-field-type";
import { currentFieldGroupTypeKey } from "../../field-groups/storage/field-group-type-key";

import {
  asScalarStorageField,
  pluginDeclaredImportNames,
  asStorageEquivalentField,
  isPluginDataField,
  pluginCodegenImports,
  pluginStorageFieldType,
  pluginTsType,
  reserveAppliedGlobals,
} from "./plugin-codegen";

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
  /**
   * `import type` lines the code needs, when a plugin field type declared them.
   *
   * A bare interface cannot carry its own imports without becoming
   * unconcatenable, so they are returned alongside for a caller assembling a
   * file itself. `generateTypesFile` collects and dedupes these across every
   * entity and emits them once, so it ignores this.
   */
  imports: string[];
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
  /**
   * `import type` lines the code needs, when a plugin field type declared them.
   *
   * A bare interface cannot carry its own imports without becoming
   * unconcatenable, so they are returned alongside for a caller assembling a
   * file itself. `generateTypesFile` collects and dedupes these across every
   * entity and emits them once, so it ignores this.
   */
  imports: string[];
}

/**
 * Result of generating the `User` interface.
 *
 * Carries no slug or interface name: there is exactly one User type and its
 * name is fixed, so only the code and what it has to import vary.
 */
export interface GeneratedUserInterface {
  /** Generated TypeScript interface code */
  code: string;

  /**
   * `import type` lines the code needs, when a plugin user field type
   * declared them. Returned rather than inlined for the same reason the
   * entity interfaces do it: a bare interface carrying imports cannot be
   * concatenated into a file.
   */
  imports: string[];
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
  /**
   * `import type` lines the code needs, when a plugin field type declared them.
   *
   * A bare interface cannot carry its own imports without becoming
   * unconcatenable, so they are returned alongside for a caller assembling a
   * file itself. `generateTypesFile` collects and dedupes these across every
   * entity and emits them once, so it ignores this.
   */
  imports: string[];
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

/** Dedupe + lexically sort a list of strings for deterministic codegen output. */
function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

export class TypeGenerator {
  private readonly includeComments: boolean;
  private readonly generateInputTypes: boolean;
  private readonly generateConfig: boolean;
  private readonly generateModuleAugmentation: boolean;
  private readonly filename: string;
  private readonly moduleToAugment: string;

  /**
   * Expressions the plugin callbacks returned during this run.
   *
   * Imports are filtered to the names these reference. Searching the whole
   * generated body instead would match the generator's own declarations — a
   * collection interface named `Posts` makes an unused `Posts` import look
   * used — so only what the plugins emitted is considered.
   */
  private pluginExpressions = new Map<object, string>();

  /**
   * Every expression a plugin emitted, in emission order and with repeats.
   *
   * `pluginExpressions` is keyed by field object so each field's own text can
   * be found when deciding whether it references an import. That makes it the
   * wrong thing to count with: two entities can share one field object, which
   * is how a shared field definition is normally written, and the map then
   * holds one entry for two emissions. Subtracting the map's occurrences from
   * the body would credit the generator with the difference and reserve a
   * global only the plugin ever wrote.
   */
  private pluginEmissions: Array<{
    expression: string;
    imported: ReadonlySet<string>;
  }> = [];

  constructor(options: TypeGeneratorOptions = {}) {
    this.includeComments = options.includeComments ?? true;
    this.generateInputTypes = options.generateInputTypes ?? true;
    this.generateConfig = options.generateConfig ?? true;
    this.generateModuleAugmentation =
      options.generateModuleAugmentation ?? true;
    this.filename = options.filename ?? "payload-types.ts";
    this.moduleToAugment = options.moduleToAugment ?? "nextly";
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
    components: DynamicFieldGroupRecord[] = [],
    userFields: UserFieldDefinitionRecord[] = [],
    permissionSlugs: string[] = [],
    eventNames: string[] = []
  ): GeneratedTypesFile {
    const lines: string[] = [];
    this.pluginExpressions = new Map();
    this.pluginEmissions = [];

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

    // Imports are decided after the body exists, so they can be filtered to
    // the names it actually references; they are spliced in here.
    const importSlot = lines.length;

    this.assertNoInterfaceNameCollisions(collections, singles, components);

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
    lines.push(userInterface.code);
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
        components,
        permissionSlugs,
        eventNames
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

    // Only what this run declares or imports for itself is reserved, so a
    // plugin naming something a different configuration would have emitted is
    // not refused for a collision that cannot happen here.
    const reserved = this.declaredInterfaceNames(
      collections,
      singles,
      components
    );

    // Globals the emitted code relies on resolving. An import of one shadows it
    // for the whole file — a non-generic `Partial` makes every `Partial<Post>`
    // fail to compile — but only the ones this output actually wrote are worth
    // reserving, so a name no construct here uses stays free.
    // Reserved only where the generator itself wrote them. A plugin expression
    // naming `Partial<Model>` is the plugin using its own import, so its uses
    // are subtracted rather than removed from the text — deleting them would
    // also erase core's own `Partial<Post>` and reserve nothing.
    this.reserveGlobalsWritten(lines.slice(importSlot).join("\n"), reserved);

    const imports: string[] = [];
    // A blocks field is typed as the engine's document, imported from `nextly`
    // rather than the engine package so the generated file resolves against the
    // dependency every app already has.
    // User fields are a flat list rather than an entity, so they are wrapped to
    // be scanned alongside the rest: a plugin type used only there still names
    // types the generated `User` interface has to import.
    imports.push(
      ...pluginCodegenImports(
        [...collections, ...singles, ...components, { fields: userFields }],
        reserved,
        "tsImports",
        this.pluginExpressions,
        // What this file imports on its own behalf: a plugin naming the same
        // binding from the same module is asking for the one already there.
        // Empty now that no built-in brings a type of its own into the file —
        // a contributed type declares its imports through `codegen.tsImports`.
        new Map<string, string>()
      )
    );
    if (imports.length > 0) lines.splice(importSlot, 0, ...imports, "");

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
    allComponents: DynamicFieldGroupRecord[] = []
  ): GeneratedTypeInterface {
    const outerExpressions = this.beginOwnExpressions();
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
      if (!isDataField(field) && !isPluginDataField(field)) continue;

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
      imports: this.endOwnExpressions(
        outerExpressions,
        interfaceName,
        lines.join("\n")
      ),
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
    allComponents: DynamicFieldGroupRecord[] = []
  ): GeneratedSingleTypeInterface {
    const outerExpressions = this.beginOwnExpressions();
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
      if (!isDataField(field) && !isPluginDataField(field)) continue;

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
      imports: this.endOwnExpressions(
        outerExpressions,
        interfaceName,
        lines.join("\n")
      ),
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
    component: DynamicFieldGroupRecord,
    allComponents: DynamicFieldGroupRecord[] = [],
    allCollections: DynamicCollectionRecord[] = []
  ): GeneratedComponentTypeInterface {
    const outerExpressions = this.beginOwnExpressions();
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
    lines.push(`  ${currentFieldGroupTypeKey}: "${component.slug}";`);

    // Generate field types
    for (const field of component.fields) {
      if (!isDataField(field) && !isPluginDataField(field)) continue;

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
      imports: this.endOwnExpressions(
        outerExpressions,
        interfaceName,
        lines.join("\n")
      ),
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
    components: DynamicFieldGroupRecord[],
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
   * Returns the imports beside the code, as the collection, single and
   * component methods do: a plugin user field's type can name something only
   * an import brings into scope, and a caller given the code alone would hold
   * a interface referring to identifiers it has no way to resolve.
   *
   * @param userFields - Array of custom user field definition records
   * @returns Generated User interface code and the imports it relies on
   */
  generateUserInterface(
    userFields: UserFieldDefinitionRecord[] = []
  ): GeneratedUserInterface {
    const outerExpressions = this.beginOwnExpressions();
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

    const code = lines.join("\n");
    return {
      code,
      imports: this.endOwnExpressions(outerExpressions, "User", code),
    };
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
    allComponents: DynamicFieldGroupRecord[] = []
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
    // Repeater fields
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
    // Chips fields (array of strings)
    else if (isChipsField(field)) {
      tsType = "string[]";
    }
    // Component fields
    else if (isFieldGroupField(field)) {
      tsType = this.buildComponentType(field, allComponents);
    }
    // Anything the built-ins above did not claim. A plugin-contributed type may
    // state its own rendering; asked once, because the callback is plugin code
    // and nothing requires it to be pure.
    else {
      const contributed = pluginTsType(field);
      if (contributed !== undefined) {
        this.pluginExpressions.set(field, contributed);
        this.pluginEmissions.push({
          expression: contributed,
          imported: pluginDeclaredImportNames(field, "tsImports"),
        });
        tsType = contributed;
      } else {
        // No rendering of its own, but the registry still knows what it stores.
        // Re-entered as the storage primitive's built-in type so the branch
        // above emits it, rather than degrading a number-backed type to
        // `unknown` for want of a callback.
        const storageType = pluginStorageFieldType(field);
        const asStorage =
          storageType === undefined
            ? null
            : this.generateFieldType(
                this.asScalarStorageField(field, storageType),
                allCollections,
                allComponents
              );
        if (asStorage !== null) return asStorage;
        tsType = "unknown";
      }
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

      case "json":
        // A JSON column hands back whatever was stored — object, array or
        // scalar — so the field cannot be narrowed further. Reached through the
        // storage fallback below when a `json`-backed plugin type declares no
        // rendering of its own; without a case here it fell to the unknown-type
        // default and generated `string`.
        tsType = "unknown";
        break;

      default: {
        // A plugin-contributed type renders itself; failing that, what the
        // registry says it stores. `string` remains the fallback only for a
        // type nothing in the process knows about, which is what a UI-authored
        // field of a since-removed plugin type is.
        const contributed = pluginTsType(field);
        if (contributed !== undefined) {
          this.pluginExpressions.set(field, contributed);
          this.pluginEmissions.push({
            expression: contributed,
            imported: pluginDeclaredImportNames(field, "tsImports"),
          });
          tsType = contributed;
          break;
        }
        const storageType = pluginStorageFieldType(field);
        const asStorage =
          storageType === undefined
            ? null
            : this.generateUserFieldType(
                asStorageEquivalentField(field, storageType)
              );
        if (asStorage !== null) return asStorage;
        tsType = "string";
        break;
      }
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
   * Builds TypeScript type for repeater fields.
   */
  private buildArrayType(
    field: DataFieldConfig,
    allCollections: DynamicCollectionRecord[],
    allComponents: DynamicFieldGroupRecord[] = []
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
    allComponents: DynamicFieldGroupRecord[] = []
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
    _allComponents: DynamicFieldGroupRecord[]
  ): string {
    const componentField = field as {
      component?: string;
      fieldGroup?: string;
      components?: string[];
      fieldGroups?: string[];
      repeatable?: boolean;
    };

    // Through the shared extractor: a migrated definition names its slugs
    // under fieldGroup / fieldGroups, and missing them emitted `unknown` —
    // dropping the static contract for every migrated field-group field.
    const { single, many } = extractFieldGroupReferences(componentField);
    const { repeatable } = componentField;

    let baseType: string;

    if (single !== undefined) {
      // Single component mode
      baseType = this.toComponentInterfaceName(single);
    } else if (many !== undefined && many.length > 0) {
      // Multi-component mode (dynamic zone) - create union type
      const componentTypes = many.map(slug =>
        this.toComponentInterfaceName(slug)
      );
      baseType = componentTypes.join(" | ");
    } else {
      // No component specified - fallback to unknown
      return "unknown";
    }

    // Wrap in array if repeatable
    if (repeatable) {
      if (many !== undefined && many.length > 1) {
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
    allComponents: DynamicFieldGroupRecord[] = []
  ): string {
    const lines: string[] = [];

    for (const field of fields) {
      if (!isDataField(field) && !isPluginDataField(field)) continue;

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
    components: DynamicFieldGroupRecord[] = [],
    permissionSlugs: string[] = [],
    eventNames: string[] = []
  ): string {
    const lines: string[] = [];

    if (this.includeComments) {
      lines.push("/**");
      lines.push(
        " * Configuration interface mapping collection, single, and field group slugs to their types."
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

    // Field groups section
    lines.push("  fieldGroups: {");
    for (const component of components) {
      const interfaceName = this.toComponentInterfaceName(component.slug);
      lines.push(`    "${component.slug}": ${interfaceName};`);
    }
    lines.push("  };");

    // Which fields above are backed by a timestamp column. The interfaces
    // describe the WIRE, where every timestamp is formatted text; in process
    // the driver hands back a Date for exactly these fields, and
    // `RowFromCollectionSlug` reads this map to say so. Names only: the rule
    // that applies them lives in the library, so it can improve without every
    // project regenerating.
    lines.push("  collectionDateFields: {");
    for (const collection of collections) {
      lines.push(
        `    "${collection.slug}": ${this.dateFieldUnion(
          collection.fields,
          collection.timestamps ? ["createdAt", "updatedAt"] : []
        )};`
      );
    }
    lines.push("  };");

    // A single's own date fields, and deliberately NOT its `updatedAt`. A
    // single is read through a deserializer that normalizes the system
    // timestamps to ISO strings, so `updatedAt` really is a string in process
    // here, unlike everywhere else. Its user-declared date fields are not
    // touched by that step and arrive as the `Date` the driver decoded.
    lines.push("  singleDateFields: {");
    for (const single of singles) {
      lines.push(
        `    "${single.slug}": ${this.dateFieldUnion(single.fields, [])};`
      );
    }
    lines.push("  };");

    // Permissions section (D47) — key union only; permission payloads are not
    // typed. Sorted + deduped for deterministic output. Narrows `PermissionSlug`.
    // Emitted ONLY when non-empty: an empty map would make `keyof P` resolve to
    // `never` (breaking every PermissionSlug); omitting the key falls back to
    // `string` (the safe default — same convention as CollectionSlug).
    const permissions = uniqueSorted(permissionSlugs);
    if (permissions.length > 0) {
      lines.push("  permissions: {");
      for (const slug of permissions) {
        lines.push(`    "${slug}": true;`);
      }
      lines.push("  };");
    }

    // Events section (D47) — key union only; event payloads are not typed.
    // Sorted + deduped; emitted only when non-empty (see permissions above).
    const events = uniqueSorted(eventNames);
    if (events.length > 0) {
      lines.push("  events: {");
      for (const name of events) {
        lines.push(`    "${name}": true;`);
      }
      lines.push("  };");
    }

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
   * The union of field names an entity stores in a timestamp column, written as
   * a TypeScript type expression.
   *
   * A `date` field is stored as a timestamp, and so is a plugin field whose
   * declared storage primitive is `date` — the same two cases the column
   * descriptor maps to a timestamp column, so the emitted names are exactly the
   * ones the driver decodes. `never` when there are none, which leaves the row
   * type equal to the wire type.
   */
  private dateFieldUnion(
    fields: readonly FieldConfig[],
    builtIn: readonly string[]
  ): string {
    const names = [...builtIn];
    for (const field of fields) {
      if (!("name" in field) || !field.name) continue;
      if (isDateField(field) || pluginStorageFieldType(field) === "date") {
        names.push(field.name);
      }
    }
    if (names.length === 0) return "never";
    return names.map(name => `"${name}"`).join(" | ");
  }

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
   * Converts a field group slug to its generated interface name.
   *
   * e.g. "seo" -> "SeoFieldGroup", "hero-section" -> "HeroSectionFieldGroup".
   * The suffix matches the `Config.fieldGroups` map key so the generated file
   * reads in one vocabulary.
   */
  private toComponentInterfaceName(slug: string): string {
    return this.toPascalCase(slug) + "FieldGroup";
  }

  /**
   * A plugin field retyped as the scalar its storage primitive writes.
   *
   * `hasMany` goes with it: the primitive maps to one column, so generating a
   * list would promise a shape the table cannot hold — the column mapper and
   * the Zod fallback both emit the scalar.
   */
  /**
   * Start recording plugin expressions for one interface, returning the map to
   * restore afterwards.
   *
   * The recorder is swapped rather than diffed: the same generator can produce
   * an interface twice, and two interfaces can share a field object, either of
   * which makes "what was added since" report nothing for the later call.
   */
  private beginOwnExpressions(): {
    expressions: Map<object, string>;
    emissions: Array<{ expression: string; imported: ReadonlySet<string> }>;
  } {
    const outer = {
      expressions: this.pluginExpressions,
      emissions: this.pluginEmissions,
    };
    this.pluginExpressions = new Map();
    // Scoped with them: this interface reserves against what IT wrote, so
    // emissions from an earlier call would make it credit the generator with
    // text that is not in this body and under-reserve.
    this.pluginEmissions = [];
    return outer;
  }

  /**
   * Finish that recording: the imports this interface's own expressions need,
   * with its entries merged back so `generateTypesFile` keeps accumulating
   * across entities — which it needs both for the file's imports and to tell
   * its own use of a global utility apart from a plugin's.
   *
   * `declares` is the interface's own name, the one binding a lone interface
   * introduces and one an import of that name would conflict with. `body` is
   * the emitted source, read for the globals it relies on.
   */
  private endOwnExpressions(
    outer: {
      expressions: Map<object, string>;
      emissions: Array<{ expression: string; imported: ReadonlySet<string> }>;
    },
    declares: string,
    body: string
  ): string[] {
    const own = this.pluginExpressions;
    // The globals this one interface wrote, on the same terms the whole-file
    // path uses: an import landing beside it shadows them just as surely.
    const reserved = new Set([declares]);
    this.reserveGlobalsWritten(body, reserved);
    const imports = pluginCodegenImports(
      [{ fields: [...own.keys()] }],
      reserved,
      "tsImports",
      own
    );
    for (const [field, expression] of own) {
      outer.expressions.set(field, expression);
    }
    // Concatenated rather than merged: a repeat is the thing the whole-file
    // reservation has to see.
    outer.emissions.push(...this.pluginEmissions);
    this.pluginExpressions = outer.expressions;
    this.pluginEmissions = outer.emissions;
    return imports;
  }

  /**
   * Reserve the globals this output relies on resolving, so no import shadows
   * them. Shared with the Zod generator, which emits different files from the
   * same expressions and needs the identical rule.
   */
  private reserveGlobalsWritten(body: string, reserved: Set<string>): void {
    reserveAppliedGlobals(body, this.pluginEmissions, reserved);
  }

  private asScalarStorageField(
    field: DataFieldConfig,
    storageType: Parameters<typeof asStorageEquivalentField>[1]
  ): DataFieldConfig {
    // Delegated so this and the Zod generator drop `hasMany` by the same rule;
    // two copies of it is how the storage fallbacks drifted apart before.
    return asScalarStorageField(field, storageType);
  }

  /**
   * Every top-level name this run will declare.
   *
   * An import sharing one of these conflicts with the local declaration
   * (TS2440), so the import scan is given them to refuse the clash before the
   * file is written. `User` is always emitted, `Config` when the config
   * interface is generated, and the rest are one interface per entity plus the
   * input aliases when those are generated — a collection declares
   * `<Name>CreateInput` and `<Name>UpdateInput`, a single `<Name>UpdateInput`.
   */
  private declaredInterfaceNames(
    collections: DynamicCollectionRecord[],
    singles: DynamicSingleRecord[],
    components: DynamicFieldGroupRecord[]
  ): Set<string> {
    // `GeneratedTypes` is deliberately absent: it is only ever declared inside
    // `declare module`, which creates no top-level binding, so an import of
    // that name coexists with it. `Config` is declared only when the config
    // interface is generated.
    const names = new Set<string>(["User"]);
    if (this.generateConfig) names.add("Config");

    for (const collection of collections) {
      const name = this.toPascalCase(collection.slug);
      names.add(name);
      if (this.generateInputTypes) {
        names.add(`${name}CreateInput`);
        names.add(`${name}UpdateInput`);
      }
    }
    for (const single of singles) {
      const name = this.toPascalCase(single.slug);
      names.add(name);
      // Singles are update-only; there is no create input for them.
      if (this.generateInputTypes) names.add(`${name}UpdateInput`);
    }
    for (const component of components) {
      names.add(this.toComponentInterfaceName(component.slug));
    }
    return names;
  }

  /**
   * Fails when two entities would generate the same interface name.
   *
   * Distinct slugs can still collide: a field group `seo` and a collection
   * `seo-field-group` both produce `SeoFieldGroup`, because the suffix this
   * appends is itself a legal part of a slug. Slug-uniqueness validation does
   * not catch it — the slugs differ. TypeScript would then MERGE the two
   * declarations rather than reject them, so each `Config` entry would silently
   * acquire the other's required fields and the generated API would type calls
   * against a shape no row ever has.
   */
  private assertNoInterfaceNameCollisions(
    collections: DynamicCollectionRecord[],
    singles: DynamicSingleRecord[],
    components: DynamicFieldGroupRecord[]
  ): void {
    const owners = new Map<string, string>();
    const claim = (interfaceName: string, kind: string, slug: string): void => {
      const existing = owners.get(interfaceName);
      if (existing !== undefined) {
        throw NextlyError.validation({
          errors: [
            {
              path: "fieldGroups",
              code: "GENERATED_TYPE_NAME_COLLISION",
              message:
                `${existing} and ${kind} '${slug}' both generate the ` +
                `interface '${interfaceName}'. Rename one of them: the ` +
                `generated types cannot distinguish the two.`,
            },
          ],
          logContext: {
            reason: "generated-type-name-collision",
            interfaceName,
            claimedBy: existing,
            conflictsWith: `${kind} '${slug}'`,
          },
        });
      }
      owners.set(interfaceName, `${kind} '${slug}'`);
    };

    for (const collection of collections) {
      claim(this.toPascalCase(collection.slug), "collection", collection.slug);
    }
    for (const single of singles) {
      claim(this.toPascalCase(single.slug), "single", single.slug);
    }
    for (const component of components) {
      claim(
        this.toComponentInterfaceName(component.slug),
        "field group",
        component.slug
      );
    }
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
