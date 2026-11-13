

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE public.activity_log (
    id text NOT NULL,
    user_id text NOT NULL,
    actor_type text,
    user_name text,
    user_email text,
    action character varying(10) NOT NULL,
    collection character varying(255) NOT NULL,
    entry_id text,
    entry_title text,
    locale text,
    subject_kind text,
    metadata text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    identity_erased_at timestamp without time zone
);

CREATE TABLE public.api_keys (
    id text NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    key_hash character varying(64) NOT NULL,
    key_prefix character varying(16) NOT NULL,
    token_type character varying(20) NOT NULL,
    role_id text,
    user_id text NOT NULL,
    expires_at timestamp without time zone,
    last_used_at timestamp without time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.audit_log (
    id text NOT NULL,
    kind character varying(64) NOT NULL,
    actor_user_id text,
    target_user_id text,
    ip_address character varying(45),
    user_agent text,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    identity_erased_at timestamp without time zone,
    actor_kind character varying(191),
    actor_principal_kind character varying(191),
    actor_principal_id character varying(191),
    target_principal_kind character varying(191),
    target_principal_id character varying(191)
);

CREATE TABLE public.comp_seo (
    id text NOT NULL,
    _parent_id text NOT NULL,
    _parent_table character varying NOT NULL,
    _parent_field character varying NOT NULL,
    _order integer DEFAULT 0,
    _component_type character varying,
    og_image text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.comp_seo_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    meta_title text,
    meta_description text
);

CREATE TABLE public.dc_authors (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    first_published_at timestamp without time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    article_count integer,
    avatar text
);

CREATE TABLE public.dc_authors_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    bio text,
    job_title text
);

CREATE TABLE public.dc_block_pages (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    first_published_at timestamp without time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    content jsonb
);

CREATE TABLE public.dc_categories (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    description text,
    icon text
);

CREATE TABLE public.dc_components (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    first_published_at timestamp without time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    description text,
    category text,
    area text,
    content jsonb
);

CREATE TABLE public.dc_form_submissions (
    id text NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    form text,
    data jsonb NOT NULL,
    status text NOT NULL,
    spam_reason text,
    notes text,
    ip_address text,
    user_agent text,
    submitted_at timestamp without time zone NOT NULL,
    edited_at timestamp without time zone,
    edited_by text,
    response_key text
);

CREATE TABLE public.dc_forms (
    id text NOT NULL,
    title text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    fields jsonb NOT NULL,
    settings jsonb,
    notifications jsonb,
    status text NOT NULL,
    went_live_at timestamp without time zone,
    closed_message text
);

CREATE TABLE public.dc_layouts (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    first_published_at timestamp without time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    description text,
    areas jsonb
);

CREATE TABLE public.dc_nx_pb_address_claims (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    claim_key text NOT NULL,
    kind text NOT NULL,
    locale text,
    path text,
    holder_collection text,
    holder_id text,
    space text,
    blocked_by text
);

CREATE TABLE public.dc_nx_pb_class_usage (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    scope text,
    entity text,
    entity_key text,
    field text,
    locale text,
    variant text,
    class_id text
);

CREATE TABLE public.dc_nx_pb_component_retired (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    identity text NOT NULL,
    component_id text NOT NULL,
    kind text NOT NULL,
    exposure_id text NOT NULL
);

CREATE TABLE public.dc_nx_pb_component_usage (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    scope text,
    entity text,
    entity_key text,
    field text,
    locale text,
    variant text,
    kind text,
    component_id text
);

CREATE TABLE public.dc_nx_pb_usage_backfill (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    scope_key text,
    generation text
);

CREATE TABLE public.dc_pages (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    first_published_at timestamp without time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    content jsonb,
    layout text,
    no_header_footer boolean
);

CREATE TABLE public.dc_patterns (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    first_published_at timestamp without time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    description text,
    category text,
    keywords text,
    granularity text NOT NULL,
    content jsonb
);

CREATE TABLE public.dc_posts (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    first_published_at timestamp without time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    excerpt text,
    meta_title text,
    meta_description text,
    editor_mode text,
    content text,
    custom_script text,
    settings jsonb,
    sections jsonb,
    categories jsonb,
    tags jsonb,
    featured_image text,
    published_at timestamp without time zone
);

CREATE TABLE public.dc_tags (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    description text
);

CREATE TABLE public.dc_templates (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    first_published_at timestamp without time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    slug text NOT NULL,
    title text NOT NULL,
    collection text,
    entry text,
    entry_collection text,
    entry_id text,
    forked_from text,
    address text,
    content jsonb
);

