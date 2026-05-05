/**
 * Collection Export Service
 *
 * Generates `defineCollection()` code from dynamic collection records.
 * This allows UI-created collections to be exported to code-first format
 * for version control and customization.
 *
 * @module services/collections/collection-export-service
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { CollectionExportService } from '@nextly/services/collections';
 *
 * const exportService = new CollectionExportService();
 * const code = exportService.exportToCode(collection, {
 *   includeAccessPlaceholders: true,
 *   includeHooksPlaceholders: true,
 *   format: 'typescript',
 * });
 *
 * // Write to file
 * fs.writeFileSync(`collections/${collection.slug}.ts`, code);
 * ```
 */

import type {
  FieldConfig,
  DataFieldConfig,
  SelectOption,
} from "../../../collections/fields/types";
import type {
  DynamicCollectionRecord,
  CollectionAdminConfig,
} from "../../../schemas/dynamic-collections/types";

/**
 * Options for exporting a collection to code.
 */
export interface ExportOptions {
  /**
   * Include placeholder access control functions as comments.
   * These serve as a starting point for implementing access control.
   *
   * @default true
   */
  includeAccessPlaceholders?: boolean;

  /**
   * Include placeholder hooks as comments.
   * These serve as a starting point for implementing lifecycle hooks.
   *
   * @default true
   */
  includeHooksPlaceholders?: boolean;

  /**
   * Output format: TypeScript or JavaScript.
   * TypeScript includes type imports and annotations.
   *
   * @default 'typescript'
   */
  format?: "typescript" | "javascript";

  /**
   * Indentation string to use.
   * @default '  ' (2 spaces)
   */
  indent?: string;
}

/**
 * Service for exporting dynamic collections to code-first format.
 *
 * Generates clean, readable TypeScript/JavaScript code that uses
 * the field builder helpers (text, select, relationship, etc.) for
 * an ergonomic developer experience.
 *
 * @example
 * ```typescript
 * const service = new CollectionExportService();
 *
 * // Export with defaults
 * const tsCode = service.exportToCode(collection);
 *
 * // Export as JavaScript without placeholders
 * const jsCode = service.exportToCode(collection, {
 *   format: 'javascript',
 *   includeAccessPlaceholders: false,
 *   includeHooksPlaceholders: false,
 * });
 * ```
 */
export class CollectionExportService {
  private indent: string;

  constructor() {
    this.indent = "  ";
  }

  /**
   * Generate defineCollection() code from a collection record.
   *
   * @param collection - The dynamic collection record to export
   * @param options - Export options
   * @returns Generated TypeScript/JavaScript code as a string
   */
  exportToCode(
    collection: DynamicCollectionRecord,
    options: ExportOptions = {}
  ): string {
    const {
      includeAccessPlaceholders = true,
      includeHooksPlaceholders = true,
      format = "typescript",
      indent = "  ",
    } = options;

    this.indent = indent;

    const imports = this.generateImports(collection.fields, format);
    const collectionConfig = this.generateCollectionConfig(
      collection,
      includeAccessPlaceholders,
      includeHooksPlaceholders
    );

    return `${imports}

export default defineCollection(${collectionConfig});
`;
  }

  private generateImports(
    fields: FieldConfig[],
    format: "typescript" | "javascript"
  ): string {
    const fieldTypes = new Set<string>();
    const helperImports = new Set<string>();

    helperImports.add("defineCollection");

    this.collectFieldTypes(fields, fieldTypes, helperImports);

    const allImports = Array.from(helperImports).sort();

    if (format === "typescript") {
      return `import { ${allImports.join(", ")} } from '@nextly/core';`;
    } else {
      return `const { ${allImports.join(", ")} } = require('@nextly/core');`;
    }
  }

  private collectFieldTypes(
    fields: FieldConfig[],
    types: Set<string>,
    helpers: Set<string>
  ): void {
    for (const field of fields) {
      types.add(field.type);
      helpers.add(field.type);

      if (this.hasNestedFields(field)) {
        const nestedFields = (field as { fields: FieldConfig[] }).fields;
        if (nestedFields) {
          this.collectFieldTypes(nestedFields, types, helpers);
        }
      }

      if (
        (field.type === "select" || field.type === "radio") &&
        "options" in field
      ) {
        helpers.add("option");
      }
    }
  }

