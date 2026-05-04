/**
 * Unified Database Schema Definitions
 *
 * This file contains database-agnostic table definitions for all Nextly core tables.
 * These definitions use abstract type names (e.g., "jsonb", "uuid", "timestamp") that
 * are translated to dialect-specific types by each database adapter.
 *
 * Type Mapping Strategy:
 * - PostgreSQL: Uses native types (jsonb, uuid, timestamp, text, integer, boolean)
 * - MySQL: Translates jsonb→json, uuid→char(36), timestamp→timestamp
 * - SQLite: Translates jsonb→text(mode:'json'), uuid→text, timestamp→integer or text
 *
 * @packageDocumentation
 */

import type { TableDefinition } from "@revnixhq/adapter-drizzle/types";

/**
 * All Nextly core tables defined in a database-agnostic format.
 *
 * These table definitions serve as the single source of truth for the database schema.
 * Adapters translate these definitions into dialect-specific Drizzle schemas at runtime.
 *
 * Table Categories:
 * - System: systemMigrations, exampleUsers
 * - Authentication: users, accounts, sessions, verificationTokens, passwordResetTokens, emailVerificationTokens, refreshTokens
 * - RBAC: roles, permissions, rolePermissions, userRoles, roleInherits, userPermissionCache
 * - CMS: dynamicCollections, media, mediaFolders, contentSchemaEvents
 */
