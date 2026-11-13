

SELECT pg_catalog.set_config('search_path', '', false);

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
	('registry_record', '"{\"point\":null,\"baseline\":{\"collections\":{},\"singles\":{},\"fieldGroups\":{},\"permissions\":[]}}"', '2026-11-13 15:51:36.651+00'),
	('schema_version', '"{\"migration\":\"20261113_155131_912_create_localization_seo\",\"seq\":1}"', '2026-11-13 15:51:36.814+00'),
	('preset_grants_release', '"{\"release\":\"0.0.2-alpha.75\"}"', '2026-11-13 15:51:36.952+00');

INSERT INTO public.nextly_rbac_epoch VALUES
	('global', 6, '0f9c602e-f7da-4085-ae53-87d5f851f03e', '2026-11-13 15:51:36.967+00');

INSERT INTO public.nextly_schema_events VALUES
	('ff9821c6-fdb3-476e-b499-722583986f45', 'core_apply', 'applied', 'cli-migrate', NULL, NULL, 'core', NULL, '2026-11-13 15:51:35.953+00', '2026-11-13 15:51:35.956+00', NULL, NULL, NULL, NULL, 261, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('ca36d047-08af-488f-a37c-cc0467956c9c', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261102_183408_943_create_usage_bookkeeping', '5c870a6fee243c233144409e147e1d420ee08445c71c7275108f02ff73e81eac', NULL, NULL, '2026-11-13 15:51:36.012+00', '2026-11-13 15:51:36.022+00', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('ad3b7bfb-0e09-4d05-ba7b-31670749171e', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261103_024902_454_create_layout_removals', 'b783849639cdf821af36b98effb82ed4a20ca0ca05621b9c72dce9f0eebb5231', NULL, NULL, '2026-11-13 15:51:36.075+00', '2026-11-13 15:51:36.082+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('60e7d92c-2a99-4161-9442-5d9d367fd55a', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_063215_663_create_component_rewrite_runs', '55669705dcc7ca39c8975f10a6b51e5f4a566b419508a6cd6b00f9bec27b0337', NULL, NULL, '2026-11-13 15:51:36.125+00', '2026-11-13 15:51:36.133+00', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('b5ba88a5-088a-432f-b52f-eb3459ea392e', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_115414_028_create_site_options', 'b5d588d3b364de00f301087f219d0acd5d777b8f1779b5287498b26b2f41f897', NULL, NULL, '2026-11-13 15:51:36.182+00', '2026-11-13 15:51:36.188+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('5338dacd-178f-4655-adad-20eeeb5be5b5', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261105_064012_324_create_breakpoint_removals', 'c3c9b9717e772b91c502ae3db1417f288141b7565f8a016609908370a4d1d4a8', NULL, NULL, '2026-11-13 15:51:36.235+00', '2026-11-13 15:51:36.241+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('a8eb1e14-3ac4-4b2d-9b0e-b07109edf37d', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_064828_573_create_breakpoint_removal_fragments', '2188b3de23d90100d49a761b4b970cc76f7c0d698e08ee95b2da7c49b5bcf20c', NULL, NULL, '2026-11-13 15:51:36.304+00', '2026-11-13 15:51:36.312+00', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('52d028dd-d3a7-4963-9b89-b7b7e37e0587', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_084948_318_create_usage_index_tables', '261b1425453c4d00d7f267402783bb2b1456efbf33786d30144d52f16e334c7b', NULL, NULL, '2026-11-13 15:51:36.368+00', '2026-11-13 15:51:36.382+00', NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('f7f6b431-d5cf-4dbe-9a10-9f9c18a21564', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_095219_741_add_breakpoint_removal_undoes', 'bd09923df56aa2b4215f555ddfc3248d6fe827ffcde1c8471f9697c86b0e029e', NULL, NULL, '2026-11-13 15:51:36.448+00', '2026-11-13 15:51:36.463+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('13bc4b89-9c4e-42a3-84ba-c31ad540faea', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_104001_085_create_token_usage_table', '677b6856df085719792fe7c9a8e7d4e8cb3deda9fd2e142556e0837cfb79baf6', NULL, NULL, '2026-11-13 15:51:36.52+00', '2026-11-13 15:51:36.525+00', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('775bf5ce-121f-4dd0-8ed8-f364ca86360e', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261107_174750_902_create_binding_report_tables', 'ea204e324914661b2d4e6fc1ad4fc62781a6ce8dd81add103beed79a74d89e05', NULL, NULL, '2026-11-13 15:51:36.569+00', '2026-11-13 15:51:36.577+00', NULL, NULL, NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('b367bcd3-19ee-4091-9337-e16f4abf2e2f', 'file_apply', 'applied', 'cli-migrate', '20261113_155131_908_baseline.sql', '8bb6efe4b7090e0ca8a1f5a60b140d3e9836bd245600906d6e591237fb564a58', NULL, NULL, '2026-11-13 15:51:36.734+00', '2026-11-13 15:51:36.736+00', NULL, NULL, NULL, NULL, 121, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('81fa7c5c-0f1a-4885-af96-8510dbdffdb0', 'file_apply', 'applied', 'cli-migrate', '20261113_155131_909_create_localization_authors.sql', '5ded9495153df815e089f0e31a659aa3eb8b6019afb6b43bb90bc9e3d948ad4a', NULL, NULL, '2026-11-13 15:51:36.757+00', '2026-11-13 15:51:36.759+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('5b2df97c-0c76-4928-a2b8-64cec4f5a8ab', 'file_apply', 'applied', 'cli-migrate', '20261113_155131_910_create_localization_site-settings.sql', 'b6f6e18b351f2c59fee535034555b4beb056cb3fa9abf457e350604f93898b34', NULL, NULL, '2026-11-13 15:51:36.764+00', '2026-11-13 15:51:36.765+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('e458d93b-5383-479c-8ae9-402ff8aed1ad', 'file_apply', 'applied', 'cli-migrate', '20261113_155131_911_create_localization_announcement.sql', '14a94c4a4947be59e42e1606a47311e00664ff4c42a1d6d6a5872bcf88c7891b', NULL, NULL, '2026-11-13 15:51:36.771+00', '2026-11-13 15:51:36.772+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('54de8ee8-de75-45d4-b207-ee268f2cd4ea', 'file_apply', 'applied', 'cli-migrate', '20261113_155131_912_create_localization_seo.sql', '18d546bcc04b529f9921c650500a0e2ca3e0aaaa449596a70adf0d94441ebfdc', NULL, NULL, '2026-11-13 15:51:36.776+00', '2026-11-13 15:51:36.778+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO public.nextly_schema_lock VALUES
	(1, NULL, NULL, NULL, NULL);

INSERT INTO public.nextly_schema_owners VALUES
	('page_builder__component_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.387+00', '2026-11-13 15:51:36.58+00'),
	('page_builder__token_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.53+00', '2026-11-13 15:51:36.58+00'),
	('page_builder__binding_issues', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.58+00', '2026-11-13 15:51:36.58+00'),
	('page_builder__binding_report_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.58+00', '2026-11-13 15:51:36.58+00'),
	('page_builder__usage_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.029+00', '2026-11-13 15:51:36.58+00'),
	('page_builder__usage_progress', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.029+00', '2026-11-13 15:51:36.58+00'),
	('page_builder__layout_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.086+00', '2026-11-13 15:51:36.58+00'),
	('page_builder__component_deletions', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.136+00', '2026-11-13 15:51:36.58+00'),
	('page_builder__component_deletion_hosts', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.136+00', '2026-11-13 15:51:36.58+00'),
	('page_builder__site_options', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.193+00', '2026-11-13 15:51:36.58+00'),
	('page_builder__breakpoint_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.244+00', '2026-11-13 15:51:36.58+00'),
	('page_builder__breakpoint_removal_fragments', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.316+00', '2026-11-13 15:51:36.58+00'),
	('page_builder__class_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.75', 10, 'active', '2026-11-13 15:51:36.387+00', '2026-11-13 15:51:36.58+00');

INSERT INTO public.permissions VALUES
	('365fbd13-c3df-4e80-a412-59313564be81', 'Create Users', 'create-users', 'create', 'users', 'Permission to create users', NULL, NULL, NULL, false, '2026-11-13 15:51:36.831163', '2026-11-13 15:51:36.831163'),
	('ce368057-2427-4ddf-a2a5-f37fca812f41', 'Read Users', 'read-users', 'read', 'users', 'Permission to read users', NULL, NULL, NULL, false, '2026-11-13 15:51:36.833752', '2026-11-13 15:51:36.833752'),
	('24880203-220d-4543-8479-f909559c5fe2', 'Update Users', 'update-users', 'update', 'users', 'Permission to update users', NULL, NULL, NULL, false, '2026-11-13 15:51:36.835775', '2026-11-13 15:51:36.835775'),
	('91f28fc5-a793-418e-9ece-d5ff9d7946e4', 'Delete Users', 'delete-users', 'delete', 'users', 'Permission to delete users', NULL, NULL, NULL, false, '2026-11-13 15:51:36.837724', '2026-11-13 15:51:36.837724'),
	('af9f2709-a782-4b15-84f3-801d2c73bc72', 'Create Roles', 'create-roles', 'create', 'roles', 'Permission to create roles', NULL, NULL, NULL, false, '2026-11-13 15:51:36.839418', '2026-11-13 15:51:36.839418'),
	('b89b7df9-454f-4ceb-92ca-c8d6c7139b70', 'Read Roles', 'read-roles', 'read', 'roles', 'Permission to read roles', NULL, NULL, NULL, false, '2026-11-13 15:51:36.84095', '2026-11-13 15:51:36.84095'),
	('e43b9d0e-a6a0-4049-8ab4-020cb761821f', 'Update Roles', 'update-roles', 'update', 'roles', 'Permission to update roles', NULL, NULL, NULL, false, '2026-11-13 15:51:36.842118', '2026-11-13 15:51:36.842118'),
	('6f85ff38-4416-41e4-a054-3e6bb939c27c', 'Delete Roles', 'delete-roles', 'delete', 'roles', 'Permission to delete roles', NULL, NULL, NULL, false, '2026-11-13 15:51:36.843205', '2026-11-13 15:51:36.843205'),
	('a55bb8f7-6c0a-4451-8296-a1b89e8194cb', 'Create Media', 'create-media', 'create', 'media', 'Permission to upload media files', NULL, NULL, NULL, false, '2026-11-13 15:51:36.844299', '2026-11-13 15:51:36.844299'),
	('603af40f-846c-480e-940e-c0cceee3a3a3', 'Read Media', 'read-media', 'read', 'media', 'Permission to view media files', NULL, NULL, NULL, false, '2026-11-13 15:51:36.845542', '2026-11-13 15:51:36.845542'),
	('c0031d2e-3c1c-40dc-8fed-bd9ead006b90', 'Update Media', 'update-media', 'update', 'media', 'Permission to edit media metadata and move files', NULL, NULL, NULL, false, '2026-11-13 15:51:36.846685', '2026-11-13 15:51:36.846685'),
	('3df340c7-1b08-4a21-9412-9401f94a5283', 'Delete Media', 'delete-media', 'delete', 'media', 'Permission to delete media files', NULL, NULL, NULL, false, '2026-11-13 15:51:36.847661', '2026-11-13 15:51:36.847661'),
	('25a7ef39-048b-4627-b973-64fdbbd65a2c', 'Read Settings', 'read-settings', 'read', 'settings', 'Permission to read system settings', NULL, NULL, NULL, false, '2026-11-13 15:51:36.848607', '2026-11-13 15:51:36.848607'),
	('b9622cd8-81c0-41e6-9310-7bba36f811d2', 'Create Settings', 'create-settings', 'create', 'settings', 'Permission to add settings such as user fields and field groups', NULL, NULL, NULL, false, '2026-11-13 15:51:36.849592', '2026-11-13 15:51:36.849592'),
	('5fd24a4f-404e-4961-8fd8-572e3668c796', 'Update Settings', 'update-settings', 'update', 'settings', 'Permission to change system settings', NULL, NULL, NULL, false, '2026-11-13 15:51:36.850584', '2026-11-13 15:51:36.850584'),
	('d703cf0d-b1a7-4a7e-9bf3-daa08ce4000c', 'Delete Settings', 'delete-settings', 'delete', 'settings', 'Permission to remove settings such as user fields and field groups', NULL, NULL, NULL, false, '2026-11-13 15:51:36.851607', '2026-11-13 15:51:36.851607'),
	('74ce13c9-460e-49e5-be53-6bf1950c8255', 'Create Email Providers', 'create-email-providers', 'create', 'email-providers', 'Permission to create email providers', NULL, NULL, NULL, false, '2026-11-13 15:51:36.852615', '2026-11-13 15:51:36.852615'),
	('0357e0c0-e4fe-4edc-82ff-02ecfd62d11f', 'Read Email Providers', 'read-email-providers', 'read', 'email-providers', 'Permission to read email providers', NULL, NULL, NULL, false, '2026-11-13 15:51:36.853623', '2026-11-13 15:51:36.853623'),
	('3d16a840-1a5c-481b-a96b-527e9d40ab8b', 'Update Email Providers', 'update-email-providers', 'update', 'email-providers', 'Permission to change email providers', NULL, NULL, NULL, false, '2026-11-13 15:51:36.854614', '2026-11-13 15:51:36.854614'),
	('97e3d8d0-56e6-4cc5-8ae0-c5f548fb7f60', 'Delete Email Providers', 'delete-email-providers', 'delete', 'email-providers', 'Permission to delete email providers', NULL, NULL, NULL, false, '2026-11-13 15:51:36.856008', '2026-11-13 15:51:36.856008'),
	('6bb1f37b-fcd8-42da-846d-66fe28d8c294', 'Create Email Templates', 'create-email-templates', 'create', 'email-templates', 'Permission to create email templates', NULL, NULL, NULL, false, '2026-11-13 15:51:36.857331', '2026-11-13 15:51:36.857331'),
	('694d896d-a8c1-43c8-82b5-1d6c6c95ddd1', 'Read Email Templates', 'read-email-templates', 'read', 'email-templates', 'Permission to read email templates', NULL, NULL, NULL, false, '2026-11-13 15:51:36.859175', '2026-11-13 15:51:36.859175'),
	('57db8ea2-dece-462f-8d38-053cecf4abbd', 'Update Email Templates', 'update-email-templates', 'update', 'email-templates', 'Permission to change email templates', NULL, NULL, NULL, false, '2026-11-13 15:51:36.861045', '2026-11-13 15:51:36.861045'),
	('59fd8926-6d11-4e6a-a766-5deada5f98f9', 'Delete Email Templates', 'delete-email-templates', 'delete', 'email-templates', 'Permission to delete email templates', NULL, NULL, NULL, false, '2026-11-13 15:51:36.862718', '2026-11-13 15:51:36.862718'),
	('8ed63c8a-eeb4-4654-bf0a-500df9ea415a', 'Update API Keys', 'update-api-keys', 'update', 'api-keys', 'Permission to update API keys', NULL, NULL, NULL, false, '2026-11-13 15:51:36.864672', '2026-11-13 15:51:36.864672'),
	('95c4d1ce-ca7a-452c-bf9d-13e85832ae52', 'Create API Keys', 'create-api-keys', 'create', 'api-keys', 'Permission to create API keys', NULL, NULL, NULL, false, '2026-11-13 15:51:36.866191', '2026-11-13 15:51:36.866191'),
	('28f3817c-3968-4f39-a8db-022ce901946a', 'Read API Keys', 'read-api-keys', 'read', 'api-keys', 'Permission to read API keys', NULL, NULL, NULL, false, '2026-11-13 15:51:36.867318', '2026-11-13 15:51:36.867318'),
	('42a3a334-bbbb-4d4a-b253-1d5f3c370629', 'Delete API Keys', 'delete-api-keys', 'delete', 'api-keys', 'Permission to delete API keys', NULL, NULL, NULL, false, '2026-11-13 15:51:36.868644', '2026-11-13 15:51:36.868644'),
	('69d3564d-dab1-4bd9-83f4-5265cfb9d023', 'Update Webhooks', 'update-webhooks', 'update', 'webhooks', 'Permission to update webhook endpoints', NULL, NULL, NULL, false, '2026-11-13 15:51:36.869931', '2026-11-13 15:51:36.869931'),
	('6a93316b-671a-4c9f-a70c-ff23c0e13ca9', 'Create Webhooks', 'create-webhooks', 'create', 'webhooks', 'Permission to register webhook endpoints', NULL, NULL, NULL, false, '2026-11-13 15:51:36.871213', '2026-11-13 15:51:36.871213'),
	('8a5d5563-4b65-43fc-bd47-627fdee5543c', 'Read Webhooks', 'read-webhooks', 'read', 'webhooks', 'Permission to view webhook endpoints', NULL, NULL, NULL, false, '2026-11-13 15:51:36.872254', '2026-11-13 15:51:36.872254'),
	('dcfddfac-da80-47e2-ab28-cb8507e59bee', 'Delete Webhooks', 'delete-webhooks', 'delete', 'webhooks', 'Permission to delete webhook endpoints', NULL, NULL, NULL, false, '2026-11-13 15:51:36.873042', '2026-11-13 15:51:36.873042'),
	('90731b57-730b-4bc1-a56a-e456edc65e45', 'Read Releases', 'read-content-releases', 'read', 'content-releases', 'Permission to view content releases and their members', NULL, NULL, NULL, false, '2026-11-13 15:51:36.873807', '2026-11-13 15:51:36.873807'),
	('c2eb9f66-4e46-4210-8590-425eb06f99a2', 'Create Releases', 'create-content-releases', 'create', 'content-releases', 'Permission to create a content release and choose its members', NULL, NULL, NULL, false, '2026-11-13 15:51:36.874912', '2026-11-13 15:51:36.874912'),
	('0a83f048-ea5a-4b1e-8513-c2d0ca31e401', 'Publish Releases', 'publish-content-releases', 'publish', 'content-releases', 'Permission to schedule or cancel a content release, which is what makes its content go live', NULL, NULL, NULL, false, '2026-11-13 15:51:36.876067', '2026-11-13 15:51:36.876067'),
	('5481fde8-3172-49c0-b537-f827ab910653', 'Update Releases', 'update-content-releases', 'update', 'content-releases', 'Permission to rename a content release and change its description', NULL, NULL, NULL, false, '2026-11-13 15:51:36.879166', '2026-11-13 15:51:36.879166'),
	('00e5de37-e93c-4403-8923-65e1a8a46767', 'Delete Releases', 'delete-content-releases', 'delete', 'content-releases', 'Permission to delete a draft or cancelled content release; one that is scheduled, stopped or published stays', NULL, NULL, NULL, false, '2026-11-13 15:51:36.88179', '2026-11-13 15:51:36.88179'),
	('179b2d93-5337-403f-96df-45d4fe265c7d', 'Manage Background Jobs', 'manage-background-jobs', 'manage', 'background-jobs', 'Permission to run the background job queue by hand, outside its schedule', NULL, NULL, NULL, false, '2026-11-13 15:51:36.887656', '2026-11-13 15:51:36.887656'),
	('4383d0f1-6333-43ec-ad45-a5f5fa36ce82', 'Manage page builder site settings', 'manage-page-builder-site', 'manage', 'page-builder-site', 'Change the site''s breakpoints, and choose its default Layout.', '@nextlyhq/plugin-page-builder', NULL, 'General', false, '2026-11-13 15:51:36.903319', '2026-11-13 15:51:36.903319'),
	('5de2f80c-0961-4f5a-b25a-0a9cdb1f544f', 'Lock shared styles', 'lock-page-builder-shared-styles', 'lock', 'page-builder-shared-styles', 'Lock and unlock the site''s shared styles. A locked style can''t be changed, renamed or removed.', '@nextlyhq/plugin-page-builder', NULL, 'General', false, '2026-11-13 15:51:36.905176', '2026-11-13 15:51:36.905176'),
	('0f022165-beac-4909-88d4-82e0f238231a', 'Manage template routing', 'manage-template-routing', 'manage', 'template-routing', 'Set or change the address a collection''s entries are served at. A change moves every entry''s live address.', '@nextlyhq/plugin-page-builder', NULL, 'General', false, '2026-11-13 15:51:36.90687', '2026-11-13 15:51:36.90687'),
	('2fce5ccb-9a5f-406a-8373-e5f7e131f3ce', 'Export Submissions', 'export-submissions', 'export', 'submissions', 'Export form submissions as CSV/JSON', '@nextlyhq/plugin-form-builder', NULL, 'General', true, '2026-11-13 15:51:36.908847', '2026-11-13 15:51:36.908847');

INSERT INTO public.role_permissions VALUES
	('523d615f-031c-4c98-ab6a-9b61d3adcaa4', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '28f3817c-3968-4f39-a8db-022ce901946a', '2026-11-13 15:51:36.93156'),
	('edd925bc-54c8-458c-bba5-1b2d72f0ad1b', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '42a3a334-bbbb-4d4a-b253-1d5f3c370629', '2026-11-13 15:51:36.93156'),
	('ca2f1432-ac22-4afb-97cd-eb784c9c891b', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '8ed63c8a-eeb4-4654-bf0a-500df9ea415a', '2026-11-13 15:51:36.93156'),
	('ec3ee547-db07-453a-b3d7-a1988001ca91', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '95c4d1ce-ca7a-452c-bf9d-13e85832ae52', '2026-11-13 15:51:36.93156'),
	('b96c51f1-c42a-4ba3-9034-a3768c85028c', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '179b2d93-5337-403f-96df-45d4fe265c7d', '2026-11-13 15:51:36.93156'),
	('ad6e0827-9d30-4cab-b959-b814300466e1', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '00e5de37-e93c-4403-8923-65e1a8a46767', '2026-11-13 15:51:36.93156'),
	('df4a9031-18cb-4d98-aa53-db9cfaff155c', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '0a83f048-ea5a-4b1e-8513-c2d0ca31e401', '2026-11-13 15:51:36.93156'),
	('050da9f7-ebbe-4328-8b32-a0469086fc29', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '5481fde8-3172-49c0-b537-f827ab910653', '2026-11-13 15:51:36.93156'),
	('5a1a3201-1010-4a13-a21c-de69e8b19694', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '90731b57-730b-4bc1-a56a-e456edc65e45', '2026-11-13 15:51:36.93156'),
	('9a0d7800-6700-4e20-8a94-c207933df795', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', 'c2eb9f66-4e46-4210-8590-425eb06f99a2', '2026-11-13 15:51:36.93156'),
	('ae8b9b97-0e11-4e76-b497-7a0a5cf4bbf1', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '0357e0c0-e4fe-4edc-82ff-02ecfd62d11f', '2026-11-13 15:51:36.93156'),
	('ea8e9d6b-73f3-4d08-ba21-127951941e66', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '3d16a840-1a5c-481b-a96b-527e9d40ab8b', '2026-11-13 15:51:36.93156'),
	('2e4b6acc-2ee8-4a6d-8fec-4f7e682c3352', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '74ce13c9-460e-49e5-be53-6bf1950c8255', '2026-11-13 15:51:36.93156'),
	('4b501c21-88e1-4d20-b393-f55dcb140e8d', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '97e3d8d0-56e6-4cc5-8ae0-c5f548fb7f60', '2026-11-13 15:51:36.93156'),
	('78d49187-6ce5-4259-b72c-ff28f7d9a735', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '57db8ea2-dece-462f-8d38-053cecf4abbd', '2026-11-13 15:51:36.93156'),
	('794f8906-d3ab-4d36-b953-c9d921082827', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '59fd8926-6d11-4e6a-a766-5deada5f98f9', '2026-11-13 15:51:36.93156'),
	('7967c5b0-5457-4181-a66b-822fff41a1bf', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '694d896d-a8c1-43c8-82b5-1d6c6c95ddd1', '2026-11-13 15:51:36.93156'),
	('fc6355b6-818e-4eae-9c4f-5ba4b14063e3', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '6bb1f37b-fcd8-42da-846d-66fe28d8c294', '2026-11-13 15:51:36.93156'),
	('187cf8dd-de0c-4e53-a42d-61a84d829a9c', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '3df340c7-1b08-4a21-9412-9401f94a5283', '2026-11-13 15:51:36.93156'),
	('505d93ff-99f6-4c5c-b898-83e233c3f548', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '603af40f-846c-480e-940e-c0cceee3a3a3', '2026-11-13 15:51:36.93156'),
	('27c1307e-624a-4ff7-8db8-1482fc689f9a', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', 'a55bb8f7-6c0a-4451-8296-a1b89e8194cb', '2026-11-13 15:51:36.93156'),
	('c7655dfc-16d0-457d-a8a6-d0346f24cf20', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', 'c0031d2e-3c1c-40dc-8fed-bd9ead006b90', '2026-11-13 15:51:36.93156'),
	('8bcca882-9739-49ae-b4b5-03e1776a2c03', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '5de2f80c-0961-4f5a-b25a-0a9cdb1f544f', '2026-11-13 15:51:36.93156'),
	('98c5e79c-9287-497f-9bce-b7213da814ec', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '4383d0f1-6333-43ec-ad45-a5f5fa36ce82', '2026-11-13 15:51:36.93156'),
	('df6fa484-b2f1-4a1b-9572-ffa765283837', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', 'b89b7df9-454f-4ceb-92ca-c8d6c7139b70', '2026-11-13 15:51:36.93156'),
	('e62d30e1-f42d-4cf4-992d-b0106d03dd9f', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '25a7ef39-048b-4627-b973-64fdbbd65a2c', '2026-11-13 15:51:36.93156'),
	('86772779-3bf4-4449-b1cb-7f29bf2832bb', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '5fd24a4f-404e-4961-8fd8-572e3668c796', '2026-11-13 15:51:36.93156'),
	('714da0bb-148a-406a-a8d5-0d339194bece', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', 'b9622cd8-81c0-41e6-9310-7bba36f811d2', '2026-11-13 15:51:36.93156'),
	('37fca8c3-6ce3-4d46-a6f9-cf1293ce96cb', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', 'd703cf0d-b1a7-4a7e-9bf3-daa08ce4000c', '2026-11-13 15:51:36.93156'),
	('0c229c46-b165-4ca9-80b5-cd88d80ee422', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '2fce5ccb-9a5f-406a-8373-e5f7e131f3ce', '2026-11-13 15:51:36.93156'),
	('449e56cf-69aa-4ce2-88a7-8da42e78d06c', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '0f022165-beac-4909-88d4-82e0f238231a', '2026-11-13 15:51:36.93156'),
	('8ee943b7-6ac9-4ba4-bdb1-812eb377e883', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', 'ce368057-2427-4ddf-a2a5-f37fca812f41', '2026-11-13 15:51:36.93156'),
	('2c2de517-d4ba-4685-a08c-154c16a4e9bc', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '69d3564d-dab1-4bd9-83f4-5265cfb9d023', '2026-11-13 15:51:36.93156'),
	('97cbd838-803a-4835-920b-c30491f2f447', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '6a93316b-671a-4c9f-a70c-ff23c0e13ca9', '2026-11-13 15:51:36.93156'),
	('0fb4c75b-7fcd-4712-bd7e-1c037b65afab', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', '8a5d5563-4b65-43fc-bd47-627fdee5543c', '2026-11-13 15:51:36.93156'),
	('785b4c9b-fc26-41a1-aeb6-968f372e5643', '4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', 'dcfddfac-da80-47e2-ab28-cb8507e59bee', '2026-11-13 15:51:36.93156'),
	('ddfa4a6e-3a69-43d1-9e52-4d2d49ef0965', '49a261ab-17bc-42dc-8dfd-672701d98c23', '3df340c7-1b08-4a21-9412-9401f94a5283', '2026-11-13 15:51:36.93156'),
	('6ebfa8d3-69a1-433c-9821-0b4235b698b7', '49a261ab-17bc-42dc-8dfd-672701d98c23', '603af40f-846c-480e-940e-c0cceee3a3a3', '2026-11-13 15:51:36.93156'),
	('6db97cfc-3a7e-4ad6-a998-7385467cedff', '49a261ab-17bc-42dc-8dfd-672701d98c23', 'a55bb8f7-6c0a-4451-8296-a1b89e8194cb', '2026-11-13 15:51:36.93156'),
	('a4dbde55-9eac-421a-9364-0ae2e043e537', '49a261ab-17bc-42dc-8dfd-672701d98c23', 'c0031d2e-3c1c-40dc-8fed-bd9ead006b90', '2026-11-13 15:51:36.93156'),
	('5af912ec-b6fc-4a13-be84-843ab3d596e3', '4b62cb67-9bc0-4ea3-b290-019377483ea6', '603af40f-846c-480e-940e-c0cceee3a3a3', '2026-11-13 15:51:36.93156'),
	('74dd8d0a-a2da-409d-9137-a9733acf01be', '4b62cb67-9bc0-4ea3-b290-019377483ea6', 'a55bb8f7-6c0a-4451-8296-a1b89e8194cb', '2026-11-13 15:51:36.93156'),
	('00d0351e-0b6d-4b49-b5bd-6d2682435e2b', '4b62cb67-9bc0-4ea3-b290-019377483ea6', 'c0031d2e-3c1c-40dc-8fed-bd9ead006b90', '2026-11-13 15:51:36.93156'),
	('8911b7bb-627c-43b0-b83e-be381aedc1a4', '64445ded-b720-4e90-ae4c-29d18f4cfc28', '28f3817c-3968-4f39-a8db-022ce901946a', '2026-11-13 15:51:36.93156'),
	('f1fdb432-8f38-428d-a6df-b9192ac1f6ab', '64445ded-b720-4e90-ae4c-29d18f4cfc28', '90731b57-730b-4bc1-a56a-e456edc65e45', '2026-11-13 15:51:36.93156'),
	('52343ac5-ede3-482e-98b8-2facf7c07c65', '64445ded-b720-4e90-ae4c-29d18f4cfc28', '0357e0c0-e4fe-4edc-82ff-02ecfd62d11f', '2026-11-13 15:51:36.93156'),
	('53f94763-cf15-41b0-8d4e-d75fc8bccb2c', '64445ded-b720-4e90-ae4c-29d18f4cfc28', '694d896d-a8c1-43c8-82b5-1d6c6c95ddd1', '2026-11-13 15:51:36.93156'),
	('c06e409e-d7d1-4062-abca-6716b47c9510', '64445ded-b720-4e90-ae4c-29d18f4cfc28', '603af40f-846c-480e-940e-c0cceee3a3a3', '2026-11-13 15:51:36.93156'),
	('1b2b6031-a28e-4382-b309-58e709483d63', '64445ded-b720-4e90-ae4c-29d18f4cfc28', 'b89b7df9-454f-4ceb-92ca-c8d6c7139b70', '2026-11-13 15:51:36.93156'),
	('22fb15c1-1524-446e-82aa-3d60546ad286', '64445ded-b720-4e90-ae4c-29d18f4cfc28', '25a7ef39-048b-4627-b973-64fdbbd65a2c', '2026-11-13 15:51:36.93156'),
	('e35c4c66-8f34-4dec-986c-0fea6f22ba63', '64445ded-b720-4e90-ae4c-29d18f4cfc28', 'ce368057-2427-4ddf-a2a5-f37fca812f41', '2026-11-13 15:51:36.93156'),
	('c428d994-878c-4c1d-9ca3-ff5e033aa553', '64445ded-b720-4e90-ae4c-29d18f4cfc28', '8a5d5563-4b65-43fc-bd47-627fdee5543c', '2026-11-13 15:51:36.93156');

INSERT INTO public.roles VALUES
	('4c5f0cfc-c76e-4a6f-81ab-2e4ba901eb23', 'Admin', 'admin', 'Everything except granting access to others', 90, true, '2026-11-13 15:51:36.93156', '2026-11-13 15:51:36.93156'),
	('49a261ab-17bc-42dc-8dfd-672701d98c23', 'Editor', 'editor', 'Full control of content and media, including publishing', 50, true, '2026-11-13 15:51:36.93156', '2026-11-13 15:51:36.93156'),
	('4b62cb67-9bc0-4ea3-b290-019377483ea6', 'Author', 'author', 'Write content, but not publish or delete it', 30, true, '2026-11-13 15:51:36.93156', '2026-11-13 15:51:36.93156'),
	('64445ded-b720-4e90-ae4c-29d18f4cfc28', 'Viewer', 'viewer', 'Read everything, change nothing', 10, true, '2026-11-13 15:51:36.93156', '2026-11-13 15:51:36.93156');

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