  private hasNestedFields(field: FieldConfig): boolean {
    return ["repeater", "group"].includes(field.type);
  }

  private generateCollectionConfig(
    collection: DynamicCollectionRecord,
    includeAccess: boolean,
    includeHooks: boolean
  ): string {
    const lines: string[] = ["{"];
    const i = this.indent;

    lines.push(`${i}slug: '${this.escapeString(collection.slug)}',`);

    lines.push(`${i}labels: {`);
    lines.push(
      `${i}${i}singular: '${this.escapeString(collection.labels.singular)}',`
    );
    lines.push(
      `${i}${i}plural: '${this.escapeString(collection.labels.plural)}',`
    );
    lines.push(`${i}},`);

    if (collection.description) {
      lines.push(
        `${i}description: '${this.escapeString(collection.description)}',`
      );
    }

    lines.push(`${i}timestamps: ${collection.timestamps},`);

    if (collection.admin && Object.keys(collection.admin).length > 0) {
      lines.push(
        `${i}admin: ${this.formatObject(collection.admin as unknown as Record<string, unknown>, 1)},`
      );
    }

    lines.push(`${i}fields: [`);
    const fieldCode = this.generateFieldsCode(collection.fields, 2);
    lines.push(fieldCode);
    lines.push(`${i}],`);

    if (includeAccess) {
      lines.push(this.generateAccessPlaceholder());
    }

    if (includeHooks) {
      lines.push(this.generateHooksPlaceholder());
    }

    lines.push("}");

    return lines.join("\n");
  }

  private generateFieldsCode(fields: FieldConfig[], depth: number): string {
    const lines: string[] = [];
    const baseIndent = this.indent.repeat(depth);

    for (const field of fields) {
      const fieldCode = this.fieldToHelperCall(field, depth);
      lines.push(`${baseIndent}${fieldCode},`);
    }

    return lines.join("\n");
  }

  private fieldToHelperCall(field: FieldConfig, depth: number): string {
    const { type, ...rest } = field;

    switch (type) {
      case "select":
      case "radio":
        return this.generateSelectField(field as DataFieldConfig, depth);

      case "repeater":
      case "group":
        return this.generateNestedField(field, depth);

      default:
        return this.generateSimpleField(field, depth);
    }
  }

  private generateSimpleField(field: FieldConfig, depth: number): string {
    const { type, ...config } = field;

    const cleanConfig = this.cleanFieldConfig(config);

    if (Object.keys(cleanConfig).length === 0) {
      return `${type}({})`;
    }

    const configStr = this.formatFieldConfig(cleanConfig, depth);
    return `${type}(${configStr})`;
  }

  private generateSelectField(field: DataFieldConfig, depth: number): string {
    const { type, options, ...rest } = field as DataFieldConfig & {
      options?: SelectOption[];
    };
    const i = this.indent;
    const baseIndent = i.repeat(depth);

    const lines: string[] = [`${type}({`];

    const cleanConfig = this.cleanFieldConfig(rest);
    for (const [key, value] of Object.entries(cleanConfig)) {
      if (key !== "options") {
        lines.push(
          `${baseIndent}${i}${key}: ${this.formatValue(value, depth + 1)},`
        );
      }
    }

    if (options && options.length > 0) {
      lines.push(`${baseIndent}${i}options: [`);
      for (const opt of options) {
        if (opt.value === opt.label.toLowerCase().replace(/\s+/g, "_")) {
          lines.push(
            `${baseIndent}${i}${i}option('${this.escapeString(opt.label)}'),`
          );
        } else {
          lines.push(
            `${baseIndent}${i}${i}option('${this.escapeString(opt.label)}', '${this.escapeString(opt.value)}'),`
          );
        }
      }
      lines.push(`${baseIndent}${i}],`);
    }

    lines.push(`${baseIndent}})`);
    return lines.join("\n");
  }