export const nextlyTables: TableDefinition[] = [
  // ============================================================
  // SYSTEM TABLES
  // ============================================================

  {
    name: "system_migrations",
    comment: "System migration tracking table",
    columns: [
      {
        name: "id",
        type: "serial",
        primaryKey: true,
      },
      {
        name: "name",
        type: "text",
        nullable: false,
      },
      {
        name: "run_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
  },

  // ============================================================
  // AUTHENTICATION TABLES
  // ============================================================

  {
    name: "users",
    comment: "User accounts with authentication - Auth.js v5 compatible",
    columns: [
      {
        name: "id",
        type: "text",
        primaryKey: true,
      },
      {
        name: "name",
        type: "text",
      },
      {
        name: "email",
        type: "text",
        nullable: false,
      },
      {
        name: "email_verified",
        type: "timestamp",
      },
      {
        name: "password_updated_at",
        type: "timestamp",
      },
      {
        name: "image",
        type: "text",
      },
      {
        name: "password_hash",
        type: "text",
        nullable: false,
      },
      {
        name: "is_active",
        type: "boolean",
        nullable: false,
        default: false,
      },
      {
        name: "failed_login_attempts",
        type: "integer",
        nullable: false,
        default: 0,
      },
      {
        name: "locked_until",
        type: "timestamp",
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
      {
        name: "updated_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "users_email_unique",
        columns: ["email"],
        unique: true,
      },
      {
        name: "users_created_at_idx",
        columns: ["created_at"],
      },
    ],
  },

  {
    name: "accounts",
    comment: "OAuth provider accounts - Auth.js v5 compatible",
    columns: [
      {
        name: "id",
        type: "serial",
        primaryKey: true,
      },
      {
        name: "user_id",
        type: "text",
        nullable: false,
        references: {
          table: "users",
          column: "id",
          onDelete: "cascade",
        },
      },
      {
        name: "type",
        type: "text",
        nullable: false,
      },
      {
        name: "provider",
        type: "text",
        nullable: false,
      },
      {
        name: "provider_account_id",
        type: "text",
        nullable: false,
      },
      {
        name: "refresh_token",
        type: "text",
      },
      {
        name: "access_token",
        type: "text",
      },
      {
        name: "expires_at",
        type: "integer",
      },
      {
        name: "token_type",
        type: "text",
      },
      {
        name: "scope",
        type: "text",
      },
      {
        name: "id_token",
        type: "text",
      },
      {
        name: "session_state",
        type: "text",
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
      {
        name: "updated_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "accounts_provider_providerAccountId_unique",
        columns: ["provider", "provider_account_id"],
        unique: true,
      },
      {
        name: "accounts_user_id_idx",
        columns: ["user_id"],
      },
    ],
  },

  {
    name: "sessions",
    comment: "User sessions - Auth.js v5 compatible",
    columns: [
      {
        name: "session_token",
        type: "text",
        primaryKey: true,
      },
      {
        name: "user_id",
        type: "text",
        nullable: false,
        references: {
          table: "users",
          column: "id",
          onDelete: "cascade",
        },
      },
      {
        name: "expires",
        type: "timestamp",
        nullable: false,
      },
    ],
    indexes: [
      {
        name: "sessions_user_id_idx",
        columns: ["user_id"],
      },
    ],
  },

  {
    name: "verification_tokens",
    comment: "Email verification tokens - Auth.js v5 compatible",
    columns: [
      {
        name: "identifier",
        type: "text",
        nullable: false,
      },
      {
        name: "token",
        type: "text",
        nullable: false,
      },
      {
        name: "expires",
        type: "timestamp",
        nullable: false,
      },
    ],
    indexes: [
      {
        name: "verification_tokens_identifier_token_pk",
        columns: ["identifier", "token"],
        unique: true,
      },
      {
        name: "verification_tokens_token_idx",
        columns: ["token"],
      },
    ],
  },

  {
    name: "password_reset_tokens",
    comment: "Password reset tokens with hashing for security",
    columns: [
      {
        name: "id",
        type: "serial",
        primaryKey: true,
      },
      {
        name: "identifier",
        type: "text",
        nullable: false,
      },
      {
        name: "token_hash",
        type: "text",
        nullable: false,
      },
      {
        name: "expires",
        type: "timestamp",
        nullable: false,
      },
      {
        name: "used_at",
        type: "timestamp",
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "prt_identifier_token_hash_unique",
        columns: ["identifier", "token_hash"],
        unique: true,
      },
      {
        name: "prt_expires_idx",
        columns: ["expires"],
      },
      {
        name: "prt_used_at_idx",
        columns: ["used_at"],
      },
    ],
  },

  {
    name: "email_verification_tokens",
    comment: "Email verification tokens with hashing for security",
    columns: [
      {
        name: "id",
        type: "serial",
        primaryKey: true,
      },
      {
        name: "identifier",
        type: "text",
        nullable: false,
      },
      {
        name: "token_hash",
        type: "text",
        nullable: false,
      },
      {
        name: "expires",
        type: "timestamp",
        nullable: false,
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "evt_identifier_token_hash_unique",
        columns: ["identifier", "token_hash"],
        unique: true,
      },
      {
        name: "evt_expires_idx",
        columns: ["expires"],
      },
    ],
  },

  {
    name: "refresh_tokens",
    comment:
      "Refresh tokens for custom auth session management - SHA-256 hashed, enables revocation and rotation",
    columns: [
      {
        name: "id",
        type: "text",
        primaryKey: true,
      },
      {
        name: "user_id",
        type: "text",
        nullable: false,
        references: {
          table: "users",
          column: "id",
          onDelete: "cascade",
        },
      },
      {
        name: "token_hash",
        type: "varchar(64)",
        nullable: false,
      },
      {
        name: "user_agent",
        type: "text",
      },
      {
        name: "ip_address",
        type: "varchar(45)",
      },
      {
        name: "expires_at",
        type: "timestamp",
        nullable: false,
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "refresh_tokens_token_hash_idx",
        columns: ["token_hash"],
      },
      {
        name: "refresh_tokens_user_id_idx",
        columns: ["user_id"],
      },
      {
        name: "refresh_tokens_expires_at_idx",
        columns: ["expires_at"],
      },
    ],
  },

  {
    name: "audit_log",
    comment:
      "Append-only event store for security-sensitive auth events. Operators should revoke UPDATE/DELETE GRANTs in production.",
    columns: [
      {
        name: "id",
        type: "text",
        primaryKey: true,
      },
      {
        name: "kind",
        type: "varchar(64)",
        nullable: false,
      },
      {
        name: "actor_user_id",
        type: "text",
      },
      {
        name: "target_user_id",
        type: "text",
      },
      {
        name: "ip_address",
        type: "varchar(45)",
      },
      {
        name: "user_agent",
        type: "text",
      },
      {
        name: "metadata",
        type: "jsonb",
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      { name: "audit_log_kind_idx", columns: ["kind"] },
      { name: "audit_log_actor_user_id_idx", columns: ["actor_user_id"] },
      { name: "audit_log_target_user_id_idx", columns: ["target_user_id"] },
      { name: "audit_log_created_at_idx", columns: ["created_at"] },
    ],
  },

  // ============================================================
  // RBAC (Role-Based Access Control) TABLES
  // ============================================================

  {
    name: "roles",
    comment: "User roles for RBAC system with hierarchical support",
    columns: [
      {
        name: "id",
        type: "text",
        primaryKey: true,
      },
      {
        name: "name",
        type: "varchar(50)",
        nullable: false,
      },
      {
        name: "slug",
        type: "varchar(50)",
        nullable: false,
      },
      {
        name: "description",
        type: "varchar(255)",
      },
      {
        name: "level",
        type: "integer",
        nullable: false,
        default: 0,
      },
      {
        name: "is_system",
        type: "boolean",
        nullable: false,
        default: false,
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
      {
        name: "updated_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "roles_name_unique",
        columns: ["name"],
        unique: true,
      },
      {
        name: "roles_slug_unique",
        columns: ["slug"],
        unique: true,
      },
      {
        name: "roles_level_idx",
        columns: ["level"],
      },
      {
        name: "roles_is_system_idx",
        columns: ["is_system"],
      },
    ],
  },

  {
    name: "permissions",
    comment: "Permissions for RBAC system (action + resource)",
    columns: [
      {
        name: "id",
        type: "text",
        primaryKey: true,
      },
      {
        name: "name",
        type: "varchar(100)",
        nullable: false,
      },
      {
        name: "slug",
        type: "varchar(100)",
        nullable: false,
      },
      {
        name: "action",
        type: "varchar(50)",
        nullable: false,
      },
      {
        name: "resource",
        type: "varchar(50)",
        nullable: false,
      },
      {
        name: "description",
        type: "varchar(255)",
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
      {
        name: "updated_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "permissions_action_resource_unique",
        columns: ["action", "resource"],
        unique: true,
      },
      {
        name: "permissions_slug_unique",
        columns: ["slug"],
        unique: true,
      },
      {
        name: "permissions_resource_idx",
        columns: ["resource"],
      },
      {
        name: "permissions_action_idx",
        columns: ["action"],
      },
    ],
  },

  {
    name: "role_permissions",
    comment: "Many-to-many relationship between roles and permissions",
    columns: [
      {
        name: "id",
        type: "text",
        primaryKey: true,
      },
      {
        name: "role_id",
        type: "text",
        nullable: false,
        references: {
          table: "roles",
          column: "id",
          onDelete: "cascade",
        },
      },
      {
        name: "permission_id",
        type: "text",
        nullable: false,
        references: {
          table: "permissions",
          column: "id",
          onDelete: "cascade",
        },
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "role_permissions_role_permission_unique",
        columns: ["role_id", "permission_id"],
        unique: true,
      },
      {
        name: "role_permissions_role_id_idx",
        columns: ["role_id"],
      },
    ],
  },

  {
    name: "user_roles",
    comment:
      "Many-to-many relationship between users and roles with optional expiration",
    columns: [
      {
        name: "id",
        type: "text",
        primaryKey: true,
      },
      {
        name: "user_id",
        type: "text",
        nullable: false,
        references: {
          table: "users",
          column: "id",
          onDelete: "cascade",
        },
      },
      {
        name: "role_id",
        type: "text",
        nullable: false,
        references: {
          table: "roles",
          column: "id",
          onDelete: "cascade",
        },
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
      {
        name: "expires_at",
        type: "timestamp",
      },
    ],
    indexes: [
      {
        name: "user_roles_user_role_unique",
        columns: ["user_id", "role_id"],
        unique: true,
      },
      {
        name: "user_roles_user_id_idx",
        columns: ["user_id"],
      },
      {
        name: "user_roles_expires_at_idx",
        columns: ["expires_at"],
      },
    ],
  },

  {
    name: "role_inherits",
    comment:
      "Role inheritance hierarchy (parent roles inherit child role permissions)",
    columns: [
      {
        name: "id",
        type: "text",
        primaryKey: true,
      },
      {
        name: "parent_role_id",
        type: "text",
        nullable: false,
        references: {
          table: "roles",
          column: "id",
          onDelete: "cascade",
        },
      },
      {
        name: "child_role_id",
        type: "text",
        nullable: false,
        references: {
          table: "roles",
          column: "id",
          onDelete: "cascade",
        },
      },
    ],
    indexes: [
      {
        name: "role_inherits_parent_child_unique",
        columns: ["parent_role_id", "child_role_id"],
        unique: true,
      },
      {
        name: "role_inherits_child_idx",
        columns: ["child_role_id"],
      },
      {
        name: "role_inherits_parent_idx",
        columns: ["parent_role_id"],
      },
    ],
  },

  {
    name: "user_permission_cache",
    comment:
      "Denormalized permission cache for performance optimization (target: 90%+ cache hit rate)",
    columns: [
      {
        name: "id",
        type: "text",
        primaryKey: true,
      },
      {
        name: "user_id",
        type: "text",
        nullable: false,
        references: {
          table: "users",
          column: "id",
          onDelete: "cascade",
        },
      },
      {
        name: "action",
        type: "varchar(50)",
        nullable: false,
      },
      {
        name: "resource",
        type: "varchar(100)",
        nullable: false,
      },
      {
        name: "has_permission",
        type: "boolean",
        nullable: false,
      },
      {
        name: "role_ids",
        type: "jsonb",
        nullable: false,
      },
      {
        name: "expires_at",
        type: "timestamp",
        nullable: false,
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "upc_user_id_idx",
        columns: ["user_id"],
      },
      {
        name: "upc_expires_at_idx",
        columns: ["expires_at"],
      },
      {
        name: "upc_user_action_resource_idx",
        columns: ["user_id", "action", "resource"],
      },
    ],
  },

  // ============================================================
  // CMS TABLES
  // ============================================================

  {
    name: "dynamic_collections",
    comment:
      "Metadata table for user-defined dynamic collections with JSON schema definitions",
    columns: [
      {
        name: "id",
        type: "text",
        primaryKey: true,
      },
      {
        name: "name",
        type: "varchar(255)",
        nullable: false,
        unique: true,
      },
      {
        name: "label",
        type: "varchar(255)",
        nullable: false,
      },
      {
        name: "table_name",
        type: "varchar(255)",
        nullable: false,
        unique: true,
      },
      {
        name: "description",
        type: "text",
      },
      {
        name: "icon",
        type: "varchar(50)",
      },
      {
        name: "schema_definition",
        type: "jsonb",
        nullable: false,
      },
      {
        name: "created_by",
        type: "text",
        references: {
          table: "users",
          column: "id",
          onDelete: "set null",
        },
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
      {
        name: "updated_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "dynamic_collections_created_by_idx",
        columns: ["created_by"],
      },
      {
        name: "dynamic_collections_created_at_idx",
        columns: ["created_at"],
      },
      {
        name: "dynamic_collections_updated_at_idx",
        columns: ["updated_at"],
      },
    ],
  },

  {
    name: "content_schema_events",
    comment:
      "Audit log for dynamic DDL operations (CREATE TABLE, ALTER TABLE, etc.)",
    columns: [
      {
        name: "id",
        type: "serial",
        primaryKey: true,
      },
      {
        name: "op",
        type: "text",
        nullable: false,
      },
      {
        name: "table_name",
        type: "text",
        nullable: false,
      },
      {
        name: "sql",
        type: "text",
        nullable: false,
      },
      {
        name: "meta",
        type: "jsonb",
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "content_schema_events_created_at_idx",
        columns: ["created_at"],
      },
      {
        name: "content_schema_events_table_name_idx",
        columns: ["table_name"],
      },
    ],
  },

  {
    name: "media",
    comment:
      "Media files storage (images, videos, documents) with metadata and folder organization",
    columns: [
      {
        name: "id",
        type: "text",
        primaryKey: true,
      },
      {
        name: "filename",
        type: "varchar(255)",
        nullable: false,
      },
      {
        name: "original_filename",
        type: "varchar(255)",
        nullable: false,
      },
      {
        name: "mime_type",
        type: "varchar(100)",
        nullable: false,
      },
      {
        name: "size",
        type: "integer",
        nullable: false,
      },
      {
        name: "width",
        type: "integer",
      },
      {
        name: "height",
        type: "integer",
      },
      {
        name: "duration",
        type: "integer",
      },
      {
        name: "url",
        type: "text",
        nullable: false,
      },
      {
        name: "thumbnail_url",
        type: "text",
      },
      {
        name: "alt_text",
        type: "text",
      },
      {
        name: "caption",
        type: "text",
      },
      {
        name: "tags",
        type: "text[]",
      },
      {
        name: "folder_id",
        type: "text",
        references: {
          table: "media_folders",
          column: "id",
          onDelete: "set null",
        },
      },
      {
        name: "uploaded_by",
        type: "text",
        // Nullable: CLI seeds, data imports, and other system-context uploads
        // may not have a user to attribute the upload to.
        nullable: true,
        references: {
          table: "users",
          column: "id",
          onDelete: "cascade",
        },
      },
      {
        name: "uploaded_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
      {
        name: "updated_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "media_uploaded_by_idx",
        columns: ["uploaded_by"],
      },
      {
        name: "media_mime_type_idx",
        columns: ["mime_type"],
      },
      {
        name: "media_uploaded_at_idx",
        columns: ["uploaded_at"],
      },
      {
        name: "media_tags_idx",
        columns: ["tags"],
      },
      {
        name: "media_folder_id_idx",
        columns: ["folder_id"],
      },
    ],
  },

  {
    name: "media_folders",
    comment:
      "Hierarchical folder structure for organizing media files with nested support",
    columns: [
      {
        name: "id",
        type: "text",
        primaryKey: true,
      },
      {
        name: "name",
        type: "varchar(255)",
        nullable: false,
      },
      {
        name: "description",
        type: "text",
      },
      {
        name: "parent_id",
        type: "text",
        references: {
          table: "media_folders",
          column: "id",
          onDelete: "cascade",
        },
      },
      {
        name: "created_by",
        type: "text",
        nullable: false,
        references: {
          table: "users",
          column: "id",
          onDelete: "cascade",
        },
      },
      {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
      {
        name: "updated_at",
        type: "timestamp",
        nullable: false,
        default: { sql: "CURRENT_TIMESTAMP" },
      },
    ],
    indexes: [
      {
        name: "media_folders_parent_id_idx",
        columns: ["parent_id"],
      },
      {
        name: "media_folders_created_by_idx",
        columns: ["created_by"],
      },
      {
        name: "media_folders_created_at_idx",
        columns: ["created_at"],
      },
    ],
  },
];

/**
 * Type mapping notes for adapter implementations:
 *
 * PostgreSQL (native support for most types):
 * - serial → SERIAL
 * - text → TEXT
 * - varchar(N) → VARCHAR(N)
 * - timestamp → TIMESTAMP WITHOUT TIME ZONE
 * - integer → INTEGER
 * - boolean → BOOLEAN
 * - jsonb → JSONB
 * - text[] → TEXT[]
 *
 * MySQL (requires some translations):
 * - serial → INT AUTO_INCREMENT
 * - text → TEXT
 * - varchar(N) → VARCHAR(N)
 * - timestamp → TIMESTAMP
 * - integer → INT
 * - boolean → TINYINT(1) or BOOLEAN
 * - jsonb → JSON (no JSONB support)
 * - text[] → JSON (MySQL doesn't have native arrays)
 *
 * SQLite (requires significant translations):
 * - serial → INTEGER PRIMARY KEY AUTOINCREMENT
 * - text → TEXT
 * - varchar(N) → TEXT (SQLite doesn't enforce length)
 * - timestamp → TEXT (ISO8601) or INTEGER (Unix time)
 * - integer → INTEGER
 * - boolean → INTEGER (0 or 1)
 * - jsonb → TEXT with JSON mode
 * - text[] → TEXT with JSON mode (serialized array)
 *
 * Default value handling:
 * - { sql: "CURRENT_TIMESTAMP" } → NOW(), CURRENT_TIMESTAMP, etc. per dialect
 * - Primitive values → Literal values
 */