CREATE TABLE public.dynamic_collections (
    id text NOT NULL,
    slug character varying(100) NOT NULL,
    labels jsonb NOT NULL,
    table_name character varying(255) NOT NULL,
    description text,
    fields jsonb NOT NULL,
    timestamps boolean DEFAULT true NOT NULL,
    status boolean DEFAULT false NOT NULL,
    localized boolean DEFAULT false NOT NULL,
    versions jsonb,
    revalidate jsonb,
    webhooks jsonb,
    admin jsonb,
    hooks jsonb,
    source character varying(255) DEFAULT 'ui'::character varying NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    config_path character varying(500),
    schema_hash character varying(64) NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    migration_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    last_migration_id character varying(100),
    created_by text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.dynamic_components (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(255) NOT NULL,
    label character varying(255) NOT NULL,
    table_name character varying(255) NOT NULL,
    description text,
    fields jsonb NOT NULL,
    admin jsonb,
    source character varying(255) DEFAULT 'ui'::character varying NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    localized boolean DEFAULT false NOT NULL,
    config_path character varying(500),
    schema_hash character varying(64) NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    migration_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    last_migration_id uuid,
    created_by uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.dynamic_singles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(255) NOT NULL,
    label character varying(255) NOT NULL,
    table_name character varying(255) NOT NULL,
    description text,
    fields jsonb NOT NULL,
    admin jsonb,
    source character varying(255) DEFAULT 'ui'::character varying NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    status boolean DEFAULT false NOT NULL,
    localized boolean DEFAULT false NOT NULL,
    versions jsonb,
    revalidate jsonb,
    webhooks jsonb,
    config_path character varying(500),
    schema_hash character varying(64) NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    migration_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    last_migration_id uuid,
    created_by uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_brand (
    id text NOT NULL,
    logo_url text,
    logo_width integer,
    accent_color text,
    background_color text,
    content_color text,
    font_family text,
    footer_text text,
    footer_links jsonb,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_id uuid,
    provider_type character varying(50) NOT NULL,
    template_slug character varying(255),
    recipient_hash character varying(64) NOT NULL,
    recipient_kind character varying(3) NOT NULL,
    status character varying(20) NOT NULL,
    attempt_count integer DEFAULT 1 NOT NULL,
    next_attempt_at timestamp with time zone,
    error text,
    message_id text,
    retention_class character varying(50) NOT NULL,
    principal_kind character varying(191),
    principal_id character varying(191),
    key_digest character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(50) NOT NULL,
    from_email character varying(255) NOT NULL,
    from_name character varying(255),
    configuration jsonb NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_queue (
    id character varying(36) NOT NULL,
    scope text NOT NULL,
    state character varying(16) NOT NULL,
    job_id character varying(36),
    message text,
    principal_kind character varying(191),
    principal_id character varying(191),
    failure text,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    settled_at bigint
);

CREATE TABLE public.email_queue_recipients (
    queued_id character varying(36) NOT NULL,
    recipient_hash character varying(64) NOT NULL,
    recipient_kind character varying(8) NOT NULL
);

CREATE TABLE public.email_send_claims (
    id character varying(36) NOT NULL,
    scope text NOT NULL,
    key_digest character varying(64),
    message_digest character varying(64),
    state character varying(16) NOT NULL,
    holder character varying(36) NOT NULL,
    result text,
    claimed_at bigint NOT NULL,
    lease_expires_at bigint NOT NULL,
    settled_at bigint
);

CREATE TABLE public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    subject text NOT NULL,
    html_content text NOT NULL,
    plain_text_content text,
    preheader text,
    kind character varying(20) DEFAULT 'template'::character varying,
    layout_id uuid,
    variables jsonb,
    use_layout boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    provider_id uuid,
    from_override text,
    reply_to text,
    cc jsonb,
    bcc jsonb,
    attachments jsonb,
    owner_kind character varying(20),
    owner_name text,
    overridden boolean,
    base_digest character varying(64),
    base_version jsonb,
    carries_secret boolean,
    description text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_verification_tokens (
    id integer NOT NULL,
    identifier text NOT NULL,
    user_id text,
    token_hash text NOT NULL,
    expires timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.email_verification_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.email_verification_tokens_id_seq OWNED BY public.email_verification_tokens.id;

CREATE TABLE public.media (
    id text NOT NULL,
    filename character varying(255) NOT NULL,
    original_filename character varying(255) NOT NULL,
    mime_type character varying(100) NOT NULL,
    size integer NOT NULL,
    width integer,
    height integer,
    duration integer,
    url text NOT NULL,
    thumbnail_url text,
    focal_x integer,
    focal_y integer,
    alt_text text,
    caption text,
    tags text[],
    folder_id text,
    uploaded_by text,
    uploaded_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.media_folders (
    id text NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    parent_id text,
    created_by text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.nextly_cache_tag_expiries (
    id character varying(64) NOT NULL,
    tag text NOT NULL,
    expired_at bigint NOT NULL
);

CREATE TABLE public.nextly_content_event_parts (
    event_id text NOT NULL,
    part character varying(35) NOT NULL
);

CREATE TABLE public.nextly_content_events (
    id text NOT NULL,
    subject_kind character varying(16) NOT NULL,
    subject_slug text,
    subject_id text NOT NULL,
    kind character varying(64) NOT NULL,
    ends_subject boolean DEFAULT false NOT NULL,
    ended_by text,
    actor_kind character varying(16) NOT NULL,
    actor_id text,
    actor_principal_kind character varying(64),
    actor_name text,
    occurred_at timestamp with time zone NOT NULL,
    from_state character varying(64),
    to_state character varying(64),
    note text,
    version_no integer,
    payload jsonb,
    definition_hash character varying(64)
);

CREATE TABLE public.nextly_dashboard_pins (
    id text NOT NULL,
    user_id text NOT NULL,
    target_type text NOT NULL,
    target_slug text NOT NULL,
    entry_id text NOT NULL,
    pinned_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_dashboard_preferences (
    id text NOT NULL,
    user_id text NOT NULL,
    preference_key character varying(64) NOT NULL,
    value character varying(255) NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_deleted_principals (
    digest character varying(64) NOT NULL,
    deleted_at timestamp without time zone NOT NULL
);

CREATE TABLE public.nextly_document_lock (
    id character varying(191) NOT NULL,
    scope_kind character varying(32) NOT NULL,
    slug character varying(191) NOT NULL,
    entry_id character varying(191) NOT NULL,
    owner_id character varying(191) NOT NULL,
    claim_token character varying(36) NOT NULL,
    owner_label character varying(255),
    acquired_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    waiting_until timestamp with time zone
);

CREATE TABLE public.nextly_events (
    id text NOT NULL,
    type character varying(100) NOT NULL,
    resource_kind character varying(20) NOT NULL,
    resource_collection character varying(255),
    resource_id text,
    payload jsonb NOT NULL,
    actor_type character varying(20),
    actor_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    fanned_out_at timestamp without time zone,
    outcome character varying(16) DEFAULT 'success'::character varying NOT NULL,
    retention_class character varying(20) DEFAULT 'webhook'::character varying NOT NULL
);

CREATE TABLE public.nextly_field_group_lock (
    id integer NOT NULL,
    owner text,
    expires_at timestamp with time zone
);

CREATE TABLE public.nextly_i18n_archive (
    id bigint NOT NULL,
    collection text NOT NULL,
    entity_kind character varying(20) DEFAULT 'unknown'::character varying NOT NULL,
    entry_id text NOT NULL,
    locale character varying(20) NOT NULL,
    field text NOT NULL,
    value text,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.nextly_i18n_archive_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.nextly_i18n_archive_id_seq OWNED BY public.nextly_i18n_archive.id;

CREATE TABLE public.nextly_jobs (
    id text NOT NULL,
    slug text NOT NULL,
    input jsonb,
    state text NOT NULL,
    run_at timestamp with time zone,
    run_as_user_id text,
    dedupe_key text,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    locked_by text,
    locked_until timestamp with time zone,
    last_error text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_languages (
    code character varying(20) NOT NULL,
    label character varying(255) NOT NULL,
    direction character varying(3) DEFAULT 'ltr'::character varying NOT NULL,
    fallback text DEFAULT '[]'::text NOT NULL,
    "position" integer NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_limit_store (
    id character varying(64) NOT NULL,
    value text,
    expires_at bigint NOT NULL,
    generation character varying(32) NOT NULL
);

CREATE TABLE public.nextly_media_usage (
    id text NOT NULL,
    media_id text NOT NULL,
    subject_kind text NOT NULL,
    subject_slug text NOT NULL,
    document_id text NOT NULL,
    field_path text NOT NULL,
    locale text NOT NULL,
    address text
);

CREATE TABLE public.nextly_meta (
    key text NOT NULL,
    value jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.nextly_migrate_lock (
    id integer NOT NULL,
    owner text NOT NULL,
    acquired_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_notices (
    id text NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    occurrence text NOT NULL,
    dedupe_key text NOT NULL,
    data jsonb,
    created_at timestamp with time zone NOT NULL,
    read_at timestamp with time zone
);

CREATE TABLE public.nextly_one_time_secrets (
    id text NOT NULL,
    owner text NOT NULL,
    purpose text NOT NULL,
    subject text NOT NULL,
    subject_key text NOT NULL,
    kind text NOT NULL,
    secret_hash text NOT NULL,
    live_key text,
    issue_seq integer,
    data text,
    expires_at timestamp without time zone NOT NULL,
    spent_at timestamp without time zone,
    voided_at timestamp without time zone,
    wrong_tries integer DEFAULT 0 NOT NULL,
    max_wrong_tries integer,
    created_at timestamp without time zone NOT NULL
);

CREATE TABLE public.nextly_plugin_event_deliveries (
    id text NOT NULL,
    event_id text NOT NULL,
    subscriber text NOT NULL,
    subscriber_key text NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp without time zone NOT NULL,
    locked_by text,
    locked_until timestamp without time zone,
    last_error text,
    created_at timestamp without time zone NOT NULL,
    finished_at timestamp without time zone
);

CREATE TABLE public.nextly_plugin_events (
    id text NOT NULL,
    owner text NOT NULL,
    name text NOT NULL,
    payload text NOT NULL,
    created_at timestamp without time zone NOT NULL,
    fanned_out_at timestamp without time zone,
    finished_at timestamp without time zone
);

CREATE TABLE public.nextly_plugin_settings (
    owner text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    is_secret boolean DEFAULT false NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    updated_by text
);

CREATE TABLE public.nextly_preview_links (
    id character varying(64) NOT NULL,
    document_kind character varying(16) NOT NULL,
    document_slug character varying(255) NOT NULL,
    entry_id character varying(255),
    locale character varying(64),
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    generation integer NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by text,
    open_count integer DEFAULT 0 NOT NULL,
    last_opened_at timestamp with time zone
);

CREATE TABLE public.nextly_rbac_epoch (
    id text NOT NULL,
    revision bigint NOT NULL,
    generation text NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_received_webhooks (
    delivery_key text NOT NULL,
    owner text NOT NULL,
    provider text NOT NULL,
    delivery_id text,
    freshness text NOT NULL,
    status text NOT NULL,
    claim_token text NOT NULL,
    lease_until timestamp without time zone,
    received_at timestamp without time zone NOT NULL,
    completed_at timestamp without time zone,
    prune_at timestamp without time zone NOT NULL
);

CREATE TABLE public.nextly_release_members (
    id text NOT NULL,
    release_id text NOT NULL,
    scope_kind text NOT NULL,
    scope_slug text NOT NULL,
    entry_id text NOT NULL,
    locale text,
    action text NOT NULL,
    member_key text NOT NULL,
    single_slot integer,
    applied_revision integer,
    created_by text,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_releases (
    id text NOT NULL,
    title text NOT NULL,
    description text,
    scheduled_at timestamp with time zone,
    timezone text,
    state text NOT NULL,
    kind text DEFAULT 'release'::text NOT NULL,
    published_at timestamp with time zone,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    revision integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.nextly_review_states (
    id text NOT NULL,
    scope_kind text NOT NULL,
    scope_slug text NOT NULL,
    entry_id text NOT NULL,
    part text,
    part_key text NOT NULL,
    stage text NOT NULL,
    entered_at timestamp with time zone NOT NULL,
    entered_by text,
    assignee_kind text,
    assignee_id text,
    due_at timestamp with time zone,
    approved_version_no integer,
    approved_digest text,
    approved_by text,
    approved_at timestamp with time zone,
    definition_hash text NOT NULL,
    revision integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_schedule_windows (
    schedule_key text NOT NULL,
    window_at timestamp with time zone NOT NULL,
    job_id text,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_schema_events (
    id text NOT NULL,
    event_type text NOT NULL,
    status text NOT NULL,
    source text NOT NULL,
    filename text,
    sha256 text,
    scope_kind text,
    scope_slug text,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    duration_ms integer,
    applied_by text,
    note text,
    statements_planned integer,
    statements_executed integer,
    renames_applied integer,
    error_code text,
    error_message text,
    error_json jsonb,
    superseded_event_ids jsonb,
    superseded_at timestamp with time zone,
    superseded_by text
);

CREATE TABLE public.nextly_schema_lock (
    id integer NOT NULL,
    owner text,
    command text,
    acquired_at timestamp with time zone,
    expires_at timestamp with time zone
);

CREATE TABLE public.nextly_schema_owners (
    table_name text NOT NULL,
    element_kind text DEFAULT 'table'::text NOT NULL,
    element_name text DEFAULT ''::text NOT NULL,
    owner_kind text NOT NULL,
    owner_id text NOT NULL,
    migrated_by text NOT NULL,
    owner_version text,
    schema_version integer,
    state text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_spent_challenges (
    id character varying(64) NOT NULL,
    expires_at bigint NOT NULL
);

CREATE TABLE public.nextly_version_pins (
    id text NOT NULL,
    scope_kind text NOT NULL,
    scope_slug text NOT NULL,
    entry_id text NOT NULL,
    holder text NOT NULL,
    slot text NOT NULL,
    version_no integer NOT NULL,
    pin_key text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_version_views (
    id text NOT NULL,
    user_id text NOT NULL,
    scope_kind text NOT NULL,
    scope_slug text NOT NULL,
    entry_id text NOT NULL,
    part text,
    view_key text NOT NULL,
    version_no integer NOT NULL,
    previous_version_no integer,
    viewed_at timestamp with time zone NOT NULL,
    visit_started_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_versions (
    id text NOT NULL,
    scope_kind text NOT NULL,
    scope_slug text NOT NULL,
    entry_id text NOT NULL,
    version_no integer,
    status text NOT NULL,
    is_autosave boolean DEFAULT false NOT NULL,
    snapshot jsonb NOT NULL,
    label text,
    locale text,
    source_version_no integer,
    draft_key text,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    base_version_no integer,
    base_draft_revision integer
);

CREATE TABLE public.nextly_webhook_deliveries (
    id text NOT NULL,
    webhook_id text NOT NULL,
    event_id text NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp without time zone,
    locked_by text,
    locked_until timestamp without time zone,
    last_status_code integer,
    last_latency_ms integer,
    last_error text,
    last_response_snippet text,
    attempts jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.nextly_webhooks (
    id text NOT NULL,
    name character varying(255) NOT NULL,
    url text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    event_types jsonb NOT NULL,
    filter jsonb,
    headers jsonb,
    secret_hash jsonb NOT NULL,
    secret_prefix character varying(16) NOT NULL,
    field_allowlist jsonb,
    created_by text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);

CREATE TABLE public.nextly_widget_layout (
    id character varying(191) NOT NULL,
    scope_kind character varying(32) NOT NULL,
    scope_id text NOT NULL,
    layout text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.nextly_workflow_settings (
    id text NOT NULL,
    workflow text NOT NULL,
    settings text NOT NULL,
    revision integer NOT NULL,
    updated_by text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.page_builder__binding_issues (
    id text NOT NULL,
    document_key text NOT NULL,
    kind text NOT NULL,
    slug text NOT NULL,
    document_id text,
    place text NOT NULL,
    issues jsonb NOT NULL,
    dirty character(36),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.page_builder__binding_report_runs (
    id text NOT NULL,
    name text NOT NULL,
    checked text,
    checking text,
    cursor jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.page_builder__breakpoint_removal_fragments (
    id text NOT NULL,
    run_id character(36) NOT NULL,
    document_key text NOT NULL,
    host jsonb,
    form text NOT NULL,
    fragment jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.page_builder__breakpoint_removals (
    id text NOT NULL,
    removed_ids text NOT NULL,
    before text NOT NULL,
    started_by text NOT NULL,
    phase text DEFAULT 'converting'::text NOT NULL,
    cursor text,
    open_key text,
    undoes character(36)
);

CREATE TABLE public.page_builder__class_usage (
    id text NOT NULL,
    scope text NOT NULL,
    entity text NOT NULL,
    entity_key text NOT NULL,
    field text NOT NULL,
    locale text NOT NULL,
    variant text NOT NULL,
    class_id text NOT NULL
);

CREATE TABLE public.page_builder__component_deletion_hosts (
    id text NOT NULL,
    deletion_id character(36) NOT NULL,
    host_key text NOT NULL,
    state text NOT NULL,
    reason text
);

CREATE TABLE public.page_builder__component_deletions (
    id text NOT NULL,
    component_id text NOT NULL,
    purpose text NOT NULL,
    started_by text NOT NULL,
    phase text DEFAULT 'converting'::text NOT NULL,
    cursor text
);

CREATE TABLE public.page_builder__component_usage (
    id text NOT NULL,
    scope text NOT NULL,
    entity text NOT NULL,
    entity_key text NOT NULL,
    field text NOT NULL,
    locale text NOT NULL,
    variant text NOT NULL,
    kind text NOT NULL,
    component_id text NOT NULL
);

CREATE TABLE public.page_builder__layout_removals (
    id text NOT NULL,
    layout_id text NOT NULL,
    action text NOT NULL,
    step text NOT NULL,
    token character(36) NOT NULL,
    started_by text,
    pages_left integer,
    copy jsonb,
    copy_version text,
    settled_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.page_builder__site_options (
    id text NOT NULL,
    name text NOT NULL,
    value text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.page_builder__token_usage (
    id text NOT NULL,
    scope text NOT NULL,
    entity text NOT NULL,
    entity_key text NOT NULL,
    field text NOT NULL,
    locale text NOT NULL,
    variant text NOT NULL,
    token_id text NOT NULL
);

CREATE TABLE public.page_builder__usage_progress (
    id text NOT NULL,
    token character(36) NOT NULL,
    scope_key text NOT NULL,
    cursor text,
    done boolean DEFAULT false NOT NULL
);

CREATE TABLE public.page_builder__usage_runs (
    id text NOT NULL,
    name text NOT NULL,
    generation text NOT NULL,
    token character(36) NOT NULL,
    dirty boolean DEFAULT false NOT NULL
);

CREATE TABLE public.password_reset_tokens (
    id integer NOT NULL,
    identifier text NOT NULL,
    user_id text,
    token_hash text NOT NULL,
    expires timestamp without time zone NOT NULL,
    used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.password_reset_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;

CREATE TABLE public.permissions (
    id text NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(100) NOT NULL,
    action character varying(50) NOT NULL,
    resource character varying(50) NOT NULL,
    description character varying(255),
    owner character varying(191),
    orphaned_at timestamp without time zone,
    permission_group character varying(191),
    danger boolean,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.refresh_tokens (
    id text NOT NULL,
    user_id text NOT NULL,
    token_hash character varying(64) NOT NULL,
    user_agent text,
    ip_address character varying(45),
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.role_inherits (
    id text NOT NULL,
    parent_role_id text NOT NULL,
    child_role_id text NOT NULL
);

CREATE TABLE public.role_permissions (
    id text NOT NULL,
    role_id text NOT NULL,
    permission_id text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.roles (
    id text NOT NULL,
    name character varying(50) NOT NULL,
    slug character varying(50) NOT NULL,
    description character varying(255),
    level integer DEFAULT 0 NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.single_announcement (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    first_published_at timestamp without time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    campaign text
);

CREATE TABLE public.single_announcement_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    headline text,
    body text
);

CREATE TABLE public.single_homepage (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    slug text NOT NULL,
    title text,
    layout jsonb
);

CREATE TABLE public.single_landing_page (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    first_published_at timestamp without time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    slug text NOT NULL,
    title text,
    hero jsonb
);

CREATE TABLE public.single_page_builder_settings (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    default_layout text,
    seeded_layout text,
    default_layout_changed_by text
);

CREATE TABLE public.single_page_builder_site_code (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    head_source text,
    body_source text,
    head jsonb,
    body jsonb,
    changed_by text
);

CREATE TABLE public.single_site_settings (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    site_name text NOT NULL
);

CREATE TABLE public.single_site_settings_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    tagline text
);

CREATE TABLE public.single_site_style (
    id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    title text NOT NULL,
    slug text NOT NULL,
    tokens jsonb,
    fonts jsonb,
    classes jsonb,
    breakpoints jsonb
);

CREATE TABLE public.site_settings (
    id text NOT NULL,
    application_name character varying(255),
    site_url character varying(2048),
    admin_email character varying(255),
    timezone character varying(100),
    date_format character varying(50),
    time_format character varying(50),
    logo_url character varying(2048),
    logo_url_dark character varying(2048),
    custom_sidebar_groups text,
    plugin_placements text,
    preview_token_generation integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_field_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    label character varying(255) NOT NULL,
    type character varying(50) NOT NULL,
    required boolean DEFAULT false NOT NULL,
    default_value character varying(255),
    options jsonb,
    plugin_options jsonb,
    has_many boolean,
    min_length integer,
    max_length integer,
    min_value double precision,
    max_value double precision,
    placeholder character varying(255),
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    source character varying(10) DEFAULT 'ui'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_invite_tokens (
    id integer NOT NULL,
    user_id text NOT NULL,
    token_hash text NOT NULL,
    expires timestamp without time zone NOT NULL,
    used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.user_invite_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.user_invite_tokens_id_seq OWNED BY public.user_invite_tokens.id;

CREATE TABLE public.user_roles (
    id text NOT NULL,
    user_id text NOT NULL,
    role_id text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone
);

CREATE TABLE public.users (
    id text NOT NULL,
    name text,
    email text NOT NULL,
    email_verified timestamp without time zone,
    email_verified_via text,
    password_updated_at timestamp without time zone,
    image text,
    interface_language text,
    password_hash text,
    is_active boolean DEFAULT false NOT NULL,
    deactivated_at timestamp without time zone,
    must_change_password boolean,
    session_epoch integer,
    failed_login_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.email_verification_tokens ALTER COLUMN id SET DEFAULT nextval('public.email_verification_tokens_id_seq'::regclass);

ALTER TABLE ONLY public.nextly_i18n_archive ALTER COLUMN id SET DEFAULT nextval('public.nextly_i18n_archive_id_seq'::regclass);

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);

ALTER TABLE ONLY public.user_invite_tokens ALTER COLUMN id SET DEFAULT nextval('public.user_invite_tokens_id_seq'::regclass);

INSERT INTO public.nextly_field_group_lock VALUES
	(1, NULL, NULL);

INSERT INTO public.nextly_meta VALUES
	('registry_record', '"{\"point\":null,\"baseline\":{\"collections\":{},\"singles\":{},\"fieldGroups\":{},\"permissions\":[]}}"', '2026-11-13 14:49:06.335+00'),
	('schema_version', '"{\"migration\":\"20261113_144903_702_create_localization_seo\",\"seq\":1}"', '2026-11-13 14:49:06.417+00'),
	('preset_grants_release', '"{\"release\":\"0.0.2-alpha.75\"}"', '2026-11-13 14:49:06.48+00');

INSERT INTO public.nextly_rbac_epoch VALUES
	('global', 6, 'aadfe7ee-ae69-415a-8892-dc31dbbe6df7', '2026-11-13 14:49:06.489+00');

INSERT INTO public.nextly_schema_events VALUES
	('b8aec49b-37a5-42cd-ad4a-43b8c0327396', 'core_apply', 'applied', 'cli-migrate', NULL, NULL, 'core', NULL, '2026-11-13 14:49:06.059+00', '2026-11-13 14:49:06.06+00', NULL, NULL, NULL, NULL, 261, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('650558ab-696a-4cae-8749-d4dd2200cd92', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261102_183408_943_create_usage_bookkeeping', '5c870a6fee243c233144409e147e1d420ee08445c71c7275108f02ff73e81eac', NULL, NULL, '2026-11-13 14:49:06.087+00', '2026-11-13 14:49:06.092+00', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('3ee02992-25d2-47a5-8e09-28c3bff56d9b', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261103_024902_454_create_layout_removals', 'b783849639cdf821af36b98effb82ed4a20ca0ca05621b9c72dce9f0eebb5231', NULL, NULL, '2026-11-13 14:49:06.112+00', '2026-11-13 14:49:06.114+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('8d221981-7dda-426d-b907-3496d946e753', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_063215_663_create_component_rewrite_runs', '55669705dcc7ca39c8975f10a6b51e5f4a566b419508a6cd6b00f9bec27b0337', NULL, NULL, '2026-11-13 14:49:06.134+00', '2026-11-13 14:49:06.137+00', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('e8158608-9ae8-4d66-bae2-9fa875056c5e', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_115414_028_create_site_options', 'b5d588d3b364de00f301087f219d0acd5d777b8f1779b5287498b26b2f41f897', NULL, NULL, '2026-11-13 14:49:06.157+00', '2026-11-13 14:49:06.159+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('c94984bb-1668-4371-86c0-3a1a62eda8ea', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261105_064012_324_create_breakpoint_removals', 'c3c9b9717e772b91c502ae3db1417f288141b7565f8a016609908370a4d1d4a8', NULL, NULL, '2026-11-13 14:49:06.18+00', '2026-11-13 14:49:06.183+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('7785b1db-406a-468c-bd68-8f77be467820', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_064828_573_create_breakpoint_removal_fragments', '2188b3de23d90100d49a761b4b970cc76f7c0d698e08ee95b2da7c49b5bcf20c', NULL, NULL, '2026-11-13 14:49:06.205+00', '2026-11-13 14:49:06.209+00', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('082466dc-95e4-424e-8481-e9196b52d171', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_084948_318_create_usage_index_tables', '261b1425453c4d00d7f267402783bb2b1456efbf33786d30144d52f16e334c7b', NULL, NULL, '2026-11-13 14:49:06.233+00', '2026-11-13 14:49:06.236+00', NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('325da7a9-24c2-4c2a-9875-fdbd0e053f9a', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_095219_741_add_breakpoint_removal_undoes', 'bd09923df56aa2b4215f555ddfc3248d6fe827ffcde1c8471f9697c86b0e029e', NULL, NULL, '2026-11-13 14:49:06.262+00', '2026-11-13 14:49:06.264+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('7d2ab760-6f07-414e-b377-b759768c610c', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_104001_085_create_token_usage_table', '677b6856df085719792fe7c9a8e7d4e8cb3deda9fd2e142556e0837cfb79baf6', NULL, NULL, '2026-11-13 14:49:06.284+00', '2026-11-13 14:49:06.287+00', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('5e71afa7-a988-47c2-9f76-a559152d2a10', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261107_174750_902_create_binding_report_tables', 'ea204e324914661b2d4e6fc1ad4fc62781a6ce8dd81add103beed79a74d89e05', NULL, NULL, '2026-11-13 14:49:06.302+00', '2026-11-13 14:49:06.305+00', NULL, NULL, NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('05efb25d-b62a-4c24-b6ff-22829a875590', 'file_apply', 'applied', 'cli-migrate', '20261113_144903_698_baseline.sql', 'd46fde765de5894e45465c14db6737f57901fceb04472b3106bfa44ebad185ac', NULL, NULL, '2026-11-13 14:49:06.376+00', '2026-11-13 14:49:06.377+00', NULL, NULL, NULL, NULL, 121, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('0217b18d-7515-4268-9ad9-3b66ccb4ac19', 'file_apply', 'applied', 'cli-migrate', '20261113_144903_699_create_localization_authors.sql', 'eed35efa712a50d64cfadac1fa8a297497d5be504ca1139ac03b505d10659298', NULL, NULL, '2026-11-13 14:49:06.387+00', '2026-11-13 14:49:06.388+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('75dac4ea-573b-4198-8bcf-b201a5125196', 'file_apply', 'applied', 'cli-migrate', '20261113_144903_700_create_localization_site-settings.sql', 'bba5df781dfd0860a9c885de9ba8647bd3b0d575d262eddc900f592b4821b86d', NULL, NULL, '2026-11-13 14:49:06.391+00', '2026-11-13 14:49:06.392+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('0376585a-414d-46e4-8914-cff4b4972932', 'file_apply', 'applied', 'cli-migrate', '20261113_144903_701_create_localization_announcement.sql', '7147face54d2b985fc967c41197d262939dbf11ae173475cfcd0e717997383c6', NULL, NULL, '2026-11-13 14:49:06.395+00', '2026-11-13 14:49:06.395+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('c3a8e8ad-d788-4e77-93c3-1c1757cbc014', 'file_apply', 'applied', 'cli-migrate', '20261113_144903_702_create_localization_seo.sql', 'b04d7b761380e69d21b09837c2044a7b3affc0f89944e833f8c58febdd4063bf', NULL, NULL, '2026-11-13 14:49:06.398+00', '2026-11-13 14:49:06.398+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO public.nextly_schema_lock VALUES
	(1, NULL, NULL, NULL, NULL);

INSERT INTO public.nextly_schema_owners VALUES
	('page_builder__component_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.238+00', '2026-11-13 14:49:06.306+00'),
	('page_builder__token_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.288+00', '2026-11-13 14:49:06.306+00'),
	('page_builder__binding_issues', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.306+00', '2026-11-13 14:49:06.306+00'),
	('page_builder__binding_report_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.306+00', '2026-11-13 14:49:06.306+00'),
	('page_builder__usage_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.094+00', '2026-11-13 14:49:06.306+00'),
	('page_builder__usage_progress', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.094+00', '2026-11-13 14:49:06.306+00'),
	('page_builder__layout_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.116+00', '2026-11-13 14:49:06.306+00'),
	('page_builder__component_deletions', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.138+00', '2026-11-13 14:49:06.306+00'),
	('page_builder__component_deletion_hosts', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.138+00', '2026-11-13 14:49:06.306+00'),
	('page_builder__site_options', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.161+00', '2026-11-13 14:49:06.306+00'),
	('page_builder__breakpoint_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.184+00', '2026-11-13 14:49:06.306+00'),
	('page_builder__breakpoint_removal_fragments', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.21+00', '2026-11-13 14:49:06.306+00'),
	('page_builder__class_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 14:49:06.238+00', '2026-11-13 14:49:06.306+00');

INSERT INTO public.permissions VALUES
	('0a5dade9-15dd-44c4-b33a-90e01ebdfec3', 'Create Users', 'create-users', 'create', 'users', 'Permission to create users', NULL, NULL, NULL, false, '2026-11-13 14:49:06.42441', '2026-11-13 14:49:06.42441'),
	('6c88140e-2092-4a3a-9e72-666f429d4ff3', 'Read Users', 'read-users', 'read', 'users', 'Permission to read users', NULL, NULL, NULL, false, '2026-11-13 14:49:06.425221', '2026-11-13 14:49:06.425221'),
	('51a08a02-3e78-4765-984e-a3d0d5f144c9', 'Update Users', 'update-users', 'update', 'users', 'Permission to update users', NULL, NULL, NULL, false, '2026-11-13 14:49:06.425901', '2026-11-13 14:49:06.425901'),
	('24f04168-12a8-4758-b0cb-5abdc92483a2', 'Delete Users', 'delete-users', 'delete', 'users', 'Permission to delete users', NULL, NULL, NULL, false, '2026-11-13 14:49:06.427709', '2026-11-13 14:49:06.427709'),
	('bc259449-8b70-4d2c-b8a8-6262014ef369', 'Create Roles', 'create-roles', 'create', 'roles', 'Permission to create roles', NULL, NULL, NULL, false, '2026-11-13 14:49:06.4283', '2026-11-13 14:49:06.4283'),
	('114eba67-6666-4120-a3ac-843dda7433b4', 'Read Roles', 'read-roles', 'read', 'roles', 'Permission to read roles', NULL, NULL, NULL, false, '2026-11-13 14:49:06.428764', '2026-11-13 14:49:06.428764'),
	('582902bb-6e5e-4fc0-8e56-e349e3e1ecc2', 'Update Roles', 'update-roles', 'update', 'roles', 'Permission to update roles', NULL, NULL, NULL, false, '2026-11-13 14:49:06.429206', '2026-11-13 14:49:06.429206'),
	('a23f270a-d1dd-45c3-a4d7-94f40defa4f4', 'Delete Roles', 'delete-roles', 'delete', 'roles', 'Permission to delete roles', NULL, NULL, NULL, false, '2026-11-13 14:49:06.42967', '2026-11-13 14:49:06.42967'),
	('3a82709e-4422-468b-8099-f6dd2bf8efec', 'Create Media', 'create-media', 'create', 'media', 'Permission to upload media files', NULL, NULL, NULL, false, '2026-11-13 14:49:06.430146', '2026-11-13 14:49:06.430146'),
	('4e7b6da6-9b3f-4244-ac6b-9517ac150b2f', 'Read Media', 'read-media', 'read', 'media', 'Permission to view media files', NULL, NULL, NULL, false, '2026-11-13 14:49:06.430686', '2026-11-13 14:49:06.430686'),
	('dc193f38-c11c-4f0e-8f64-39352e30c579', 'Update Media', 'update-media', 'update', 'media', 'Permission to edit media metadata and move files', NULL, NULL, NULL, false, '2026-11-13 14:49:06.431197', '2026-11-13 14:49:06.431197'),
	('45ba631f-3de9-4b68-87e6-132570ea7e66', 'Delete Media', 'delete-media', 'delete', 'media', 'Permission to delete media files', NULL, NULL, NULL, false, '2026-11-13 14:49:06.431687', '2026-11-13 14:49:06.431687'),
	('62f2e340-8a0c-47db-8c41-7cf345fd57e8', 'Read Settings', 'read-settings', 'read', 'settings', 'Permission to read system settings', NULL, NULL, NULL, false, '2026-11-13 14:49:06.432095', '2026-11-13 14:49:06.432095'),
	('14b771da-87b0-42d7-9f9e-b01e48537a4a', 'Create Settings', 'create-settings', 'create', 'settings', 'Permission to add settings such as user fields and field groups', NULL, NULL, NULL, false, '2026-11-13 14:49:06.432594', '2026-11-13 14:49:06.432594'),
	('7c62b5cd-26d3-4a31-9f67-13c364528ff2', 'Update Settings', 'update-settings', 'update', 'settings', 'Permission to change system settings', NULL, NULL, NULL, false, '2026-11-13 14:49:06.433001', '2026-11-13 14:49:06.433001'),
	('129cc52d-a9a7-4f29-a23a-c42319d214ed', 'Delete Settings', 'delete-settings', 'delete', 'settings', 'Permission to remove settings such as user fields and field groups', NULL, NULL, NULL, false, '2026-11-13 14:49:06.433418', '2026-11-13 14:49:06.433418'),
	('3f2e7a96-8a6e-4c83-8c5a-fc4f7c6f6723', 'Create Email Providers', 'create-email-providers', 'create', 'email-providers', 'Permission to create email providers', NULL, NULL, NULL, false, '2026-11-13 14:49:06.433828', '2026-11-13 14:49:06.433828'),
	('a478097d-a840-467e-a791-ad5bb972c235', 'Read Email Providers', 'read-email-providers', 'read', 'email-providers', 'Permission to read email providers', NULL, NULL, NULL, false, '2026-11-13 14:49:06.43438', '2026-11-13 14:49:06.43438'),
	('1b0aea6a-608f-4585-b20e-5d7faa96885b', 'Update Email Providers', 'update-email-providers', 'update', 'email-providers', 'Permission to change email providers', NULL, NULL, NULL, false, '2026-11-13 14:49:06.434799', '2026-11-13 14:49:06.434799'),
	('96f3bd0b-d5b6-40c4-9266-718fb3f130a7', 'Delete Email Providers', 'delete-email-providers', 'delete', 'email-providers', 'Permission to delete email providers', NULL, NULL, NULL, false, '2026-11-13 14:49:06.435192', '2026-11-13 14:49:06.435192'),
	('33c1c211-8db2-4900-917c-3ea148ace249', 'Create Email Templates', 'create-email-templates', 'create', 'email-templates', 'Permission to create email templates', NULL, NULL, NULL, false, '2026-11-13 14:49:06.435677', '2026-11-13 14:49:06.435677'),
	('68d49cd9-eae4-4db0-80d2-2ab5b785b123', 'Read Email Templates', 'read-email-templates', 'read', 'email-templates', 'Permission to read email templates', NULL, NULL, NULL, false, '2026-11-13 14:49:06.436086', '2026-11-13 14:49:06.436086'),
	('91c8bb7b-5d9c-43f2-87a4-d968d6dbd3d7', 'Update Email Templates', 'update-email-templates', 'update', 'email-templates', 'Permission to change email templates', NULL, NULL, NULL, false, '2026-11-13 14:49:06.436532', '2026-11-13 14:49:06.436532'),
	('a3e6e716-2292-4dc9-b924-146a65c7b2dc', 'Delete Email Templates', 'delete-email-templates', 'delete', 'email-templates', 'Permission to delete email templates', NULL, NULL, NULL, false, '2026-11-13 14:49:06.436953', '2026-11-13 14:49:06.436953'),
	('7abfea01-7358-413f-b90e-f28118421e3a', 'Update API Keys', 'update-api-keys', 'update', 'api-keys', 'Permission to update API keys', NULL, NULL, NULL, false, '2026-11-13 14:49:06.437406', '2026-11-13 14:49:06.437406'),
	('95464ffe-ce4b-459f-953e-0be5cf244a28', 'Create API Keys', 'create-api-keys', 'create', 'api-keys', 'Permission to create API keys', NULL, NULL, NULL, false, '2026-11-13 14:49:06.438001', '2026-11-13 14:49:06.438001'),
	('2893d08d-ea21-4975-a011-2a5b5c17c54e', 'Read API Keys', 'read-api-keys', 'read', 'api-keys', 'Permission to read API keys', NULL, NULL, NULL, false, '2026-11-13 14:49:06.438433', '2026-11-13 14:49:06.438433'),
	('bdc62ed6-e459-4c63-84a2-86908112292d', 'Delete API Keys', 'delete-api-keys', 'delete', 'api-keys', 'Permission to delete API keys', NULL, NULL, NULL, false, '2026-11-13 14:49:06.43884', '2026-11-13 14:49:06.43884'),
	('fb2050d5-eadb-4dab-8fe2-faddf4a0ad86', 'Update Webhooks', 'update-webhooks', 'update', 'webhooks', 'Permission to update webhook endpoints', NULL, NULL, NULL, false, '2026-11-13 14:49:06.439211', '2026-11-13 14:49:06.439211'),
	('c862b3e7-91e3-4ff6-9b65-f6f20e45e07c', 'Create Webhooks', 'create-webhooks', 'create', 'webhooks', 'Permission to register webhook endpoints', NULL, NULL, NULL, false, '2026-11-13 14:49:06.439618', '2026-11-13 14:49:06.439618'),
	('20da83f6-a653-439d-81f9-f2631ae1f0b8', 'Read Webhooks', 'read-webhooks', 'read', 'webhooks', 'Permission to view webhook endpoints', NULL, NULL, NULL, false, '2026-11-13 14:49:06.440033', '2026-11-13 14:49:06.440033'),
	('0d943b5b-f8b0-4ba7-a33d-7896bb99a58e', 'Delete Webhooks', 'delete-webhooks', 'delete', 'webhooks', 'Permission to delete webhook endpoints', NULL, NULL, NULL, false, '2026-11-13 14:49:06.440453', '2026-11-13 14:49:06.440453'),
	('a93ce286-7bdd-4fc2-be5f-1e86fc48debf', 'Read Releases', 'read-content-releases', 'read', 'content-releases', 'Permission to view content releases and their members', NULL, NULL, NULL, false, '2026-11-13 14:49:06.440848', '2026-11-13 14:49:06.440848'),
	('18062f7d-4469-4727-a0c7-0e74e57443d9', 'Create Releases', 'create-content-releases', 'create', 'content-releases', 'Permission to create a content release and choose its members', NULL, NULL, NULL, false, '2026-11-13 14:49:06.441258', '2026-11-13 14:49:06.441258'),
	('e8d0706f-cdb4-4e3f-98ab-f39fa3fcbb75', 'Publish Releases', 'publish-content-releases', 'publish', 'content-releases', 'Permission to schedule or cancel a content release, which is what makes its content go live', NULL, NULL, NULL, false, '2026-11-13 14:49:06.441664', '2026-11-13 14:49:06.441664'),
	('7ff33c67-00fb-40a4-bced-0343a8d3661d', 'Update Releases', 'update-content-releases', 'update', 'content-releases', 'Permission to rename a content release and change its description', NULL, NULL, NULL, false, '2026-11-13 14:49:06.443416', '2026-11-13 14:49:06.443416'),
	('7b4eb89e-2977-485c-b73e-9dd1503b4d67', 'Delete Releases', 'delete-content-releases', 'delete', 'content-releases', 'Permission to delete a draft or cancelled content release; one that is scheduled, stopped or published stays', NULL, NULL, NULL, false, '2026-11-13 14:49:06.444829', '2026-11-13 14:49:06.444829'),
	('5e4e6d94-ddb2-4eba-80e5-59be181e8690', 'Manage Background Jobs', 'manage-background-jobs', 'manage', 'background-jobs', 'Permission to run the background job queue by hand, outside its schedule', NULL, NULL, NULL, false, '2026-11-13 14:49:06.44593', '2026-11-13 14:49:06.44593'),
	('bb0a68de-81f9-4956-820a-3f8836ae25e8', 'Manage page builder site settings', 'manage-page-builder-site', 'manage', 'page-builder-site', 'Change the site''s breakpoints, and choose its default Layout.', '@nextlyhq/plugin-page-builder', NULL, 'General', false, '2026-11-13 14:49:06.452754', '2026-11-13 14:49:06.452754'),
	('ebb41ee7-7650-4449-b15b-c59c740a2be1', 'Lock shared styles', 'lock-page-builder-shared-styles', 'lock', 'page-builder-shared-styles', 'Lock and unlock the site''s shared styles. A locked style can''t be changed, renamed or removed.', '@nextlyhq/plugin-page-builder', NULL, 'General', false, '2026-11-13 14:49:06.453825', '2026-11-13 14:49:06.453825'),
	('39a7f26d-1d69-4031-a7b8-e4efb951feb9', 'Manage template routing', 'manage-template-routing', 'manage', 'template-routing', 'Set or change the address a collection''s entries are served at. A change moves every entry''s live address.', '@nextlyhq/plugin-page-builder', NULL, 'General', false, '2026-11-13 14:49:06.455392', '2026-11-13 14:49:06.455392'),
	('7319a767-9dcd-4ede-9c86-101624289bc0', 'Export Submissions', 'export-submissions', 'export', 'submissions', 'Export form submissions as CSV/JSON', '@nextlyhq/plugin-form-builder', NULL, 'General', true, '2026-11-13 14:49:06.45628', '2026-11-13 14:49:06.45628');

INSERT INTO public.role_permissions VALUES
	('3a85872e-a853-4169-a6fd-66069664095f', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '2893d08d-ea21-4975-a011-2a5b5c17c54e', '2026-11-13 14:49:06.468818'),
	('710cf415-17e5-4546-949e-c9749e8c8136', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '7abfea01-7358-413f-b90e-f28118421e3a', '2026-11-13 14:49:06.468818'),
	('6ad7f378-21a5-4d9c-a8b7-92b2e4fcb8b1', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '95464ffe-ce4b-459f-953e-0be5cf244a28', '2026-11-13 14:49:06.468818'),
	('cae83a6d-50bc-493e-a238-f8251013df8b', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', 'bdc62ed6-e459-4c63-84a2-86908112292d', '2026-11-13 14:49:06.468818'),
	('03700e1f-b357-457f-955d-a71d728001be', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '5e4e6d94-ddb2-4eba-80e5-59be181e8690', '2026-11-13 14:49:06.468818'),
	('54943bfb-3b7b-419e-9cab-6b54ee7967c2', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '18062f7d-4469-4727-a0c7-0e74e57443d9', '2026-11-13 14:49:06.468818'),
	('959ff638-8994-42b0-903d-c76452d1176c', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '7b4eb89e-2977-485c-b73e-9dd1503b4d67', '2026-11-13 14:49:06.468818'),
	('8d9519cf-151f-410a-bc02-45c7f9d54f73', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '7ff33c67-00fb-40a4-bced-0343a8d3661d', '2026-11-13 14:49:06.468818'),
	('2d25c722-1e60-4486-b9b2-1310c7d4c1f9', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', 'a93ce286-7bdd-4fc2-be5f-1e86fc48debf', '2026-11-13 14:49:06.468818'),
	('cbf6652f-2b19-44b1-b85e-fc6463b5c5f7', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', 'e8d0706f-cdb4-4e3f-98ab-f39fa3fcbb75', '2026-11-13 14:49:06.468818'),
	('373e7c0a-65d5-4395-a618-d720b6f041ed', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '1b0aea6a-608f-4585-b20e-5d7faa96885b', '2026-11-13 14:49:06.468818'),
	('61b4772f-e143-4d4a-8f1b-0002d02bb3f0', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '3f2e7a96-8a6e-4c83-8c5a-fc4f7c6f6723', '2026-11-13 14:49:06.468818'),
	('fd467606-cbc2-4282-be6c-ffb7d731fe60', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '96f3bd0b-d5b6-40c4-9266-718fb3f130a7', '2026-11-13 14:49:06.468818'),
	('2b8ca6c6-4487-49fb-8740-8ca1a7fdfb6f', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', 'a478097d-a840-467e-a791-ad5bb972c235', '2026-11-13 14:49:06.468818'),
	('4f1acf00-accb-4c67-a94a-b3b54b5e1ed2', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '33c1c211-8db2-4900-917c-3ea148ace249', '2026-11-13 14:49:06.468818'),
	('0c0369b0-b52d-45ce-8447-5d27b75a3957', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '68d49cd9-eae4-4db0-80d2-2ab5b785b123', '2026-11-13 14:49:06.468818'),
	('b60d0656-4248-472a-91a6-7b93d4d5e1a8', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '91c8bb7b-5d9c-43f2-87a4-d968d6dbd3d7', '2026-11-13 14:49:06.468818'),
	('1fbc8544-cf8f-4228-bf2e-196366c75664', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', 'a3e6e716-2292-4dc9-b924-146a65c7b2dc', '2026-11-13 14:49:06.468818'),
	('fd6a8a62-0a2b-49df-9120-d1ca5bea0179', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '3a82709e-4422-468b-8099-f6dd2bf8efec', '2026-11-13 14:49:06.468818'),
	('a788cce5-e813-4ba8-b856-c2b416bf6dbc', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '45ba631f-3de9-4b68-87e6-132570ea7e66', '2026-11-13 14:49:06.468818'),
	('2f5fb632-cd20-4039-83a9-124442fd8c65', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '4e7b6da6-9b3f-4244-ac6b-9517ac150b2f', '2026-11-13 14:49:06.468818'),
	('3f7171d4-b368-40fa-91f5-82933c7ed89c', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', 'dc193f38-c11c-4f0e-8f64-39352e30c579', '2026-11-13 14:49:06.468818'),
	('f58621b0-666c-41d4-b600-b5a88b03d073', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', 'ebb41ee7-7650-4449-b15b-c59c740a2be1', '2026-11-13 14:49:06.468818'),
	('337ee121-6870-44f7-9223-218aa346b78f', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', 'bb0a68de-81f9-4956-820a-3f8836ae25e8', '2026-11-13 14:49:06.468818'),
	('26083f52-bb40-419c-b86d-d0e1cacc00f2', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '114eba67-6666-4120-a3ac-843dda7433b4', '2026-11-13 14:49:06.468818'),
	('df557782-7f1f-429c-9116-10b6c6f957da', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '129cc52d-a9a7-4f29-a23a-c42319d214ed', '2026-11-13 14:49:06.468818'),
	('f72d9256-7cbb-43be-a1e6-8ac14a19118a', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '14b771da-87b0-42d7-9f9e-b01e48537a4a', '2026-11-13 14:49:06.468818'),
	('abde43da-7751-4515-842f-0c96b84c48ff', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '62f2e340-8a0c-47db-8c41-7cf345fd57e8', '2026-11-13 14:49:06.468818'),
	('5733d5ce-3140-4e81-a213-92802ff6a4bf', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '7c62b5cd-26d3-4a31-9f67-13c364528ff2', '2026-11-13 14:49:06.468818'),
	('6ff38436-289f-4f91-9c4b-bb34b7fc2e35', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '7319a767-9dcd-4ede-9c86-101624289bc0', '2026-11-13 14:49:06.468818'),
	('f9618023-61a1-4930-bdb2-cd3ef0b36421', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '39a7f26d-1d69-4031-a7b8-e4efb951feb9', '2026-11-13 14:49:06.468818'),
	('5feaf26c-797c-4055-90a5-4b7be1e58284', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '6c88140e-2092-4a3a-9e72-666f429d4ff3', '2026-11-13 14:49:06.468818'),
	('b5623cbb-fa42-4a70-8299-445b6826c855', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '0d943b5b-f8b0-4ba7-a33d-7896bb99a58e', '2026-11-13 14:49:06.468818'),
	('402456da-7e8e-4a4a-b79b-07f5f6c58b1e', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', '20da83f6-a653-439d-81f9-f2631ae1f0b8', '2026-11-13 14:49:06.468818'),
	('d32000b9-871d-4ca2-b870-5f665609c10b', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', 'c862b3e7-91e3-4ff6-9b65-f6f20e45e07c', '2026-11-13 14:49:06.468818'),
	('7231a79b-6d20-4278-9d03-ac88c59d65bd', 'ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', 'fb2050d5-eadb-4dab-8fe2-faddf4a0ad86', '2026-11-13 14:49:06.468818'),
	('752d15b4-b587-458f-869f-82b4db5ebcc9', '3089fee9-4b96-4ba7-990e-05cbf82d3cab', '3a82709e-4422-468b-8099-f6dd2bf8efec', '2026-11-13 14:49:06.468818'),
	('4a62110d-f088-47d6-ac92-baa91d4603f3', '3089fee9-4b96-4ba7-990e-05cbf82d3cab', '45ba631f-3de9-4b68-87e6-132570ea7e66', '2026-11-13 14:49:06.468818'),
	('2baf4aff-6b51-4e4b-9898-eb82fab585f1', '3089fee9-4b96-4ba7-990e-05cbf82d3cab', '4e7b6da6-9b3f-4244-ac6b-9517ac150b2f', '2026-11-13 14:49:06.468818'),
	('0030e12f-9ccb-48f5-ba37-90deb1673000', '3089fee9-4b96-4ba7-990e-05cbf82d3cab', 'dc193f38-c11c-4f0e-8f64-39352e30c579', '2026-11-13 14:49:06.468818'),
	('b292988a-0cfa-4468-a7e2-2860597db3c2', '444d2d1a-b2c6-427a-81a9-03694127bd58', '3a82709e-4422-468b-8099-f6dd2bf8efec', '2026-11-13 14:49:06.468818'),
	('bca27096-611b-4070-ab5a-e4f104c3c8d6', '444d2d1a-b2c6-427a-81a9-03694127bd58', '4e7b6da6-9b3f-4244-ac6b-9517ac150b2f', '2026-11-13 14:49:06.468818'),
	('53d0e1ce-d05c-4f3d-972d-11f97a20e9bb', '444d2d1a-b2c6-427a-81a9-03694127bd58', 'dc193f38-c11c-4f0e-8f64-39352e30c579', '2026-11-13 14:49:06.468818'),
	('b540bd76-b352-43cf-81f5-b74517b2502b', 'bfe09b42-e0fa-46da-a4ac-d88da585832f', '2893d08d-ea21-4975-a011-2a5b5c17c54e', '2026-11-13 14:49:06.468818'),
	('71f5f7d5-7798-4508-bce6-1f1aee0409cb', 'bfe09b42-e0fa-46da-a4ac-d88da585832f', 'a93ce286-7bdd-4fc2-be5f-1e86fc48debf', '2026-11-13 14:49:06.468818'),
	('072b7b6e-273b-43ff-85de-4b48161af5a1', 'bfe09b42-e0fa-46da-a4ac-d88da585832f', 'a478097d-a840-467e-a791-ad5bb972c235', '2026-11-13 14:49:06.468818'),
	('febf7b27-0b61-4f1b-b705-351c7090ada1', 'bfe09b42-e0fa-46da-a4ac-d88da585832f', '68d49cd9-eae4-4db0-80d2-2ab5b785b123', '2026-11-13 14:49:06.468818'),
	('5fe313f1-55a7-4a1d-ba93-397cb60ef3b4', 'bfe09b42-e0fa-46da-a4ac-d88da585832f', '4e7b6da6-9b3f-4244-ac6b-9517ac150b2f', '2026-11-13 14:49:06.468818'),
	('46678b5b-1d6d-4e02-ae5d-97cc4b597fec', 'bfe09b42-e0fa-46da-a4ac-d88da585832f', '114eba67-6666-4120-a3ac-843dda7433b4', '2026-11-13 14:49:06.468818'),
	('8e05bd02-f4e2-475b-ac79-6611773c070f', 'bfe09b42-e0fa-46da-a4ac-d88da585832f', '62f2e340-8a0c-47db-8c41-7cf345fd57e8', '2026-11-13 14:49:06.468818'),
	('9f1ba41e-c04d-459e-badf-28a241657472', 'bfe09b42-e0fa-46da-a4ac-d88da585832f', '6c88140e-2092-4a3a-9e72-666f429d4ff3', '2026-11-13 14:49:06.468818'),
	('f4701691-3419-4c5a-b874-652653c0669c', 'bfe09b42-e0fa-46da-a4ac-d88da585832f', '20da83f6-a653-439d-81f9-f2631ae1f0b8', '2026-11-13 14:49:06.468818');

INSERT INTO public.roles VALUES
	('ff90a258-2d0e-46f7-bf9d-52bb5799dbbe', 'Admin', 'admin', 'Everything except granting access to others', 90, true, '2026-11-13 14:49:06.468818', '2026-11-13 14:49:06.468818'),
	('3089fee9-4b96-4ba7-990e-05cbf82d3cab', 'Editor', 'editor', 'Full control of content and media, including publishing', 50, true, '2026-11-13 14:49:06.468818', '2026-11-13 14:49:06.468818'),
	('444d2d1a-b2c6-427a-81a9-03694127bd58', 'Author', 'author', 'Write content, but not publish or delete it', 30, true, '2026-11-13 14:49:06.468818', '2026-11-13 14:49:06.468818'),
	('bfe09b42-e0fa-46da-a4ac-d88da585832f', 'Viewer', 'viewer', 'Read everything, change nothing', 10, true, '2026-11-13 14:49:06.468818', '2026-11-13 14:49:06.468818');

SELECT pg_catalog.setval('public.email_verification_tokens_id_seq', 1, false);

SELECT pg_catalog.setval('public.nextly_i18n_archive_id_seq', 1, false);

SELECT pg_catalog.setval('public.password_reset_tokens_id_seq', 1, false);

SELECT pg_catalog.setval('public.user_invite_tokens_id_seq', 1, false);

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.comp_seo_locales
    ADD CONSTRAINT comp_seo_locales_pkey PRIMARY KEY (_parent, _locale);

ALTER TABLE ONLY public.comp_seo
    ADD CONSTRAINT comp_seo_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_authors_locales
    ADD CONSTRAINT dc_authors_locales_pkey PRIMARY KEY (_parent, _locale);

ALTER TABLE ONLY public.dc_authors
    ADD CONSTRAINT dc_authors_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_block_pages
    ADD CONSTRAINT dc_block_pages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_categories
    ADD CONSTRAINT dc_categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_components
    ADD CONSTRAINT dc_components_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_form_submissions
    ADD CONSTRAINT dc_form_submissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_forms
    ADD CONSTRAINT dc_forms_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_layouts
    ADD CONSTRAINT dc_layouts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_nx_pb_address_claims
    ADD CONSTRAINT dc_nx_pb_address_claims_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_nx_pb_class_usage
    ADD CONSTRAINT dc_nx_pb_class_usage_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_nx_pb_component_retired
    ADD CONSTRAINT dc_nx_pb_component_retired_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_nx_pb_component_usage
    ADD CONSTRAINT dc_nx_pb_component_usage_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_nx_pb_usage_backfill
    ADD CONSTRAINT dc_nx_pb_usage_backfill_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_pages
    ADD CONSTRAINT dc_pages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_patterns
    ADD CONSTRAINT dc_patterns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_posts
    ADD CONSTRAINT dc_posts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_tags
    ADD CONSTRAINT dc_tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dc_templates
    ADD CONSTRAINT dc_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dynamic_collections
    ADD CONSTRAINT dynamic_collections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dynamic_collections
    ADD CONSTRAINT dynamic_collections_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.dynamic_collections
    ADD CONSTRAINT dynamic_collections_table_name_key UNIQUE (table_name);

ALTER TABLE ONLY public.dynamic_components
    ADD CONSTRAINT dynamic_components_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dynamic_components
    ADD CONSTRAINT dynamic_components_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.dynamic_components
    ADD CONSTRAINT dynamic_components_table_name_key UNIQUE (table_name);

ALTER TABLE ONLY public.dynamic_singles
    ADD CONSTRAINT dynamic_singles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dynamic_singles
    ADD CONSTRAINT dynamic_singles_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.dynamic_singles
    ADD CONSTRAINT dynamic_singles_table_name_key UNIQUE (table_name);

ALTER TABLE ONLY public.email_brand
    ADD CONSTRAINT email_brand_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_providers
    ADD CONSTRAINT email_providers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_queue_recipients
    ADD CONSTRAINT email_queue_recipients_pkey PRIMARY KEY (queued_id, recipient_hash);

ALTER TABLE ONLY public.email_send_claims
    ADD CONSTRAINT email_send_claims_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.media_folders
    ADD CONSTRAINT media_folders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_cache_tag_expiries
    ADD CONSTRAINT nextly_cache_tag_expiries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_content_event_parts
    ADD CONSTRAINT nextly_content_event_parts_pkey PRIMARY KEY (event_id, part);

ALTER TABLE ONLY public.nextly_content_events
    ADD CONSTRAINT nextly_content_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_dashboard_pins
    ADD CONSTRAINT nextly_dashboard_pins_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_dashboard_preferences
    ADD CONSTRAINT nextly_dashboard_preferences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_deleted_principals
    ADD CONSTRAINT nextly_deleted_principals_pkey PRIMARY KEY (digest);

ALTER TABLE ONLY public.nextly_document_lock
    ADD CONSTRAINT nextly_document_lock_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_events
    ADD CONSTRAINT nextly_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_field_group_lock
    ADD CONSTRAINT nextly_field_group_lock_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_i18n_archive
    ADD CONSTRAINT nextly_i18n_archive_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_jobs
    ADD CONSTRAINT nextly_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_languages
    ADD CONSTRAINT nextly_languages_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.nextly_limit_store
    ADD CONSTRAINT nextly_limit_store_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_media_usage
    ADD CONSTRAINT nextly_media_usage_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_meta
    ADD CONSTRAINT nextly_meta_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.nextly_migrate_lock
    ADD CONSTRAINT nextly_migrate_lock_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_notices
    ADD CONSTRAINT nextly_notices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_one_time_secrets
    ADD CONSTRAINT nextly_one_time_secrets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_plugin_event_deliveries
    ADD CONSTRAINT nextly_plugin_event_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_plugin_events
    ADD CONSTRAINT nextly_plugin_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_plugin_settings
    ADD CONSTRAINT nextly_plugin_settings_pkey PRIMARY KEY (owner, key);

ALTER TABLE ONLY public.nextly_preview_links
    ADD CONSTRAINT nextly_preview_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_rbac_epoch
    ADD CONSTRAINT nextly_rbac_epoch_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_received_webhooks
    ADD CONSTRAINT nextly_received_webhooks_pkey PRIMARY KEY (delivery_key);

ALTER TABLE ONLY public.nextly_release_members
    ADD CONSTRAINT nextly_release_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_releases
    ADD CONSTRAINT nextly_releases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_review_states
    ADD CONSTRAINT nextly_review_states_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_schedule_windows
    ADD CONSTRAINT nextly_schedule_windows_pkey PRIMARY KEY (schedule_key, window_at);

ALTER TABLE ONLY public.nextly_schema_events
    ADD CONSTRAINT nextly_schema_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_schema_lock
    ADD CONSTRAINT nextly_schema_lock_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_schema_owners
    ADD CONSTRAINT nextly_schema_owners_pkey PRIMARY KEY (table_name, element_kind, element_name);

ALTER TABLE ONLY public.nextly_spent_challenges
    ADD CONSTRAINT nextly_spent_challenges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_version_pins
    ADD CONSTRAINT nextly_version_pins_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_version_views
    ADD CONSTRAINT nextly_version_views_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_versions
    ADD CONSTRAINT nextly_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_webhook_deliveries
    ADD CONSTRAINT nextly_webhook_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_webhooks
    ADD CONSTRAINT nextly_webhooks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_widget_layout
    ADD CONSTRAINT nextly_widget_layout_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nextly_workflow_settings
    ADD CONSTRAINT nextly_workflow_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__binding_issues
    ADD CONSTRAINT page_builder__binding_issues_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__binding_report_runs
    ADD CONSTRAINT page_builder__binding_report_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__breakpoint_removal_fragments
    ADD CONSTRAINT page_builder__breakpoint_removal_fragments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__breakpoint_removals
    ADD CONSTRAINT page_builder__breakpoint_removals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__class_usage
    ADD CONSTRAINT page_builder__class_usage_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__component_deletion_hosts
    ADD CONSTRAINT page_builder__component_deletion_hosts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__component_deletions
    ADD CONSTRAINT page_builder__component_deletions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__component_usage
    ADD CONSTRAINT page_builder__component_usage_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__layout_removals
    ADD CONSTRAINT page_builder__layout_removals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__site_options
    ADD CONSTRAINT page_builder__site_options_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__token_usage
    ADD CONSTRAINT page_builder__token_usage_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__usage_progress
    ADD CONSTRAINT page_builder__usage_progress_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.page_builder__usage_runs
    ADD CONSTRAINT page_builder__usage_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.role_inherits
    ADD CONSTRAINT role_inherits_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.single_announcement_locales
    ADD CONSTRAINT single_announcement_locales_pkey PRIMARY KEY (_parent, _locale);

ALTER TABLE ONLY public.single_announcement
    ADD CONSTRAINT single_announcement_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.single_homepage
    ADD CONSTRAINT single_homepage_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.single_landing_page
    ADD CONSTRAINT single_landing_page_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.single_page_builder_settings
    ADD CONSTRAINT single_page_builder_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.single_page_builder_site_code
    ADD CONSTRAINT single_page_builder_site_code_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.single_site_settings_locales
    ADD CONSTRAINT single_site_settings_locales_pkey PRIMARY KEY (_parent, _locale);

ALTER TABLE ONLY public.single_site_settings
    ADD CONSTRAINT single_site_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.single_site_style
    ADD CONSTRAINT single_site_style_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_field_definitions
    ADD CONSTRAINT user_field_definitions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_invite_tokens
    ADD CONSTRAINT user_invite_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX api_keys_is_active_expires_at_idx ON public.api_keys USING btree (is_active, expires_at);

CREATE UNIQUE INDEX api_keys_key_hash_unique ON public.api_keys USING btree (key_hash);

CREATE INDEX api_keys_role_id_idx ON public.api_keys USING btree (role_id);

CREATE INDEX api_keys_user_id_idx ON public.api_keys USING btree (user_id);

CREATE INDEX audit_log_actor_principal_idx ON public.audit_log USING btree (actor_principal_kind, actor_principal_id);

CREATE INDEX audit_log_actor_user_id_idx ON public.audit_log USING btree (actor_user_id);

CREATE INDEX audit_log_created_at_idx ON public.audit_log USING btree (created_at);

CREATE INDEX audit_log_kind_idx ON public.audit_log USING btree (kind);

CREATE INDEX audit_log_target_principal_idx ON public.audit_log USING btree (target_principal_kind, target_principal_id);

CREATE INDEX audit_log_target_user_id_idx ON public.audit_log USING btree (target_user_id);

CREATE INDEX dynamic_collections_created_at_idx ON public.dynamic_collections USING btree (created_at);

CREATE INDEX dynamic_collections_created_by_idx ON public.dynamic_collections USING btree (created_by);

CREATE INDEX dynamic_collections_migration_status_idx ON public.dynamic_collections USING btree (migration_status);

CREATE INDEX dynamic_collections_source_idx ON public.dynamic_collections USING btree (source);

CREATE INDEX dynamic_collections_updated_at_idx ON public.dynamic_collections USING btree (updated_at);

CREATE INDEX dynamic_components_created_at_idx ON public.dynamic_components USING btree (created_at);

CREATE INDEX dynamic_components_created_by_idx ON public.dynamic_components USING btree (created_by);

CREATE INDEX dynamic_components_migration_status_idx ON public.dynamic_components USING btree (migration_status);

CREATE INDEX dynamic_components_source_idx ON public.dynamic_components USING btree (source);

CREATE INDEX dynamic_components_updated_at_idx ON public.dynamic_components USING btree (updated_at);

CREATE INDEX dynamic_singles_created_at_idx ON public.dynamic_singles USING btree (created_at);

CREATE INDEX dynamic_singles_created_by_idx ON public.dynamic_singles USING btree (created_by);

CREATE INDEX dynamic_singles_migration_status_idx ON public.dynamic_singles USING btree (migration_status);

CREATE INDEX dynamic_singles_source_idx ON public.dynamic_singles USING btree (source);

CREATE INDEX dynamic_singles_updated_at_idx ON public.dynamic_singles USING btree (updated_at);

CREATE INDEX email_deliveries_created_idx ON public.email_deliveries USING btree (created_at);

CREATE INDEX email_deliveries_key_idx ON public.email_deliveries USING btree (key_digest);

CREATE INDEX email_deliveries_principal_idx ON public.email_deliveries USING btree (principal_kind, principal_id);

CREATE INDEX email_deliveries_provider_idx ON public.email_deliveries USING btree (provider_id, created_at);

CREATE INDEX email_deliveries_recipient_idx ON public.email_deliveries USING btree (recipient_hash, created_at);

CREATE INDEX email_deliveries_retention_idx ON public.email_deliveries USING btree (retention_class, created_at);

CREATE INDEX email_deliveries_status_created_idx ON public.email_deliveries USING btree (status, created_at);

CREATE INDEX email_providers_created_at_idx ON public.email_providers USING btree (created_at);

CREATE UNIQUE INDEX email_providers_default_unique_idx ON public.email_providers USING btree (is_default) WHERE (is_default = true);

CREATE INDEX email_providers_is_active_idx ON public.email_providers USING btree (is_active);

CREATE INDEX email_providers_type_idx ON public.email_providers USING btree (type);

CREATE INDEX email_queue_principal_idx ON public.email_queue USING btree (principal_kind, principal_id);

CREATE INDEX email_queue_recipients_hash_idx ON public.email_queue_recipients USING btree (recipient_hash);

CREATE INDEX email_queue_state_idx ON public.email_queue USING btree (state, settled_at);

CREATE UNIQUE INDEX email_send_claims_key_idx ON public.email_send_claims USING btree (key_digest);

CREATE INDEX email_send_claims_lease_idx ON public.email_send_claims USING btree (lease_expires_at);

CREATE INDEX email_send_claims_state_idx ON public.email_send_claims USING btree (state, settled_at);

CREATE INDEX email_templates_created_at_idx ON public.email_templates USING btree (created_at);

CREATE INDEX email_templates_is_active_idx ON public.email_templates USING btree (is_active);

CREATE INDEX email_templates_kind_idx ON public.email_templates USING btree (kind);

CREATE INDEX email_templates_layout_id_idx ON public.email_templates USING btree (layout_id);

CREATE INDEX email_templates_provider_id_idx ON public.email_templates USING btree (provider_id);

CREATE INDEX evt_expires_idx ON public.email_verification_tokens USING btree (expires);

CREATE UNIQUE INDEX evt_identifier_token_hash_unique ON public.email_verification_tokens USING btree (identifier, token_hash);

CREATE INDEX evt_token_hash_idx ON public.email_verification_tokens USING btree (token_hash);

CREATE INDEX evt_user_id_idx ON public.email_verification_tokens USING btree (user_id);

CREATE INDEX idx_activity_log_collection ON public.activity_log USING btree (collection, created_at);

CREATE INDEX idx_activity_log_created_at ON public.activity_log USING btree (created_at);

CREATE INDEX idx_activity_log_user_id ON public.activity_log USING btree (user_id, created_at);

CREATE INDEX idx_comp_seo_created_at ON public.comp_seo USING btree (created_at);

CREATE INDEX idx_comp_seo_og_image ON public.comp_seo USING btree (og_image);

CREATE INDEX idx_comp_seo_parent ON public.comp_seo USING btree (_parent_id, _parent_table, _parent_field);

CREATE INDEX idx_dc_authors_avatar ON public.dc_authors USING btree (avatar);

CREATE INDEX idx_dc_authors_created_at ON public.dc_authors USING btree (created_at);

CREATE INDEX idx_dc_authors_created_by ON public.dc_authors USING btree (created_by);

CREATE UNIQUE INDEX idx_dc_authors_slug ON public.dc_authors USING btree (slug);

CREATE INDEX idx_dc_block_pages_created_at ON public.dc_block_pages USING btree (created_at);

CREATE INDEX idx_dc_block_pages_created_by ON public.dc_block_pages USING btree (created_by);

CREATE UNIQUE INDEX idx_dc_block_pages_slug ON public.dc_block_pages USING btree (slug);

CREATE INDEX idx_dc_categories_created_at ON public.dc_categories USING btree (created_at);

CREATE INDEX idx_dc_categories_created_by ON public.dc_categories USING btree (created_by);

CREATE UNIQUE INDEX idx_dc_categories_slug ON public.dc_categories USING btree (slug);

CREATE INDEX idx_dc_components_created_at ON public.dc_components USING btree (created_at);

CREATE INDEX idx_dc_components_created_by ON public.dc_components USING btree (created_by);

CREATE UNIQUE INDEX idx_dc_components_slug ON public.dc_components USING btree (slug);

CREATE INDEX idx_dc_form_submissions_created_at ON public.dc_form_submissions USING btree (created_at);

CREATE INDEX idx_dc_form_submissions_created_by ON public.dc_form_submissions USING btree (created_by);

CREATE INDEX idx_dc_form_submissions_form ON public.dc_form_submissions USING btree (form);

CREATE UNIQUE INDEX idx_dc_form_submissions_slug ON public.dc_form_submissions USING btree (slug);

CREATE INDEX idx_dc_form_submissions_status ON public.dc_form_submissions USING btree (status);

CREATE INDEX idx_dc_form_submissions_submitted_at ON public.dc_form_submissions USING btree (submitted_at);

CREATE INDEX idx_dc_forms_created_at ON public.dc_forms USING btree (created_at);

CREATE INDEX idx_dc_forms_created_by ON public.dc_forms USING btree (created_by);

CREATE UNIQUE INDEX idx_dc_forms_slug ON public.dc_forms USING btree (slug);

CREATE INDEX idx_dc_layouts_created_at ON public.dc_layouts USING btree (created_at);

CREATE INDEX idx_dc_layouts_created_by ON public.dc_layouts USING btree (created_by);

CREATE UNIQUE INDEX idx_dc_layouts_slug ON public.dc_layouts USING btree (slug);

CREATE INDEX idx_dc_nx_pb_address_claims_blocked_by ON public.dc_nx_pb_address_claims USING btree (blocked_by);

CREATE INDEX idx_dc_nx_pb_address_claims_created_at ON public.dc_nx_pb_address_claims USING btree (created_at);

CREATE INDEX idx_dc_nx_pb_address_claims_created_by ON public.dc_nx_pb_address_claims USING btree (created_by);

CREATE INDEX idx_dc_nx_pb_address_claims_holder_collection ON public.dc_nx_pb_address_claims USING btree (holder_collection);

CREATE INDEX idx_dc_nx_pb_address_claims_holder_id ON public.dc_nx_pb_address_claims USING btree (holder_id);

CREATE INDEX idx_dc_nx_pb_address_claims_kind ON public.dc_nx_pb_address_claims USING btree (kind);

CREATE UNIQUE INDEX idx_dc_nx_pb_address_claims_slug ON public.dc_nx_pb_address_claims USING btree (slug);

CREATE INDEX idx_dc_nx_pb_address_claims_space ON public.dc_nx_pb_address_claims USING btree (space);

CREATE INDEX idx_dc_nx_pb_class_usage_class_id ON public.dc_nx_pb_class_usage USING btree (class_id);

CREATE INDEX idx_dc_nx_pb_class_usage_created_at ON public.dc_nx_pb_class_usage USING btree (created_at);

CREATE INDEX idx_dc_nx_pb_class_usage_created_by ON public.dc_nx_pb_class_usage USING btree (created_by);

CREATE INDEX idx_dc_nx_pb_class_usage_entity_key ON public.dc_nx_pb_class_usage USING btree (entity_key);

CREATE UNIQUE INDEX idx_dc_nx_pb_class_usage_slug ON public.dc_nx_pb_class_usage USING btree (slug);

CREATE INDEX idx_dc_nx_pb_component_retired_component_id ON public.dc_nx_pb_component_retired USING btree (component_id);

CREATE INDEX idx_dc_nx_pb_component_retired_created_at ON public.dc_nx_pb_component_retired USING btree (created_at);

CREATE INDEX idx_dc_nx_pb_component_retired_created_by ON public.dc_nx_pb_component_retired USING btree (created_by);

CREATE UNIQUE INDEX idx_dc_nx_pb_component_retired_slug ON public.dc_nx_pb_component_retired USING btree (slug);

CREATE INDEX idx_dc_nx_pb_component_usage_component_id ON public.dc_nx_pb_component_usage USING btree (component_id);

CREATE INDEX idx_dc_nx_pb_component_usage_created_at ON public.dc_nx_pb_component_usage USING btree (created_at);

CREATE INDEX idx_dc_nx_pb_component_usage_created_by ON public.dc_nx_pb_component_usage USING btree (created_by);

CREATE INDEX idx_dc_nx_pb_component_usage_entity_key ON public.dc_nx_pb_component_usage USING btree (entity_key);

CREATE UNIQUE INDEX idx_dc_nx_pb_component_usage_slug ON public.dc_nx_pb_component_usage USING btree (slug);

CREATE INDEX idx_dc_nx_pb_usage_backfill_created_at ON public.dc_nx_pb_usage_backfill USING btree (created_at);

CREATE INDEX idx_dc_nx_pb_usage_backfill_created_by ON public.dc_nx_pb_usage_backfill USING btree (created_by);

CREATE INDEX idx_dc_nx_pb_usage_backfill_generation ON public.dc_nx_pb_usage_backfill USING btree (generation);

CREATE INDEX idx_dc_nx_pb_usage_backfill_scope_key ON public.dc_nx_pb_usage_backfill USING btree (scope_key);

CREATE UNIQUE INDEX idx_dc_nx_pb_usage_backfill_slug ON public.dc_nx_pb_usage_backfill USING btree (slug);

CREATE INDEX idx_dc_pages_created_at ON public.dc_pages USING btree (created_at);

CREATE INDEX idx_dc_pages_created_by ON public.dc_pages USING btree (created_by);

CREATE INDEX idx_dc_pages_layout ON public.dc_pages USING btree (layout);

CREATE UNIQUE INDEX idx_dc_pages_slug ON public.dc_pages USING btree (slug);

CREATE INDEX idx_dc_patterns_created_at ON public.dc_patterns USING btree (created_at);

CREATE INDEX idx_dc_patterns_created_by ON public.dc_patterns USING btree (created_by);

CREATE UNIQUE INDEX idx_dc_patterns_slug ON public.dc_patterns USING btree (slug);

CREATE INDEX idx_dc_posts_created_at ON public.dc_posts USING btree (created_at);

CREATE INDEX idx_dc_posts_created_by ON public.dc_posts USING btree (created_by);

CREATE INDEX idx_dc_posts_featured_image ON public.dc_posts USING btree (featured_image);

CREATE UNIQUE INDEX idx_dc_posts_slug ON public.dc_posts USING btree (slug);

CREATE INDEX idx_dc_tags_created_at ON public.dc_tags USING btree (created_at);

CREATE INDEX idx_dc_tags_created_by ON public.dc_tags USING btree (created_by);

CREATE UNIQUE INDEX idx_dc_tags_slug ON public.dc_tags USING btree (slug);

CREATE INDEX idx_dc_templates_created_at ON public.dc_templates USING btree (created_at);

CREATE INDEX idx_dc_templates_created_by ON public.dc_templates USING btree (created_by);

CREATE INDEX idx_dc_templates_entry_collection ON public.dc_templates USING btree (entry_collection);

CREATE INDEX idx_dc_templates_forked_from ON public.dc_templates USING btree (forked_from);

CREATE UNIQUE INDEX idx_dc_templates_slug ON public.dc_templates USING btree (slug);

CREATE INDEX idx_page_builder__binding_issues_dirty ON public.page_builder__binding_issues USING btree (dirty);

CREATE INDEX idx_page_builder__breakpoint_removal_fragments_created_at ON public.page_builder__breakpoint_removal_fragments USING btree (created_at);

CREATE INDEX idx_page_builder__breakpoint_removal_fragments_run_id ON public.page_builder__breakpoint_removal_fragments USING btree (run_id);

CREATE INDEX idx_page_builder__breakpoint_removal_fragments_run_id_d_04ki5jv ON public.page_builder__breakpoint_removal_fragments USING btree (run_id, document_key);

CREATE INDEX idx_page_builder__class_usage_class_id ON public.page_builder__class_usage USING btree (class_id);

CREATE INDEX idx_page_builder__class_usage_entity_entity_key_178r965 ON public.page_builder__class_usage USING btree (entity, entity_key);

CREATE INDEX idx_page_builder__component_usage_component_id ON public.page_builder__component_usage USING btree (component_id);

CREATE INDEX idx_page_builder__component_usage_entity_entity_key_178r965 ON public.page_builder__component_usage USING btree (entity, entity_key);

CREATE INDEX idx_page_builder__token_usage_entity_entity_key_178r965 ON public.page_builder__token_usage USING btree (entity, entity_key);

CREATE INDEX idx_page_builder__token_usage_token_id ON public.page_builder__token_usage USING btree (token_id);

CREATE INDEX idx_single_announcement_created_at ON public.single_announcement USING btree (created_at);

CREATE UNIQUE INDEX idx_single_announcement_slug ON public.single_announcement USING btree (slug);

CREATE INDEX idx_single_homepage_created_at ON public.single_homepage USING btree (created_at);

CREATE UNIQUE INDEX idx_single_homepage_slug ON public.single_homepage USING btree (slug);

CREATE INDEX idx_single_landing_page_created_at ON public.single_landing_page USING btree (created_at);

CREATE UNIQUE INDEX idx_single_landing_page_slug ON public.single_landing_page USING btree (slug);

CREATE INDEX idx_single_page_builder_settings_created_at ON public.single_page_builder_settings USING btree (created_at);

CREATE INDEX idx_single_page_builder_settings_default_layout ON public.single_page_builder_settings USING btree (default_layout);

CREATE INDEX idx_single_page_builder_settings_seeded_layout ON public.single_page_builder_settings USING btree (seeded_layout);

CREATE UNIQUE INDEX idx_single_page_builder_settings_slug ON public.single_page_builder_settings USING btree (slug);

CREATE INDEX idx_single_page_builder_site_code_created_at ON public.single_page_builder_site_code USING btree (created_at);

CREATE UNIQUE INDEX idx_single_page_builder_site_code_slug ON public.single_page_builder_site_code USING btree (slug);

CREATE INDEX idx_single_site_settings_created_at ON public.single_site_settings USING btree (created_at);

CREATE UNIQUE INDEX idx_single_site_settings_slug ON public.single_site_settings USING btree (slug);

CREATE INDEX idx_single_site_style_created_at ON public.single_site_style USING btree (created_at);

CREATE UNIQUE INDEX idx_single_site_style_slug ON public.single_site_style USING btree (slug);

CREATE INDEX media_folder_id_idx ON public.media USING btree (folder_id);

CREATE INDEX media_folders_created_at_idx ON public.media_folders USING btree (created_at);

CREATE INDEX media_folders_created_by_idx ON public.media_folders USING btree (created_by);

CREATE INDEX media_folders_parent_id_idx ON public.media_folders USING btree (parent_id);

CREATE INDEX media_mime_type_idx ON public.media USING btree (mime_type);

CREATE INDEX media_tags_idx ON public.media USING btree (tags);

CREATE INDEX media_uploaded_at_idx ON public.media USING btree (uploaded_at);

CREATE INDEX media_uploaded_by_idx ON public.media USING btree (uploaded_by);

CREATE INDEX ncte_expired_at_idx ON public.nextly_cache_tag_expiries USING btree (expired_at);

CREATE INDEX ndl_expires_at_idx ON public.nextly_document_lock USING btree (expires_at);

CREATE INDEX ndl_scope_idx ON public.nextly_document_lock USING btree (scope_kind, slug);

CREATE INDEX nextly_content_events_ended_by_idx ON public.nextly_content_events USING btree (ended_by);

CREATE INDEX nextly_content_events_ends_idx ON public.nextly_content_events USING btree (ends_subject, occurred_at);

CREATE INDEX nextly_content_events_subject_idx ON public.nextly_content_events USING btree (subject_kind, subject_slug, subject_id, id);

CREATE INDEX nextly_dashboard_pins_entry_idx ON public.nextly_dashboard_pins USING btree (target_type, target_slug, entry_id);

CREATE UNIQUE INDEX nextly_dashboard_pins_target_uidx ON public.nextly_dashboard_pins USING btree (user_id, target_type, target_slug, entry_id);

CREATE INDEX nextly_dashboard_pins_user_idx ON public.nextly_dashboard_pins USING btree (user_id, pinned_at);

CREATE UNIQUE INDEX nextly_dashboard_preferences_key_uidx ON public.nextly_dashboard_preferences USING btree (user_id, preference_key);

CREATE INDEX nextly_events_fanned_out_at_idx ON public.nextly_events USING btree (fanned_out_at, created_at);

CREATE INDEX nextly_events_retention_idx ON public.nextly_events USING btree (retention_class, created_at);

CREATE INDEX nextly_events_type_created_at_idx ON public.nextly_events USING btree (type, created_at);

CREATE INDEX nextly_i18n_archive_lookup_idx ON public.nextly_i18n_archive USING btree (collection, entry_id, locale);

CREATE UNIQUE INDEX nextly_jobs_dedupe_idx ON public.nextly_jobs USING btree (dedupe_key);

CREATE INDEX nextly_jobs_due_idx ON public.nextly_jobs USING btree (state, run_at);

CREATE INDEX nextly_jobs_recent_idx ON public.nextly_jobs USING btree (updated_at);

CREATE INDEX nextly_media_usage_media_idx ON public.nextly_media_usage USING btree (media_id);

CREATE UNIQUE INDEX nextly_media_usage_uidx ON public.nextly_media_usage USING btree (subject_kind, subject_slug, document_id, field_path, locale, media_id);

CREATE INDEX nextly_meta_updated_at_idx ON public.nextly_meta USING btree (updated_at);

CREATE INDEX nextly_notices_created_idx ON public.nextly_notices USING btree (created_at);

CREATE UNIQUE INDEX nextly_notices_dedupe_uidx ON public.nextly_notices USING btree (dedupe_key);

CREATE INDEX nextly_notices_inbox_idx ON public.nextly_notices USING btree (user_id, created_at, id);

CREATE INDEX nextly_notices_subject_idx ON public.nextly_notices USING btree (subject_type, subject_id);

CREATE INDEX nextly_notices_user_idx ON public.nextly_notices USING btree (user_id, read_at, created_at, id);

CREATE INDEX nextly_one_time_secrets_expires_idx ON public.nextly_one_time_secrets USING btree (expires_at);

CREATE INDEX nextly_one_time_secrets_hash_idx ON public.nextly_one_time_secrets USING btree (secret_hash);

CREATE UNIQUE INDEX nextly_one_time_secrets_issue_unique ON public.nextly_one_time_secrets USING btree (subject_key, purpose, kind, issue_seq);

CREATE UNIQUE INDEX nextly_one_time_secrets_live_key_unique ON public.nextly_one_time_secrets USING btree (live_key);

CREATE INDEX nextly_one_time_secrets_subject_key_idx ON public.nextly_one_time_secrets USING btree (subject_key);

CREATE INDEX nextly_plugin_event_deliveries_due_idx ON public.nextly_plugin_event_deliveries USING btree (status, next_attempt_at);

CREATE UNIQUE INDEX nextly_plugin_event_deliveries_event_subscriber_unique ON public.nextly_plugin_event_deliveries USING btree (event_id, subscriber_key);

CREATE INDEX nextly_plugin_events_fan_out_idx ON public.nextly_plugin_events USING btree (fanned_out_at, created_at);

CREATE INDEX nextly_plugin_events_finished_idx ON public.nextly_plugin_events USING btree (finished_at);

CREATE INDEX nextly_preview_links_created_by_idx ON public.nextly_preview_links USING btree (created_by);

CREATE INDEX nextly_preview_links_document_idx ON public.nextly_preview_links USING btree (document_kind, document_slug, entry_id);

CREATE INDEX nextly_preview_links_expires_idx ON public.nextly_preview_links USING btree (expires_at);

CREATE INDEX nextly_preview_links_revoked_by_idx ON public.nextly_preview_links USING btree (revoked_by);

CREATE INDEX nextly_preview_links_revoked_idx ON public.nextly_preview_links USING btree (revoked_at);

CREATE INDEX nextly_received_webhooks_prune_idx ON public.nextly_received_webhooks USING btree (prune_at);

CREATE INDEX nextly_release_members_doc_idx ON public.nextly_release_members USING btree (scope_kind, scope_slug, entry_id, locale);

CREATE UNIQUE INDEX nextly_release_members_key_uidx ON public.nextly_release_members USING btree (member_key);

CREATE INDEX nextly_release_members_release_idx ON public.nextly_release_members USING btree (release_id);

CREATE UNIQUE INDEX nextly_release_members_single_uidx ON public.nextly_release_members USING btree (release_id, single_slot);

CREATE INDEX nextly_releases_due_idx ON public.nextly_releases USING btree (state, scheduled_at);

CREATE INDEX nextly_releases_published_idx ON public.nextly_releases USING btree (published_at);

CREATE INDEX nextly_releases_scheduled_idx ON public.nextly_releases USING btree (scheduled_at);

CREATE INDEX nextly_review_states_assignee_idx ON public.nextly_review_states USING btree (assignee_kind, assignee_id);

CREATE INDEX nextly_review_states_doc_idx ON public.nextly_review_states USING btree (scope_kind, scope_slug, entry_id);

CREATE UNIQUE INDEX nextly_review_states_key_uidx ON public.nextly_review_states USING btree (part_key);

CREATE INDEX nextly_review_states_stage_idx ON public.nextly_review_states USING btree (scope_kind, scope_slug, stage);

CREATE INDEX nextly_schedule_windows_window_idx ON public.nextly_schedule_windows USING btree (window_at);

CREATE UNIQUE INDEX nextly_schema_events_filename_applied_idx ON public.nextly_schema_events USING btree (filename) WHERE ((event_type = 'file_apply'::text) AND (status = 'applied'::text));

CREATE INDEX nextly_schema_events_scope_idx ON public.nextly_schema_events USING btree (scope_kind, scope_slug);

CREATE INDEX nextly_schema_events_started_at_idx ON public.nextly_schema_events USING btree (started_at);

CREATE INDEX nextly_version_pins_doc_idx ON public.nextly_version_pins USING btree (scope_kind, scope_slug, entry_id);

CREATE UNIQUE INDEX nextly_version_pins_key_uidx ON public.nextly_version_pins USING btree (pin_key);

CREATE INDEX nextly_version_views_doc_idx ON public.nextly_version_views USING btree (scope_kind, scope_slug, entry_id);

CREATE UNIQUE INDEX nextly_version_views_key_uidx ON public.nextly_version_views USING btree (view_key);

CREATE INDEX nextly_version_views_user_idx ON public.nextly_version_views USING btree (user_id);

CREATE UNIQUE INDEX nextly_versions_autosave_uidx ON public.nextly_versions USING btree (scope_kind, scope_slug, entry_id, created_by) WHERE (is_autosave = true);

CREATE INDEX nextly_versions_doc_recent_idx ON public.nextly_versions USING btree (scope_kind, scope_slug, entry_id, created_at);

CREATE INDEX nextly_versions_pending_edits_idx ON public.nextly_versions USING btree (is_autosave, status, version_no, scope_slug, updated_at, id);

CREATE UNIQUE INDEX nextly_versions_seq_uidx ON public.nextly_versions USING btree (scope_kind, scope_slug, entry_id, version_no) WHERE (is_autosave = false);

CREATE UNIQUE INDEX nextly_versions_working_draft_uidx ON public.nextly_versions USING btree (draft_key);

CREATE INDEX nextly_webhook_deliveries_event_idx ON public.nextly_webhook_deliveries USING btree (event_id);

CREATE INDEX nextly_webhook_deliveries_retention_idx ON public.nextly_webhook_deliveries USING btree (status, updated_at);

CREATE INDEX nextly_webhook_deliveries_status_next_idx ON public.nextly_webhook_deliveries USING btree (status, next_attempt_at);

CREATE INDEX nextly_webhook_deliveries_webhook_created_idx ON public.nextly_webhook_deliveries USING btree (webhook_id, created_at, id);

CREATE UNIQUE INDEX nextly_webhook_deliveries_webhook_event_unique ON public.nextly_webhook_deliveries USING btree (webhook_id, event_id);

CREATE INDEX nextly_webhooks_enabled_idx ON public.nextly_webhooks USING btree (enabled);

CREATE UNIQUE INDEX nextly_workflow_settings_workflow_uidx ON public.nextly_workflow_settings USING btree (workflow);

CREATE INDEX nls_expires_at_idx ON public.nextly_limit_store USING btree (expires_at);

CREATE INDEX nls_generation_idx ON public.nextly_limit_store USING btree (generation);

CREATE INDEX nsc_expires_at_idx ON public.nextly_spent_challenges USING btree (expires_at);

CREATE INDEX permissions_action_idx ON public.permissions USING btree (action);

CREATE UNIQUE INDEX permissions_action_resource_unique ON public.permissions USING btree (action, resource);

CREATE INDEX permissions_resource_idx ON public.permissions USING btree (resource);

CREATE UNIQUE INDEX permissions_slug_unique ON public.permissions USING btree (slug);

CREATE INDEX prt_expires_idx ON public.password_reset_tokens USING btree (expires);

CREATE UNIQUE INDEX prt_identifier_token_hash_unique ON public.password_reset_tokens USING btree (identifier, token_hash);

CREATE INDEX prt_token_hash_idx ON public.password_reset_tokens USING btree (token_hash);

CREATE INDEX prt_used_at_idx ON public.password_reset_tokens USING btree (used_at);

CREATE INDEX prt_user_id_idx ON public.password_reset_tokens USING btree (user_id);

CREATE INDEX refresh_tokens_expires_at_idx ON public.refresh_tokens USING btree (expires_at);

CREATE INDEX refresh_tokens_token_hash_idx ON public.refresh_tokens USING btree (token_hash);

CREATE INDEX refresh_tokens_user_id_idx ON public.refresh_tokens USING btree (user_id);

CREATE INDEX role_inherits_child_idx ON public.role_inherits USING btree (child_role_id);

CREATE UNIQUE INDEX role_inherits_parent_child_unique ON public.role_inherits USING btree (parent_role_id, child_role_id);

CREATE INDEX role_inherits_parent_idx ON public.role_inherits USING btree (parent_role_id);

CREATE INDEX role_permissions_role_id_idx ON public.role_permissions USING btree (role_id);

CREATE UNIQUE INDEX role_permissions_role_permission_unique ON public.role_permissions USING btree (role_id, permission_id);

CREATE INDEX roles_is_system_idx ON public.roles USING btree (is_system);

CREATE INDEX roles_level_idx ON public.roles USING btree (level);

CREATE UNIQUE INDEX roles_name_unique ON public.roles USING btree (name);

CREATE UNIQUE INDEX roles_slug_unique ON public.roles USING btree (slug);

CREATE INDEX uit_expires_idx ON public.user_invite_tokens USING btree (expires);

CREATE INDEX uit_token_hash_idx ON public.user_invite_tokens USING btree (token_hash);

CREATE UNIQUE INDEX uit_user_id_unique ON public.user_invite_tokens USING btree (user_id);

CREATE UNIQUE INDEX uq_dc_form_submissions_form_response_key_1ak966i ON public.dc_form_submissions USING btree (form, response_key);

CREATE UNIQUE INDEX uq_dc_nx_pb_address_claims_claim_key ON public.dc_nx_pb_address_claims USING btree (claim_key);

CREATE UNIQUE INDEX uq_dc_nx_pb_component_retired_identity ON public.dc_nx_pb_component_retired USING btree (identity);

CREATE UNIQUE INDEX uq_dc_templates_address ON public.dc_templates USING btree (address);

CREATE UNIQUE INDEX uq_dc_templates_collection ON public.dc_templates USING btree (collection);

CREATE UNIQUE INDEX uq_dc_templates_entry ON public.dc_templates USING btree (entry);

CREATE UNIQUE INDEX uq_page_builder__binding_issues_document_key ON public.page_builder__binding_issues USING btree (document_key);

CREATE UNIQUE INDEX uq_page_builder__binding_report_runs_name ON public.page_builder__binding_report_runs USING btree (name);

CREATE UNIQUE INDEX uq_page_builder__breakpoint_removals_open_key ON public.page_builder__breakpoint_removals USING btree (open_key);

CREATE UNIQUE INDEX uq_page_builder__component_deletion_hosts_deletion_id_h_007uo01 ON public.page_builder__component_deletion_hosts USING btree (deletion_id, host_key);

CREATE UNIQUE INDEX uq_page_builder__component_deletions_component_id_purpo_1mlwby6 ON public.page_builder__component_deletions USING btree (component_id, purpose);

CREATE UNIQUE INDEX uq_page_builder__layout_removals_layout_id ON public.page_builder__layout_removals USING btree (layout_id);

CREATE UNIQUE INDEX uq_page_builder__site_options_name ON public.page_builder__site_options USING btree (name);

CREATE UNIQUE INDEX uq_page_builder__usage_progress_token_scope_key_0ujeq6m ON public.page_builder__usage_progress USING btree (token, scope_key);

CREATE UNIQUE INDEX uq_page_builder__usage_runs_name ON public.page_builder__usage_runs USING btree (name);

CREATE INDEX user_field_defs_created_at_idx ON public.user_field_definitions USING btree (created_at);

CREATE INDEX user_field_defs_is_active_idx ON public.user_field_definitions USING btree (is_active);

CREATE UNIQUE INDEX user_field_defs_name_unique_idx ON public.user_field_definitions USING btree (name);

CREATE INDEX user_field_defs_sort_order_idx ON public.user_field_definitions USING btree (sort_order);

CREATE INDEX user_field_defs_source_idx ON public.user_field_definitions USING btree (source);

CREATE INDEX user_roles_expires_at_idx ON public.user_roles USING btree (expires_at);

CREATE INDEX user_roles_user_id_idx ON public.user_roles USING btree (user_id);

CREATE UNIQUE INDEX user_roles_user_role_unique ON public.user_roles USING btree (user_id, role_id);

CREATE INDEX users_created_at_idx ON public.users USING btree (created_at);

CREATE UNIQUE INDEX users_email_unique ON public.users USING btree (email);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_role_id_roles_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comp_seo_locales
    ADD CONSTRAINT comp_seo_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.comp_seo(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dc_authors_locales
    ADD CONSTRAINT dc_authors_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_authors(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dynamic_collections
    ADD CONSTRAINT dynamic_collections_created_by_users_id_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_provider_id_email_providers_id_fkey FOREIGN KEY (provider_id) REFERENCES public.email_providers(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_folder_id_media_folders_id_fkey FOREIGN KEY (folder_id) REFERENCES public.media_folders(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.media_folders
    ADD CONSTRAINT media_folders_created_by_users_id_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.media_folders
    ADD CONSTRAINT media_folders_parent_id_media_folders_id_fkey FOREIGN KEY (parent_id) REFERENCES public.media_folders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_uploaded_by_users_id_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.nextly_dashboard_pins
    ADD CONSTRAINT nextly_dashboard_pins_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.nextly_dashboard_preferences
    ADD CONSTRAINT nextly_dashboard_preferences_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.nextly_media_usage
    ADD CONSTRAINT nextly_media_usage_media_id_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.media(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.nextly_notices
    ADD CONSTRAINT nextly_notices_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.nextly_preview_links
    ADD CONSTRAINT nextly_preview_links_created_by_users_id_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.nextly_preview_links
    ADD CONSTRAINT nextly_preview_links_revoked_by_users_id_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.nextly_webhook_deliveries
    ADD CONSTRAINT nextly_webhook_deliveries_event_id_nextly_events_id_fkey FOREIGN KEY (event_id) REFERENCES public.nextly_events(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.nextly_webhook_deliveries
    ADD CONSTRAINT nextly_webhook_deliveries_webhook_id_nextly_webhooks_id_fkey FOREIGN KEY (webhook_id) REFERENCES public.nextly_webhooks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.nextly_webhooks
    ADD CONSTRAINT nextly_webhooks_created_by_users_id_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.role_inherits
    ADD CONSTRAINT role_inherits_child_role_id_roles_id_fkey FOREIGN KEY (child_role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.role_inherits
    ADD CONSTRAINT role_inherits_parent_role_id_roles_id_fkey FOREIGN KEY (parent_role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_permissions_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_roles_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.single_announcement_locales
    ADD CONSTRAINT single_announcement_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.single_announcement(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.single_site_settings_locales
    ADD CONSTRAINT single_site_settings_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.single_site_settings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_invite_tokens
    ADD CONSTRAINT user_invite_tokens_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_roles_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