  private generateNestedField(field: FieldConfig, depth: number): string {
    const { type, ...rest } = field;
    const nestedFields = (rest as { fields?: FieldConfig[] }).fields;
    const { fields: _fields, ...otherConfig } = rest as {
      fields?: FieldConfig[];
    };

    const i = this.indent;
    const baseIndent = i.repeat(depth);
    const lines: string[] = [`${type}({`];

    const cleanConfig = this.cleanFieldConfig(otherConfig);
    for (const [key, value] of Object.entries(cleanConfig)) {
      lines.push(
        `${baseIndent}${i}${key}: ${this.formatValue(value, depth + 1)},`
      );
    }

    if (nestedFields && nestedFields.length > 0) {
      lines.push(`${baseIndent}${i}fields: [`);
      const fieldsCode = this.generateFieldsCode(nestedFields, depth + 2);
      lines.push(fieldsCode);
      lines.push(`${baseIndent}${i}],`);
    }

    lines.push(`${baseIndent}})`);
    return lines.join("\n");
  }

  private generateAccessPlaceholder(): string {
    const i = this.indent;
    return `
${i}// Configure access control
${i}// access: {
${i}//   create: ({ req }) => !!req.user,
${i}//   read: () => true,
${i}//   update: ({ req }) => req.user?.role === 'admin',
${i}//   delete: ({ req }) => req.user?.role === 'admin',
${i}// },`;
  }

  private generateHooksPlaceholder(): string {
    const i = this.indent;
    return `

${i}// Configure hooks
${i}// hooks: {
${i}//   beforeChange: [
${i}//     async ({ data, operation }) => {
${i}//       // Transform data before save
${i}//       return data;
${i}//     },
${i}//   ],
${i}// },`;
  }

  private cleanFieldConfig(
    config: Record<string, unknown>
  ): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === "function") {
        continue;
      }

      if (value === undefined) {
        continue;
      }

      if (
        key === "admin" &&
        typeof value === "object" &&
        value !== null &&
        "components" in value
      ) {
        // Keep admin but remove components
        const { components, ...adminRest } = value as Record<string, unknown>;
        if (Object.keys(adminRest).length > 0) {
          cleaned[key] = adminRest;
        }
        continue;
      }

      cleaned[key] = value;
    }

    return cleaned;
  }

  private formatFieldConfig(
    config: Record<string, unknown>,
    depth: number
  ): string {
    const entries = Object.entries(config);

    if (entries.length === 0) {
      return "{}";
    }

    if (entries.length === 1 && entries[0][0] === "name") {
      return `{ name: '${this.escapeString(entries[0][1] as string)}' }`;
    }

    if (entries.length <= 3) {
      const simple = entries.every(
        ([_, v]) =>
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean"
      );
      if (simple) {
        const parts = entries.map(
          ([k, v]) => `${k}: ${this.formatValue(v, 0)}`
        );
        const singleLine = `{ ${parts.join(", ")} }`;
        if (singleLine.length < 80) {
          return singleLine;
        }
      }
    }

    return this.formatObject(config, depth);
  }

  private formatObject(obj: Record<string, unknown>, depth: number): string {
    const i = this.indent;
    const baseIndent = i.repeat(depth);
    const lines: string[] = ["{"];

    for (const [key, value] of Object.entries(obj)) {
      const formattedValue = this.formatValue(value, depth + 1);
      lines.push(`${baseIndent}${i}${key}: ${formattedValue},`);
    }

    lines.push(`${baseIndent}}`);
    return lines.join("\n");
  }

  private formatValue(value: unknown, depth: number): string {
    if (value === null) {
      return "null";
    }

    if (value === undefined) {
      return "undefined";
    }

    if (typeof value === "string") {
      return `'${this.escapeString(value)}'`;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return "[]";
      }

      const allSimple = value.every(
        v =>
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean"
      );

      if (allSimple && value.length <= 5) {
        const items = value.map(v => this.formatValue(v, 0));
        const singleLine = `[${items.join(", ")}]`;
        if (singleLine.length < 60) {
          return singleLine;
        }
      }

      const i = this.indent;
      const baseIndent = i.repeat(depth);
      const lines: string[] = ["["];
      for (const item of value) {
        lines.push(`${baseIndent}${i}${this.formatValue(item, depth + 1)},`);
      }
      lines.push(`${baseIndent}]`);
      return lines.join("\n");
    }

    if (typeof value === "object") {
      return this.formatObject(value as Record<string, unknown>, depth);
    }

    return String(value);
  }

  private escapeString(str: string): string {
    return str
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }
}
