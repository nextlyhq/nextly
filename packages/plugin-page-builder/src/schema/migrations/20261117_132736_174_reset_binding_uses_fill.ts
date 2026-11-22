/**
 * Written by `nextly migrate:create --plugin`, to be edited: put this
 * module's SQL in each dialect's `up` and `down`, one statement per entry.
 * It is sealed with `migrationChecksum` when it loads, so an edit keeps it
 * intact. Once it has been applied, change it no further: the ledger
 * refuses a module that no longer matches what ran.
 *
 * Forgets that the index of where documents bind a Single's fields
 * (`binding_uses`, created by the module before this one) was filled: its
 * mark is set to a format no release fills, and the bindings report's check
 * of every document is no longer current, so the next jobs pass checks every
 * document and fills the index. Both ways, because a table created, or
 * dropped and created again, starts empty, and a mark left from before would
 * say it was complete. Changes no schema, so it runs wherever the plugin's
 * tables stand, including a database whose schema sync already made the
 * table. Each statement only resets, so running it again does no harm.
 */
import {
  migrationChecksum,
  type PluginMigration,
} from "@nextlyhq/plugin-sdk/schema";

const content = {
  name: "20261117_132736_174_reset_binding_uses_fill",
  schemaVersion: 11,
  dialects: {
    postgresql: {
      up: [
        'UPDATE "page_builder__site_options" SET "value" = \'0\' WHERE "name" = \'binding-uses-filled\'',
        'UPDATE "page_builder__binding_report_runs" SET "checked" = NULL, "checking" = NULL, "cursor" = NULL WHERE "name" = \'full\'',
      ],
      down: [
        'UPDATE "page_builder__site_options" SET "value" = \'0\' WHERE "name" = \'binding-uses-filled\'',
        'UPDATE "page_builder__binding_report_runs" SET "checked" = NULL, "checking" = NULL, "cursor" = NULL WHERE "name" = \'full\'',
      ],
    },
    mysql: {
      up: [
        "UPDATE `page_builder__site_options` SET `value` = '0' WHERE `name` = 'binding-uses-filled'",
        "UPDATE `page_builder__binding_report_runs` SET `checked` = NULL, `checking` = NULL, `cursor` = NULL WHERE `name` = 'full'",
      ],
      down: [
        "UPDATE `page_builder__site_options` SET `value` = '0' WHERE `name` = 'binding-uses-filled'",
        "UPDATE `page_builder__binding_report_runs` SET `checked` = NULL, `checking` = NULL, `cursor` = NULL WHERE `name` = 'full'",
      ],
    },
    sqlite: {
      up: [
        'UPDATE "page_builder__site_options" SET "value" = \'0\' WHERE "name" = \'binding-uses-filled\'',
        'UPDATE "page_builder__binding_report_runs" SET "checked" = NULL, "checking" = NULL, "cursor" = NULL WHERE "name" = \'full\'',
      ],
      down: [
        'UPDATE "page_builder__site_options" SET "value" = \'0\' WHERE "name" = \'binding-uses-filled\'',
        'UPDATE "page_builder__binding_report_runs" SET "checked" = NULL, "checking" = NULL, "cursor" = NULL WHERE "name" = \'full\'',
      ],
    },
  },
  snapshot: {
    postgresql: {
      tables: [
        {
          name: "page_builder__usage_runs",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "text",
              nullable: false,
            },
            {
              name: "generation",
              type: "text",
              nullable: false,
            },
            {
              name: "token",
              type: "bpchar",
              typeModifier: "36",
              nullable: false,
            },
            {
              name: "dirty",
              type: "bool",
              nullable: false,
              default: "false",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__usage_runs_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__usage_progress",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "token",
              type: "bpchar",
              typeModifier: "36",
              nullable: false,
            },
            {
              name: "scope_key",
              type: "text",
              nullable: false,
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
            {
              name: "done",
              type: "bool",
              nullable: false,
              default: "false",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__usage_progress_token_scope_key_0ujeq6m",
              columns: ["token", "scope_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__layout_removals",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "layout_id",
              type: "text",
              nullable: false,
            },
            {
              name: "action",
              type: "text",
              nullable: false,
            },
            {
              name: "step",
              type: "text",
              nullable: false,
            },
            {
              name: "token",
              type: "bpchar",
              typeModifier: "36",
              nullable: false,
            },
            {
              name: "started_by",
              type: "text",
              nullable: true,
            },
            {
              name: "pages_left",
              type: "int4",
              nullable: true,
            },
            {
              name: "copy",
              type: "jsonb",
              nullable: true,
            },
            {
              name: "copy_version",
              type: "text",
              nullable: true,
            },
            {
              name: "settled_at",
              type: "timestamp",
              nullable: true,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__layout_removals_layout_id",
              columns: ["layout_id"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_deletions",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "component_id",
              type: "text",
              nullable: false,
            },
            {
              name: "purpose",
              type: "text",
              nullable: false,
            },
            {
              name: "started_by",
              type: "text",
              nullable: false,
            },
            {
              name: "phase",
              type: "text",
              nullable: false,
              default: "'converting'",
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__component_deletions_component_id_purpo_1mlwby6",
              columns: ["component_id", "purpose"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_deletion_hosts",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "deletion_id",
              type: "bpchar",
              typeModifier: "36",
              nullable: false,
            },
            {
              name: "host_key",
              type: "text",
              nullable: false,
            },
            {
              name: "state",
              type: "text",
              nullable: false,
            },
            {
              name: "reason",
              type: "text",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__component_deletion_hosts_deletion_id_h_007uo01",
              columns: ["deletion_id", "host_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__site_options",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "text",
              nullable: false,
            },
            {
              name: "value",
              type: "text",
              nullable: false,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__site_options_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__breakpoint_removals",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "removed_ids",
              type: "text",
              nullable: false,
            },
            {
              name: "before",
              type: "text",
              nullable: false,
            },
            {
              name: "started_by",
              type: "text",
              nullable: false,
            },
            {
              name: "phase",
              type: "text",
              nullable: false,
              default: "'converting'",
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
            {
              name: "open_key",
              type: "text",
              nullable: true,
            },
            {
              name: "undoes",
              type: "bpchar",
              typeModifier: "36",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__breakpoint_removals_open_key",
              columns: ["open_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__breakpoint_removal_fragments",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "run_id",
              type: "bpchar",
              typeModifier: "36",
              nullable: false,
            },
            {
              name: "document_key",
              type: "text",
              nullable: false,
            },
            {
              name: "host",
              type: "jsonb",
              nullable: true,
            },
            {
              name: "form",
              type: "text",
              nullable: false,
            },
            {
              name: "fragment",
              type: "jsonb",
              nullable: false,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__breakpoint_removal_fragments_run_id",
              columns: ["run_id"],
              unique: false,
            },
            {
              name: "idx_page_builder__breakpoint_removal_fragments_created_at",
              columns: ["created_at"],
              unique: false,
            },
            {
              name: "idx_page_builder__breakpoint_removal_fragments_run_id_d_04ki5jv",
              columns: ["run_id", "document_key"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__class_usage",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "text",
              nullable: false,
            },
            {
              name: "entity",
              type: "text",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "text",
              nullable: false,
            },
            {
              name: "field",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: false,
            },
            {
              name: "variant",
              type: "text",
              nullable: false,
            },
            {
              name: "class_id",
              type: "text",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__class_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__class_usage_class_id",
              columns: ["class_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_usage",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "text",
              nullable: false,
            },
            {
              name: "entity",
              type: "text",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "text",
              nullable: false,
            },
            {
              name: "field",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: false,
            },
            {
              name: "variant",
              type: "text",
              nullable: false,
            },
            {
              name: "kind",
              type: "text",
              nullable: false,
            },
            {
              name: "component_id",
              type: "text",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__component_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__component_usage_component_id",
              columns: ["component_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__token_usage",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "text",
              nullable: false,
            },
            {
              name: "entity",
              type: "text",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "text",
              nullable: false,
            },
            {
              name: "field",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: false,
            },
            {
              name: "variant",
              type: "text",
              nullable: false,
            },
            {
              name: "token_id",
              type: "text",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__token_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__token_usage_token_id",
              columns: ["token_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_issues",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "document_key",
              type: "text",
              nullable: false,
            },
            {
              name: "kind",
              type: "text",
              nullable: false,
            },
            {
              name: "slug",
              type: "text",
              nullable: false,
            },
            {
              name: "document_id",
              type: "text",
              nullable: true,
            },
            {
              name: "place",
              type: "text",
              nullable: false,
            },
            {
              name: "issues",
              type: "jsonb",
              nullable: false,
            },
            {
              name: "dirty",
              type: "bpchar",
              typeModifier: "36",
              nullable: true,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__binding_issues_document_key",
              columns: ["document_key"],
              unique: true,
            },
            {
              name: "idx_page_builder__binding_issues_dirty",
              columns: ["dirty"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_report_runs",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "text",
              nullable: false,
            },
            {
              name: "checked",
              type: "text",
              nullable: true,
            },
            {
              name: "checking",
              type: "text",
              nullable: true,
            },
            {
              name: "cursor",
              type: "jsonb",
              nullable: true,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__binding_report_runs_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_uses",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "document_key",
              type: "text",
              nullable: false,
            },
            {
              name: "kind",
              type: "text",
              nullable: false,
            },
            {
              name: "slug",
              type: "text",
              nullable: false,
            },
            {
              name: "document_id",
              type: "text",
              nullable: true,
            },
            {
              name: "place",
              type: "text",
              nullable: false,
            },
            {
              name: "version",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: true,
            },
            {
              name: "blocks_field",
              type: "text",
              nullable: false,
            },
            {
              name: "node_id",
              type: "text",
              nullable: false,
            },
            {
              name: "block_type",
              type: "text",
              nullable: false,
            },
            {
              name: "block_name",
              type: "text",
              nullable: true,
            },
            {
              name: "prop",
              type: "text",
              nullable: false,
            },
            {
              name: "path",
              type: "text",
              nullable: false,
            },
            {
              name: "source_kind",
              type: "text",
              nullable: false,
            },
            {
              name: "source_key",
              type: "text",
              nullable: false,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__binding_uses_source_kind_source_key_001e79k",
              columns: ["source_kind", "source_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__binding_uses_document_key",
              columns: ["document_key"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
      ],
    },
    mysql: {
      tables: [
        {
          name: "page_builder__usage_runs",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "varchar(64)",
              nullable: false,
            },
            {
              name: "generation",
              type: "varchar(512)",
              nullable: false,
            },
            {
              name: "token",
              type: "char(36)",
              nullable: false,
            },
            {
              name: "dirty",
              type: "tinyint(1)",
              nullable: false,
              default: "false",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__usage_runs_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__usage_progress",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "token",
              type: "char(36)",
              nullable: false,
            },
            {
              name: "scope_key",
              type: "varchar(512)",
              nullable: false,
            },
            {
              name: "cursor",
              type: "varchar(255)",
              nullable: true,
            },
            {
              name: "done",
              type: "tinyint(1)",
              nullable: false,
              default: "false",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__usage_progress_token_scope_key_0ujeq6m",
              columns: ["token", "scope_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__layout_removals",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "layout_id",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "action",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "step",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "token",
              type: "char(36)",
              nullable: false,
            },
            {
              name: "started_by",
              type: "varchar(255)",
              nullable: true,
            },
            {
              name: "pages_left",
              type: "int",
              nullable: true,
            },
            {
              name: "copy",
              type: "json",
              nullable: true,
            },
            {
              name: "copy_version",
              type: "varchar(128)",
              nullable: true,
            },
            {
              name: "settled_at",
              type: "timestamp",
              nullable: true,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__layout_removals_layout_id",
              columns: ["layout_id"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_deletions",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "component_id",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "purpose",
              type: "varchar(32)",
              nullable: false,
            },
            {
              name: "started_by",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "phase",
              type: "varchar(16)",
              nullable: false,
              default: "'converting'",
            },
            {
              name: "cursor",
              type: "varchar(1024)",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__component_deletions_component_id_purpo_1mlwby6",
              columns: ["component_id", "purpose"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_deletion_hosts",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "deletion_id",
              type: "char(36)",
              nullable: false,
            },
            {
              name: "host_key",
              type: "varchar(512)",
              nullable: false,
            },
            {
              name: "state",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "reason",
              type: "varchar(64)",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__component_deletion_hosts_deletion_id_h_007uo01",
              columns: ["deletion_id", "host_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__site_options",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "varchar(64)",
              nullable: false,
            },
            {
              name: "value",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__site_options_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__breakpoint_removals",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "removed_ids",
              type: "text",
              nullable: false,
            },
            {
              name: "before",
              type: "text",
              nullable: false,
            },
            {
              name: "started_by",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "phase",
              type: "varchar(16)",
              nullable: false,
              default: "'converting'",
            },
            {
              name: "cursor",
              type: "varchar(1024)",
              nullable: true,
            },
            {
              name: "open_key",
              type: "varchar(16)",
              nullable: true,
            },
            {
              name: "undoes",
              type: "char(36)",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__breakpoint_removals_open_key",
              columns: ["open_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__breakpoint_removal_fragments",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "run_id",
              type: "char(36)",
              nullable: false,
            },
            {
              name: "document_key",
              type: "varchar(512)",
              nullable: false,
            },
            {
              name: "host",
              type: "json",
              nullable: true,
            },
            {
              name: "form",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "fragment",
              type: "json",
              nullable: false,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__breakpoint_removal_fragments_run_id",
              columns: ["run_id"],
              unique: false,
            },
            {
              name: "idx_page_builder__breakpoint_removal_fragments_created_at",
              columns: ["created_at"],
              unique: false,
            },
            {
              name: "idx_page_builder__breakpoint_removal_fragments_run_id_d_04ki5jv",
              columns: ["run_id", "document_key"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__class_usage",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "entity",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "field",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "locale",
              type: "varchar(64)",
              nullable: false,
            },
            {
              name: "variant",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "class_id",
              type: "varchar(255)",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__class_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__class_usage_class_id",
              columns: ["class_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_usage",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "entity",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "field",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "locale",
              type: "varchar(64)",
              nullable: false,
            },
            {
              name: "variant",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "kind",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "component_id",
              type: "varchar(512)",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__component_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__component_usage_component_id",
              columns: ["component_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__token_usage",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "entity",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "field",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "locale",
              type: "varchar(64)",
              nullable: false,
            },
            {
              name: "variant",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "token_id",
              type: "varchar(512)",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__token_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__token_usage_token_id",
              columns: ["token_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_issues",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "document_key",
              type: "varchar(512)",
              nullable: false,
            },
            {
              name: "kind",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "slug",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "document_id",
              type: "varchar(255)",
              nullable: true,
            },
            {
              name: "place",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "issues",
              type: "json",
              nullable: false,
            },
            {
              name: "dirty",
              type: "char(36)",
              nullable: true,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__binding_issues_document_key",
              columns: ["document_key"],
              unique: true,
            },
            {
              name: "idx_page_builder__binding_issues_dirty",
              columns: ["dirty"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_report_runs",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "varchar(32)",
              nullable: false,
            },
            {
              name: "checked",
              type: "varchar(64)",
              nullable: true,
            },
            {
              name: "checking",
              type: "varchar(64)",
              nullable: true,
            },
            {
              name: "cursor",
              type: "json",
              nullable: true,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__binding_report_runs_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_uses",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "document_key",
              type: "varchar(512)",
              nullable: false,
            },
            {
              name: "kind",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "slug",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "document_id",
              type: "varchar(255)",
              nullable: true,
            },
            {
              name: "place",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "version",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: true,
            },
            {
              name: "blocks_field",
              type: "text",
              nullable: false,
            },
            {
              name: "node_id",
              type: "text",
              nullable: false,
            },
            {
              name: "block_type",
              type: "text",
              nullable: false,
            },
            {
              name: "block_name",
              type: "text",
              nullable: true,
            },
            {
              name: "prop",
              type: "text",
              nullable: false,
            },
            {
              name: "path",
              type: "text",
              nullable: false,
            },
            {
              name: "source_kind",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "source_key",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__binding_uses_source_kind_source_key_001e79k",
              columns: ["source_kind", "source_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__binding_uses_document_key",
              columns: ["document_key"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
      ],
    },
    sqlite: {
      tables: [
        {
          name: "page_builder__usage_runs",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "text",
              nullable: false,
            },
            {
              name: "generation",
              type: "text",
              nullable: false,
            },
            {
              name: "token",
              type: "text",
              nullable: false,
            },
            {
              name: "dirty",
              type: "integer",
              nullable: false,
              default: "false",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__usage_runs_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__usage_progress",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "token",
              type: "text",
              nullable: false,
            },
            {
              name: "scope_key",
              type: "text",
              nullable: false,
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
            {
              name: "done",
              type: "integer",
              nullable: false,
              default: "false",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__usage_progress_token_scope_key_0ujeq6m",
              columns: ["token", "scope_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__layout_removals",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "layout_id",
              type: "text",
              nullable: false,
            },
            {
              name: "action",
              type: "text",
              nullable: false,
            },
            {
              name: "step",
              type: "text",
              nullable: false,
            },
            {
              name: "token",
              type: "text",
              nullable: false,
            },
            {
              name: "started_by",
              type: "text",
              nullable: true,
            },
            {
              name: "pages_left",
              type: "integer",
              nullable: true,
            },
            {
              name: "copy",
              type: "text",
              nullable: true,
            },
            {
              name: "copy_version",
              type: "text",
              nullable: true,
            },
            {
              name: "settled_at",
              type: "integer",
              nullable: true,
            },
            {
              name: "created_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
            {
              name: "updated_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__layout_removals_layout_id",
              columns: ["layout_id"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_deletions",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "component_id",
              type: "text",
              nullable: false,
            },
            {
              name: "purpose",
              type: "text",
              nullable: false,
            },
            {
              name: "started_by",
              type: "text",
              nullable: false,
            },
            {
              name: "phase",
              type: "text",
              nullable: false,
              default: "'converting'",
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__component_deletions_component_id_purpo_1mlwby6",
              columns: ["component_id", "purpose"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_deletion_hosts",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "deletion_id",
              type: "text",
              nullable: false,
            },
            {
              name: "host_key",
              type: "text",
              nullable: false,
            },
            {
              name: "state",
              type: "text",
              nullable: false,
            },
            {
              name: "reason",
              type: "text",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__component_deletion_hosts_deletion_id_h_007uo01",
              columns: ["deletion_id", "host_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__site_options",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "text",
              nullable: false,
            },
            {
              name: "value",
              type: "text",
              nullable: false,
            },
            {
              name: "created_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
            {
              name: "updated_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__site_options_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__breakpoint_removals",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "removed_ids",
              type: "text",
              nullable: false,
            },
            {
              name: "before",
              type: "text",
              nullable: false,
            },
            {
              name: "started_by",
              type: "text",
              nullable: false,
            },
            {
              name: "phase",
              type: "text",
              nullable: false,
              default: "'converting'",
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
            {
              name: "open_key",
              type: "text",
              nullable: true,
            },
            {
              name: "undoes",
              type: "text",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__breakpoint_removals_open_key",
              columns: ["open_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__breakpoint_removal_fragments",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "run_id",
              type: "text",
              nullable: false,
            },
            {
              name: "document_key",
              type: "text",
              nullable: false,
            },
            {
              name: "host",
              type: "text",
              nullable: true,
            },
            {
              name: "form",
              type: "text",
              nullable: false,
            },
            {
              name: "fragment",
              type: "text",
              nullable: false,
            },
            {
              name: "created_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
            {
              name: "updated_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__breakpoint_removal_fragments_run_id",
              columns: ["run_id"],
              unique: false,
            },
            {
              name: "idx_page_builder__breakpoint_removal_fragments_created_at",
              columns: ["created_at"],
              unique: false,
            },
            {
              name: "idx_page_builder__breakpoint_removal_fragments_run_id_d_04ki5jv",
              columns: ["run_id", "document_key"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__class_usage",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "text",
              nullable: false,
            },
            {
              name: "entity",
              type: "text",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "text",
              nullable: false,
            },
            {
              name: "field",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: false,
            },
            {
              name: "variant",
              type: "text",
              nullable: false,
            },
            {
              name: "class_id",
              type: "text",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__class_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__class_usage_class_id",
              columns: ["class_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_usage",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "text",
              nullable: false,
            },
            {
              name: "entity",
              type: "text",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "text",
              nullable: false,
            },
            {
              name: "field",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: false,
            },
            {
              name: "variant",
              type: "text",
              nullable: false,
            },
            {
              name: "kind",
              type: "text",
              nullable: false,
            },
            {
              name: "component_id",
              type: "text",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__component_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__component_usage_component_id",
              columns: ["component_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__token_usage",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "text",
              nullable: false,
            },
            {
              name: "entity",
              type: "text",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "text",
              nullable: false,
            },
            {
              name: "field",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: false,
            },
            {
              name: "variant",
              type: "text",
              nullable: false,
            },
            {
              name: "token_id",
              type: "text",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__token_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__token_usage_token_id",
              columns: ["token_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_issues",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "document_key",
              type: "text",
              nullable: false,
            },
            {
              name: "kind",
              type: "text",
              nullable: false,
            },
            {
              name: "slug",
              type: "text",
              nullable: false,
            },
            {
              name: "document_id",
              type: "text",
              nullable: true,
            },
            {
              name: "place",
              type: "text",
              nullable: false,
            },
            {
              name: "issues",
              type: "text",
              nullable: false,
            },
            {
              name: "dirty",
              type: "text",
              nullable: true,
            },
            {
              name: "created_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
            {
              name: "updated_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__binding_issues_document_key",
              columns: ["document_key"],
              unique: true,
            },
            {
              name: "idx_page_builder__binding_issues_dirty",
              columns: ["dirty"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_report_runs",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "text",
              nullable: false,
            },
            {
              name: "checked",
              type: "text",
              nullable: true,
            },
            {
              name: "checking",
              type: "text",
              nullable: true,
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
            {
              name: "created_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
            {
              name: "updated_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__binding_report_runs_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_uses",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "document_key",
              type: "text",
              nullable: false,
            },
            {
              name: "kind",
              type: "text",
              nullable: false,
            },
            {
              name: "slug",
              type: "text",
              nullable: false,
            },
            {
              name: "document_id",
              type: "text",
              nullable: true,
            },
            {
              name: "place",
              type: "text",
              nullable: false,
            },
            {
              name: "version",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: true,
            },
            {
              name: "blocks_field",
              type: "text",
              nullable: false,
            },
            {
              name: "node_id",
              type: "text",
              nullable: false,
            },
            {
              name: "block_type",
              type: "text",
              nullable: false,
            },
            {
              name: "block_name",
              type: "text",
              nullable: true,
            },
            {
              name: "prop",
              type: "text",
              nullable: false,
            },
            {
              name: "path",
              type: "text",
              nullable: false,
            },
            {
              name: "source_kind",
              type: "text",
              nullable: false,
            },
            {
              name: "source_key",
              type: "text",
              nullable: false,
            },
            {
              name: "created_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
            {
              name: "updated_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__binding_uses_source_kind_source_key_001e79k",
              columns: ["source_kind", "source_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__binding_uses_document_key",
              columns: ["document_key"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
      ],
    },
  },
  before: {
    postgresql: {
      tables: [
        {
          name: "page_builder__usage_runs",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "text",
              nullable: false,
            },
            {
              name: "generation",
              type: "text",
              nullable: false,
            },
            {
              name: "token",
              type: "bpchar",
              typeModifier: "36",
              nullable: false,
            },
            {
              name: "dirty",
              type: "bool",
              nullable: false,
              default: "false",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__usage_runs_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__usage_progress",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "token",
              type: "bpchar",
              typeModifier: "36",
              nullable: false,
            },
            {
              name: "scope_key",
              type: "text",
              nullable: false,
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
            {
              name: "done",
              type: "bool",
              nullable: false,
              default: "false",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__usage_progress_token_scope_key_0ujeq6m",
              columns: ["token", "scope_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__layout_removals",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "layout_id",
              type: "text",
              nullable: false,
            },
            {
              name: "action",
              type: "text",
              nullable: false,
            },
            {
              name: "step",
              type: "text",
              nullable: false,
            },
            {
              name: "token",
              type: "bpchar",
              typeModifier: "36",
              nullable: false,
            },
            {
              name: "started_by",
              type: "text",
              nullable: true,
            },
            {
              name: "pages_left",
              type: "int4",
              nullable: true,
            },
            {
              name: "copy",
              type: "jsonb",
              nullable: true,
            },
            {
              name: "copy_version",
              type: "text",
              nullable: true,
            },
            {
              name: "settled_at",
              type: "timestamp",
              nullable: true,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__layout_removals_layout_id",
              columns: ["layout_id"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_deletions",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "component_id",
              type: "text",
              nullable: false,
            },
            {
              name: "purpose",
              type: "text",
              nullable: false,
            },
            {
              name: "started_by",
              type: "text",
              nullable: false,
            },
            {
              name: "phase",
              type: "text",
              nullable: false,
              default: "'converting'",
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__component_deletions_component_id_purpo_1mlwby6",
              columns: ["component_id", "purpose"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_deletion_hosts",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "deletion_id",
              type: "bpchar",
              typeModifier: "36",
              nullable: false,
            },
            {
              name: "host_key",
              type: "text",
              nullable: false,
            },
            {
              name: "state",
              type: "text",
              nullable: false,
            },
            {
              name: "reason",
              type: "text",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__component_deletion_hosts_deletion_id_h_007uo01",
              columns: ["deletion_id", "host_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__site_options",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "text",
              nullable: false,
            },
            {
              name: "value",
              type: "text",
              nullable: false,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__site_options_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__breakpoint_removals",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "removed_ids",
              type: "text",
              nullable: false,
            },
            {
              name: "before",
              type: "text",
              nullable: false,
            },
            {
              name: "started_by",
              type: "text",
              nullable: false,
            },
            {
              name: "phase",
              type: "text",
              nullable: false,
              default: "'converting'",
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
            {
              name: "open_key",
              type: "text",
              nullable: true,
            },
            {
              name: "undoes",
              type: "bpchar",
              typeModifier: "36",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__breakpoint_removals_open_key",
              columns: ["open_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__breakpoint_removal_fragments",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "run_id",
              type: "bpchar",
              typeModifier: "36",
              nullable: false,
            },
            {
              name: "document_key",
              type: "text",
              nullable: false,
            },
            {
              name: "host",
              type: "jsonb",
              nullable: true,
            },
            {
              name: "form",
              type: "text",
              nullable: false,
            },
            {
              name: "fragment",
              type: "jsonb",
              nullable: false,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__breakpoint_removal_fragments_run_id",
              columns: ["run_id"],
              unique: false,
            },
            {
              name: "idx_page_builder__breakpoint_removal_fragments_created_at",
              columns: ["created_at"],
              unique: false,
            },
            {
              name: "idx_page_builder__breakpoint_removal_fragments_run_id_d_04ki5jv",
              columns: ["run_id", "document_key"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__class_usage",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "text",
              nullable: false,
            },
            {
              name: "entity",
              type: "text",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "text",
              nullable: false,
            },
            {
              name: "field",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: false,
            },
            {
              name: "variant",
              type: "text",
              nullable: false,
            },
            {
              name: "class_id",
              type: "text",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__class_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__class_usage_class_id",
              columns: ["class_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_usage",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "text",
              nullable: false,
            },
            {
              name: "entity",
              type: "text",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "text",
              nullable: false,
            },
            {
              name: "field",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: false,
            },
            {
              name: "variant",
              type: "text",
              nullable: false,
            },
            {
              name: "kind",
              type: "text",
              nullable: false,
            },
            {
              name: "component_id",
              type: "text",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__component_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__component_usage_component_id",
              columns: ["component_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__token_usage",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "text",
              nullable: false,
            },
            {
              name: "entity",
              type: "text",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "text",
              nullable: false,
            },
            {
              name: "field",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: false,
            },
            {
              name: "variant",
              type: "text",
              nullable: false,
            },
            {
              name: "token_id",
              type: "text",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__token_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__token_usage_token_id",
              columns: ["token_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_issues",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "document_key",
              type: "text",
              nullable: false,
            },
            {
              name: "kind",
              type: "text",
              nullable: false,
            },
            {
              name: "slug",
              type: "text",
              nullable: false,
            },
            {
              name: "document_id",
              type: "text",
              nullable: true,
            },
            {
              name: "place",
              type: "text",
              nullable: false,
            },
            {
              name: "issues",
              type: "jsonb",
              nullable: false,
            },
            {
              name: "dirty",
              type: "bpchar",
              typeModifier: "36",
              nullable: true,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__binding_issues_document_key",
              columns: ["document_key"],
              unique: true,
            },
            {
              name: "idx_page_builder__binding_issues_dirty",
              columns: ["dirty"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_report_runs",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "text",
              nullable: false,
            },
            {
              name: "checked",
              type: "text",
              nullable: true,
            },
            {
              name: "checking",
              type: "text",
              nullable: true,
            },
            {
              name: "cursor",
              type: "jsonb",
              nullable: true,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__binding_report_runs_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_uses",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "document_key",
              type: "text",
              nullable: false,
            },
            {
              name: "kind",
              type: "text",
              nullable: false,
            },
            {
              name: "slug",
              type: "text",
              nullable: false,
            },
            {
              name: "document_id",
              type: "text",
              nullable: true,
            },
            {
              name: "place",
              type: "text",
              nullable: false,
            },
            {
              name: "version",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: true,
            },
            {
              name: "blocks_field",
              type: "text",
              nullable: false,
            },
            {
              name: "node_id",
              type: "text",
              nullable: false,
            },
            {
              name: "block_type",
              type: "text",
              nullable: false,
            },
            {
              name: "block_name",
              type: "text",
              nullable: true,
            },
            {
              name: "prop",
              type: "text",
              nullable: false,
            },
            {
              name: "path",
              type: "text",
              nullable: false,
            },
            {
              name: "source_kind",
              type: "text",
              nullable: false,
            },
            {
              name: "source_key",
              type: "text",
              nullable: false,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "now()",
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__binding_uses_source_kind_source_key_001e79k",
              columns: ["source_kind", "source_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__binding_uses_document_key",
              columns: ["document_key"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
      ],
    },
    mysql: {
      tables: [
        {
          name: "page_builder__usage_runs",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "varchar(64)",
              nullable: false,
            },
            {
              name: "generation",
              type: "varchar(512)",
              nullable: false,
            },
            {
              name: "token",
              type: "char(36)",
              nullable: false,
            },
            {
              name: "dirty",
              type: "tinyint(1)",
              nullable: false,
              default: "false",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__usage_runs_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__usage_progress",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "token",
              type: "char(36)",
              nullable: false,
            },
            {
              name: "scope_key",
              type: "varchar(512)",
              nullable: false,
            },
            {
              name: "cursor",
              type: "varchar(255)",
              nullable: true,
            },
            {
              name: "done",
              type: "tinyint(1)",
              nullable: false,
              default: "false",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__usage_progress_token_scope_key_0ujeq6m",
              columns: ["token", "scope_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__layout_removals",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "layout_id",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "action",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "step",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "token",
              type: "char(36)",
              nullable: false,
            },
            {
              name: "started_by",
              type: "varchar(255)",
              nullable: true,
            },
            {
              name: "pages_left",
              type: "int",
              nullable: true,
            },
            {
              name: "copy",
              type: "json",
              nullable: true,
            },
            {
              name: "copy_version",
              type: "varchar(128)",
              nullable: true,
            },
            {
              name: "settled_at",
              type: "timestamp",
              nullable: true,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__layout_removals_layout_id",
              columns: ["layout_id"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_deletions",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "component_id",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "purpose",
              type: "varchar(32)",
              nullable: false,
            },
            {
              name: "started_by",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "phase",
              type: "varchar(16)",
              nullable: false,
              default: "'converting'",
            },
            {
              name: "cursor",
              type: "varchar(1024)",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__component_deletions_component_id_purpo_1mlwby6",
              columns: ["component_id", "purpose"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_deletion_hosts",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "deletion_id",
              type: "char(36)",
              nullable: false,
            },
            {
              name: "host_key",
              type: "varchar(512)",
              nullable: false,
            },
            {
              name: "state",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "reason",
              type: "varchar(64)",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__component_deletion_hosts_deletion_id_h_007uo01",
              columns: ["deletion_id", "host_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__site_options",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "varchar(64)",
              nullable: false,
            },
            {
              name: "value",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__site_options_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__breakpoint_removals",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "removed_ids",
              type: "text",
              nullable: false,
            },
            {
              name: "before",
              type: "text",
              nullable: false,
            },
            {
              name: "started_by",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "phase",
              type: "varchar(16)",
              nullable: false,
              default: "'converting'",
            },
            {
              name: "cursor",
              type: "varchar(1024)",
              nullable: true,
            },
            {
              name: "open_key",
              type: "varchar(16)",
              nullable: true,
            },
            {
              name: "undoes",
              type: "char(36)",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__breakpoint_removals_open_key",
              columns: ["open_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__breakpoint_removal_fragments",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "run_id",
              type: "char(36)",
              nullable: false,
            },
            {
              name: "document_key",
              type: "varchar(512)",
              nullable: false,
            },
            {
              name: "host",
              type: "json",
              nullable: true,
            },
            {
              name: "form",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "fragment",
              type: "json",
              nullable: false,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__breakpoint_removal_fragments_run_id",
              columns: ["run_id"],
              unique: false,
            },
            {
              name: "idx_page_builder__breakpoint_removal_fragments_created_at",
              columns: ["created_at"],
              unique: false,
            },
            {
              name: "idx_page_builder__breakpoint_removal_fragments_run_id_d_04ki5jv",
              columns: ["run_id", "document_key"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__class_usage",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "entity",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "field",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "locale",
              type: "varchar(64)",
              nullable: false,
            },
            {
              name: "variant",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "class_id",
              type: "varchar(255)",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__class_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__class_usage_class_id",
              columns: ["class_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_usage",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "entity",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "field",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "locale",
              type: "varchar(64)",
              nullable: false,
            },
            {
              name: "variant",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "kind",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "component_id",
              type: "varchar(512)",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__component_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__component_usage_component_id",
              columns: ["component_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__token_usage",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "entity",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "field",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "locale",
              type: "varchar(64)",
              nullable: false,
            },
            {
              name: "variant",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "token_id",
              type: "varchar(512)",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__token_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__token_usage_token_id",
              columns: ["token_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_issues",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "document_key",
              type: "varchar(512)",
              nullable: false,
            },
            {
              name: "kind",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "slug",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "document_id",
              type: "varchar(255)",
              nullable: true,
            },
            {
              name: "place",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "issues",
              type: "json",
              nullable: false,
            },
            {
              name: "dirty",
              type: "char(36)",
              nullable: true,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__binding_issues_document_key",
              columns: ["document_key"],
              unique: true,
            },
            {
              name: "idx_page_builder__binding_issues_dirty",
              columns: ["dirty"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_report_runs",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "varchar(32)",
              nullable: false,
            },
            {
              name: "checked",
              type: "varchar(64)",
              nullable: true,
            },
            {
              name: "checking",
              type: "varchar(64)",
              nullable: true,
            },
            {
              name: "cursor",
              type: "json",
              nullable: true,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__binding_report_runs_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_uses",
          columns: [
            {
              name: "id",
              type: "varchar(36)",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "document_key",
              type: "varchar(512)",
              nullable: false,
            },
            {
              name: "kind",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "slug",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "document_id",
              type: "varchar(255)",
              nullable: true,
            },
            {
              name: "place",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "version",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: true,
            },
            {
              name: "blocks_field",
              type: "text",
              nullable: false,
            },
            {
              name: "node_id",
              type: "text",
              nullable: false,
            },
            {
              name: "block_type",
              type: "text",
              nullable: false,
            },
            {
              name: "block_name",
              type: "text",
              nullable: true,
            },
            {
              name: "prop",
              type: "text",
              nullable: false,
            },
            {
              name: "path",
              type: "text",
              nullable: false,
            },
            {
              name: "source_kind",
              type: "varchar(16)",
              nullable: false,
            },
            {
              name: "source_key",
              type: "varchar(255)",
              nullable: false,
            },
            {
              name: "created_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
            {
              name: "updated_at",
              type: "timestamp",
              nullable: false,
              default: "CURRENT_TIMESTAMP",
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__binding_uses_source_kind_source_key_001e79k",
              columns: ["source_kind", "source_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__binding_uses_document_key",
              columns: ["document_key"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
      ],
    },
    sqlite: {
      tables: [
        {
          name: "page_builder__usage_runs",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "text",
              nullable: false,
            },
            {
              name: "generation",
              type: "text",
              nullable: false,
            },
            {
              name: "token",
              type: "text",
              nullable: false,
            },
            {
              name: "dirty",
              type: "integer",
              nullable: false,
              default: "false",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__usage_runs_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__usage_progress",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "token",
              type: "text",
              nullable: false,
            },
            {
              name: "scope_key",
              type: "text",
              nullable: false,
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
            {
              name: "done",
              type: "integer",
              nullable: false,
              default: "false",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__usage_progress_token_scope_key_0ujeq6m",
              columns: ["token", "scope_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__layout_removals",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "layout_id",
              type: "text",
              nullable: false,
            },
            {
              name: "action",
              type: "text",
              nullable: false,
            },
            {
              name: "step",
              type: "text",
              nullable: false,
            },
            {
              name: "token",
              type: "text",
              nullable: false,
            },
            {
              name: "started_by",
              type: "text",
              nullable: true,
            },
            {
              name: "pages_left",
              type: "integer",
              nullable: true,
            },
            {
              name: "copy",
              type: "text",
              nullable: true,
            },
            {
              name: "copy_version",
              type: "text",
              nullable: true,
            },
            {
              name: "settled_at",
              type: "integer",
              nullable: true,
            },
            {
              name: "created_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
            {
              name: "updated_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__layout_removals_layout_id",
              columns: ["layout_id"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_deletions",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "component_id",
              type: "text",
              nullable: false,
            },
            {
              name: "purpose",
              type: "text",
              nullable: false,
            },
            {
              name: "started_by",
              type: "text",
              nullable: false,
            },
            {
              name: "phase",
              type: "text",
              nullable: false,
              default: "'converting'",
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__component_deletions_component_id_purpo_1mlwby6",
              columns: ["component_id", "purpose"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_deletion_hosts",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "deletion_id",
              type: "text",
              nullable: false,
            },
            {
              name: "host_key",
              type: "text",
              nullable: false,
            },
            {
              name: "state",
              type: "text",
              nullable: false,
            },
            {
              name: "reason",
              type: "text",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__component_deletion_hosts_deletion_id_h_007uo01",
              columns: ["deletion_id", "host_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__site_options",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "text",
              nullable: false,
            },
            {
              name: "value",
              type: "text",
              nullable: false,
            },
            {
              name: "created_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
            {
              name: "updated_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__site_options_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__breakpoint_removals",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "removed_ids",
              type: "text",
              nullable: false,
            },
            {
              name: "before",
              type: "text",
              nullable: false,
            },
            {
              name: "started_by",
              type: "text",
              nullable: false,
            },
            {
              name: "phase",
              type: "text",
              nullable: false,
              default: "'converting'",
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
            {
              name: "open_key",
              type: "text",
              nullable: true,
            },
            {
              name: "undoes",
              type: "text",
              nullable: true,
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__breakpoint_removals_open_key",
              columns: ["open_key"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__breakpoint_removal_fragments",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "run_id",
              type: "text",
              nullable: false,
            },
            {
              name: "document_key",
              type: "text",
              nullable: false,
            },
            {
              name: "host",
              type: "text",
              nullable: true,
            },
            {
              name: "form",
              type: "text",
              nullable: false,
            },
            {
              name: "fragment",
              type: "text",
              nullable: false,
            },
            {
              name: "created_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
            {
              name: "updated_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__breakpoint_removal_fragments_run_id",
              columns: ["run_id"],
              unique: false,
            },
            {
              name: "idx_page_builder__breakpoint_removal_fragments_created_at",
              columns: ["created_at"],
              unique: false,
            },
            {
              name: "idx_page_builder__breakpoint_removal_fragments_run_id_d_04ki5jv",
              columns: ["run_id", "document_key"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__class_usage",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "text",
              nullable: false,
            },
            {
              name: "entity",
              type: "text",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "text",
              nullable: false,
            },
            {
              name: "field",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: false,
            },
            {
              name: "variant",
              type: "text",
              nullable: false,
            },
            {
              name: "class_id",
              type: "text",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__class_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__class_usage_class_id",
              columns: ["class_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__component_usage",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "text",
              nullable: false,
            },
            {
              name: "entity",
              type: "text",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "text",
              nullable: false,
            },
            {
              name: "field",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: false,
            },
            {
              name: "variant",
              type: "text",
              nullable: false,
            },
            {
              name: "kind",
              type: "text",
              nullable: false,
            },
            {
              name: "component_id",
              type: "text",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__component_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__component_usage_component_id",
              columns: ["component_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__token_usage",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "scope",
              type: "text",
              nullable: false,
            },
            {
              name: "entity",
              type: "text",
              nullable: false,
            },
            {
              name: "entity_key",
              type: "text",
              nullable: false,
            },
            {
              name: "field",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: false,
            },
            {
              name: "variant",
              type: "text",
              nullable: false,
            },
            {
              name: "token_id",
              type: "text",
              nullable: false,
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__token_usage_entity_entity_key_178r965",
              columns: ["entity", "entity_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__token_usage_token_id",
              columns: ["token_id"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_issues",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "document_key",
              type: "text",
              nullable: false,
            },
            {
              name: "kind",
              type: "text",
              nullable: false,
            },
            {
              name: "slug",
              type: "text",
              nullable: false,
            },
            {
              name: "document_id",
              type: "text",
              nullable: true,
            },
            {
              name: "place",
              type: "text",
              nullable: false,
            },
            {
              name: "issues",
              type: "text",
              nullable: false,
            },
            {
              name: "dirty",
              type: "text",
              nullable: true,
            },
            {
              name: "created_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
            {
              name: "updated_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__binding_issues_document_key",
              columns: ["document_key"],
              unique: true,
            },
            {
              name: "idx_page_builder__binding_issues_dirty",
              columns: ["dirty"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_report_runs",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "name",
              type: "text",
              nullable: false,
            },
            {
              name: "checked",
              type: "text",
              nullable: true,
            },
            {
              name: "checking",
              type: "text",
              nullable: true,
            },
            {
              name: "cursor",
              type: "text",
              nullable: true,
            },
            {
              name: "created_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
            {
              name: "updated_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
          ],
          indexes: [
            {
              name: "uq_page_builder__binding_report_runs_name",
              columns: ["name"],
              unique: true,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
        {
          name: "page_builder__binding_uses",
          columns: [
            {
              name: "id",
              type: "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: "document_key",
              type: "text",
              nullable: false,
            },
            {
              name: "kind",
              type: "text",
              nullable: false,
            },
            {
              name: "slug",
              type: "text",
              nullable: false,
            },
            {
              name: "document_id",
              type: "text",
              nullable: true,
            },
            {
              name: "place",
              type: "text",
              nullable: false,
            },
            {
              name: "version",
              type: "text",
              nullable: false,
            },
            {
              name: "locale",
              type: "text",
              nullable: true,
            },
            {
              name: "blocks_field",
              type: "text",
              nullable: false,
            },
            {
              name: "node_id",
              type: "text",
              nullable: false,
            },
            {
              name: "block_type",
              type: "text",
              nullable: false,
            },
            {
              name: "block_name",
              type: "text",
              nullable: true,
            },
            {
              name: "prop",
              type: "text",
              nullable: false,
            },
            {
              name: "path",
              type: "text",
              nullable: false,
            },
            {
              name: "source_kind",
              type: "text",
              nullable: false,
            },
            {
              name: "source_key",
              type: "text",
              nullable: false,
            },
            {
              name: "created_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
            {
              name: "updated_at",
              type: "integer",
              nullable: false,
              default: "(strftime('%s', 'now'))",
            },
          ],
          indexes: [
            {
              name: "idx_page_builder__binding_uses_source_kind_source_key_001e79k",
              columns: ["source_kind", "source_key"],
              unique: false,
            },
            {
              name: "idx_page_builder__binding_uses_document_key",
              columns: ["document_key"],
              unique: false,
            },
          ],
          foreignKeys: [],
          checks: [],
        },
      ],
    },
  },
  contributed: {
    postgresql: {
      tables: [],
    },
    mysql: {
      tables: [],
    },
    sqlite: {
      tables: [],
    },
  },
  contributedBefore: {
    postgresql: {
      tables: [],
    },
    mysql: {
      tables: [],
    },
    sqlite: {
      tables: [],
    },
  },
} satisfies Omit<PluginMigration, "checksum">;

export default {
  ...content,
  checksum: migrationChecksum(content),
} satisfies PluginMigration as PluginMigration;
