


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
    content jsonb
);



CREATE TABLE public.dc_block_pages_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    title text,
    slug text
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
    icon text
);



CREATE TABLE public.dc_categories_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    title text,
    slug text,
    description text
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
    slug text NOT NULL,
    area text,
    content jsonb
);



CREATE TABLE public.dc_components_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    title text,
    description text,
    category text
);



CREATE TABLE public.dc_form_submission_resends (
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
    submission text NOT NULL,
    ticked jsonb,
    exclude jsonb,
    retire jsonb,
    settled jsonb
);



CREATE TABLE public.dc_form_submission_resends_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    notification text,
    requested_by text
);



CREATE TABLE public.dc_form_submission_sends (
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
    submission text NOT NULL,
    queued_id text NOT NULL,
    form text,
    notification text,
    attempts integer,
    retries integer,
    changed_at timestamp without time zone,
    cancel jsonb,
    cancel_requested jsonb,
    configured jsonb,
    recipients jsonb
);



CREATE TABLE public.dc_form_submission_sends_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    send_key text,
    notification_name text,
    state text,
    retired_by text,
    requested_by text,
    resend text
);



CREATE TABLE public.dc_form_submissions (
    id text NOT NULL,
    slug text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying,
    _changed_by_id text,
    _changed_by_principal_kind character varying,
    _changed_at timestamp without time zone,
    form text NOT NULL,
    data jsonb NOT NULL,
    status text NOT NULL,
    submitted_at timestamp without time zone NOT NULL,
    edited_at timestamp without time zone,
    response_key text,
    asked jsonb
);



CREATE TABLE public.dc_form_submissions_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    spam_reason text,
    notes text,
    ip_address text,
    user_agent text,
    page text,
    edited_by text,
    title text
);



CREATE TABLE public.dc_form_uploads (
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
    media text NOT NULL,
    form text NOT NULL,
    submission text,
    released_at timestamp without time zone
);



CREATE TABLE public.dc_form_uploads_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    field text
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
    slug text NOT NULL,
    fields jsonb NOT NULL,
    settings jsonb,
    notifications jsonb,
    status text NOT NULL,
    went_live_at timestamp without time zone
);



CREATE TABLE public.dc_forms_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    name text,
    description text,
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
    slug text NOT NULL,
    areas jsonb
);



CREATE TABLE public.dc_layouts_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    title text,
    description text
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
    content jsonb,
    layout text,
    no_header_footer boolean
);



CREATE TABLE public.dc_pages_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    title text,
    slug text
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
    slug text NOT NULL,
    granularity text NOT NULL,
    content jsonb
);



CREATE TABLE public.dc_patterns_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    title text,
    description text,
    category text,
    keywords text
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
    editor_mode text,
    settings jsonb,
    sections jsonb,
    categories jsonb,
    tags jsonb,
    featured_image text,
    published_at timestamp without time zone,
    last_saved_at timestamp without time zone
);



CREATE TABLE public.dc_posts_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    title text,
    slug text,
    excerpt text,
    meta_title text,
    meta_description text,
    content text,
    custom_script text
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
    _changed_at timestamp without time zone
);



CREATE TABLE public.dc_tags_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    title text,
    slug text,
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
    collection text,
    entry text,
    entry_collection text,
    entry_id text,
    forked_from text,
    address text,
    content jsonb
);



CREATE TABLE public.dc_templates_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    title text
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
    queued_id character varying(36),
    template_owner text,
    template_overridden boolean,
    template_digest character varying(64),
    failure_kind character varying(16),
    failure_status integer,
    provider_origin character varying(16),
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
    template_slug character varying(255),
    message_kind character varying(16),
    recipient_kinds character varying(16),
    provider_type character varying(50),
    provider_id character varying(36),
    provider_origin character varying(16),
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
    format character varying(10),
    blocks jsonb,
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



CREATE TABLE public.nextly_external_identities (
    id text NOT NULL,
    provider_key text NOT NULL,
    issuer text NOT NULL,
    subject text NOT NULL,
    key_digest character varying(64) NOT NULL,
    address text,
    user_id text NOT NULL,
    created_at timestamp with time zone NOT NULL
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



CREATE TABLE public.nextly_translation_provenance (
    id text NOT NULL,
    scope_kind text NOT NULL,
    scope_slug text NOT NULL,
    entry_id text NOT NULL,
    locale text NOT NULL,
    part_state text NOT NULL,
    field_path text NOT NULL,
    value_fingerprint text NOT NULL,
    origin text NOT NULL,
    engine text,
    actor_kind text,
    actor_id text,
    actor_principal_kind text,
    source_locale text,
    source_fingerprint text,
    origin_row_id text,
    written_at timestamp with time zone NOT NULL
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
    base_draft_revision integer,
    field_sources jsonb,
    changed_locales jsonb,
    shared_changed boolean
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



CREATE TABLE public.page_builder__binding_uses (
    id text NOT NULL,
    document_key text NOT NULL,
    kind text NOT NULL,
    slug text NOT NULL,
    document_id text,
    place text NOT NULL,
    version text NOT NULL,
    locale text,
    blocks_field text NOT NULL,
    node_id text NOT NULL,
    block_type text NOT NULL,
    block_name text,
    prop text NOT NULL,
    path text NOT NULL,
    source_kind text NOT NULL,
    source_key text NOT NULL,
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
    class_id text NOT NULL,
    blocks integer
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



CREATE TABLE public.reading__list_items (
    id text NOT NULL,
    list_id character varying(255) NOT NULL,
    post_id text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.reading__lists (
    id text NOT NULL,
    owner_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
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
    layout jsonb
);



CREATE TABLE public.single_homepage_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    title text
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
    hero jsonb
);



CREATE TABLE public.single_landing_page_locales (
    _parent text NOT NULL,
    _locale character varying(20) NOT NULL,
    _updated_at timestamp with time zone,
    _revision integer DEFAULT 1 NOT NULL,
    _changed_by_kind character varying(16),
    _changed_by_id text,
    _changed_by_principal_kind character varying(64),
    _changed_at timestamp without time zone,
    title text
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



























































































































INSERT INTO public.dynamic_collections VALUES
	('21694013-42ac-4bfb-a780-cf1a573a89c8', 'authors', '{"plural": "Authors", "singular": "Author"}', 'dc_authors', NULL, '[{"name": "title", "type": "text", "label": "Title", "required": true, "localized": false}, {"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "bio", "type": "textarea", "label": "Biography"}, {"name": "jobTitle", "type": "text", "label": "Role / Title"}, {"name": "articleCount", "type": "number", "label": "Article Count"}, {"name": "avatar", "type": "upload", "label": "Avatar", "relationTo": "media"}]', true, true, true, '{"drafts": {"enabled": true, "autosave": {"enabled": true, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, '{"pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}, "useAsTitle": "title"}', NULL, 'code', true, NULL, '9574b54dab8dab53d40130bff603d766e1004126b673d9873a4e7a0b3a54a69f', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.362', '2026-11-23 04:47:33.516'),
	('a573b2cb-03e0-4395-a7be-434ce42e48da', 'block-pages', '{"plural": "Block Pages", "singular": "Block Page"}', 'dc_block_pages', NULL, '[{"name": "title", "type": "text", "required": true}, {"name": "slug", "type": "text", "unique": true, "required": true}, {"name": "content", "type": "json", "admin": {"description": "A @nextlyhq/blocks-engine BlockDocument. Rendered by blocks-react, not by the page builder."}, "label": "Block document"}]', true, true, false, '{"drafts": {"enabled": false, "autosave": {"enabled": false, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, '{"pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}}', NULL, 'code', true, NULL, 'e8ac65cbc2e6c69a97ea4503fe8df15c2aee64487d1190bbdc790e76b0a0e7bb', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.369', '2026-11-23 04:47:33.522'),
	('fb33737b-99bb-4020-8d79-34fa7ca5524c', 'categories', '{"plural": "Categories", "singular": "Category"}', 'dc_categories', NULL, '[{"name": "title", "type": "text", "required": true}, {"name": "slug", "type": "text", "unique": true, "required": true}, {"name": "description", "type": "textarea"}, {"name": "icon", "type": "icon", "label": "Icon"}]', true, false, false, NULL, NULL, NULL, '{"pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}}', NULL, 'code', true, NULL, 'bb9fa3378bdb739e5cf91fff9efd293e17cd805975945c94a715a97d7bd62dc5', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.372', '2026-11-23 04:47:33.526'),
	('72a8cb57-63fd-4fd3-a8b1-351afa529c41', 'components', '{"plural": "Components", "singular": "Component"}', 'dc_components', NULL, '[{"name": "title", "type": "text", "required": true}, {"name": "slug", "type": "text", "unique": true, "required": true, "localized": false}, {"name": "description", "type": "textarea"}, {"name": "category", "type": "text"}, {"name": "area", "type": "select", "admin": {"isClearable": true, "placeholder": "Anywhere"}, "label": "Use as", "options": [{"label": "Header", "value": "header"}, {"label": "Footer", "value": "footer"}]}, {"name": "content", "type": "blocks", "label": "Component", "blocks": {"kinds": ["component"]}}]', true, true, false, '{"drafts": {"enabled": true, "autosave": {"enabled": true, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, '{"hidden": true, "components": {"BeforeListTable": "@nextlyhq/plugin-page-builder/admin#ComponentListTools"}, "pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}, "useAsTitle": "title", "disableDelete": true}', NULL, 'plugin:@nextlyhq/plugin-page-builder', true, NULL, '3c59abcd739fcfbb2753cb953d44828e41893c1c2ed432af503ae662d375a301', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.376', '2026-11-23 04:47:33.531'),
	('4df53317-6f18-4ef2-8fe3-dc4850a7c68a', 'form-submission-resends', '{"plural": "Submission resends", "singular": "Submission resend"}', 'dc_form_submission_resends', NULL, '[{"name": "submission", "type": "text", "required": true, "localized": false}, {"name": "notification", "type": "text", "required": true}, {"name": "requestedBy", "type": "text"}, {"name": "ticked", "type": "json"}, {"name": "exclude", "type": "json"}, {"name": "retire", "type": "json"}, {"name": "settled", "type": "json"}]', true, false, false, NULL, NULL, '{"record": false}', NULL, NULL, 'plugin:@nextlyhq/plugin-form-builder', true, NULL, '302306984b5fc1c8832cca99fec3a8cb3b47b90579e17cae99f94cdcf96f04f8', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.379', '2026-11-23 04:47:33.536'),
	('b1b89e80-5a0f-42e7-9878-921eba9b2846', 'form-submission-sends', '{"plural": "Submission sends", "singular": "Submission send"}', 'dc_form_submission_sends', NULL, '[{"name": "submission", "type": "text", "required": true, "localized": false}, {"name": "queuedId", "type": "text", "required": true, "localized": false}, {"name": "sendKey", "type": "text", "required": true}, {"name": "form", "type": "text", "localized": false}, {"name": "notification", "type": "text", "localized": false}, {"name": "notificationName", "type": "text"}, {"name": "state", "type": "text"}, {"name": "attempts", "type": "number"}, {"name": "retries", "type": "number"}, {"name": "changedAt", "type": "date"}, {"name": "cancel", "type": "json"}, {"name": "cancelRequested", "type": "json"}, {"name": "retiredBy", "type": "text"}, {"name": "configured", "type": "json"}, {"name": "recipients", "type": "json"}, {"name": "requestedBy", "type": "text"}, {"name": "resend", "type": "text"}]', true, false, false, NULL, NULL, '{"record": false}', NULL, NULL, 'plugin:@nextlyhq/plugin-form-builder', true, NULL, '0779c8813feb5a919d2c2e40ed279cc893a7a9ea856e779e4c3c9adfb0416640', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.382', '2026-11-23 04:47:33.539'),
	('19c01413-91a4-4d26-ba6e-ee0352c501c0', 'form-submissions', '{"plural": "Submissions", "singular": "Submission"}', 'dc_form_submissions', 'View and manage form submissions', '[{"name": "form", "type": "relationship", "admin": {"readOnly": true, "description": "The form this submission belongs to"}, "label": "Form", "required": true, "relationTo": "forms"}, {"name": "data", "type": "json", "admin": {"readOnly": true, "description": "The submitted form data as JSON"}, "label": "Submission Data", "required": true}, {"name": "status", "type": "select", "admin": {"description": "Track whether this submission has been reviewed"}, "index": true, "label": "Status", "options": [{"label": "New", "value": "new"}, {"label": "Read", "value": "read"}, {"label": "Archived", "value": "archived"}, {"label": "Spam", "value": "spam"}], "required": true, "defaultValue": "new"}, {"name": "spamReason", "type": "text", "admin": {"readOnly": true, "description": "Which spam check flagged this submission (empty for clean submissions)"}, "label": "Spam Reason"}, {"name": "notes", "type": "textarea", "admin": {"description": "Notes visible only to admins (not shown to submitter)"}, "label": "Internal Notes"}, {"name": "ipAddress", "type": "text", "admin": {"readOnly": true, "description": "IP address of the submitter"}, "label": "IP Address"}, {"name": "userAgent", "type": "text", "admin": {"readOnly": true, "description": "Browser/device information of the submitter"}, "label": "User Agent"}, {"name": "page", "type": "textarea", "admin": {"hidden": true}, "label": "Page"}, {"name": "submittedAt", "type": "date", "admin": {"readOnly": true, "description": "When the form was submitted"}, "index": true, "label": "Submitted At", "required": true}, {"name": "editedAt", "type": "date", "admin": {"readOnly": true, "description": "When an admin last edited the submitted data"}, "label": "Edited At"}, {"name": "editedBy", "type": "text", "admin": {"readOnly": true, "description": "ID of the admin who last edited the submitted data"}, "label": "Edited By"}, {"name": "responseKey", "type": "text", "admin": {"hidden": true}, "label": "One-response key", "localized": false}, {"name": "asked", "type": "json", "admin": {"hidden": true}, "label": "Fields asked"}, {"name": "title", "type": "text", "admin": {"hidden": true}, "label": "Sender"}]', true, false, false, NULL, NULL, '{"record": false}', '{"group": "Forms", "order": 51, "isPlugin": true, "components": {"views": {"Edit": {"Component": "@nextlyhq/plugin-form-builder/admin#SubmissionPage"}, "List": {"Component": "@nextlyhq/plugin-form-builder/admin#SubmissionsView"}}}, "useAsTitle": "title", "disableCreate": true}', NULL, 'plugin:@nextlyhq/plugin-form-builder', true, NULL, '6335712e6584ae42de074501c22a31e8b4bde2543c7e512003708f3efc9593f0', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.386', '2026-11-23 04:47:33.543'),
	('e26e5f7f-b99e-4504-8d13-9935060ce308', 'form-uploads', '{"plural": "Form uploads", "singular": "Form upload"}', 'dc_form_uploads', NULL, '[{"name": "media", "type": "text", "required": true, "localized": false}, {"name": "form", "type": "text", "required": true, "localized": false}, {"name": "field", "type": "text", "required": true}, {"name": "submission", "type": "text", "localized": false}, {"name": "releasedAt", "type": "date"}]', true, false, false, NULL, NULL, '{"record": false}', NULL, NULL, 'plugin:@nextlyhq/plugin-form-builder', true, NULL, 'ac95228adc18eecf6702f32e049e2887f3113374eed27648f58581a338325e3f', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.389', '2026-11-23 04:47:33.547'),
	('6a389e43-3aa4-42fb-bd82-ba7e7cc6fd40', 'forms', '{"plural": "Forms", "singular": "Form"}', 'dc_forms', 'Create and manage your form templates using the visual form builder. Create and manage forms for collecting user submissions', '[{"name": "name", "type": "text", "admin": {"description": "Internal name for this form (not shown to users)"}, "label": "Form Name", "required": true}, {"name": "slug", "type": "text", "admin": {"description": "URL-friendly identifier. Used in API: /api/forms/{slug}"}, "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "description", "type": "textarea", "admin": {"description": "Internal notes about this form''s purpose"}, "label": "Description"}, {"name": "fields", "type": "json", "admin": {"description": "Form field configuration. Managed by the Form Builder UI."}, "label": "Form Fields", "required": true, "defaultValue": []}, {"name": "settings", "type": "group", "label": "Form Settings", "fields": [{"name": "submitButtonText", "type": "text", "admin": {"description": "Text displayed on the form submit button"}, "label": "Submit Button Text", "defaultValue": "Submit"}, {"name": "confirmationType", "type": "select", "admin": {"description": "What happens after a successful form submission"}, "label": "After Submission", "options": [{"label": "Show Message", "value": "message"}, {"label": "Redirect to URL", "value": "redirect"}, {"label": "Redirect to Page", "value": "relationship"}], "defaultValue": "message"}, {"name": "successMessage", "type": "textarea", "admin": {"condition": {"field": "settings.confirmationType", "equals": "message"}, "description": "Message shown after successful submission"}, "label": "Success Message", "defaultValue": "Thank you for your submission!"}, {"name": "redirectUrl", "type": "text", "admin": {"condition": {"field": "settings.confirmationType", "equals": "redirect"}, "description": "URL to redirect to after submission"}, "label": "Redirect URL"}, {"name": "redirectPage", "type": "relationship", "admin": {"condition": {"field": "settings.confirmationType", "equals": "relationship"}, "description": "Select a page to redirect to after submission"}, "label": "Redirect Page", "relationTo": ["pages"]}, {"name": "allowMultipleSubmissions", "type": "checkbox", "admin": {"hidden": true}, "label": "Allow Multiple Submissions"}, {"name": "oneResponse", "type": "select", "label": "One response per person", "options": [{"label": "Allow several responses", "value": "off"}, {"label": "One per email address", "value": "email"}, {"label": "One per browser", "value": "browser"}, {"label": "One per network (IP address)", "value": "ip"}]}, {"name": "oneResponseField", "type": "text", "label": "Email field for one response per person"}, {"name": "oneResponseVersion", "type": "number", "admin": {"hidden": true}, "label": "One-response version", "defaultValue": 0}, {"name": "oneResponseKeyedVersion", "type": "number", "admin": {"hidden": true}, "label": "One-response keys made for version"}, {"name": "honeypotEnabled", "type": "checkbox", "admin": {"description": "Per-form honeypot override; unset inherits the plugin default"}, "label": "Honeypot"}, {"name": "captchaEnabled", "type": "checkbox", "admin": {"hidden": true}, "label": "Enable reCAPTCHA"}, {"name": "botCheck", "type": "select", "label": "Bot check", "options": [{"label": "Site default", "value": "default"}, {"label": "Off", "value": "off"}, {"label": "reCAPTCHA", "value": "recaptcha"}, {"label": "Turnstile", "value": "turnstile"}]}, {"name": "closesAt", "type": "date", "label": "Closes at"}, {"min": 1, "name": "submissionLimit", "type": "number", "label": "Submission limit"}, {"name": "storeIpAndBrowser", "type": "checkbox", "label": "Store IP address and browser", "defaultValue": true}, {"min": 1, "name": "keepDays", "type": "number", "label": "Keep submissions for (days)"}, {"name": "internalNote", "type": "textarea", "label": "Internal note"}, {"name": "captchaSiteKey", "type": "text", "admin": {"condition": {"field": "settings.captchaEnabled", "equals": true}, "description": "Override the default reCAPTCHA site key for this form"}, "label": "reCAPTCHA Site Key"}]}, {"name": "notifications", "type": "json", "admin": {"description": "Email notification rules. Managed by the Form Builder UI."}, "label": "Notifications", "defaultValue": []}, {"name": "status", "type": "select", "admin": {"description": "Only published forms can receive submissions. Closed forms display a message instead."}, "label": "Status", "options": [{"label": "Draft", "value": "draft"}, {"label": "Published", "value": "published"}, {"label": "Closed", "value": "closed"}], "required": true, "defaultValue": "draft"}, {"name": "wentLiveAt", "type": "date", "admin": {"readOnly": true, "description": "When this form first went live. Written once and never changed."}, "label": "First Published"}, {"name": "closedMessage", "type": "textarea", "admin": {"condition": {"field": "status", "equals": "closed"}, "description": "Message shown when form status is ''closed''"}, "label": "Closed Form Message", "defaultValue": "This form is no longer accepting submissions."}]', true, false, false, NULL, NULL, NULL, '{"group": "Forms", "order": 50, "isPlugin": true, "components": {"views": {"Edit": {"Component": "@nextlyhq/plugin-form-builder/admin#FormBuilderView"}}}, "useAsTitle": "name"}', NULL, 'plugin:@nextlyhq/plugin-form-builder', true, NULL, '5a578f2b745016e46ea3657b3d54e09ff12bc8755351484ace308b1e510d63ff', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.395', '2026-11-23 04:47:33.552'),
	('69f0b3d9-c15a-49bd-99c6-00af023f5ab2', 'layouts', '{"plural": "Header & footer", "singular": "Header & footer set"}', 'dc_layouts', NULL, '[{"name": "title", "type": "text", "required": true}, {"name": "slug", "type": "text", "unique": true, "required": true, "localized": false}, {"name": "description", "type": "textarea"}, {"name": "areas", "type": "repeater", "fields": [{"name": "area", "type": "select", "options": [{"label": "Header", "value": "header"}, {"label": "Footer", "value": "footer"}], "required": true}, {"name": "component", "type": "relationship", "required": true, "relationTo": "components"}]}]', true, true, false, '{"drafts": {"enabled": true, "autosave": {"enabled": true, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, '{"hidden": true, "components": {"BeforeListTable": "@nextlyhq/plugin-page-builder/admin#LayoutListTools"}, "pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}, "useAsTitle": "title"}', NULL, 'plugin:@nextlyhq/plugin-page-builder', true, NULL, '9f54922cbb0eaf858d0392bd216d06a7c478bc8114cd5ab799231e9c8b75620b', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.402', '2026-11-23 04:47:33.556'),
	('3165f592-a4b3-4483-9bb2-d85977a70b32', 'nx_pb_address_claims', '{"plural": "Address claims", "singular": "Address claim"}', 'dc_nx_pb_address_claims', 'Which document holds each served address. Maintained automatically.', '[{"name": "title", "type": "text", "label": "Title", "required": true, "localized": false}, {"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "claimKey", "type": "text", "label": "Claim key", "unique": true, "required": true, "localized": false}, {"name": "kind", "type": "text", "index": true, "label": "Kind", "required": true, "localized": false}, {"name": "locale", "type": "text", "label": "Locale", "localized": false}, {"name": "path", "type": "textarea", "label": "Path", "localized": false}, {"name": "holderCollection", "type": "text", "index": true, "label": "Holder collection", "localized": false}, {"name": "holderId", "type": "text", "index": true, "label": "Holder id", "localized": false}, {"name": "space", "type": "text", "index": true, "label": "Space", "localized": false}, {"name": "blockedBy", "type": "text", "index": true, "label": "Blocked by", "localized": false}]', false, false, false, NULL, NULL, '{"record": false}', '{"hidden": true, "pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}}', NULL, 'plugin:@nextlyhq/plugin-page-builder', true, NULL, '8de6f4426cda5d37ee85d440bf70cf74258b36994c39f96b0a6aa26bdf98a1f2', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.406', '2026-11-23 04:47:33.56'),
	('5bcd6979-bd96-4390-aab0-d5ab40309707', 'nx_pb_class_usage', '{"plural": "Class usage", "singular": "Class usage"}', 'dc_nx_pb_class_usage', 'No longer used. The page builder keeps its usage index elsewhere, and nothing reads these rows.', '[{"name": "title", "type": "text", "label": "Title", "required": true, "localized": false}, {"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "scope", "type": "text", "label": "Scope", "localized": false}, {"name": "entity", "type": "text", "label": "Entity", "localized": false}, {"name": "entityKey", "type": "text", "index": true, "label": "Entity key", "localized": false}, {"name": "field", "type": "text", "label": "Field", "localized": false}, {"name": "locale", "type": "text", "label": "Locale", "localized": false}, {"name": "variant", "type": "text", "label": "Variant", "localized": false}, {"name": "classId", "type": "text", "index": true, "label": "Class id", "localized": false}]', false, false, false, NULL, NULL, '{"record": false}', '{"hidden": true, "pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}}', NULL, 'plugin:@nextlyhq/plugin-page-builder', true, NULL, '097355078d3cdff17284a917aba3f65a628cf18532561d57270fac46d554b261', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.409', '2026-11-23 04:47:33.564'),
	('f0227cdc-d6a9-42db-bf23-39ffc7657580', 'nx_pb_component_retired', '{"plural": "Retired component fields", "singular": "Retired component field"}', 'dc_nx_pb_component_retired', 'Fields removed from components. Maintained automatically when a component is published.', '[{"name": "title", "type": "text", "label": "Title", "required": true, "localized": false}, {"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "identity", "type": "text", "unique": true, "required": true, "localized": false}, {"name": "componentId", "type": "text", "index": true, "required": true, "localized": false}, {"name": "kind", "type": "text", "required": true, "localized": false}, {"name": "exposureId", "type": "textarea", "required": true, "localized": false}]', false, false, false, NULL, NULL, '{"record": false}', '{"hidden": true, "pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}}', NULL, 'plugin:@nextlyhq/plugin-page-builder', true, NULL, 'acaf1e1f5553f49a23e1e868045655032f62f7782ee899b2a1b3ac74d783a71e', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.413', '2026-11-23 04:47:33.567'),
	('535e6268-2bcb-45be-9d47-70766c5a75c1', 'nx_pb_component_usage', '{"plural": "Component usage", "singular": "Component usage"}', 'dc_nx_pb_component_usage', 'No longer used. The page builder keeps its usage index elsewhere, and nothing reads these rows.', '[{"name": "title", "type": "text", "label": "Title", "required": true, "localized": false}, {"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "scope", "type": "text", "label": "Scope", "localized": false}, {"name": "entity", "type": "text", "label": "Entity", "localized": false}, {"name": "entityKey", "type": "text", "index": true, "label": "Entity key", "localized": false}, {"name": "field", "type": "text", "label": "Field", "localized": false}, {"name": "locale", "type": "text", "label": "Locale", "localized": false}, {"name": "variant", "type": "text", "label": "Variant", "localized": false}, {"name": "kind", "type": "text", "label": "Kind", "localized": false}, {"name": "componentId", "type": "text", "index": true, "label": "Component id", "localized": false}]', false, false, false, NULL, NULL, '{"record": false}', '{"hidden": true, "pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}}', NULL, 'plugin:@nextlyhq/plugin-page-builder', true, NULL, '36ce808b133ef5c9e6ec6cdf729238823fcee558f3e423400d6365d9d69c066b', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.416', '2026-11-23 04:47:33.571'),
	('fdcb8cf8-4506-4533-9563-e1a7566d01cf', 'nx_pb_usage_backfill', '{"plural": "Usage backfill", "singular": "Usage backfill"}', 'dc_nx_pb_usage_backfill', 'No longer used. The page builder keeps its usage index progress elsewhere, and nothing reads these rows.', '[{"name": "title", "type": "text", "label": "Title", "required": true, "localized": false}, {"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "scopeKey", "type": "text", "index": true, "label": "Scope key", "localized": false}, {"name": "generation", "type": "text", "index": true, "label": "Generation", "localized": false}]', false, false, false, NULL, NULL, '{"record": false}', '{"hidden": true, "pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}}', NULL, 'plugin:@nextlyhq/plugin-page-builder', true, NULL, '52cb3df6ca6a996ae81c74e0dc2964785a89000a9e98046978224f4a30057909', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.419', '2026-11-23 04:47:33.574'),
	('b97b1e2c-c515-4567-83ec-b903bcf8efbb', 'pages', '{"plural": "Pages", "singular": "Page"}', 'dc_pages', NULL, '[{"name": "title", "type": "text", "required": true}, {"name": "slug", "type": "text", "unique": true, "required": true}, {"name": "content", "type": "blocks", "label": "Page Builder"}, {"name": "layout", "type": "relationship", "admin": {"hidden": true, "description": "Leave empty to use the site''s default header & footer set."}, "label": "Header & footer", "relationTo": "layouts"}, {"name": "noHeaderFooter", "type": "checkbox", "admin": {"hidden": true}, "label": "No header or footer", "defaultValue": false}]', true, true, false, '{"drafts": {"enabled": true, "autosave": {"enabled": true, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, '{"pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}, "useAsTitle": "title"}', NULL, 'plugin:@nextlyhq/plugin-page-builder', true, NULL, '8c4db2ea8a7cc335c49460cd47a2e4bcc6f9d18551265ad8c10aa455dfdfe79a', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.422', '2026-11-23 04:47:33.577'),
	('703d3e43-169d-411a-b739-4a16eebb2342', 'patterns', '{"plural": "Saved sections", "singular": "Saved section"}', 'dc_patterns', NULL, '[{"name": "title", "type": "text", "required": true}, {"name": "slug", "type": "text", "unique": true, "required": true, "localized": false}, {"name": "description", "type": "textarea"}, {"name": "category", "type": "text"}, {"name": "keywords", "type": "text"}, {"name": "granularity", "type": "select", "options": [{"label": "element", "value": "element"}, {"label": "group", "value": "group"}, {"label": "section", "value": "section"}, {"label": "page", "value": "page"}], "required": true}, {"name": "content", "type": "blocks", "label": "Saved section", "blocks": {"kinds": ["pattern"]}}]', true, true, false, '{"drafts": {"enabled": true, "autosave": {"enabled": true, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, '{"hidden": true, "components": {"BeforeListTable": "@nextlyhq/plugin-page-builder/admin#TransferImport"}, "pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}, "useAsTitle": "title"}', NULL, 'plugin:@nextlyhq/plugin-page-builder', true, NULL, 'e9c577d0f3fc82d2caa8342275a071942f4b92e6ff3ed6dcd9a138a0b195a313', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.425', '2026-11-23 04:47:33.581'),
	('9dffbbb7-ef8d-4f4a-9233-5e67e4c3904d', 'posts', '{"plural": "Posts", "singular": "Post"}', 'dc_posts', NULL, '[{"name": "title", "type": "text", "required": true}, {"name": "slug", "type": "text", "unique": true, "required": true}, {"name": "excerpt", "type": "textarea"}, {"name": "metaTitle", "type": "text"}, {"name": "metaDescription", "type": "text"}, {"name": "editorMode", "type": "select", "admin": {"description": "Choose how to build this post''s body."}, "label": "Editor", "options": [{"label": "Standard editor", "value": "standard"}, {"label": "Page Builder", "value": "page-builder"}], "defaultValue": "standard"}, {"name": "content", "type": "richText", "admin": {"condition": {"field": "editorMode", "equals": "standard"}}}, {"name": "customScript", "type": "code", "admin": {"language": "typescript", "description": "Runs when this post is rendered."}}, {"name": "settings", "type": "json", "admin": {"description": "Arbitrary per-post configuration."}}, {"name": "sections", "type": "blocks", "admin": {"condition": {"field": "editorMode", "equals": "page-builder"}}, "blocks": {"allow": ["core/*"]}}, {"name": "categories", "type": "relationship", "hasMany": true, "relationTo": "categories"}, {"name": "tags", "type": "relationship", "hasMany": true, "relationTo": "tags"}, {"name": "featuredImage", "type": "upload", "relationTo": "media"}, {"name": "publishedAt", "type": "date"}]', true, true, false, '{"drafts": {"enabled": true, "autosave": {"enabled": true, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, '{"pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}, "useAsTitle": "title"}', NULL, 'code', true, NULL, '58ad88c3c41de147d5158ee231bc1fedf1e412ab634ccebd3f1c96b70a81aa2b', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.427', '2026-11-23 04:47:33.584'),
	('a5044428-ddf4-4bfc-9833-eda0efa55f3f', 'tags', '{"plural": "Tags", "singular": "Tag"}', 'dc_tags', NULL, '[{"name": "title", "type": "text", "required": true}, {"name": "slug", "type": "text", "unique": true, "required": true}, {"name": "description", "type": "textarea"}]', true, false, false, NULL, NULL, NULL, '{"pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}}', NULL, 'code', true, NULL, '200bd33fa25e12a7c3744ab96cd121402cd32bb6af4a0413911a737bab950a94', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.43', '2026-11-23 04:47:33.587'),
	('78448576-12ad-40ce-b17d-02c4c9a18f52', 'templates', '{"plural": "Collection templates", "singular": "Collection template"}', 'dc_templates', NULL, '[{"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "title", "type": "text", "required": true, "maxLength": 255}, {"name": "collection", "type": "text", "admin": {"component": "@nextlyhq/plugin-page-builder/admin#TemplateCollectionField", "condition": {"field": "entry", "equals": ""}, "description": "The collection whose entries this template draws. A collection has one template, and it cannot be changed once the template exists."}, "label": "Collection", "unique": true, "localized": false}, {"name": "entry", "type": "text", "admin": {"hidden": true, "description": "The entry this design serves, when it is an entry''s own design rather than its collection''s template. Set when it is made, and never changed."}, "label": "Entry", "unique": true, "localized": false}, {"name": "entryCollection", "type": "text", "admin": {"hidden": true}, "index": true, "label": "Entry''s collection", "localized": false}, {"name": "entryId", "type": "text", "admin": {"hidden": true}, "label": "Entry id", "localized": false}, {"name": "forkedFrom", "type": "text", "admin": {"hidden": true}, "index": true, "label": "Copied from", "localized": false}, {"name": "address", "type": "text", "admin": {"component": "@nextlyhq/plugin-page-builder/admin#TemplateAddressField", "condition": {"field": "entry", "equals": ""}, "description": "Where this collection''s entries are served: with /blog, the entry hello is served at /blog/hello once the template is published. Changing it moves every entry to the new address and frees the old ones.", "placeholder": "/blog"}, "label": "Address", "unique": true, "localized": false, "maxLength": 255}, {"name": "content", "type": "blocks", "label": "Collection template", "blocks": {"kinds": ["template"]}}]', true, true, false, '{"drafts": {"enabled": true, "autosave": {"enabled": true, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, '{"hidden": true, "pagination": {"limits": [10, 25, 50, 100], "defaultLimit": 10}, "useAsTitle": "title", "defaultColumns": ["title", "collection", "address", "status"]}', NULL, 'plugin:@nextlyhq/plugin-page-builder', true, NULL, '3949d5829f15fbc49a505c57c53cce5543a11a81c81c7bb1408c871f7883be2b', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.432', '2026-11-23 04:47:33.591');



INSERT INTO public.dynamic_components VALUES
	('0b0f8e09-8f1a-46ff-b88f-fea668d3b476', 'seo', 'SEO Metadata', 'comp_seo', NULL, '[{"name": "metaTitle", "type": "text", "label": "Meta Title"}, {"name": "metaDescription", "type": "textarea", "label": "Meta Description"}, {"name": "ogImage", "type": "upload", "label": "OG Image", "relationTo": "media"}]', '{"category": "Shared", "description": "Search-engine and social-share metadata."}', 'code', true, true, 'components/seo.ts', 'b42685ed7e2e672728c80c48271817c2d4b8b958d789f6355536f4bba02d13f7', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.462', '2026-11-23 04:47:33.621');



INSERT INTO public.dynamic_singles VALUES
	('73274e87-c412-449b-ac1e-d7ac7b3c5ed6', 'announcement', 'Announcement', 'single_announcement', NULL, '[{"name": "title", "type": "text", "label": "Title", "required": true, "localized": false}, {"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "campaign", "type": "text", "label": "Campaign", "localized": false}, {"name": "headline", "type": "text", "label": "Headline"}, {"name": "body", "type": "textarea", "label": "Body"}]', '{}', 'code', true, true, true, '{"drafts": {"enabled": true, "autosave": {"enabled": true, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, NULL, '383af6a2a438d655a05f247e3505a7a49158601211a53fa2fd63bba4bf99cc77', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.436', '2026-11-23 04:47:33.596'),
	('9386d868-452e-412a-b04a-7e388a6078d5', 'homepage', 'Homepage', 'single_homepage', NULL, '[{"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "title", "type": "text"}, {"name": "layout", "type": "blocks", "label": "Layout", "blocks": {"allow": ["core/*"]}}]', '{}', 'code', true, false, false, '{"drafts": {"enabled": true, "autosave": {"enabled": true, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, NULL, '5d793e3ec0ba01cd60314dedc10e877554cde735e7218d69a2cc207229abaf24', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.439', '2026-11-23 04:47:33.6'),
	('cb524c87-ebce-445f-a819-361b8dc6772b', 'landing-page', 'Landing Page', 'single_landing_page', NULL, '[{"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "title", "type": "text"}, {"name": "hero", "type": "blocks", "label": "Hero section", "blocks": {"allow": ["core/*"]}}]', '{}', 'code', true, true, false, '{"drafts": {"enabled": false, "autosave": {"enabled": false, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, NULL, '0f6e230b923e46a497101a43d5535df61d034f9f992d09efb5e598af25777309', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.442', '2026-11-23 04:47:33.603'),
	('4a855c09-df10-43f6-b7bd-e6309ec4c4a4', 'page-builder-settings', 'Page Builder Settings', 'single_page_builder_settings', NULL, '[{"name": "title", "type": "text", "label": "Title", "required": true, "localized": false}, {"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "defaultLayout", "type": "relationship", "admin": {"readOnly": true}, "label": "Default header & footer set", "relationTo": "layouts"}, {"name": "seededLayout", "type": "relationship", "admin": {"hidden": true, "readOnly": true}, "label": "Seeded header & footer set", "relationTo": "layouts"}, {"name": "defaultLayoutChangedBy", "type": "text", "admin": {"hidden": true, "readOnly": true}, "label": "Default changed by", "localized": false}]', '{"hidden": true, "description": "The header & footer set pages are drawn inside when they choose none of their own. Set from the Header & footer list."}', 'code', true, false, false, NULL, NULL, NULL, NULL, 'a58a522c82c355c911beb7d23484bdb5bdb8dfa2becbb64b8b1fde3d0efbedf1', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.447', '2026-11-23 04:47:33.607'),
	('dc29c643-021b-48ac-b040-742feb206378', 'page-builder-site-code', 'Site Code', 'single_page_builder_site_code', NULL, '[{"name": "title", "type": "text", "label": "Title", "required": true, "localized": false}, {"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "headSource", "type": "textarea", "admin": {"readOnly": true}, "label": "Head", "localized": false}, {"name": "bodySource", "type": "textarea", "admin": {"readOnly": true}, "label": "End of body", "localized": false}, {"name": "head", "type": "json", "admin": {"hidden": true, "readOnly": true}, "label": "Head entries"}, {"name": "body", "type": "json", "admin": {"hidden": true, "readOnly": true}, "label": "End of body entries"}, {"name": "changedBy", "type": "text", "admin": {"hidden": true, "readOnly": true}, "label": "Changed by", "localized": false}]', '{"hidden": true, "description": "Code added to every page of the site. Changed in Settings, under Site."}', 'code', true, false, false, '{"drafts": {"enabled": true, "autosave": {"enabled": true, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, NULL, '1db6be20129d2bc9d385389e63d4ac1d047990f074b4fbabd767cc4b002db9e7', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.449', '2026-11-23 04:47:33.611'),
	('55acc615-6bd4-4e78-aebe-e5e2b4c7fddc', 'site-settings', 'Site Settings', 'single_site_settings', NULL, '[{"name": "title", "type": "text", "label": "Title", "required": true, "localized": false}, {"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "siteName", "type": "text", "label": "Site Name", "required": true, "localized": false}, {"name": "tagline", "type": "textarea", "label": "Tagline"}, {"name": "seo", "type": "component", "label": "Default SEO", "component": "seo"}]', '{}', 'code', true, false, true, '{"drafts": {"enabled": true, "autosave": {"enabled": true, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, NULL, '8ea4ce97622df5c31d0a9663202a201da90ad6668d3cee173a4c3ac7e18db581', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.455', '2026-11-23 04:47:33.614'),
	('1a6617bc-a07a-48a2-a618-192b55eff559', 'site-style', 'Site Style', 'single_site_style', NULL, '[{"name": "title", "type": "text", "label": "Title", "required": true, "localized": false}, {"name": "slug", "type": "text", "label": "Slug", "unique": true, "required": true, "localized": false}, {"name": "tokens", "type": "json", "admin": {"description": "A token set: { tokens: [{ id?, name, label?, kind, values: { light, dark? }, fluid?: { small, large }, group? }], prefix?, darkMode?, fluidRange?: { min, max }, order?: [identity], builtInColoursShown?: boolean, siteText?: { body?, h1?…h6?, link?, button?, caption? } }. Values are per mode; \"light\" is what a reader with no mode set resolves. `id` is the token''s stable identity — set it once and a later rename of `name` leaves every page that references the token working; omit it and the name is the identity. `fluid` is the two sizes in px a fluid size was made from, and `fluidRange` the screen widths in px it grows between (360 to 1280 when absent). `group` is the named group a colour is listed under and `order` the identities of the colours in the order they are listed, both display-only. `builtInColoursShown: false` leaves the built-in colours the site does not use out of the Design panel and the colour pickers; they are still written on every page. `siteText` sets the text of every page: each row holds `fontFamily`, `fontSize` and `lineHeight` (a variable reference such as { $token: \"font-size.h2\" } or a value; the Body font is `body.fontFamily` set to { $token: \"font.body\" } and the Headings font is `fontFamily` set to { $token: \"font.heading\" } on every heading row), and the `link` row `color`, `hoverColor` and `underline` (\"always\", \"hover\" or \"never\") instead; a row left out keeps its built-in value."}, "label": "Design tokens"}, {"name": "fonts", "type": "json", "admin": {"description": "Self-hosted @font-face definitions: [{ family, src: [{ url, format? }], weight?, style? }]. Files must live on this site."}, "label": "Font faces"}, {"name": "classes", "type": "json", "admin": {"description": "Reusable style presets: [{ id, slug, label?, orderIndex, styles, locked? }]. Documents reference a class by id; a later orderIndex overrides an earlier one. `label` is the name authors see; `locked: true` holds the class as it is until it is unlocked."}, "label": "Named classes"}, {"name": "breakpoints", "type": "json", "admin": {"description": "The site''s breakpoints: { viewport: [{ id, label, maxWidth? }], container: [...] }. Ids must be unique across both axes; the base breakpoint has no maxWidth."}, "label": "Breakpoints"}]', '{"icon": "Palette", "description": "Site-wide design tokens, fonts, classes and breakpoints for pages built from blocks."}', 'code', true, false, false, '{"drafts": {"enabled": true, "autosave": {"enabled": true, "intervalMs": 1000}}, "enabled": true, "maxPerDoc": 50}', NULL, NULL, NULL, 'c565a9373778365db99ffc4f99f2d4f00a3356adbe7e14b9c97fb6fb459959c8', 1, 'applied', NULL, NULL, '2026-11-23 04:47:33.458', '2026-11-23 04:47:33.617');

































INSERT INTO public.nextly_cache_tag_expiries VALUES
	('196f52e8b9ee9af8a1f6efc7643944f765b59ece49f624bdc9442804ce7b3469', 'nextly:authors', 1795409256073),
	('e610992ebb64c532e52a1bf8965e68ddc39624a9aedfa029ed9e022e7fda1b90', 'nextly:block-pages', 1795409256073),
	('6e1d0f3ee1e7a4e57e7b9c9f849b827d5fb9630b7a4aed557c0aa4241c5b0d25', 'nextly:categories', 1795409256073),
	('4bc3f91485047dd868569cd04c78536223036443f6944cd35e5a080e4af3c784', 'nextly:components', 1795409256073),
	('3f6055ebf4e2e790d78cdec59abebc514a12efe3ba2eac83fbdc9d14477b86b6', 'nextly:form-submission-resends', 1795409256073),
	('b55bd0b602d772cda029806d44dfd6cff9d79e036fe671b68d1cca4b626eb3fc', 'nextly:form-submission-sends', 1795409256073),
	('e43a21fe5f8326f2b558d2bf0f9511eb8ab154830dbc21c7c30cbfab956f4d46', 'nextly:form-submissions', 1795409256073),
	('dc89a5f5fb2d249a7a19d6f90d8a4570c52f6a17c6107180c04c9a3cb540ea08', 'nextly:form-uploads', 1795409256073),
	('8f0a1fe2cbeca15a2e8f48e423da6b8926c7dd0d9ec056ba9cb4da0dc10beda3', 'nextly:forms', 1795409256073),
	('1ae6c0cba0a90552d7ef46de27b6d4c9d50050c2f37df2ced0bf528a651e514d', 'nextly:layouts', 1795409256073),
	('90ddf72aa37d60f19135fcac40945c3d3ef70a8ba2fa3e07baef09db333268a5', 'nextly:nx_pb_address_claims', 1795409256073),
	('b40f545e925b03821fdc21ff42d85f26925a1613087ebdde038f187ba56547ab', 'nextly:nx_pb_class_usage', 1795409256073),
	('0934dd1d2250257e0c815e4f1bf8444689faf1773dd32c669194e72d119f4480', 'nextly:nx_pb_component_retired', 1795409256073),
	('345827994938fb50297f0c43a5954c56a77c506ecff30871504d50bf1558b3b0', 'nextly:nx_pb_component_usage', 1795409256073),
	('1fb73701362b2ddd37ce5a48c537f404d5bf76bc892e63854c83f4e9e9e4255c', 'nextly:nx_pb_usage_backfill', 1795409256073),
	('f7336b4be5e930dbee8010131d536479b9e24a7a5023c8eb9dbd50a20ea61172', 'nextly:pages', 1795409256073),
	('ab4f77ac592b98f0fb738cc32d879e0b3962e07d008ed4d85458cb8639a8e752', 'nextly:patterns', 1795409256073),
	('8b0c6efbe48b7f60bc93a0120f901e50e6f12253b0c4c3d0df7825491cd024a4', 'nextly:posts', 1795409256073),
	('3605cc0ff8c05260d0520356db39c189864f60d1b2ff0bfcf57328fd74d38a46', 'nextly:tags', 1795409256073),
	('eb5895cd9d57f56cc4353e8320ee8318c5c0a50f043740fa3d65bb0fd1640cf2', 'nextly:templates', 1795409256073),
	('42154262594900e3715c2c2eb56e8d20dd8c29a97b11c7d8b106ead41e484245', 'nextly:single:announcement', 1795409256073),
	('ec788ab296ed5baa48a7611054330223cb52d36b333f7c46f53b90c360c8dfed', 'nextly:single:homepage', 1795409256073),
	('c78830075125ee97a521f7a78edb8dea657e4fafcd2a24d31cbf1f3260d6311c', 'nextly:single:landing-page', 1795409256073),
	('6237ef38c37ab913772883cda6cea0eeca6e617b1d07ea50ee48119a24aea5a0', 'nextly:single:page-builder-settings', 1795409256073),
	('8418a57f7e6cb6f51937a9a617fa96b9f8c58523ffe62150870c8e4e5f48b687', 'nextly:single:page-builder-site-code', 1795409256073),
	('da349ada08ecfa4c18881030e9b062ff97533a6b0396908514a734fbe3df70e8', 'nextly:single:site-settings', 1795409256073),
	('d84dbfa1c24f9b12ac60a6f6bccd86d52e3e7e0b1dc14b687a57acae8bb5ad85', 'nextly:single:site-style', 1795409256073);



























INSERT INTO public.nextly_field_group_lock VALUES
	(1, NULL, NULL);


















INSERT INTO public.nextly_meta VALUES
	('registry_record', '"{\"point\":null,\"baseline\":{\"collections\":{},\"singles\":{},\"fieldGroups\":{},\"permissions\":[],\"ownedPermissions\":[]}}"', '2026-11-23 04:47:31.052+00'),
	('schema_version', '"{\"migration\":\"20261123_044716_023_unique_localization_pages\",\"seq\":1}"', '2026-11-23 04:47:33.623+00'),
	('public-read-upgrade-notice', '"\"not-due\""', '2026-11-23 04:47:33.709+00'),
	('preset-grants-grandfathered', '"{\"collections\":{}}"', '2026-11-23 04:47:33.904+00'),
	('preset_grants_release', '"{\"release\":\"0.0.2-alpha.79\"}"', '2026-11-23 04:47:33.997+00'),
	('collections-closed-to-super-admin-in-code', '"{\"collections\":{}}"', '2026-11-23 04:47:34.024+00'),
	('public-role-created', '"\"created\""', '2026-11-23 04:47:34.037+00'),
	('public-role-granted', '"{\"role\":\"9a3e3693-2279-4c89-88b9-e116a99bf813\",\"granted\":[\"522bc4f1-e08c-4388-91cc-f6b839578893\",\"6babf5cd-30c4-4352-b160-49435695b96f\",\"842d06ec-f173-4d78-ad68-0888f8704b71\",\"8440bfa1-b21d-40b4-9b8c-6da486eeb13b\",\"950b64a8-0c44-48cd-ac1b-b217966a46e4\",\"aa7ddb1f-fd1c-4d44-9966-2ed9ab7519da\",\"b9c780ac-23aa-47ef-bd19-6167ed107700\",\"f08a7e56-ba5a-49c8-871a-ce8ddaf74c8b\"],\"declared\":{\"950b64a8-0c44-48cd-ac1b-b217966a46e4\":{\"action\":\"create\",\"resource\":\"form-submissions\",\"owner\":\"@nextlyhq/plugin-form-builder\"}}}"', '2026-11-23 04:47:34.068+00');
























INSERT INTO public.nextly_rbac_epoch VALUES
	('global', 8, 'aa1af6d2-76e7-4e3b-a22e-4b92d301fa88', '2026-11-23 04:47:34.071+00');


















INSERT INTO public.nextly_schema_events VALUES
	('47da1cc1-2d66-4275-87ad-0fe29bf4cd35', 'core_apply', 'applied', 'cli-migrate', NULL, NULL, 'core', NULL, '2026-11-23 04:47:28.801+00', '2026-11-23 04:47:28.804+00', NULL, NULL, NULL, NULL, 280, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('e73d9196-2d23-46bd-9e63-002e0e92093d', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261102_183408_943_create_usage_bookkeeping', '5c870a6fee243c233144409e147e1d420ee08445c71c7275108f02ff73e81eac', NULL, NULL, '2026-11-23 04:47:28.952+00', '2026-11-23 04:47:28.999+00', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('cd876dca-8074-479b-a925-20968e863189', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261103_024902_454_create_layout_removals', 'b783849639cdf821af36b98effb82ed4a20ca0ca05621b9c72dce9f0eebb5231', NULL, NULL, '2026-11-23 04:47:29.042+00', '2026-11-23 04:47:29.073+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('b3ffb621-8a7d-4c52-903b-6837c3acc41d', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_063215_663_create_component_rewrite_runs', '55669705dcc7ca39c8975f10a6b51e5f4a566b419508a6cd6b00f9bec27b0337', NULL, NULL, '2026-11-23 04:47:29.13+00', '2026-11-23 04:47:29.141+00', NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('2aaf0793-94c4-49e7-96bd-65a4cb6e3a70', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261104_115414_028_create_site_options', 'b5d588d3b364de00f301087f219d0acd5d777b8f1779b5287498b26b2f41f897', NULL, NULL, '2026-11-23 04:47:29.188+00', '2026-11-23 04:47:29.231+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('b3f4c7eb-b9b6-4497-aa16-b462babce8e9', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261105_064012_324_create_breakpoint_removals', 'c3c9b9717e772b91c502ae3db1417f288141b7565f8a016609908370a4d1d4a8', NULL, NULL, '2026-11-23 04:47:29.296+00', '2026-11-23 04:47:29.334+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('8de09e63-3a7c-4fc9-a87d-3da72c9e9791', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_064828_573_create_breakpoint_removal_fragments', '2188b3de23d90100d49a761b4b970cc76f7c0d698e08ee95b2da7c49b5bcf20c', NULL, NULL, '2026-11-23 04:47:29.396+00', '2026-11-23 04:47:29.406+00', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('c453a3e1-34a2-45bc-9f8b-fa2d1c725e2e', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_084948_318_create_usage_index_tables', '261b1425453c4d00d7f267402783bb2b1456efbf33786d30144d52f16e334c7b', NULL, NULL, '2026-11-23 04:47:29.461+00', '2026-11-23 04:47:29.475+00', NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('a086050a-2602-489a-a803-5fe60ec7e2ef', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_095219_741_add_breakpoint_removal_undoes', 'bd09923df56aa2b4215f555ddfc3248d6fe827ffcde1c8471f9697c86b0e029e', NULL, NULL, '2026-11-23 04:47:29.54+00', '2026-11-23 04:47:29.548+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('0a1004d1-5a46-4467-b146-d03078d831be', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261106_104001_085_create_token_usage_table', '677b6856df085719792fe7c9a8e7d4e8cb3deda9fd2e142556e0837cfb79baf6', NULL, NULL, '2026-11-23 04:47:29.618+00', '2026-11-23 04:47:29.625+00', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('59d583c0-421e-4231-80f4-cfe342bc9be6', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261107_174750_902_create_binding_report_tables', 'ea204e324914661b2d4e6fc1ad4fc62781a6ce8dd81add103beed79a74d89e05', NULL, NULL, '2026-11-23 04:47:29.69+00', '2026-11-23 04:47:29.74+00', NULL, NULL, NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('5462c336-c776-4744-973a-820887ad1be2', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261112_193109_764_seed_composition_graph_lock', '3d0cd7df9937f5d849c10da3c55b5adbfe788d92601a4b33c802fe99607cb1e6', NULL, NULL, '2026-11-23 04:47:29.797+00', '2026-11-23 04:47:29.808+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('4c314e27-b25b-450d-ba1d-122ba446dda4', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261117_054612_570_create_binding_uses_table', 'c7dba671d14bfc919719e1d6e7e2c612b53a0fec9dd00ca9f801748964999a04', NULL, NULL, '2026-11-23 04:47:29.872+00', '2026-11-23 04:47:29.883+00', NULL, NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('5b8a489e-7cdb-4dd0-9ee7-f015fcb79d3d', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261117_132736_174_reset_binding_uses_fill', '3c20140487117e9d3909b63ade314ba5b916c76e5387412dbbd5b4b125a592c6', NULL, NULL, '2026-11-23 04:47:29.939+00', '2026-11-23 04:47:29.945+00', NULL, NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('ca955ef0-9b4d-4af8-9b06-a2b5739c0776', 'file_apply', 'applied', 'cli-migrate', 'plugin:@nextlyhq/plugin-page-builder/20261117_184525_129_add_class_usage_blocks', '50fbafe7caae279444ebb426966a5f6f45c8e914ee8cf43125e058f4a31332ab', NULL, NULL, '2026-11-23 04:47:29.983+00', '2026-11-23 04:47:29.986+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('30aa097a-8a1c-4910-921d-583737af0ad3', 'file_apply', 'applied', 'cli-migrate', 'plugin:reading-lists-fixture/20261113_140950_391_create_reading_lists', '5a4183056fe82c090a2a3777dd5f40d3ca86c9dbac8acf4ab050ccbb8213a4c8', NULL, NULL, '2026-11-23 04:47:30.01+00', '2026-11-23 04:47:30.02+00', NULL, NULL, NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('f8074a6e-bb56-43d6-b972-0cc162e1023f', 'file_apply', 'applied', 'cli-migrate', '20261123_044715_998_baseline.sql', 'bb1dac1238aeaadfff9eef10e3b649a029ae362cbe993ef3d2ac1bdcbde201a8', NULL, NULL, '2026-11-23 04:47:32.788+00', '2026-11-23 04:47:32.8+00', NULL, NULL, NULL, NULL, 136, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('b397aa3c-500c-4834-9593-99eb97dcb310', 'file_apply', 'applied', 'cli-migrate', '20261123_044715_999_create_localization_posts.sql', '78dffa1f98baa10ea222e65e2b332b766ce149f2e2f69ebc177be79dbddac5c9', NULL, NULL, '2026-11-23 04:47:32.941+00', '2026-11-23 04:47:32.946+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('c78df3a2-adf7-4b00-a41d-850df77d4f08', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_000_create_localization_categories.sql', '067f3f58d3c40c995db1b9fea0c312ab9317faf4c7a09ff10417dc6dfa538171', NULL, NULL, '2026-11-23 04:47:32.962+00', '2026-11-23 04:47:32.964+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('8679713e-0bf9-4b73-a361-3b307851525a', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_001_create_localization_tags.sql', '307d43ded2f0e6a786dd4836d65d61bce41629e0dd4f455cd14105c377e4f651', NULL, NULL, '2026-11-23 04:47:32.98+00', '2026-11-23 04:47:32.982+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('8e83c9ca-48c7-4bca-b156-8262f765a220', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_002_create_localization_block-pages.sql', 'ccca8dffa45e80dbeefa673e03c42a68d738e4a42d946334b15320cc13147b7e', NULL, NULL, '2026-11-23 04:47:33.003+00', '2026-11-23 04:47:33.009+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('e0f9d143-95b7-4e1d-a062-51621134a166', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_003_create_localization_authors.sql', 'eef3aa2c91a4bed590f03b745aefe57a46e41479b8556ab1edd82f3e28ae672d', NULL, NULL, '2026-11-23 04:47:33.028+00', '2026-11-23 04:47:33.03+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('2fcaaf33-f3f8-40ed-9ce5-6fb89ea57d0d', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_004_create_localization_pages.sql', '92c25ef4eea6e83f64a6285c34c4fe27510004f46b73da5604738c503b33d645', NULL, NULL, '2026-11-23 04:47:33.043+00', '2026-11-23 04:47:33.046+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('6f3dfcb9-56e8-45d6-b4f0-10b9405e6feb', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_005_create_localization_patterns.sql', '73469e5eb6387ca9c44ccf3d9e536483486729e90b53fbed6cb82a63fee9fcdc', NULL, NULL, '2026-11-23 04:47:33.058+00', '2026-11-23 04:47:33.06+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('d2517018-7d7c-4893-b419-a0fe106ac6b7', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_006_create_localization_components.sql', '50f53688ca84590c8706621e5ecc2570c76c590bb6292d582fbce13bb72283ae', NULL, NULL, '2026-11-23 04:47:33.071+00', '2026-11-23 04:47:33.074+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('8e180f1d-111a-4a09-b6b4-84a78969d8c5', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_007_create_localization_layouts.sql', '9a304f1128533e91f785d6a548d4197a462a857f91d890ca68a27279b020f3d4', NULL, NULL, '2026-11-23 04:47:33.086+00', '2026-11-23 04:47:33.088+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('2587ce8f-a7e1-4c70-a22d-b8bb37f1643d', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_008_create_localization_templates.sql', '5ac0ed470f8241c435d4148003c5b364a9adadd3543d8b3c0f1059319692fecc', NULL, NULL, '2026-11-23 04:47:33.096+00', '2026-11-23 04:47:33.098+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('9fdbf27e-ca54-4a9d-901d-6b1fca3cdf8e', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_009_create_localization_forms.sql', '9401495e128403da956c923b2f24857add2ccd674c0a9d2a762f9aeb7c85327b', NULL, NULL, '2026-11-23 04:47:33.108+00', '2026-11-23 04:47:33.109+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('c4ad57de-32be-4347-a4f2-c3a95da07f5e', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_010_create_localization_form-submissions.sql', '0900eae4bd4dbf78d645549ed34139b34797e5765d0060428a75f58b0f217f1d', NULL, NULL, '2026-11-23 04:47:33.12+00', '2026-11-23 04:47:33.123+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('5da94c3e-fc39-4f6b-b9c6-9f191149b469', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_011_create_localization_form-submission-sends.sql', 'aabb1892b582d372603dd59a57d375b9f9915961f155e8c0ddef664305b3f11d', NULL, NULL, '2026-11-23 04:47:33.131+00', '2026-11-23 04:47:33.133+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('52cb4608-707a-4e3d-b3d9-ae7a8f29a0f6', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_012_create_localization_form-uploads.sql', '9159373c668c460f236e6e878c229e79e1d6991601d635ea9b421e67c396a501', NULL, NULL, '2026-11-23 04:47:33.144+00', '2026-11-23 04:47:33.146+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('e899fbaf-fccf-40d5-9e65-8fc1845c8790', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_013_create_localization_form-submission-resends.sql', 'afc7c50afd81558d3ddbac00be40df76a32cfe4fdafb57a3db182d9b346ffb11', NULL, NULL, '2026-11-23 04:47:33.154+00', '2026-11-23 04:47:33.156+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('528752fc-886d-4ab6-9758-cb54ad67b284', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_014_create_localization_homepage.sql', 'c915db24c560c8aa83e44456c78d55968586ce6c1433484f8e5c0aa8df28c963', NULL, NULL, '2026-11-23 04:47:33.165+00', '2026-11-23 04:47:33.166+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('b4cb3982-b241-4d60-8855-eaba424c4f16', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_015_create_localization_landing-page.sql', '8648113a1330d17204b9d8efcc66a285961ad3c59ab012596953ffe38057ecc5', NULL, NULL, '2026-11-23 04:47:33.176+00', '2026-11-23 04:47:33.178+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('1e192bef-e3e2-4d1d-928f-9ee87d3ccc40', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_016_create_localization_site-settings.sql', 'bed7cd96a39bb33ba507fbb2fc8689f07e8e2760943974f26eba5a321fec0bb7', NULL, NULL, '2026-11-23 04:47:33.186+00', '2026-11-23 04:47:33.187+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('8e8fd3a2-83ff-46c8-b176-d7bd170391b7', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_017_create_localization_announcement.sql', '466b9318a5c77c90596f11dd1eb40fd0abd4257cace84781efd07e9483860624', NULL, NULL, '2026-11-23 04:47:33.195+00', '2026-11-23 04:47:33.196+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('aafae4d4-ec41-4ab6-b92f-00cf6a30d635', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_018_create_localization_seo.sql', '97ecbc410c8b6fa57d6e3fea0a6333e1df0afe430fb06e0fcfab814f1b44d037', NULL, NULL, '2026-11-23 04:47:33.201+00', '2026-11-23 04:47:33.202+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('1b9f67a6-43c2-4710-8bfc-c50cf21d0f6a', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_019_unique_localization_posts.sql', '4bfb4a043f07f37a289dadc28e31d79d92757246cad7ac310a150a4edb19292b', NULL, NULL, '2026-11-23 04:47:33.211+00', '2026-11-23 04:47:33.212+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('59983d58-f897-49bf-bb69-e891fe04a731', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_020_unique_localization_categories.sql', '2ce6c4b53c669a09443d32c0d97968ebfddd858c7b1647f53a18395882f88791', NULL, NULL, '2026-11-23 04:47:33.22+00', '2026-11-23 04:47:33.222+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('45a658a3-c580-4b26-ac74-910e3f64504c', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_021_unique_localization_tags.sql', '4cc1139b331a98637a8aab3dee63636ff9ed7187b0c7f3e061bc27b5210f041e', NULL, NULL, '2026-11-23 04:47:33.235+00', '2026-11-23 04:47:33.237+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('fdf61664-2a5f-45e2-a4d6-2a9bc71079f2', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_022_unique_localization_block-pages.sql', '2b574818fe5e9a8022ca535e3dccea80cc9737bb5add24c33e3ea277846ff18d', NULL, NULL, '2026-11-23 04:47:33.247+00', '2026-11-23 04:47:33.249+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	('bcdceb4f-de9d-4055-9476-f434b9cb07be', 'file_apply', 'applied', 'cli-migrate', '20261123_044716_023_unique_localization_pages.sql', '5d6db7a3d17994472f4420d625ab3fb05c8363cddf3188953248379e990f7a1b', NULL, NULL, '2026-11-23 04:47:33.256+00', '2026-11-23 04:47:33.257+00', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL);



INSERT INTO public.nextly_schema_lock VALUES
	(1, NULL, NULL, NULL, NULL);



INSERT INTO public.nextly_schema_owners VALUES
	('page_builder__binding_report_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.745+00', '2026-11-23 04:47:29.989+00'),
	('page_builder__binding_uses', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.887+00', '2026-11-23 04:47:29.989+00'),
	('page_builder__usage_runs', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.006+00', '2026-11-23 04:47:29.989+00'),
	('page_builder__usage_progress', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.006+00', '2026-11-23 04:47:29.989+00'),
	('page_builder__layout_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.08+00', '2026-11-23 04:47:29.989+00'),
	('page_builder__component_deletions', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.146+00', '2026-11-23 04:47:29.989+00'),
	('page_builder__component_deletion_hosts', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.146+00', '2026-11-23 04:47:29.989+00'),
	('reading__lists', 'table', '', 'plugin', 'reading-lists-fixture', 'plugin:reading-lists-fixture', '0.0.0', 1, 'active', '2026-11-23 04:47:30.023+00', '2026-11-23 04:47:30.023+00'),
	('reading__list_items', 'table', '', 'plugin', 'reading-lists-fixture', 'plugin:reading-lists-fixture', '0.0.0', 1, 'active', '2026-11-23 04:47:30.023+00', '2026-11-23 04:47:30.023+00'),
	('page_builder__site_options', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.237+00', '2026-11-23 04:47:29.989+00'),
	('page_builder__breakpoint_removals', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.339+00', '2026-11-23 04:47:29.989+00'),
	('page_builder__breakpoint_removal_fragments', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.411+00', '2026-11-23 04:47:29.989+00'),
	('page_builder__class_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.478+00', '2026-11-23 04:47:29.989+00'),
	('page_builder__component_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.478+00', '2026-11-23 04:47:29.989+00'),
	('page_builder__token_usage', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.628+00', '2026-11-23 04:47:29.989+00'),
	('page_builder__binding_issues', 'table', '', 'plugin', '@nextlyhq/plugin-page-builder', 'plugin:@nextlyhq/plugin-page-builder', '0.0.2-alpha.79', 12, 'active', '2026-11-23 04:47:29.745+00', '2026-11-23 04:47:29.989+00');




























































INSERT INTO public.page_builder__site_options VALUES
	('a1b6f697-71d8-40cc-a73d-a1f93eaf124b', 'composition-graph-lock', 'a0a71c34-d618-42f0-bc7c-339f7d9e0400', '2026-11-23 04:47:29.802245', '2026-11-23 04:47:29.802245');















INSERT INTO public.permissions VALUES
	('c6ef5b38-c4e3-4519-8124-6ddc7ec0d9cb', 'Create Users', 'create-users', 'create', 'users', 'Permission to create users', NULL, NULL, NULL, false, '2026-11-23 04:47:33.714589', '2026-11-23 04:47:33.714589'),
	('e6b6d822-da84-4334-bde8-17a950fdeb6e', 'Read Users', 'read-users', 'read', 'users', 'Permission to read users', NULL, NULL, NULL, false, '2026-11-23 04:47:33.715831', '2026-11-23 04:47:33.715831'),
	('f9b659f6-ec87-4092-bd10-c199693e88d2', 'Update Users', 'update-users', 'update', 'users', 'Permission to update users', NULL, NULL, NULL, false, '2026-11-23 04:47:33.716754', '2026-11-23 04:47:33.716754'),
	('42b2c775-6695-4644-9d98-586e12c2ff6f', 'Delete Users', 'delete-users', 'delete', 'users', 'Permission to delete users', NULL, NULL, NULL, false, '2026-11-23 04:47:33.718874', '2026-11-23 04:47:33.718874'),
	('52e8ecd2-677b-4801-b83d-e76c1b5ecadf', 'Create Roles', 'create-roles', 'create', 'roles', 'Permission to create roles', NULL, NULL, NULL, false, '2026-11-23 04:47:33.720829', '2026-11-23 04:47:33.720829'),
	('abccac12-638f-4252-a4e6-116df022f07f', 'Read Roles', 'read-roles', 'read', 'roles', 'Permission to read roles', NULL, NULL, NULL, false, '2026-11-23 04:47:33.722446', '2026-11-23 04:47:33.722446'),
	('8e7c3a56-ee62-4194-b438-5dcf89f9a5ca', 'Update Roles', 'update-roles', 'update', 'roles', 'Permission to update roles', NULL, NULL, NULL, false, '2026-11-23 04:47:33.723533', '2026-11-23 04:47:33.723533'),
	('907a3944-fe80-4e81-970e-3701ec095bae', 'Delete Roles', 'delete-roles', 'delete', 'roles', 'Permission to delete roles', NULL, NULL, NULL, false, '2026-11-23 04:47:33.724563', '2026-11-23 04:47:33.724563'),
	('3eb45258-6f23-4f32-bd2f-94df93494d1a', 'Create Media', 'create-media', 'create', 'media', 'Permission to upload media files', NULL, NULL, NULL, false, '2026-11-23 04:47:33.725531', '2026-11-23 04:47:33.725531'),
	('f08a7e56-ba5a-49c8-871a-ce8ddaf74c8b', 'Read Media', 'read-media', 'read', 'media', 'Permission to view media files', NULL, NULL, NULL, false, '2026-11-23 04:47:33.7267', '2026-11-23 04:47:33.7267'),
	('b7d03684-41e2-499b-9535-548add0070e2', 'Update Media', 'update-media', 'update', 'media', 'Permission to edit media metadata and move files', NULL, NULL, NULL, false, '2026-11-23 04:47:33.727604', '2026-11-23 04:47:33.727604'),
	('6a093e3b-8c70-4ca9-ab2d-fb6222049143', 'Delete Media', 'delete-media', 'delete', 'media', 'Permission to delete media files', NULL, NULL, NULL, false, '2026-11-23 04:47:33.728407', '2026-11-23 04:47:33.728407'),
	('18b847d6-b7ac-4df1-ad07-89963e6b7cf5', 'Read Settings', 'read-settings', 'read', 'settings', 'Permission to read system settings', NULL, NULL, NULL, false, '2026-11-23 04:47:33.729232', '2026-11-23 04:47:33.729232'),
	('dac38c06-c18d-451a-9e61-7b519f2026d2', 'Create Settings', 'create-settings', 'create', 'settings', 'Permission to add settings such as user fields and field groups', NULL, NULL, NULL, false, '2026-11-23 04:47:33.73001', '2026-11-23 04:47:33.73001'),
	('23b58815-4b85-4ca0-a8e6-218283af15fc', 'Update Settings', 'update-settings', 'update', 'settings', 'Permission to change system settings', NULL, NULL, NULL, false, '2026-11-23 04:47:33.730777', '2026-11-23 04:47:33.730777'),
	('a8169b04-7123-4545-9116-7a9385c2e766', 'Delete Settings', 'delete-settings', 'delete', 'settings', 'Permission to remove settings such as user fields and field groups', NULL, NULL, NULL, false, '2026-11-23 04:47:33.731536', '2026-11-23 04:47:33.731536'),
	('e3384ae9-552f-4150-bab9-0154e6cfe90c', 'Create Email Providers', 'create-email-providers', 'create', 'email-providers', 'Permission to create email providers', NULL, NULL, NULL, false, '2026-11-23 04:47:33.732269', '2026-11-23 04:47:33.732269'),
	('da2d4f9e-123e-4e88-af55-0696927eedd7', 'Read Email Providers', 'read-email-providers', 'read', 'email-providers', 'Permission to read email providers', NULL, NULL, NULL, false, '2026-11-23 04:47:33.73299', '2026-11-23 04:47:33.73299'),
	('f6b724fe-c92d-4e46-8294-9dc5d976ce67', 'Update Email Providers', 'update-email-providers', 'update', 'email-providers', 'Permission to change email providers', NULL, NULL, NULL, false, '2026-11-23 04:47:33.733723', '2026-11-23 04:47:33.733723'),
	('a831db16-83ae-49d5-9b16-28130a28a6da', 'Delete Email Providers', 'delete-email-providers', 'delete', 'email-providers', 'Permission to delete email providers', NULL, NULL, NULL, false, '2026-11-23 04:47:33.734476', '2026-11-23 04:47:33.734476'),
	('d25dcaee-aabd-4f3e-9a24-d13beec0628c', 'Create Email Templates', 'create-email-templates', 'create', 'email-templates', 'Permission to create email templates', NULL, NULL, NULL, false, '2026-11-23 04:47:33.735201', '2026-11-23 04:47:33.735201'),
	('9c3e4496-21fc-4ea8-8dd9-021053d63657', 'Read Email Templates', 'read-email-templates', 'read', 'email-templates', 'Permission to read email templates', NULL, NULL, NULL, false, '2026-11-23 04:47:33.735939', '2026-11-23 04:47:33.735939'),
	('4b33bdc0-af06-4f28-88ed-37ba154fbe6d', 'Update Email Templates', 'update-email-templates', 'update', 'email-templates', 'Permission to change email templates', NULL, NULL, NULL, false, '2026-11-23 04:47:33.736839', '2026-11-23 04:47:33.736839'),
	('df57848f-8e05-4a41-8266-d1c3359732c3', 'Delete Email Templates', 'delete-email-templates', 'delete', 'email-templates', 'Permission to delete email templates', NULL, NULL, NULL, false, '2026-11-23 04:47:33.737992', '2026-11-23 04:47:33.737992'),
	('0c21373b-d177-41ca-b7c3-d488c956935d', 'Update API Keys', 'update-api-keys', 'update', 'api-keys', 'Permission to update API keys', NULL, NULL, NULL, false, '2026-11-23 04:47:33.739', '2026-11-23 04:47:33.739'),
	('85d3b888-9de5-40b2-bab5-3ac5cf00b939', 'Create API Keys', 'create-api-keys', 'create', 'api-keys', 'Permission to create API keys', NULL, NULL, NULL, false, '2026-11-23 04:47:33.740417', '2026-11-23 04:47:33.740417'),
	('62e9822e-a86e-4dfa-8f86-e8e0bce68b17', 'Read API Keys', 'read-api-keys', 'read', 'api-keys', 'Permission to read API keys', NULL, NULL, NULL, false, '2026-11-23 04:47:33.741795', '2026-11-23 04:47:33.741795'),
	('e7f9b7bd-47f8-4df9-b26a-b30df1f7dfa5', 'Delete API Keys', 'delete-api-keys', 'delete', 'api-keys', 'Permission to delete API keys', NULL, NULL, NULL, false, '2026-11-23 04:47:33.743238', '2026-11-23 04:47:33.743238'),
	('9c70277b-3c51-4f3a-b381-4d8f13fbf440', 'Update Webhooks', 'update-webhooks', 'update', 'webhooks', 'Permission to update webhook endpoints', NULL, NULL, NULL, false, '2026-11-23 04:47:33.744278', '2026-11-23 04:47:33.744278'),
	('0cb388ac-80ec-4b7d-bc41-e31c9dc976b8', 'Create Webhooks', 'create-webhooks', 'create', 'webhooks', 'Permission to register webhook endpoints', NULL, NULL, NULL, false, '2026-11-23 04:47:33.745368', '2026-11-23 04:47:33.745368'),
	('74d509a1-ebc6-41c9-9e2a-2442b2c424dd', 'Read Webhooks', 'read-webhooks', 'read', 'webhooks', 'Permission to view webhook endpoints', NULL, NULL, NULL, false, '2026-11-23 04:47:33.746492', '2026-11-23 04:47:33.746492'),
	('68d33409-512c-42c0-a807-75a9b81f81b1', 'Delete Webhooks', 'delete-webhooks', 'delete', 'webhooks', 'Permission to delete webhook endpoints', NULL, NULL, NULL, false, '2026-11-23 04:47:33.74738', '2026-11-23 04:47:33.74738'),
	('840bf313-2abd-4070-9c18-177f186a400b', 'Read Releases', 'read-content-releases', 'read', 'content-releases', 'Permission to view content releases and their members', NULL, NULL, NULL, false, '2026-11-23 04:47:33.748265', '2026-11-23 04:47:33.748265'),
	('6b8c12ef-69e4-4e9d-91ec-623c0469b5f6', 'Create Releases', 'create-content-releases', 'create', 'content-releases', 'Permission to create a content release and choose its members', NULL, NULL, NULL, false, '2026-11-23 04:47:33.749089', '2026-11-23 04:47:33.749089'),
	('db930a99-8fc7-4794-841f-7bf5ed0aa8fe', 'Publish Releases', 'publish-content-releases', 'publish', 'content-releases', 'Permission to schedule or cancel a content release, which is what makes its content go live', NULL, NULL, NULL, false, '2026-11-23 04:47:33.750318', '2026-11-23 04:47:33.750318'),
	('c8460665-5a04-406d-b920-3337bd29850b', 'Update Releases', 'update-content-releases', 'update', 'content-releases', 'Permission to rename a content release and change its description', NULL, NULL, NULL, false, '2026-11-23 04:47:33.753498', '2026-11-23 04:47:33.753498'),
	('c0036edf-6ff5-4803-bf80-552cadd81b10', 'Delete Releases', 'delete-content-releases', 'delete', 'content-releases', 'Permission to delete a draft or cancelled content release; one that is scheduled, stopped or published stays', NULL, NULL, NULL, false, '2026-11-23 04:47:33.757137', '2026-11-23 04:47:33.757137'),
	('e63557a3-79b8-454a-8605-d4e6680b01da', 'Read Email Deliveries', 'read-email-deliveries', 'read', 'email-deliveries', 'Permission to see the email delivery log and queued email', NULL, NULL, NULL, false, '2026-11-23 04:47:33.759619', '2026-11-23 04:47:33.759619'),
	('708ffde3-9532-4144-8b8e-e7aef0bb8a47', 'Manage Email Deliveries', 'manage-email-deliveries', 'manage', 'email-deliveries', 'Permission to cancel a queued email, and to have one sent again where a plugin offers it', NULL, NULL, NULL, false, '2026-11-23 04:47:33.760447', '2026-11-23 04:47:33.760447'),
	('7417d5f3-ff19-4d69-8e94-c4b0d75c56c1', 'Manage Background Jobs', 'manage-background-jobs', 'manage', 'background-jobs', 'Permission to run the background job queue by hand, outside its schedule', NULL, NULL, NULL, false, '2026-11-23 04:47:33.7613', '2026-11-23 04:47:33.7613'),
	('d7e570ed-ade8-435e-a351-495e7013b0b4', 'Create Authors', 'create-authors', 'create', 'authors', 'Permission to create authors', NULL, NULL, NULL, false, '2026-11-23 04:47:33.783043', '2026-11-23 04:47:33.783043'),
	('7bcab065-38c7-4a8a-8469-e66c852ca419', 'Read Authors', 'read-authors', 'read', 'authors', 'Permission to read authors', NULL, NULL, NULL, false, '2026-11-23 04:47:33.7837', '2026-11-23 04:47:33.7837'),
	('d856af01-dcf3-484c-97c3-2715e4010917', 'Update Authors', 'update-authors', 'update', 'authors', 'Permission to update authors', NULL, NULL, NULL, false, '2026-11-23 04:47:33.784313', '2026-11-23 04:47:33.784313'),
	('e372a018-e900-47fe-8acd-3db01d9d9e9d', 'Delete Authors', 'delete-authors', 'delete', 'authors', 'Permission to delete authors', NULL, NULL, NULL, false, '2026-11-23 04:47:33.78488', '2026-11-23 04:47:33.78488'),
	('59d771a3-57af-4373-a2c3-db50c4cf77b7', 'Publish Authors', 'publish-authors', 'publish', 'authors', 'Permission to publish authors', NULL, NULL, NULL, false, '2026-11-23 04:47:33.785412', '2026-11-23 04:47:33.785412'),
	('436778ff-4227-47d8-8483-db912035de50', 'Unpublish Authors', 'unpublish-authors', 'unpublish', 'authors', 'Permission to unpublish authors', NULL, NULL, NULL, false, '2026-11-23 04:47:33.78603', '2026-11-23 04:47:33.78603'),
	('e9741876-fa34-498d-93cc-7e7c522e55a9', 'Create Block Pages', 'create-block-pages', 'create', 'block-pages', 'Permission to create block pages', NULL, NULL, NULL, false, '2026-11-23 04:47:33.786566', '2026-11-23 04:47:33.786566'),
	('aa7ddb1f-fd1c-4d44-9966-2ed9ab7519da', 'Read Block Pages', 'read-block-pages', 'read', 'block-pages', 'Permission to read block pages', NULL, NULL, NULL, false, '2026-11-23 04:47:33.787052', '2026-11-23 04:47:33.787052'),
	('6f792995-0e2c-4315-9622-b14f6106a64f', 'Update Block Pages', 'update-block-pages', 'update', 'block-pages', 'Permission to update block pages', NULL, NULL, NULL, false, '2026-11-23 04:47:33.787533', '2026-11-23 04:47:33.787533'),
	('8c848fd1-4549-4cb2-ac09-91d1f01d985c', 'Delete Block Pages', 'delete-block-pages', 'delete', 'block-pages', 'Permission to delete block pages', NULL, NULL, NULL, false, '2026-11-23 04:47:33.787945', '2026-11-23 04:47:33.787945'),
	('f50f25bc-f09a-4ef4-8d4e-009269ef5c3e', 'Publish Block Pages', 'publish-block-pages', 'publish', 'block-pages', 'Permission to publish block pages', NULL, NULL, NULL, false, '2026-11-23 04:47:33.788408', '2026-11-23 04:47:33.788408'),
	('54182cf7-0ef7-4862-b960-4ca1521a421c', 'Unpublish Block Pages', 'unpublish-block-pages', 'unpublish', 'block-pages', 'Permission to unpublish block pages', NULL, NULL, NULL, false, '2026-11-23 04:47:33.788804', '2026-11-23 04:47:33.788804'),
	('166a8b31-0c69-4340-b9cc-10a195de67e1', 'Create Categories', 'create-categories', 'create', 'categories', 'Permission to create categories', NULL, NULL, NULL, false, '2026-11-23 04:47:33.789201', '2026-11-23 04:47:33.789201'),
	('13a7bbf9-1b66-4793-bc8c-3ad4a3339fde', 'Read Categories', 'read-categories', 'read', 'categories', 'Permission to read categories', NULL, NULL, NULL, false, '2026-11-23 04:47:33.789602', '2026-11-23 04:47:33.789602'),
	('7b6a863c-f955-4cba-8be0-a7b22eece05a', 'Update Categories', 'update-categories', 'update', 'categories', 'Permission to update categories', NULL, NULL, NULL, false, '2026-11-23 04:47:33.789971', '2026-11-23 04:47:33.789971'),
	('ebf8ddb5-3083-4c80-b0ef-3b27efaa5fb9', 'Delete Categories', 'delete-categories', 'delete', 'categories', 'Permission to delete categories', NULL, NULL, NULL, false, '2026-11-23 04:47:33.790358', '2026-11-23 04:47:33.790358'),
	('2aae015a-b68e-4307-82c5-c2018b5f0ab7', 'Publish Categories', 'publish-categories', 'publish', 'categories', 'Permission to publish categories', NULL, NULL, NULL, false, '2026-11-23 04:47:33.790729', '2026-11-23 04:47:33.790729'),
	('fd6f07e7-e883-4e2c-97f3-4261bcca0aae', 'Unpublish Categories', 'unpublish-categories', 'unpublish', 'categories', 'Permission to unpublish categories', NULL, NULL, NULL, false, '2026-11-23 04:47:33.791094', '2026-11-23 04:47:33.791094'),
	('3348a529-f4ab-47ba-9b5c-d56de176c9f9', 'Create Components', 'create-components', 'create', 'components', 'Permission to create components', NULL, NULL, NULL, false, '2026-11-23 04:47:33.791485', '2026-11-23 04:47:33.791485'),
	('8d82820e-6b5a-4518-a025-8167a829b7dc', 'Read Components', 'read-components', 'read', 'components', 'Permission to read components', NULL, NULL, NULL, false, '2026-11-23 04:47:33.791863', '2026-11-23 04:47:33.791863'),
	('9d06eda3-af58-4278-ae8e-501e0524ecb2', 'Update Components', 'update-components', 'update', 'components', 'Permission to update components', NULL, NULL, NULL, false, '2026-11-23 04:47:33.792247', '2026-11-23 04:47:33.792247'),
	('1d42f5e4-db44-4c9e-a406-26491073f6fb', 'Delete Components', 'delete-components', 'delete', 'components', 'Permission to delete components', NULL, NULL, NULL, false, '2026-11-23 04:47:33.792634', '2026-11-23 04:47:33.792634'),
	('c3208853-bd11-4f3a-a903-412f3982ed77', 'Publish Components', 'publish-components', 'publish', 'components', 'Permission to publish components', NULL, NULL, NULL, false, '2026-11-23 04:47:33.792997', '2026-11-23 04:47:33.792997'),
	('31f4b996-d6bc-496d-8984-cdf19e427e72', 'Unpublish Components', 'unpublish-components', 'unpublish', 'components', 'Permission to unpublish components', NULL, NULL, NULL, false, '2026-11-23 04:47:33.793379', '2026-11-23 04:47:33.793379'),
	('43e92338-a063-41c6-8f5d-064e77b73019', 'Create Form Submission Resends', 'create-form-submission-resends', 'create', 'form-submission-resends', 'Permission to create form submission resends', NULL, NULL, NULL, false, '2026-11-23 04:47:33.794173', '2026-11-23 04:47:33.794173'),
	('fe385aeb-6676-48d3-ab9a-70613eddb6f1', 'Read Form Submission Resends', 'read-form-submission-resends', 'read', 'form-submission-resends', 'Permission to read form submission resends', NULL, NULL, NULL, false, '2026-11-23 04:47:33.794699', '2026-11-23 04:47:33.794699'),
	('bb27a11c-82d7-487b-802e-c3c649990949', 'Update Form Submission Resends', 'update-form-submission-resends', 'update', 'form-submission-resends', 'Permission to update form submission resends', NULL, NULL, NULL, false, '2026-11-23 04:47:33.795315', '2026-11-23 04:47:33.795315'),
	('f7a61d5c-9851-4138-b1e3-f5bcce88b48d', 'Delete Form Submission Resends', 'delete-form-submission-resends', 'delete', 'form-submission-resends', 'Permission to delete form submission resends', NULL, NULL, NULL, false, '2026-11-23 04:47:33.79584', '2026-11-23 04:47:33.79584'),
	('d1140264-c254-4f03-9c98-8516b3d79973', 'Publish Form Submission Resends', 'publish-form-submission-resends', 'publish', 'form-submission-resends', 'Permission to publish form submission resends', NULL, NULL, NULL, false, '2026-11-23 04:47:33.796434', '2026-11-23 04:47:33.796434'),
	('54fe599b-bc9c-4b68-a480-7bd507154bbe', 'Unpublish Form Submission Resends', 'unpublish-form-submission-resends', 'unpublish', 'form-submission-resends', 'Permission to unpublish form submission resends', NULL, NULL, NULL, false, '2026-11-23 04:47:33.796917', '2026-11-23 04:47:33.796917'),
	('dd5ddce0-e5bb-483e-8542-e59597a91e10', 'Create Form Submission Sends', 'create-form-submission-sends', 'create', 'form-submission-sends', 'Permission to create form submission sends', NULL, NULL, NULL, false, '2026-11-23 04:47:33.797406', '2026-11-23 04:47:33.797406'),
	('cc3610a2-c994-4ace-ace9-ecd50f7fbafe', 'Read Form Submission Sends', 'read-form-submission-sends', 'read', 'form-submission-sends', 'Permission to read form submission sends', NULL, NULL, NULL, false, '2026-11-23 04:47:33.797873', '2026-11-23 04:47:33.797873'),
	('16e2f5c7-0966-4d61-9f28-b2728a2a6882', 'Update Form Submission Sends', 'update-form-submission-sends', 'update', 'form-submission-sends', 'Permission to update form submission sends', NULL, NULL, NULL, false, '2026-11-23 04:47:33.799208', '2026-11-23 04:47:33.799208'),
	('2625d3b9-ca47-446e-89e8-bfdc54975773', 'Delete Form Submission Sends', 'delete-form-submission-sends', 'delete', 'form-submission-sends', 'Permission to delete form submission sends', NULL, NULL, NULL, false, '2026-11-23 04:47:33.799814', '2026-11-23 04:47:33.799814'),
	('236e0d5d-7fdd-4471-8e45-a936f2e66e47', 'Publish Form Submission Sends', 'publish-form-submission-sends', 'publish', 'form-submission-sends', 'Permission to publish form submission sends', NULL, NULL, NULL, false, '2026-11-23 04:47:33.800514', '2026-11-23 04:47:33.800514'),
	('c8afb488-30a7-40bc-a9da-3e6ed67e1745', 'Unpublish Form Submission Sends', 'unpublish-form-submission-sends', 'unpublish', 'form-submission-sends', 'Permission to unpublish form submission sends', NULL, NULL, NULL, false, '2026-11-23 04:47:33.801109', '2026-11-23 04:47:33.801109'),
	('950b64a8-0c44-48cd-ac1b-b217966a46e4', 'Create Form Submissions', 'create-form-submissions', 'create', 'form-submissions', 'Permission to create form submissions', NULL, NULL, NULL, false, '2026-11-23 04:47:33.801643', '2026-11-23 04:47:33.801643'),
	('6fd1e5bb-7a13-4be2-af3a-fa283a955067', 'Read Form Submissions', 'read-form-submissions', 'read', 'form-submissions', 'Permission to read form submissions', NULL, NULL, NULL, false, '2026-11-23 04:47:33.802155', '2026-11-23 04:47:33.802155'),
	('83ce75a4-6859-4e70-bb31-310aad39d1ec', 'Update Form Submissions', 'update-form-submissions', 'update', 'form-submissions', 'Permission to update form submissions', NULL, NULL, NULL, false, '2026-11-23 04:47:33.802768', '2026-11-23 04:47:33.802768'),
	('a77498a1-0740-4b8d-a885-74e94cd11475', 'Delete Form Submissions', 'delete-form-submissions', 'delete', 'form-submissions', 'Permission to delete form submissions', NULL, NULL, NULL, false, '2026-11-23 04:47:33.803358', '2026-11-23 04:47:33.803358'),
	('97f90778-d1be-4ed3-8648-4cda7c19b4fc', 'Publish Form Submissions', 'publish-form-submissions', 'publish', 'form-submissions', 'Permission to publish form submissions', NULL, NULL, NULL, false, '2026-11-23 04:47:33.803945', '2026-11-23 04:47:33.803945'),
	('d9896fc1-1eed-4a8f-928a-48aabb4e001a', 'Unpublish Form Submissions', 'unpublish-form-submissions', 'unpublish', 'form-submissions', 'Permission to unpublish form submissions', NULL, NULL, NULL, false, '2026-11-23 04:47:33.80447', '2026-11-23 04:47:33.80447'),
	('74e56b63-7677-4cd1-bfc0-0481e4a74b25', 'Create Form Uploads', 'create-form-uploads', 'create', 'form-uploads', 'Permission to create form uploads', NULL, NULL, NULL, false, '2026-11-23 04:47:33.804993', '2026-11-23 04:47:33.804993'),
	('1bc5b019-8e3b-448b-ac2e-28b94cf6c5a8', 'Read Form Uploads', 'read-form-uploads', 'read', 'form-uploads', 'Permission to read form uploads', NULL, NULL, NULL, false, '2026-11-23 04:47:33.805536', '2026-11-23 04:47:33.805536'),
	('22855709-20ac-407d-960e-5e16029f3b82', 'Update Form Uploads', 'update-form-uploads', 'update', 'form-uploads', 'Permission to update form uploads', NULL, NULL, NULL, false, '2026-11-23 04:47:33.806073', '2026-11-23 04:47:33.806073'),
	('2a3432a1-2eef-4740-9ea2-44f696113afa', 'Delete Form Uploads', 'delete-form-uploads', 'delete', 'form-uploads', 'Permission to delete form uploads', NULL, NULL, NULL, false, '2026-11-23 04:47:33.806586', '2026-11-23 04:47:33.806586'),
	('20e69557-30b8-4b48-ae50-0e1858c628a1', 'Publish Form Uploads', 'publish-form-uploads', 'publish', 'form-uploads', 'Permission to publish form uploads', NULL, NULL, NULL, false, '2026-11-23 04:47:33.807219', '2026-11-23 04:47:33.807219'),
	('34225046-f3e2-485b-a111-8177931c0e9b', 'Unpublish Form Uploads', 'unpublish-form-uploads', 'unpublish', 'form-uploads', 'Permission to unpublish form uploads', NULL, NULL, NULL, false, '2026-11-23 04:47:33.807705', '2026-11-23 04:47:33.807705'),
	('c9bda9f7-86a5-4c77-b42e-79862b142345', 'Create Forms', 'create-forms', 'create', 'forms', 'Permission to create forms', NULL, NULL, NULL, false, '2026-11-23 04:47:33.808205', '2026-11-23 04:47:33.808205'),
	('b9c780ac-23aa-47ef-bd19-6167ed107700', 'Read Forms', 'read-forms', 'read', 'forms', 'Permission to read forms', NULL, NULL, NULL, false, '2026-11-23 04:47:33.808724', '2026-11-23 04:47:33.808724'),
	('916be51e-8716-4107-aeeb-412ef963eaa5', 'Update Forms', 'update-forms', 'update', 'forms', 'Permission to update forms', NULL, NULL, NULL, false, '2026-11-23 04:47:33.809411', '2026-11-23 04:47:33.809411'),
	('e9959cd7-b9c2-4a21-980c-b8c6f655ba65', 'Delete Forms', 'delete-forms', 'delete', 'forms', 'Permission to delete forms', NULL, NULL, NULL, false, '2026-11-23 04:47:33.81001', '2026-11-23 04:47:33.81001'),
	('90e603d7-e10e-4939-aca6-a0f5ac8245aa', 'Publish Forms', 'publish-forms', 'publish', 'forms', 'Permission to publish forms', NULL, NULL, NULL, false, '2026-11-23 04:47:33.810603', '2026-11-23 04:47:33.810603'),
	('38c11d7a-1590-4c19-accc-8f87ec8c0eab', 'Unpublish Forms', 'unpublish-forms', 'unpublish', 'forms', 'Permission to unpublish forms', NULL, NULL, NULL, false, '2026-11-23 04:47:33.811135', '2026-11-23 04:47:33.811135'),
	('3261ada3-a268-4cf1-9583-26c16aecf9d9', 'Create Layouts', 'create-layouts', 'create', 'layouts', 'Permission to create layouts', NULL, NULL, NULL, false, '2026-11-23 04:47:33.81163', '2026-11-23 04:47:33.81163'),
	('abc44d55-6917-41a4-a7ee-5cdf4e39a444', 'Read Layouts', 'read-layouts', 'read', 'layouts', 'Permission to read layouts', NULL, NULL, NULL, false, '2026-11-23 04:47:33.812276', '2026-11-23 04:47:33.812276'),
	('8e2cb9d8-c655-4343-9db4-f100ec282bd9', 'Update Layouts', 'update-layouts', 'update', 'layouts', 'Permission to update layouts', NULL, NULL, NULL, false, '2026-11-23 04:47:33.812725', '2026-11-23 04:47:33.812725'),
	('1894e8f7-b44c-4d42-b82e-ba8eeaca414a', 'Delete Layouts', 'delete-layouts', 'delete', 'layouts', 'Permission to delete layouts', NULL, NULL, NULL, false, '2026-11-23 04:47:33.813184', '2026-11-23 04:47:33.813184'),
	('ed0d5f43-e27d-42cd-97dd-148ef3f23f5e', 'Publish Layouts', 'publish-layouts', 'publish', 'layouts', 'Permission to publish layouts', NULL, NULL, NULL, false, '2026-11-23 04:47:33.8137', '2026-11-23 04:47:33.8137'),
	('1b3e9e87-aedb-4593-b390-cc7c3ebd6833', 'Unpublish Layouts', 'unpublish-layouts', 'unpublish', 'layouts', 'Permission to unpublish layouts', NULL, NULL, NULL, false, '2026-11-23 04:47:33.814184', '2026-11-23 04:47:33.814184'),
	('1abe5063-1bc6-4b46-a6c8-74086d380fd2', 'Create Nx_pb_address_claims', 'create-nx_pb_address_claims', 'create', 'nx_pb_address_claims', 'Permission to create nx_pb_address_claims', NULL, NULL, NULL, false, '2026-11-23 04:47:33.814734', '2026-11-23 04:47:33.814734'),
	('f60b7658-07f5-4c88-8474-99b55967f1d1', 'Read Nx_pb_address_claims', 'read-nx_pb_address_claims', 'read', 'nx_pb_address_claims', 'Permission to read nx_pb_address_claims', NULL, NULL, NULL, false, '2026-11-23 04:47:33.815394', '2026-11-23 04:47:33.815394'),
	('f2eada37-f624-4ca5-94bd-132d424088db', 'Update Nx_pb_address_claims', 'update-nx_pb_address_claims', 'update', 'nx_pb_address_claims', 'Permission to update nx_pb_address_claims', NULL, NULL, NULL, false, '2026-11-23 04:47:33.815981', '2026-11-23 04:47:33.815981'),
	('54ecba53-cad4-4cef-a30e-bf1b99903663', 'Delete Nx_pb_address_claims', 'delete-nx_pb_address_claims', 'delete', 'nx_pb_address_claims', 'Permission to delete nx_pb_address_claims', NULL, NULL, NULL, false, '2026-11-23 04:47:33.816521', '2026-11-23 04:47:33.816521'),
	('0102945e-3781-4cdc-9c0d-41d50a8f21e9', 'Publish Nx_pb_address_claims', 'publish-nx_pb_address_claims', 'publish', 'nx_pb_address_claims', 'Permission to publish nx_pb_address_claims', NULL, NULL, NULL, false, '2026-11-23 04:47:33.817162', '2026-11-23 04:47:33.817162'),
	('1fc6c5c6-8358-4c9d-ade4-ff90dd01e9bc', 'Unpublish Nx_pb_address_claims', 'unpublish-nx_pb_address_claims', 'unpublish', 'nx_pb_address_claims', 'Permission to unpublish nx_pb_address_claims', NULL, NULL, NULL, false, '2026-11-23 04:47:33.817753', '2026-11-23 04:47:33.817753'),
	('903aea4b-2143-4aa5-9f7f-7f639f62c1af', 'Create Nx_pb_class_usage', 'create-nx_pb_class_usage', 'create', 'nx_pb_class_usage', 'Permission to create nx_pb_class_usage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.818388', '2026-11-23 04:47:33.818388'),
	('740eb670-16db-4bb6-a1d9-793924d41049', 'Read Nx_pb_class_usage', 'read-nx_pb_class_usage', 'read', 'nx_pb_class_usage', 'Permission to read nx_pb_class_usage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.818949', '2026-11-23 04:47:33.818949'),
	('9e82a5ae-6e09-42ad-8c0f-244aba63d47d', 'Update Nx_pb_class_usage', 'update-nx_pb_class_usage', 'update', 'nx_pb_class_usage', 'Permission to update nx_pb_class_usage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.819525', '2026-11-23 04:47:33.819525'),
	('8e0ac324-afe4-49f8-9c43-bda79160d715', 'Delete Nx_pb_class_usage', 'delete-nx_pb_class_usage', 'delete', 'nx_pb_class_usage', 'Permission to delete nx_pb_class_usage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.820086', '2026-11-23 04:47:33.820086'),
	('313e02c3-858c-4f88-af9d-5bc34fec8da1', 'Publish Nx_pb_class_usage', 'publish-nx_pb_class_usage', 'publish', 'nx_pb_class_usage', 'Permission to publish nx_pb_class_usage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.82062', '2026-11-23 04:47:33.82062'),
	('b7f3e5e2-174b-429d-8b1e-1fa16f65515e', 'Unpublish Nx_pb_class_usage', 'unpublish-nx_pb_class_usage', 'unpublish', 'nx_pb_class_usage', 'Permission to unpublish nx_pb_class_usage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.821082', '2026-11-23 04:47:33.821082'),
	('a467822b-1069-4b2c-9b5a-7609fca5c16f', 'Create Nx_pb_component_retired', 'create-nx_pb_component_retired', 'create', 'nx_pb_component_retired', 'Permission to create nx_pb_component_retired', NULL, NULL, NULL, false, '2026-11-23 04:47:33.821542', '2026-11-23 04:47:33.821542'),
	('01e50634-77e5-4242-b6f8-ae0b8d09c361', 'Read Nx_pb_component_retired', 'read-nx_pb_component_retired', 'read', 'nx_pb_component_retired', 'Permission to read nx_pb_component_retired', NULL, NULL, NULL, false, '2026-11-23 04:47:33.822', '2026-11-23 04:47:33.822'),
	('be054b83-877a-42cc-86ca-46bdb39681e0', 'Update Nx_pb_component_retired', 'update-nx_pb_component_retired', 'update', 'nx_pb_component_retired', 'Permission to update nx_pb_component_retired', NULL, NULL, NULL, false, '2026-11-23 04:47:33.822504', '2026-11-23 04:47:33.822504'),
	('082bb3c2-e1ea-4a9b-b093-dedc73c060f0', 'Delete Nx_pb_component_retired', 'delete-nx_pb_component_retired', 'delete', 'nx_pb_component_retired', 'Permission to delete nx_pb_component_retired', NULL, NULL, NULL, false, '2026-11-23 04:47:33.82301', '2026-11-23 04:47:33.82301'),
	('13a90290-7c5d-4ea5-ac44-5f35627e8e49', 'Publish Nx_pb_component_retired', 'publish-nx_pb_component_retired', 'publish', 'nx_pb_component_retired', 'Permission to publish nx_pb_component_retired', NULL, NULL, NULL, false, '2026-11-23 04:47:33.823509', '2026-11-23 04:47:33.823509'),
	('10726544-09df-4712-bc64-113f1e6c7e42', 'Unpublish Nx_pb_component_retired', 'unpublish-nx_pb_component_retired', 'unpublish', 'nx_pb_component_retired', 'Permission to unpublish nx_pb_component_retired', NULL, NULL, NULL, false, '2026-11-23 04:47:33.823961', '2026-11-23 04:47:33.823961'),
	('1627d04b-94c0-40f2-8891-31a698fa1a53', 'Create Nx_pb_component_usage', 'create-nx_pb_component_usage', 'create', 'nx_pb_component_usage', 'Permission to create nx_pb_component_usage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.824385', '2026-11-23 04:47:33.824385'),
	('21e5a502-d081-4f18-923e-2eed75608a69', 'Read Nx_pb_component_usage', 'read-nx_pb_component_usage', 'read', 'nx_pb_component_usage', 'Permission to read nx_pb_component_usage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.824805', '2026-11-23 04:47:33.824805'),
	('66f3aee0-e00b-4238-bbaf-0720467bf9f3', 'Update Nx_pb_component_usage', 'update-nx_pb_component_usage', 'update', 'nx_pb_component_usage', 'Permission to update nx_pb_component_usage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.825193', '2026-11-23 04:47:33.825193'),
	('2b8ceb3d-a089-4453-88e1-0709e4508c0c', 'Delete Nx_pb_component_usage', 'delete-nx_pb_component_usage', 'delete', 'nx_pb_component_usage', 'Permission to delete nx_pb_component_usage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.825578', '2026-11-23 04:47:33.825578'),
	('9151175f-bd0e-4861-adb5-fb24cf8319ec', 'Publish Nx_pb_component_usage', 'publish-nx_pb_component_usage', 'publish', 'nx_pb_component_usage', 'Permission to publish nx_pb_component_usage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.825949', '2026-11-23 04:47:33.825949'),
	('18920cc9-dbe5-4e34-98c1-55b0a686bdab', 'Unpublish Nx_pb_component_usage', 'unpublish-nx_pb_component_usage', 'unpublish', 'nx_pb_component_usage', 'Permission to unpublish nx_pb_component_usage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.826395', '2026-11-23 04:47:33.826395'),
	('33bc4eab-bbd6-4c30-be79-5a108e0b7a3a', 'Create Nx_pb_usage_backfill', 'create-nx_pb_usage_backfill', 'create', 'nx_pb_usage_backfill', 'Permission to create nx_pb_usage_backfill', NULL, NULL, NULL, false, '2026-11-23 04:47:33.826784', '2026-11-23 04:47:33.826784'),
	('ea82b906-9c82-4f4f-9e63-46b0dab93222', 'Read Nx_pb_usage_backfill', 'read-nx_pb_usage_backfill', 'read', 'nx_pb_usage_backfill', 'Permission to read nx_pb_usage_backfill', NULL, NULL, NULL, false, '2026-11-23 04:47:33.827135', '2026-11-23 04:47:33.827135'),
	('198c710a-3025-4f6f-8b58-39a7c42ee9b4', 'Update Nx_pb_usage_backfill', 'update-nx_pb_usage_backfill', 'update', 'nx_pb_usage_backfill', 'Permission to update nx_pb_usage_backfill', NULL, NULL, NULL, false, '2026-11-23 04:47:33.827533', '2026-11-23 04:47:33.827533'),
	('649102dc-bd7f-493e-9801-cee8bd47d95a', 'Delete Nx_pb_usage_backfill', 'delete-nx_pb_usage_backfill', 'delete', 'nx_pb_usage_backfill', 'Permission to delete nx_pb_usage_backfill', NULL, NULL, NULL, false, '2026-11-23 04:47:33.827921', '2026-11-23 04:47:33.827921'),
	('d0c4877e-fb8a-4538-b2a0-06af02fa552f', 'Publish Nx_pb_usage_backfill', 'publish-nx_pb_usage_backfill', 'publish', 'nx_pb_usage_backfill', 'Permission to publish nx_pb_usage_backfill', NULL, NULL, NULL, false, '2026-11-23 04:47:33.828252', '2026-11-23 04:47:33.828252'),
	('b8c7a936-e5c0-423e-b2ac-4a5fa1d8eade', 'Unpublish Nx_pb_usage_backfill', 'unpublish-nx_pb_usage_backfill', 'unpublish', 'nx_pb_usage_backfill', 'Permission to unpublish nx_pb_usage_backfill', NULL, NULL, NULL, false, '2026-11-23 04:47:33.828566', '2026-11-23 04:47:33.828566'),
	('ee7a639c-310d-43e0-b8ee-b17bf13736e6', 'Create Pages', 'create-pages', 'create', 'pages', 'Permission to create pages', NULL, NULL, NULL, false, '2026-11-23 04:47:33.828866', '2026-11-23 04:47:33.828866'),
	('6babf5cd-30c4-4352-b160-49435695b96f', 'Read Pages', 'read-pages', 'read', 'pages', 'Permission to read pages', NULL, NULL, NULL, false, '2026-11-23 04:47:33.829197', '2026-11-23 04:47:33.829197'),
	('4ae907c5-f3b7-4cd9-8627-f9edc7402ac5', 'Update Pages', 'update-pages', 'update', 'pages', 'Permission to update pages', NULL, NULL, NULL, false, '2026-11-23 04:47:33.829599', '2026-11-23 04:47:33.829599'),
	('13853ea6-61cf-4010-aac6-9304e7d2a763', 'Delete Pages', 'delete-pages', 'delete', 'pages', 'Permission to delete pages', NULL, NULL, NULL, false, '2026-11-23 04:47:33.830071', '2026-11-23 04:47:33.830071'),
	('51a52508-0464-4458-b503-522ec78dc5fd', 'Publish Pages', 'publish-pages', 'publish', 'pages', 'Permission to publish pages', NULL, NULL, NULL, false, '2026-11-23 04:47:33.830447', '2026-11-23 04:47:33.830447'),
	('d7ef156d-0854-4ce9-bc7e-fe37f0d35014', 'Unpublish Pages', 'unpublish-pages', 'unpublish', 'pages', 'Permission to unpublish pages', NULL, NULL, NULL, false, '2026-11-23 04:47:33.830798', '2026-11-23 04:47:33.830798'),
	('2045604e-7a56-419e-b060-704378df31f4', 'Create Patterns', 'create-patterns', 'create', 'patterns', 'Permission to create patterns', NULL, NULL, NULL, false, '2026-11-23 04:47:33.831266', '2026-11-23 04:47:33.831266'),
	('dfa49aa8-d740-4c64-ae0f-481162d972a2', 'Read Patterns', 'read-patterns', 'read', 'patterns', 'Permission to read patterns', NULL, NULL, NULL, false, '2026-11-23 04:47:33.831703', '2026-11-23 04:47:33.831703'),
	('e8666ccd-5f61-40b4-be04-a8e35c1cc033', 'Update Patterns', 'update-patterns', 'update', 'patterns', 'Permission to update patterns', NULL, NULL, NULL, false, '2026-11-23 04:47:33.83213', '2026-11-23 04:47:33.83213'),
	('63aade21-ee23-4218-9127-bc7774c05b66', 'Delete Patterns', 'delete-patterns', 'delete', 'patterns', 'Permission to delete patterns', NULL, NULL, NULL, false, '2026-11-23 04:47:33.832566', '2026-11-23 04:47:33.832566'),
	('e11b260e-9539-4902-a0e7-a1f7e8b52397', 'Publish Patterns', 'publish-patterns', 'publish', 'patterns', 'Permission to publish patterns', NULL, NULL, NULL, false, '2026-11-23 04:47:33.832978', '2026-11-23 04:47:33.832978'),
	('3bbe7526-d322-47c8-bab4-6457393d88cb', 'Unpublish Patterns', 'unpublish-patterns', 'unpublish', 'patterns', 'Permission to unpublish patterns', NULL, NULL, NULL, false, '2026-11-23 04:47:33.833414', '2026-11-23 04:47:33.833414'),
	('718f5667-adb1-4c54-ac15-d67c4d90d3a5', 'Create Posts', 'create-posts', 'create', 'posts', 'Permission to create posts', NULL, NULL, NULL, false, '2026-11-23 04:47:33.833841', '2026-11-23 04:47:33.833841'),
	('842d06ec-f173-4d78-ad68-0888f8704b71', 'Read Posts', 'read-posts', 'read', 'posts', 'Permission to read posts', NULL, NULL, NULL, false, '2026-11-23 04:47:33.834281', '2026-11-23 04:47:33.834281'),
	('f09ea341-8f71-454a-9e04-40c04677f377', 'Update Posts', 'update-posts', 'update', 'posts', 'Permission to update posts', NULL, NULL, NULL, false, '2026-11-23 04:47:33.834726', '2026-11-23 04:47:33.834726'),
	('ed3ad395-0862-48a1-a863-46a2a8aa2b8a', 'Delete Posts', 'delete-posts', 'delete', 'posts', 'Permission to delete posts', NULL, NULL, NULL, false, '2026-11-23 04:47:33.835154', '2026-11-23 04:47:33.835154'),
	('526dcac9-303b-432f-a916-063085ef5beb', 'Publish Posts', 'publish-posts', 'publish', 'posts', 'Permission to publish posts', NULL, NULL, NULL, false, '2026-11-23 04:47:33.835585', '2026-11-23 04:47:33.835585'),
	('aed41bd8-ac15-4bf9-9927-2f857a69b547', 'Unpublish Posts', 'unpublish-posts', 'unpublish', 'posts', 'Permission to unpublish posts', NULL, NULL, NULL, false, '2026-11-23 04:47:33.836007', '2026-11-23 04:47:33.836007'),
	('310be402-6bb9-445d-9fa7-2acc1f09a365', 'Create Tags', 'create-tags', 'create', 'tags', 'Permission to create tags', NULL, NULL, NULL, false, '2026-11-23 04:47:33.83644', '2026-11-23 04:47:33.83644'),
	('1a306415-759f-45c4-88c4-1cb6c6d40220', 'Read Tags', 'read-tags', 'read', 'tags', 'Permission to read tags', NULL, NULL, NULL, false, '2026-11-23 04:47:33.836862', '2026-11-23 04:47:33.836862'),
	('efaf50c8-8beb-4915-bb61-5f728b7a6c1a', 'Update Tags', 'update-tags', 'update', 'tags', 'Permission to update tags', NULL, NULL, NULL, false, '2026-11-23 04:47:33.837307', '2026-11-23 04:47:33.837307'),
	('ff07fe3e-1369-4297-9bc6-7f67b1c516e8', 'Delete Tags', 'delete-tags', 'delete', 'tags', 'Permission to delete tags', NULL, NULL, NULL, false, '2026-11-23 04:47:33.837721', '2026-11-23 04:47:33.837721'),
	('25ad9566-eddf-4ff3-8bd9-72fa5b52c840', 'Publish Tags', 'publish-tags', 'publish', 'tags', 'Permission to publish tags', NULL, NULL, NULL, false, '2026-11-23 04:47:33.838138', '2026-11-23 04:47:33.838138'),
	('d264352e-58d0-4637-8bae-59f6fb845674', 'Unpublish Tags', 'unpublish-tags', 'unpublish', 'tags', 'Permission to unpublish tags', NULL, NULL, NULL, false, '2026-11-23 04:47:33.838718', '2026-11-23 04:47:33.838718'),
	('9e2da601-02be-4a47-8f44-3d96374aaf39', 'Create Templates', 'create-templates', 'create', 'templates', 'Permission to create templates', NULL, NULL, NULL, false, '2026-11-23 04:47:33.839262', '2026-11-23 04:47:33.839262'),
	('522bc4f1-e08c-4388-91cc-f6b839578893', 'Read Templates', 'read-templates', 'read', 'templates', 'Permission to read templates', NULL, NULL, NULL, false, '2026-11-23 04:47:33.839761', '2026-11-23 04:47:33.839761'),
	('67320042-f287-45f7-9da6-c4738843a88f', 'Update Templates', 'update-templates', 'update', 'templates', 'Permission to update templates', NULL, NULL, NULL, false, '2026-11-23 04:47:33.840245', '2026-11-23 04:47:33.840245'),
	('dfede3d1-3ecb-4bd7-9141-8468e00a0e34', 'Delete Templates', 'delete-templates', 'delete', 'templates', 'Permission to delete templates', NULL, NULL, NULL, false, '2026-11-23 04:47:33.840881', '2026-11-23 04:47:33.840881'),
	('4b83f7f2-bce4-45b6-8669-8b4d37446b5a', 'Publish Templates', 'publish-templates', 'publish', 'templates', 'Permission to publish templates', NULL, NULL, NULL, false, '2026-11-23 04:47:33.841366', '2026-11-23 04:47:33.841366'),
	('3e22482d-452a-4629-9ced-1e2c82ea29ab', 'Unpublish Templates', 'unpublish-templates', 'unpublish', 'templates', 'Permission to unpublish templates', NULL, NULL, NULL, false, '2026-11-23 04:47:33.841864', '2026-11-23 04:47:33.841864'),
	('06f08b75-b40f-41e3-ba35-d44515e0c14b', 'Read Announcement', 'read-announcement', 'read', 'announcement', 'Permission to read announcement', NULL, NULL, NULL, false, '2026-11-23 04:47:33.844378', '2026-11-23 04:47:33.844378'),
	('0bdf55d4-b854-4b49-9baa-7984f5103ef5', 'Update Announcement', 'update-announcement', 'update', 'announcement', 'Permission to update announcement', NULL, NULL, NULL, false, '2026-11-23 04:47:33.844951', '2026-11-23 04:47:33.844951'),
	('33b5f092-fe9d-42d7-bb8d-a35321622a34', 'Publish Announcement', 'publish-announcement', 'publish', 'announcement', 'Permission to publish announcement', NULL, NULL, NULL, false, '2026-11-23 04:47:33.845648', '2026-11-23 04:47:33.845648'),
	('299ad622-05a9-4f85-a7e9-a704a92d1598', 'Unpublish Announcement', 'unpublish-announcement', 'unpublish', 'announcement', 'Permission to unpublish announcement', NULL, NULL, NULL, false, '2026-11-23 04:47:33.846214', '2026-11-23 04:47:33.846214'),
	('8440bfa1-b21d-40b4-9b8c-6da486eeb13b', 'Read Homepage', 'read-homepage', 'read', 'homepage', 'Permission to read homepage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.846777', '2026-11-23 04:47:33.846777'),
	('b60f0a9f-5269-45df-ad29-0ec372ef75b2', 'Update Homepage', 'update-homepage', 'update', 'homepage', 'Permission to update homepage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.84731', '2026-11-23 04:47:33.84731'),
	('f146fa38-9db9-4480-9f81-99f7c38e7b74', 'Publish Homepage', 'publish-homepage', 'publish', 'homepage', 'Permission to publish homepage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.847884', '2026-11-23 04:47:33.847884'),
	('238eb043-a154-4b83-9b4c-39fa81b33a87', 'Unpublish Homepage', 'unpublish-homepage', 'unpublish', 'homepage', 'Permission to unpublish homepage', NULL, NULL, NULL, false, '2026-11-23 04:47:33.849008', '2026-11-23 04:47:33.849008'),
	('066da758-0388-42de-87f2-45ada21038a3', 'Read Landing Page', 'read-landing-page', 'read', 'landing-page', 'Permission to read landing page', NULL, NULL, NULL, false, '2026-11-23 04:47:33.850348', '2026-11-23 04:47:33.850348'),
	('98640ce9-3fba-47b8-a515-a9f29889f4f3', 'Update Landing Page', 'update-landing-page', 'update', 'landing-page', 'Permission to update landing page', NULL, NULL, NULL, false, '2026-11-23 04:47:33.851523', '2026-11-23 04:47:33.851523'),
	('b60b1f77-6f98-46b1-b588-578327b15e20', 'Publish Landing Page', 'publish-landing-page', 'publish', 'landing-page', 'Permission to publish landing page', NULL, NULL, NULL, false, '2026-11-23 04:47:33.852174', '2026-11-23 04:47:33.852174'),
	('6460f81a-d9ca-43ee-aa9f-c4a4f4ee033d', 'Unpublish Landing Page', 'unpublish-landing-page', 'unpublish', 'landing-page', 'Permission to unpublish landing page', NULL, NULL, NULL, false, '2026-11-23 04:47:33.852818', '2026-11-23 04:47:33.852818'),
	('8d560aa6-9e3f-4d76-862f-35ca6a48b40a', 'Read Page Builder Settings', 'read-page-builder-settings', 'read', 'page-builder-settings', 'Permission to read page builder settings', NULL, NULL, NULL, false, '2026-11-23 04:47:33.854039', '2026-11-23 04:47:33.854039'),
	('dac1922e-7057-415d-9890-5156bfa0e1a1', 'Update Page Builder Settings', 'update-page-builder-settings', 'update', 'page-builder-settings', 'Permission to update page builder settings', NULL, NULL, NULL, false, '2026-11-23 04:47:33.854914', '2026-11-23 04:47:33.854914'),
	('e7415222-deca-4e6e-a306-cc80dc2da51c', 'Publish Page Builder Settings', 'publish-page-builder-settings', 'publish', 'page-builder-settings', 'Permission to publish page builder settings', NULL, NULL, NULL, false, '2026-11-23 04:47:33.855829', '2026-11-23 04:47:33.855829'),
	('a2bde97a-0306-49e2-8840-c754bd3d6b5e', 'Unpublish Page Builder Settings', 'unpublish-page-builder-settings', 'unpublish', 'page-builder-settings', 'Permission to unpublish page builder settings', NULL, NULL, NULL, false, '2026-11-23 04:47:33.856611', '2026-11-23 04:47:33.856611'),
	('c330f658-a29a-4bd9-9f3d-b0f3a119f01a', 'Read Page Builder Site Code', 'read-page-builder-site-code', 'read', 'page-builder-site-code', 'Permission to read page builder site code', NULL, NULL, NULL, false, '2026-11-23 04:47:33.857378', '2026-11-23 04:47:33.857378'),
	('78ac336c-2260-489a-acf8-be63f22b4a34', 'Update Page Builder Site Code', 'update-page-builder-site-code', 'update', 'page-builder-site-code', 'Permission to update page builder site code', NULL, NULL, NULL, false, '2026-11-23 04:47:33.858128', '2026-11-23 04:47:33.858128'),
	('a24a39ec-9874-42a2-baf9-5fca40c1ec2f', 'Publish Page Builder Site Code', 'publish-page-builder-site-code', 'publish', 'page-builder-site-code', 'Permission to publish page builder site code', NULL, NULL, NULL, false, '2026-11-23 04:47:33.858914', '2026-11-23 04:47:33.858914'),
	('13e4c947-0ef8-4543-a8e1-acdeaa217162', 'Unpublish Page Builder Site Code', 'unpublish-page-builder-site-code', 'unpublish', 'page-builder-site-code', 'Permission to unpublish page builder site code', NULL, NULL, NULL, false, '2026-11-23 04:47:33.859657', '2026-11-23 04:47:33.859657'),
	('44627974-b34c-458f-8c08-491c59f88a45', 'Read Site Settings', 'read-site-settings', 'read', 'site-settings', 'Permission to read site settings', NULL, NULL, NULL, false, '2026-11-23 04:47:33.860375', '2026-11-23 04:47:33.860375'),
	('9c6c117a-57d9-441c-862b-971414553d3c', 'Update Site Settings', 'update-site-settings', 'update', 'site-settings', 'Permission to update site settings', NULL, NULL, NULL, false, '2026-11-23 04:47:33.86107', '2026-11-23 04:47:33.86107'),
	('1d1f10b1-3478-40f5-ba41-d8278a978400', 'Publish Site Settings', 'publish-site-settings', 'publish', 'site-settings', 'Permission to publish site settings', NULL, NULL, NULL, false, '2026-11-23 04:47:33.86176', '2026-11-23 04:47:33.86176'),
	('c994a0e3-a17c-4e16-ac00-567f584e42ae', 'Unpublish Site Settings', 'unpublish-site-settings', 'unpublish', 'site-settings', 'Permission to unpublish site settings', NULL, NULL, NULL, false, '2026-11-23 04:47:33.862453', '2026-11-23 04:47:33.862453'),
	('9b385e53-fd0a-4b3d-b83a-330a9575c873', 'Read Site Style', 'read-site-style', 'read', 'site-style', 'Permission to read site style', NULL, NULL, NULL, false, '2026-11-23 04:47:33.863127', '2026-11-23 04:47:33.863127'),
	('b365f67c-46f3-4286-b8a2-dc0fce423aa7', 'Update Site Style', 'update-site-style', 'update', 'site-style', 'Permission to update site style', NULL, NULL, NULL, false, '2026-11-23 04:47:33.863828', '2026-11-23 04:47:33.863828'),
	('3b5ba7d1-591b-4e4d-9e18-414f051b5d08', 'Publish Site Style', 'publish-site-style', 'publish', 'site-style', 'Permission to publish site style', NULL, NULL, NULL, false, '2026-11-23 04:47:33.864533', '2026-11-23 04:47:33.864533'),
	('bc6b6ee1-f2fd-40a4-a7a3-ce43561bb978', 'Unpublish Site Style', 'unpublish-site-style', 'unpublish', 'site-style', 'Permission to unpublish site style', NULL, NULL, NULL, false, '2026-11-23 04:47:33.865239', '2026-11-23 04:47:33.865239'),
	('4e751734-6773-4911-b913-ae7a478f5951', 'Manage page builder site settings', 'manage-page-builder-site', 'manage', 'page-builder-site', 'Change the site''s breakpoints, and choose its default header & footer set.', '@nextlyhq/plugin-page-builder', NULL, 'General', false, '2026-11-23 04:47:33.880135', '2026-11-23 04:47:33.880135'),
	('f8deb9ba-1228-4cb6-bdef-42fb11b036b4', 'Lock shared styles', 'lock-page-builder-shared-styles', 'lock', 'page-builder-shared-styles', 'Lock and unlock the site''s shared styles. A locked style can''t be changed, renamed or removed.', '@nextlyhq/plugin-page-builder', NULL, 'General', false, '2026-11-23 04:47:33.882783', '2026-11-23 04:47:33.882783'),
	('ad288788-81e1-44db-ae0d-67c3affb19ff', 'Manage template routing', 'manage-template-routing', 'manage', 'template-routing', 'Set or change the address a collection''s entries are served at. A change moves every entry''s live address.', '@nextlyhq/plugin-page-builder', NULL, 'General', false, '2026-11-23 04:47:33.885072', '2026-11-23 04:47:33.885072'),
	('77188b68-4b04-4eb4-9a1f-103b54ded191', 'Export Submissions', 'export-submissions', 'export', 'submissions', 'Export form submissions as CSV/JSON', '@nextlyhq/plugin-form-builder', NULL, 'General', true, '2026-11-23 04:47:33.886957', '2026-11-23 04:47:33.886957');















INSERT INTO public.role_permissions VALUES
	('6dec9427-95ab-424a-87fb-0cbee800fc0b', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '06f08b75-b40f-41e3-ba35-d44515e0c14b', '2026-11-23 04:47:33.945079'),
	('6534afbe-5edb-485a-862d-9698c42707e5', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '0bdf55d4-b854-4b49-9baa-7984f5103ef5', '2026-11-23 04:47:33.945079'),
	('2b870dac-9b92-4c2a-b83b-70164e6cd1b9', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '299ad622-05a9-4f85-a7e9-a704a92d1598', '2026-11-23 04:47:33.945079'),
	('1e4e0c1d-d846-4bfa-8e9a-1745265a2ba8', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '33b5f092-fe9d-42d7-bb8d-a35321622a34', '2026-11-23 04:47:33.945079'),
	('a9366e1f-7dcf-4a69-beda-70b1ae71b82a', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '0c21373b-d177-41ca-b7c3-d488c956935d', '2026-11-23 04:47:33.945079'),
	('1c36487f-387b-4d56-b44c-84b355cd5c8b', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '62e9822e-a86e-4dfa-8f86-e8e0bce68b17', '2026-11-23 04:47:33.945079'),
	('3c4db2e4-168b-437d-a5a6-5f2f9d8fe859', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '85d3b888-9de5-40b2-bab5-3ac5cf00b939', '2026-11-23 04:47:33.945079'),
	('2ba4771d-2c5d-4d7e-95c6-4b636a2e7f79', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'e7f9b7bd-47f8-4df9-b26a-b30df1f7dfa5', '2026-11-23 04:47:33.945079'),
	('e309b121-b1c5-480b-b8ef-aa9339939bab', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '7417d5f3-ff19-4d69-8e94-c4b0d75c56c1', '2026-11-23 04:47:33.945079'),
	('ab62e614-ece3-4356-9198-0e632c68673a', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '1d42f5e4-db44-4c9e-a406-26491073f6fb', '2026-11-23 04:47:33.945079'),
	('0a289a7e-77e1-42e6-9926-67542acb4412', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '31f4b996-d6bc-496d-8984-cdf19e427e72', '2026-11-23 04:47:33.945079'),
	('ea2ff8bb-ba16-471c-a502-5b64cfa91257', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '3348a529-f4ab-47ba-9b5c-d56de176c9f9', '2026-11-23 04:47:33.945079'),
	('30340783-4640-456f-ba01-9364c27ee421', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '8d82820e-6b5a-4518-a025-8167a829b7dc', '2026-11-23 04:47:33.945079'),
	('cdb73096-e7fe-4644-ada0-1c8a21a3488f', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '9d06eda3-af58-4278-ae8e-501e0524ecb2', '2026-11-23 04:47:33.945079'),
	('e77ea113-6ecb-4290-86ef-c6632133645d', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'c3208853-bd11-4f3a-a903-412f3982ed77', '2026-11-23 04:47:33.945079'),
	('014f0665-261b-4103-962e-55188ba8767f', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '6b8c12ef-69e4-4e9d-91ec-623c0469b5f6', '2026-11-23 04:47:33.945079'),
	('dcb38977-4117-4f66-be10-21f5ea187566', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '840bf313-2abd-4070-9c18-177f186a400b', '2026-11-23 04:47:33.945079'),
	('7d66ec41-c007-47ca-86fe-ebaa066437ac', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'c0036edf-6ff5-4803-bf80-552cadd81b10', '2026-11-23 04:47:33.945079'),
	('bb639f0c-081b-474f-8c10-0539dcb70398', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'c8460665-5a04-406d-b920-3337bd29850b', '2026-11-23 04:47:33.945079'),
	('6f4d10be-b8fa-4b5f-a722-2d1736e8c408', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'db930a99-8fc7-4794-841f-7bf5ed0aa8fe', '2026-11-23 04:47:33.945079'),
	('da296ee5-2064-4c7a-9587-b953cc228b30', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '708ffde3-9532-4144-8b8e-e7aef0bb8a47', '2026-11-23 04:47:33.945079'),
	('1bf77a80-4281-43c8-b9ce-07ef7dd8af8d', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'e63557a3-79b8-454a-8605-d4e6680b01da', '2026-11-23 04:47:33.945079'),
	('2a0d0a84-533e-4fe9-bd45-6ee65289b4dd', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'a831db16-83ae-49d5-9b16-28130a28a6da', '2026-11-23 04:47:33.945079'),
	('1463a7be-f9a0-44c7-8b90-f5071bad8a9a', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'da2d4f9e-123e-4e88-af55-0696927eedd7', '2026-11-23 04:47:33.945079'),
	('7a871c85-b8fc-4c0d-a00f-f7abbe353f84', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'e3384ae9-552f-4150-bab9-0154e6cfe90c', '2026-11-23 04:47:33.945079'),
	('3012d0a8-d131-4d4b-99b6-b2e96b6e35ea', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'f6b724fe-c92d-4e46-8294-9dc5d976ce67', '2026-11-23 04:47:33.945079'),
	('e974f4b1-ff20-4327-8aba-dc6ccd7a1206', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '4b33bdc0-af06-4f28-88ed-37ba154fbe6d', '2026-11-23 04:47:33.945079'),
	('868c6f68-544e-4bce-8f1b-760bfb285545', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '9c3e4496-21fc-4ea8-8dd9-021053d63657', '2026-11-23 04:47:33.945079'),
	('b7831fe1-0bd8-42f4-b090-7bb68ea94299', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'd25dcaee-aabd-4f3e-9a24-d13beec0628c', '2026-11-23 04:47:33.945079'),
	('d2a12311-c52c-45bc-a754-bc5e48d28c9c', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'df57848f-8e05-4a41-8266-d1c3359732c3', '2026-11-23 04:47:33.945079'),
	('50fdd1d9-5a95-4e6d-b2d8-21b09625b37f', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '38c11d7a-1590-4c19-accc-8f87ec8c0eab', '2026-11-23 04:47:33.945079'),
	('0f4c2ad6-d151-4fa4-92ad-411af54b5d5a', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '90e603d7-e10e-4939-aca6-a0f5ac8245aa', '2026-11-23 04:47:33.945079'),
	('bb4e1407-8171-4266-a417-85f62c6522d5', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '916be51e-8716-4107-aeeb-412ef963eaa5', '2026-11-23 04:47:33.945079'),
	('62041574-69b1-417a-b666-85e87ecd992f', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'b9c780ac-23aa-47ef-bd19-6167ed107700', '2026-11-23 04:47:33.945079'),
	('9db5754f-e76a-475c-940e-8b2b47c5d83b', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'c9bda9f7-86a5-4c77-b42e-79862b142345', '2026-11-23 04:47:33.945079'),
	('4c46f710-ef98-45cd-a3ce-cc1ac211eddd', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'e9959cd7-b9c2-4a21-980c-b8c6f655ba65', '2026-11-23 04:47:33.945079'),
	('cee7c3e9-34e6-43d8-94c1-f8a5f1b7e069', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '43e92338-a063-41c6-8f5d-064e77b73019', '2026-11-23 04:47:33.945079'),
	('24160ded-08dc-481f-90fc-be272e60e01b', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '54fe599b-bc9c-4b68-a480-7bd507154bbe', '2026-11-23 04:47:33.945079'),
	('0d0025ba-ae6a-42ba-b858-c1a2205f608c', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'bb27a11c-82d7-487b-802e-c3c649990949', '2026-11-23 04:47:33.945079'),
	('16f7dbbe-23d8-4870-b6cc-aa2ba4b9cf0f', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'd1140264-c254-4f03-9c98-8516b3d79973', '2026-11-23 04:47:33.945079'),
	('613ffc8d-2e27-4a1c-93db-b4789fa708d1', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'f7a61d5c-9851-4138-b1e3-f5bcce88b48d', '2026-11-23 04:47:33.945079'),
	('70a4fa19-d7b9-44d4-b8d3-3ba0b646d6bb', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'fe385aeb-6676-48d3-ab9a-70613eddb6f1', '2026-11-23 04:47:33.945079'),
	('912fd822-fc6d-48ba-bfb5-c1a1459ced05', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '6fd1e5bb-7a13-4be2-af3a-fa283a955067', '2026-11-23 04:47:33.945079'),
	('9e8069ae-12cd-4322-87f5-424db77bafb6', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '83ce75a4-6859-4e70-bb31-310aad39d1ec', '2026-11-23 04:47:33.945079'),
	('70623f77-3b4d-46eb-be29-93f22452bdac', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '950b64a8-0c44-48cd-ac1b-b217966a46e4', '2026-11-23 04:47:33.945079'),
	('6dc7dedf-b970-46ed-87fc-706a0c34fde0', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '97f90778-d1be-4ed3-8648-4cda7c19b4fc', '2026-11-23 04:47:33.945079'),
	('d13debc4-2388-494d-9087-ef7be1c86665', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'a77498a1-0740-4b8d-a885-74e94cd11475', '2026-11-23 04:47:33.945079'),
	('3df9e554-b0bb-48d3-8cc2-2e283cb68d5d', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'd9896fc1-1eed-4a8f-928a-48aabb4e001a', '2026-11-23 04:47:33.945079'),
	('434afc46-8fc8-4ce7-b740-1623a64e5ce8', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '16e2f5c7-0966-4d61-9f28-b2728a2a6882', '2026-11-23 04:47:33.945079'),
	('1695a529-aeb6-4f46-bd10-133c92f4e209', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '236e0d5d-7fdd-4471-8e45-a936f2e66e47', '2026-11-23 04:47:33.945079'),
	('1460a2da-985c-46d3-8b31-a3553fb5eaf2', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '2625d3b9-ca47-446e-89e8-bfdc54975773', '2026-11-23 04:47:33.945079'),
	('9e407aad-3bb7-402e-bbc2-f641acaca560', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'c8afb488-30a7-40bc-a9da-3e6ed67e1745', '2026-11-23 04:47:33.945079'),
	('11174dc9-3ce6-46ac-8dd5-7df494385788', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'cc3610a2-c994-4ace-ace9-ecd50f7fbafe', '2026-11-23 04:47:33.945079'),
	('ed2c1d0b-bfc0-4114-a736-5aff911fbf1b', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'dd5ddce0-e5bb-483e-8542-e59597a91e10', '2026-11-23 04:47:33.945079'),
	('94330e3b-c177-4954-9832-514a5529b731', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '1bc5b019-8e3b-448b-ac2e-28b94cf6c5a8', '2026-11-23 04:47:33.945079'),
	('b9bd5003-692a-40d9-9773-cdc6f03f97b6', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '20e69557-30b8-4b48-ae50-0e1858c628a1', '2026-11-23 04:47:33.945079'),
	('22c9c5b2-8ffc-4db6-b643-e570a0267f35', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '22855709-20ac-407d-960e-5e16029f3b82', '2026-11-23 04:47:33.945079'),
	('e6118a5b-9619-4e15-98aa-a92514032989', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '2a3432a1-2eef-4740-9ea2-44f696113afa', '2026-11-23 04:47:33.945079'),
	('a5b76946-d617-401f-8de6-a64351595850', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '34225046-f3e2-485b-a111-8177931c0e9b', '2026-11-23 04:47:33.945079'),
	('ef7e6329-9fb3-4b5c-a637-643f0b1664f4', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '74e56b63-7677-4cd1-bfc0-0481e4a74b25', '2026-11-23 04:47:33.945079'),
	('4d0a3201-7647-4734-8537-90b0e496d634', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '238eb043-a154-4b83-9b4c-39fa81b33a87', '2026-11-23 04:47:33.945079'),
	('62352cdf-ab7f-4553-bc44-add804c1e706', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '8440bfa1-b21d-40b4-9b8c-6da486eeb13b', '2026-11-23 04:47:33.945079'),
	('8bd37d53-fcb5-4d69-b1a3-d5a0cb3c4d08', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'b60f0a9f-5269-45df-ad29-0ec372ef75b2', '2026-11-23 04:47:33.945079'),
	('0e4e5c20-34da-48e1-847c-db0377d16e05', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'f146fa38-9db9-4480-9f81-99f7c38e7b74', '2026-11-23 04:47:33.945079'),
	('d804a8a4-1a5a-4f83-ab33-48183d501984', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '066da758-0388-42de-87f2-45ada21038a3', '2026-11-23 04:47:33.945079'),
	('32e7de43-89b1-4e76-bdd2-fa6d80f210bf', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '6460f81a-d9ca-43ee-aa9f-c4a4f4ee033d', '2026-11-23 04:47:33.945079'),
	('feb48df6-f9b8-410e-a246-85c59a449fd1', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '98640ce9-3fba-47b8-a515-a9f29889f4f3', '2026-11-23 04:47:33.945079'),
	('9dd9ecaf-5525-42e1-a713-e493c996f422', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'b60b1f77-6f98-46b1-b588-578327b15e20', '2026-11-23 04:47:33.945079'),
	('58dca41f-f646-484a-a5f2-d4e3c883208f', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '1894e8f7-b44c-4d42-b82e-ba8eeaca414a', '2026-11-23 04:47:33.945079'),
	('0a371804-0596-476d-9e6a-53a74bdd5ee3', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '1b3e9e87-aedb-4593-b390-cc7c3ebd6833', '2026-11-23 04:47:33.945079'),
	('8a616b05-742e-43ac-9581-b753e644fbc0', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '3261ada3-a268-4cf1-9583-26c16aecf9d9', '2026-11-23 04:47:33.945079'),
	('a5ae530c-014d-4a04-8179-f3e22da0cf74', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '8e2cb9d8-c655-4343-9db4-f100ec282bd9', '2026-11-23 04:47:33.945079'),
	('0cad1587-c1c7-4f71-9a1e-37e26c81e1cf', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'abc44d55-6917-41a4-a7ee-5cdf4e39a444', '2026-11-23 04:47:33.945079'),
	('de719b0f-2414-46e8-9b8c-6618c5dac1b9', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'ed0d5f43-e27d-42cd-97dd-148ef3f23f5e', '2026-11-23 04:47:33.945079'),
	('79bb2631-9873-4a77-a655-929c4c97f0cf', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '3eb45258-6f23-4f32-bd2f-94df93494d1a', '2026-11-23 04:47:33.945079'),
	('608f2c39-262a-4207-8b77-613e619eae7b', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '6a093e3b-8c70-4ca9-ab2d-fb6222049143', '2026-11-23 04:47:33.945079'),
	('1c04c1eb-123b-45f6-b8d9-630f52018fd7', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'b7d03684-41e2-499b-9535-548add0070e2', '2026-11-23 04:47:33.945079'),
	('f3104abf-157e-4387-a96e-2efda9b9199f', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'f08a7e56-ba5a-49c8-871a-ce8ddaf74c8b', '2026-11-23 04:47:33.945079'),
	('cc39c879-1638-4ef3-935c-4fd2ba6cd5ff', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '0102945e-3781-4cdc-9c0d-41d50a8f21e9', '2026-11-23 04:47:33.945079'),
	('1ab8ec9c-54d1-4d92-951a-7d9a58e73013', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '1abe5063-1bc6-4b46-a6c8-74086d380fd2', '2026-11-23 04:47:33.945079'),
	('3001b5cd-2324-4891-afdb-a99daa587d37', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '1fc6c5c6-8358-4c9d-ade4-ff90dd01e9bc', '2026-11-23 04:47:33.945079'),
	('ff579c45-0680-4c31-8ab9-2dc37e3788b3', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '54ecba53-cad4-4cef-a30e-bf1b99903663', '2026-11-23 04:47:33.945079'),
	('65b57b81-ed8d-43c5-a9d7-6a7917ab08c1', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'f2eada37-f624-4ca5-94bd-132d424088db', '2026-11-23 04:47:33.945079'),
	('f38d96cf-e94c-4bb4-a5b2-af13b16b7f45', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'f60b7658-07f5-4c88-8474-99b55967f1d1', '2026-11-23 04:47:33.945079'),
	('a6684369-a565-460c-be9b-2fe95a3f21a1', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '313e02c3-858c-4f88-af9d-5bc34fec8da1', '2026-11-23 04:47:33.945079'),
	('0e179a6a-6eba-4906-b809-ab60ce002e41', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '740eb670-16db-4bb6-a1d9-793924d41049', '2026-11-23 04:47:33.945079'),
	('b94ffb84-c942-4567-ac2f-bb8d842ce797', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '8e0ac324-afe4-49f8-9c43-bda79160d715', '2026-11-23 04:47:33.945079'),
	('5795b115-1130-4128-8797-b6c683480cd4', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '903aea4b-2143-4aa5-9f7f-7f639f62c1af', '2026-11-23 04:47:33.945079'),
	('38d7cefa-d167-4aaa-a36c-ac6b36db9722', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '9e82a5ae-6e09-42ad-8c0f-244aba63d47d', '2026-11-23 04:47:33.945079'),
	('b1cbd97b-65f4-4b5f-ba55-ee449ce89f01', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'b7f3e5e2-174b-429d-8b1e-1fa16f65515e', '2026-11-23 04:47:33.945079'),
	('1033c85a-2124-49f7-920c-2af5f820a673', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '01e50634-77e5-4242-b6f8-ae0b8d09c361', '2026-11-23 04:47:33.945079'),
	('5272a141-fb11-421b-8b2f-1e7f4cd66784', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '082bb3c2-e1ea-4a9b-b093-dedc73c060f0', '2026-11-23 04:47:33.945079'),
	('0ff7a3b4-6bd1-40d7-b806-0b88f6877351', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '10726544-09df-4712-bc64-113f1e6c7e42', '2026-11-23 04:47:33.945079'),
	('3127e6e6-d6fe-4c1e-98cc-bd804b27b578', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '13a90290-7c5d-4ea5-ac44-5f35627e8e49', '2026-11-23 04:47:33.945079'),
	('792c97f5-90fb-4f77-adf5-072a27687710', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'a467822b-1069-4b2c-9b5a-7609fca5c16f', '2026-11-23 04:47:33.945079'),
	('ca6abc6e-5320-4b71-8b8c-a06436b16b92', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'be054b83-877a-42cc-86ca-46bdb39681e0', '2026-11-23 04:47:33.945079'),
	('b6b95937-a293-4cd8-a7b4-5b2c33655998', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '1627d04b-94c0-40f2-8891-31a698fa1a53', '2026-11-23 04:47:33.945079'),
	('e13333ee-bfcd-4e40-bcf1-0bd4f9ca7403', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '18920cc9-dbe5-4e34-98c1-55b0a686bdab', '2026-11-23 04:47:33.945079'),
	('f32dbbe1-736a-4c6c-a76c-8eb431464dc5', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '21e5a502-d081-4f18-923e-2eed75608a69', '2026-11-23 04:47:33.945079'),
	('7f691723-6971-4113-8011-ad6ee3513419', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '2b8ceb3d-a089-4453-88e1-0709e4508c0c', '2026-11-23 04:47:33.945079'),
	('cb993c7f-48ae-48e8-9c3b-d10ec52b81e3', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '66f3aee0-e00b-4238-bbaf-0720467bf9f3', '2026-11-23 04:47:33.945079'),
	('7f5e39a6-e0db-4118-92c9-86a46e55217d', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '9151175f-bd0e-4861-adb5-fb24cf8319ec', '2026-11-23 04:47:33.945079'),
	('be937f37-f41b-4490-8510-c11dd70ebe37', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '198c710a-3025-4f6f-8b58-39a7c42ee9b4', '2026-11-23 04:47:33.945079'),
	('229d0783-8fec-4d84-bd11-da65671dfd8c', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '33bc4eab-bbd6-4c30-be79-5a108e0b7a3a', '2026-11-23 04:47:33.945079'),
	('db9988e4-152f-4cd0-b766-5052be757099', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '649102dc-bd7f-493e-9801-cee8bd47d95a', '2026-11-23 04:47:33.945079'),
	('e422a705-96ed-4e50-aaac-42a3b91d39ae', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'b8c7a936-e5c0-423e-b2ac-4a5fa1d8eade', '2026-11-23 04:47:33.945079'),
	('b17a14d8-456b-4136-b519-84c279f520cd', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'd0c4877e-fb8a-4538-b2a0-06af02fa552f', '2026-11-23 04:47:33.945079'),
	('75a0c7cb-5f99-4867-aef0-4cab9309a433', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'ea82b906-9c82-4f4f-9e63-46b0dab93222', '2026-11-23 04:47:33.945079'),
	('9420f65f-96ec-4fa7-8832-b40c5b4f68e2', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '8d560aa6-9e3f-4d76-862f-35ca6a48b40a', '2026-11-23 04:47:33.945079'),
	('432fe552-f663-4f6e-8b48-f5d3a525f2ff', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'a2bde97a-0306-49e2-8840-c754bd3d6b5e', '2026-11-23 04:47:33.945079'),
	('526abed2-1879-4556-b400-3b6446e6ad24', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'dac1922e-7057-415d-9890-5156bfa0e1a1', '2026-11-23 04:47:33.945079'),
	('ddb4b844-329a-43f2-b12d-2f72b9ef51a2', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'e7415222-deca-4e6e-a306-cc80dc2da51c', '2026-11-23 04:47:33.945079'),
	('84af276e-6c94-4088-b15a-1ad485d08461', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'f8deb9ba-1228-4cb6-bdef-42fb11b036b4', '2026-11-23 04:47:33.945079'),
	('cbd02e73-f8de-4e57-9165-d4fd59f1f8f6', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '4e751734-6773-4911-b913-ae7a478f5951', '2026-11-23 04:47:33.945079'),
	('d5ab7f4d-afb8-4d1c-9457-3b50da288cf3', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '13e4c947-0ef8-4543-a8e1-acdeaa217162', '2026-11-23 04:47:33.945079'),
	('b361d621-2e57-4522-900d-65129fb879f0', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '78ac336c-2260-489a-acf8-be63f22b4a34', '2026-11-23 04:47:33.945079'),
	('486ba874-bcb7-4c24-81fa-b97f204ccf14', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'a24a39ec-9874-42a2-baf9-5fca40c1ec2f', '2026-11-23 04:47:33.945079'),
	('61d63ebe-6389-4fe0-8523-7b54d5dfe342', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'c330f658-a29a-4bd9-9f3d-b0f3a119f01a', '2026-11-23 04:47:33.945079'),
	('d25f27ba-0d8d-4dd6-b1d4-19826c2e5918', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '13853ea6-61cf-4010-aac6-9304e7d2a763', '2026-11-23 04:47:33.945079'),
	('47cdf747-d816-4298-852d-900e04744534', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '4ae907c5-f3b7-4cd9-8627-f9edc7402ac5', '2026-11-23 04:47:33.945079'),
	('dfec4dca-ae89-4eb5-88f1-3be97016f5b3', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '51a52508-0464-4458-b503-522ec78dc5fd', '2026-11-23 04:47:33.945079'),
	('3df1d337-9f10-449b-b7c6-37bfcaa7f5f3', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '6babf5cd-30c4-4352-b160-49435695b96f', '2026-11-23 04:47:33.945079'),
	('c51881c2-aa7c-47cd-8ef2-765a03957a59', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'd7ef156d-0854-4ce9-bc7e-fe37f0d35014', '2026-11-23 04:47:33.945079'),
	('c7435cfe-b5ee-4ef6-bffb-50bd879235c9', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'ee7a639c-310d-43e0-b8ee-b17bf13736e6', '2026-11-23 04:47:33.945079'),
	('27e39a64-415f-4433-ac11-a845e45c9aad', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '2045604e-7a56-419e-b060-704378df31f4', '2026-11-23 04:47:33.945079'),
	('db32cc44-8cdf-4c10-b0a0-2d40e8bd1c95', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '3bbe7526-d322-47c8-bab4-6457393d88cb', '2026-11-23 04:47:33.945079'),
	('7ee97486-73ba-4752-a8ef-362efe2b1cc8', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '63aade21-ee23-4218-9127-bc7774c05b66', '2026-11-23 04:47:33.945079'),
	('e8fed4a0-25b2-460d-b55e-24e53ddf0ab1', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'dfa49aa8-d740-4c64-ae0f-481162d972a2', '2026-11-23 04:47:33.945079'),
	('1aab6e6b-3e6a-4944-87a4-0aef0a606e5c', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'e11b260e-9539-4902-a0e7-a1f7e8b52397', '2026-11-23 04:47:33.945079'),
	('a9729b21-7f10-4548-a1ac-01b9d0e44ad5', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'e8666ccd-5f61-40b4-be04-a8e35c1cc033', '2026-11-23 04:47:33.945079'),
	('160153c3-7ce3-4ac2-bc0c-c72fb588a940', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'abccac12-638f-4252-a4e6-116df022f07f', '2026-11-23 04:47:33.945079'),
	('c89832cf-be8f-4168-b9f9-4c69613bbe01', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '18b847d6-b7ac-4df1-ad07-89963e6b7cf5', '2026-11-23 04:47:33.945079'),
	('c03cf27f-9ca2-4b8b-bcc2-6b1989cae514', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '23b58815-4b85-4ca0-a8e6-218283af15fc', '2026-11-23 04:47:33.945079'),
	('8ec033c6-1f6f-498e-a9e0-4ca0ec14313e', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'a8169b04-7123-4545-9116-7a9385c2e766', '2026-11-23 04:47:33.945079'),
	('7a22ffcb-dc59-4dcf-b4ae-7e5db1f3916b', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'dac38c06-c18d-451a-9e61-7b519f2026d2', '2026-11-23 04:47:33.945079'),
	('464192ca-3038-487c-a79f-7b2be65e93fe', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '1d1f10b1-3478-40f5-ba41-d8278a978400', '2026-11-23 04:47:33.945079'),
	('a7894dd8-ceb3-4c2a-a73d-2b4bf3c5a4cf', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '44627974-b34c-458f-8c08-491c59f88a45', '2026-11-23 04:47:33.945079'),
	('d8aa4b1d-2c4c-423f-8c30-f990f8f4a62b', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '9c6c117a-57d9-441c-862b-971414553d3c', '2026-11-23 04:47:33.945079'),
	('09044161-cdff-4086-8087-b783b79f50ee', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'c994a0e3-a17c-4e16-ac00-567f584e42ae', '2026-11-23 04:47:33.945079'),
	('bb63fedd-a466-48c7-ae78-9b8025c83a62', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '3b5ba7d1-591b-4e4d-9e18-414f051b5d08', '2026-11-23 04:47:33.945079'),
	('c1953341-9755-46d7-ae9a-c926fc39cff5', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '9b385e53-fd0a-4b3d-b83a-330a9575c873', '2026-11-23 04:47:33.945079'),
	('8592c8f6-1984-4601-abf6-e9a6cb8cddaa', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'b365f67c-46f3-4286-b8a2-dc0fce423aa7', '2026-11-23 04:47:33.945079'),
	('649ae973-0cfd-4b61-8178-22fd44632cf4', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'bc6b6ee1-f2fd-40a4-a7a3-ce43561bb978', '2026-11-23 04:47:33.945079'),
	('9776eae5-f2eb-4499-a4d9-426c28949509', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '77188b68-4b04-4eb4-9a1f-103b54ded191', '2026-11-23 04:47:33.945079'),
	('19de046f-de28-4fca-8783-9ade51d47187', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'ad288788-81e1-44db-ae0d-67c3affb19ff', '2026-11-23 04:47:33.945079'),
	('dae2dbfb-716b-4057-9e08-8769a504a50d', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '3e22482d-452a-4629-9ced-1e2c82ea29ab', '2026-11-23 04:47:33.945079'),
	('246b2d1f-00cc-4f04-b018-f1a95473333a', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '4b83f7f2-bce4-45b6-8669-8b4d37446b5a', '2026-11-23 04:47:33.945079'),
	('3845094f-708f-4dc9-bcb2-a8379691f124', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '522bc4f1-e08c-4388-91cc-f6b839578893', '2026-11-23 04:47:33.945079'),
	('34d6fe9b-fd51-4ba4-bc4e-b81996d88872', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '67320042-f287-45f7-9da6-c4738843a88f', '2026-11-23 04:47:33.945079'),
	('437c15f8-3254-4710-bceb-688d32128613', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '9e2da601-02be-4a47-8f44-3d96374aaf39', '2026-11-23 04:47:33.945079'),
	('75947705-c1b2-4d8f-ab7e-d3df6125f409', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'dfede3d1-3ecb-4bd7-9141-8468e00a0e34', '2026-11-23 04:47:33.945079'),
	('9aa9f9e4-bcf1-4469-bc31-6769efbf2e83', '2ef21c81-cb3f-4e85-bb5f-684970565b18', 'e6b6d822-da84-4334-bde8-17a950fdeb6e', '2026-11-23 04:47:33.945079'),
	('04064d33-a605-4677-a9ce-7c49cf79f832', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '0cb388ac-80ec-4b7d-bc41-e31c9dc976b8', '2026-11-23 04:47:33.945079'),
	('94b4aa5d-fa93-4d93-969c-f88130750b41', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '68d33409-512c-42c0-a807-75a9b81f81b1', '2026-11-23 04:47:33.945079'),
	('12af9e52-2ffd-460e-93da-b61ad81ef2f2', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '74d509a1-ebc6-41c9-9e2a-2442b2c424dd', '2026-11-23 04:47:33.945079'),
	('9bb3b166-36c4-4044-bf45-f6447d856290', '2ef21c81-cb3f-4e85-bb5f-684970565b18', '9c70277b-3c51-4f3a-b381-4d8f13fbf440', '2026-11-23 04:47:33.945079'),
	('0fb3866b-cc83-4804-ab91-e51ead78ff8d', 'c45f0377-159e-4b66-90df-db6404748a5f', '06f08b75-b40f-41e3-ba35-d44515e0c14b', '2026-11-23 04:47:33.945079'),
	('545e9690-2c02-4eee-bd70-018759d8e3e7', 'c45f0377-159e-4b66-90df-db6404748a5f', '0bdf55d4-b854-4b49-9baa-7984f5103ef5', '2026-11-23 04:47:33.945079'),
	('44af8946-9f52-4a4a-bc1a-395e933d5f49', 'c45f0377-159e-4b66-90df-db6404748a5f', '299ad622-05a9-4f85-a7e9-a704a92d1598', '2026-11-23 04:47:33.945079'),
	('d4c9d30c-c113-4b04-8371-c3cd195b6474', 'c45f0377-159e-4b66-90df-db6404748a5f', '33b5f092-fe9d-42d7-bb8d-a35321622a34', '2026-11-23 04:47:33.945079'),
	('0b16dd32-f4e5-4b84-8773-ad28206d540e', 'c45f0377-159e-4b66-90df-db6404748a5f', '1d42f5e4-db44-4c9e-a406-26491073f6fb', '2026-11-23 04:47:33.945079'),
	('1382b800-1395-4fe5-a2c5-3ca9a6029bd1', 'c45f0377-159e-4b66-90df-db6404748a5f', '31f4b996-d6bc-496d-8984-cdf19e427e72', '2026-11-23 04:47:33.945079'),
	('5b018a0c-0090-4086-a4db-40c63ae0ea49', 'c45f0377-159e-4b66-90df-db6404748a5f', '3348a529-f4ab-47ba-9b5c-d56de176c9f9', '2026-11-23 04:47:33.945079'),
	('1acfbcf7-bc8d-4e7c-9b4a-b171ad6660ca', 'c45f0377-159e-4b66-90df-db6404748a5f', '8d82820e-6b5a-4518-a025-8167a829b7dc', '2026-11-23 04:47:33.945079'),
	('0b55bed1-f380-4bed-8112-6cb606647cf8', 'c45f0377-159e-4b66-90df-db6404748a5f', '9d06eda3-af58-4278-ae8e-501e0524ecb2', '2026-11-23 04:47:33.945079'),
	('31bda88e-0005-42f1-8571-a42824863f45', 'c45f0377-159e-4b66-90df-db6404748a5f', 'c3208853-bd11-4f3a-a903-412f3982ed77', '2026-11-23 04:47:33.945079'),
	('b37e8b60-c5e2-4cc2-82e0-0585ab82dd9f', 'c45f0377-159e-4b66-90df-db6404748a5f', '38c11d7a-1590-4c19-accc-8f87ec8c0eab', '2026-11-23 04:47:33.945079'),
	('04b45692-c5f9-4dbc-9340-dd9e73c4a2c5', 'c45f0377-159e-4b66-90df-db6404748a5f', '90e603d7-e10e-4939-aca6-a0f5ac8245aa', '2026-11-23 04:47:33.945079'),
	('7b5350a2-98e7-4332-abbb-4c6a2c343ece', 'c45f0377-159e-4b66-90df-db6404748a5f', '916be51e-8716-4107-aeeb-412ef963eaa5', '2026-11-23 04:47:33.945079'),
	('ec7a8276-6f5a-47ae-8d61-8ebdf4495c7b', 'c45f0377-159e-4b66-90df-db6404748a5f', 'b9c780ac-23aa-47ef-bd19-6167ed107700', '2026-11-23 04:47:33.945079'),
	('1e42b31b-80f7-4773-af5d-3d673c2a3353', 'c45f0377-159e-4b66-90df-db6404748a5f', 'c9bda9f7-86a5-4c77-b42e-79862b142345', '2026-11-23 04:47:33.945079'),
	('495d15cc-5c43-4608-83ec-d3ba3c9bc513', 'c45f0377-159e-4b66-90df-db6404748a5f', 'e9959cd7-b9c2-4a21-980c-b8c6f655ba65', '2026-11-23 04:47:33.945079'),
	('6e1414bd-9f5c-4341-919e-52a880157e47', 'c45f0377-159e-4b66-90df-db6404748a5f', '43e92338-a063-41c6-8f5d-064e77b73019', '2026-11-23 04:47:33.945079'),
	('0977325a-54e6-4832-a77d-03a3fa96ec78', 'c45f0377-159e-4b66-90df-db6404748a5f', '54fe599b-bc9c-4b68-a480-7bd507154bbe', '2026-11-23 04:47:33.945079'),
	('368a29ee-6e9e-46e4-8147-a43383d80d61', 'c45f0377-159e-4b66-90df-db6404748a5f', 'bb27a11c-82d7-487b-802e-c3c649990949', '2026-11-23 04:47:33.945079'),
	('23edc49c-34e8-49ec-bb4f-ea79bf9dabef', 'c45f0377-159e-4b66-90df-db6404748a5f', 'd1140264-c254-4f03-9c98-8516b3d79973', '2026-11-23 04:47:33.945079'),
	('79f68457-aaa3-4632-b8f0-afe07a85775d', 'c45f0377-159e-4b66-90df-db6404748a5f', 'f7a61d5c-9851-4138-b1e3-f5bcce88b48d', '2026-11-23 04:47:33.945079'),
	('d04d3e3d-d2f8-4658-b782-3673f9ed296d', 'c45f0377-159e-4b66-90df-db6404748a5f', 'fe385aeb-6676-48d3-ab9a-70613eddb6f1', '2026-11-23 04:47:33.945079'),
	('172f18d5-d1a0-41df-9a78-b64c699876a8', 'c45f0377-159e-4b66-90df-db6404748a5f', '6fd1e5bb-7a13-4be2-af3a-fa283a955067', '2026-11-23 04:47:33.945079'),
	('d301bc72-13c5-49cf-a070-843bef2e1c3f', 'c45f0377-159e-4b66-90df-db6404748a5f', '83ce75a4-6859-4e70-bb31-310aad39d1ec', '2026-11-23 04:47:33.945079'),
	('57d6e167-cfbb-4c39-8811-b2a095daa640', 'c45f0377-159e-4b66-90df-db6404748a5f', '950b64a8-0c44-48cd-ac1b-b217966a46e4', '2026-11-23 04:47:33.945079'),
	('dbe5100d-1b2e-449d-b329-ab7653bc07d3', 'c45f0377-159e-4b66-90df-db6404748a5f', '97f90778-d1be-4ed3-8648-4cda7c19b4fc', '2026-11-23 04:47:33.945079'),
	('5ba02eac-ce40-46b9-8e6e-0a6a0b8bd7a9', 'c45f0377-159e-4b66-90df-db6404748a5f', 'a77498a1-0740-4b8d-a885-74e94cd11475', '2026-11-23 04:47:33.945079'),
	('f2f95a5b-770f-4f0d-ac86-7ad2e6d65e73', 'c45f0377-159e-4b66-90df-db6404748a5f', 'd9896fc1-1eed-4a8f-928a-48aabb4e001a', '2026-11-23 04:47:33.945079'),
	('9fccd46f-feb3-40fe-8280-2c11a890a5c6', 'c45f0377-159e-4b66-90df-db6404748a5f', '16e2f5c7-0966-4d61-9f28-b2728a2a6882', '2026-11-23 04:47:33.945079'),
	('0e344fe8-323d-47c4-ae0d-ab986336854f', 'c45f0377-159e-4b66-90df-db6404748a5f', '236e0d5d-7fdd-4471-8e45-a936f2e66e47', '2026-11-23 04:47:33.945079'),
	('a4117a5b-c900-4fd7-9f13-f61bf18d1863', 'c45f0377-159e-4b66-90df-db6404748a5f', '2625d3b9-ca47-446e-89e8-bfdc54975773', '2026-11-23 04:47:33.945079'),
	('03d61d4a-27eb-4854-a909-5a2f2cdee1fa', 'c45f0377-159e-4b66-90df-db6404748a5f', 'c8afb488-30a7-40bc-a9da-3e6ed67e1745', '2026-11-23 04:47:33.945079'),
	('a99c75ba-d9bc-415e-9b28-c884bfbed225', 'c45f0377-159e-4b66-90df-db6404748a5f', 'cc3610a2-c994-4ace-ace9-ecd50f7fbafe', '2026-11-23 04:47:33.945079'),
	('081b1737-9dc0-4362-bde7-ac080ae2447c', 'c45f0377-159e-4b66-90df-db6404748a5f', 'dd5ddce0-e5bb-483e-8542-e59597a91e10', '2026-11-23 04:47:33.945079'),
	('04bc20d5-66c2-46ff-b747-ff7321edc59a', 'c45f0377-159e-4b66-90df-db6404748a5f', '1bc5b019-8e3b-448b-ac2e-28b94cf6c5a8', '2026-11-23 04:47:33.945079'),
	('f4c33969-ad37-4714-af65-0e5b1c75ab8e', 'c45f0377-159e-4b66-90df-db6404748a5f', '20e69557-30b8-4b48-ae50-0e1858c628a1', '2026-11-23 04:47:33.945079'),
	('cd12b704-4b74-438f-ae0e-ae1e25cb87a7', 'c45f0377-159e-4b66-90df-db6404748a5f', '22855709-20ac-407d-960e-5e16029f3b82', '2026-11-23 04:47:33.945079'),
	('5108065b-09b6-4730-9dc5-223a0b210720', 'c45f0377-159e-4b66-90df-db6404748a5f', '2a3432a1-2eef-4740-9ea2-44f696113afa', '2026-11-23 04:47:33.945079'),
	('5c82fa36-85aa-4d31-b769-e8b584549373', 'c45f0377-159e-4b66-90df-db6404748a5f', '34225046-f3e2-485b-a111-8177931c0e9b', '2026-11-23 04:47:33.945079'),
	('4048c6ee-ac53-4d81-94cf-844a27322eb5', 'c45f0377-159e-4b66-90df-db6404748a5f', '74e56b63-7677-4cd1-bfc0-0481e4a74b25', '2026-11-23 04:47:33.945079'),
	('ccf1f22f-b819-482c-a905-c92ad4b785dc', 'c45f0377-159e-4b66-90df-db6404748a5f', '238eb043-a154-4b83-9b4c-39fa81b33a87', '2026-11-23 04:47:33.945079'),
	('aaa84c57-3850-447a-8cfd-2863ea1dc8f6', 'c45f0377-159e-4b66-90df-db6404748a5f', '8440bfa1-b21d-40b4-9b8c-6da486eeb13b', '2026-11-23 04:47:33.945079'),
	('212477f5-adb5-4143-9bf1-af5865a1372c', 'c45f0377-159e-4b66-90df-db6404748a5f', 'b60f0a9f-5269-45df-ad29-0ec372ef75b2', '2026-11-23 04:47:33.945079'),
	('e59dea4f-3cde-495d-b6d5-91a3159d68c3', 'c45f0377-159e-4b66-90df-db6404748a5f', 'f146fa38-9db9-4480-9f81-99f7c38e7b74', '2026-11-23 04:47:33.945079');
INSERT INTO public.role_permissions VALUES
	('68f42fac-e9b0-4670-8c27-6dea01ab6ffd', 'c45f0377-159e-4b66-90df-db6404748a5f', '066da758-0388-42de-87f2-45ada21038a3', '2026-11-23 04:47:33.945079'),
	('d8f0dcb2-cea3-4626-b650-4e102ad3a7db', 'c45f0377-159e-4b66-90df-db6404748a5f', '6460f81a-d9ca-43ee-aa9f-c4a4f4ee033d', '2026-11-23 04:47:33.945079'),
	('0cea08bd-27b1-4604-8638-4be7ca8c6e3b', 'c45f0377-159e-4b66-90df-db6404748a5f', '98640ce9-3fba-47b8-a515-a9f29889f4f3', '2026-11-23 04:47:33.945079'),
	('4ba16902-a4b8-4154-bc9f-ef46bd25cc6d', 'c45f0377-159e-4b66-90df-db6404748a5f', 'b60b1f77-6f98-46b1-b588-578327b15e20', '2026-11-23 04:47:33.945079'),
	('c23c0250-9601-445e-bb03-46585c646210', 'c45f0377-159e-4b66-90df-db6404748a5f', '1894e8f7-b44c-4d42-b82e-ba8eeaca414a', '2026-11-23 04:47:33.945079'),
	('f09bb3b1-a1d0-4c07-ad0b-40aa69a4b31c', 'c45f0377-159e-4b66-90df-db6404748a5f', '1b3e9e87-aedb-4593-b390-cc7c3ebd6833', '2026-11-23 04:47:33.945079'),
	('8dfcc2de-bca0-420d-872c-229195b59fd0', 'c45f0377-159e-4b66-90df-db6404748a5f', '3261ada3-a268-4cf1-9583-26c16aecf9d9', '2026-11-23 04:47:33.945079'),
	('d38abef7-d052-4c7f-a726-d3f5d0981f94', 'c45f0377-159e-4b66-90df-db6404748a5f', '8e2cb9d8-c655-4343-9db4-f100ec282bd9', '2026-11-23 04:47:33.945079'),
	('fccf6db0-8c3e-41d7-880a-8a6fe4553021', 'c45f0377-159e-4b66-90df-db6404748a5f', 'abc44d55-6917-41a4-a7ee-5cdf4e39a444', '2026-11-23 04:47:33.945079'),
	('8602e155-0abf-40b1-a948-75d3ac6fe8aa', 'c45f0377-159e-4b66-90df-db6404748a5f', 'ed0d5f43-e27d-42cd-97dd-148ef3f23f5e', '2026-11-23 04:47:33.945079'),
	('2fc3f70b-d635-4f33-b1d5-b0b9a9c9eec8', 'c45f0377-159e-4b66-90df-db6404748a5f', '3eb45258-6f23-4f32-bd2f-94df93494d1a', '2026-11-23 04:47:33.945079'),
	('8c32bc36-12e3-4083-a782-7d5eca320ff9', 'c45f0377-159e-4b66-90df-db6404748a5f', '6a093e3b-8c70-4ca9-ab2d-fb6222049143', '2026-11-23 04:47:33.945079'),
	('b604a365-e951-416e-b578-5875ec45d754', 'c45f0377-159e-4b66-90df-db6404748a5f', 'b7d03684-41e2-499b-9535-548add0070e2', '2026-11-23 04:47:33.945079'),
	('66a71002-cc13-4f56-bb58-bea3a5135ec0', 'c45f0377-159e-4b66-90df-db6404748a5f', 'f08a7e56-ba5a-49c8-871a-ce8ddaf74c8b', '2026-11-23 04:47:33.945079'),
	('5889fb8d-1e25-4c4d-a75e-296d62a866d6', 'c45f0377-159e-4b66-90df-db6404748a5f', '0102945e-3781-4cdc-9c0d-41d50a8f21e9', '2026-11-23 04:47:33.945079'),
	('a93c3132-1011-4dcf-8db8-deee0559d730', 'c45f0377-159e-4b66-90df-db6404748a5f', '1abe5063-1bc6-4b46-a6c8-74086d380fd2', '2026-11-23 04:47:33.945079'),
	('e46aec3d-3e6a-41ad-b3c2-a4c55fa01b40', 'c45f0377-159e-4b66-90df-db6404748a5f', '1fc6c5c6-8358-4c9d-ade4-ff90dd01e9bc', '2026-11-23 04:47:33.945079'),
	('ae18d208-3df8-4df9-8d18-5d6ad7e40a1e', 'c45f0377-159e-4b66-90df-db6404748a5f', '54ecba53-cad4-4cef-a30e-bf1b99903663', '2026-11-23 04:47:33.945079'),
	('19787a81-0ceb-4a2d-a299-537bdc4651d5', 'c45f0377-159e-4b66-90df-db6404748a5f', 'f2eada37-f624-4ca5-94bd-132d424088db', '2026-11-23 04:47:33.945079'),
	('fa563b82-020a-4849-a3c4-a477f0989191', 'c45f0377-159e-4b66-90df-db6404748a5f', 'f60b7658-07f5-4c88-8474-99b55967f1d1', '2026-11-23 04:47:33.945079'),
	('23ee3509-0692-4b57-b6e5-3649d9765539', 'c45f0377-159e-4b66-90df-db6404748a5f', '313e02c3-858c-4f88-af9d-5bc34fec8da1', '2026-11-23 04:47:33.945079'),
	('90a5fabc-c70e-47d5-a156-1078062491eb', 'c45f0377-159e-4b66-90df-db6404748a5f', '740eb670-16db-4bb6-a1d9-793924d41049', '2026-11-23 04:47:33.945079'),
	('901448fa-60e2-46d7-ab47-807a979d5367', 'c45f0377-159e-4b66-90df-db6404748a5f', '8e0ac324-afe4-49f8-9c43-bda79160d715', '2026-11-23 04:47:33.945079'),
	('b2d53da9-279d-4b57-96e4-cc79e368072b', 'c45f0377-159e-4b66-90df-db6404748a5f', '903aea4b-2143-4aa5-9f7f-7f639f62c1af', '2026-11-23 04:47:33.945079'),
	('a740de95-17a8-4fa5-805a-402329c90777', 'c45f0377-159e-4b66-90df-db6404748a5f', '9e82a5ae-6e09-42ad-8c0f-244aba63d47d', '2026-11-23 04:47:33.945079'),
	('a38cf179-f760-4e01-8ef6-05218224d7af', 'c45f0377-159e-4b66-90df-db6404748a5f', 'b7f3e5e2-174b-429d-8b1e-1fa16f65515e', '2026-11-23 04:47:33.945079'),
	('b3acf846-ed95-453c-ae74-ad506964b586', 'c45f0377-159e-4b66-90df-db6404748a5f', '01e50634-77e5-4242-b6f8-ae0b8d09c361', '2026-11-23 04:47:33.945079'),
	('309ac1f5-766f-44bc-a2ac-81c724f1a36d', 'c45f0377-159e-4b66-90df-db6404748a5f', '082bb3c2-e1ea-4a9b-b093-dedc73c060f0', '2026-11-23 04:47:33.945079'),
	('27487e88-9c1f-4c45-9f6c-3b0fbef9312b', 'c45f0377-159e-4b66-90df-db6404748a5f', '10726544-09df-4712-bc64-113f1e6c7e42', '2026-11-23 04:47:33.945079'),
	('ffe0c2dd-590d-464b-ae26-5f1ab428f4c5', 'c45f0377-159e-4b66-90df-db6404748a5f', '13a90290-7c5d-4ea5-ac44-5f35627e8e49', '2026-11-23 04:47:33.945079'),
	('18ed7ee7-e309-4fd3-adf5-e7c1a3563448', 'c45f0377-159e-4b66-90df-db6404748a5f', 'a467822b-1069-4b2c-9b5a-7609fca5c16f', '2026-11-23 04:47:33.945079'),
	('e13a8a9e-5482-40ba-a952-c23e660af985', 'c45f0377-159e-4b66-90df-db6404748a5f', 'be054b83-877a-42cc-86ca-46bdb39681e0', '2026-11-23 04:47:33.945079'),
	('ab2d8e4f-bc4c-4b68-90c2-9cb964390190', 'c45f0377-159e-4b66-90df-db6404748a5f', '1627d04b-94c0-40f2-8891-31a698fa1a53', '2026-11-23 04:47:33.945079'),
	('9b67bf05-9f47-4db8-b9f8-ac50c00ab258', 'c45f0377-159e-4b66-90df-db6404748a5f', '18920cc9-dbe5-4e34-98c1-55b0a686bdab', '2026-11-23 04:47:33.945079'),
	('b307e10c-872a-4dd4-873a-e7347c9b5a0e', 'c45f0377-159e-4b66-90df-db6404748a5f', '21e5a502-d081-4f18-923e-2eed75608a69', '2026-11-23 04:47:33.945079'),
	('00a9be6b-822d-43dd-8766-292f2e21d696', 'c45f0377-159e-4b66-90df-db6404748a5f', '2b8ceb3d-a089-4453-88e1-0709e4508c0c', '2026-11-23 04:47:33.945079'),
	('0778cfba-3a5d-48d5-9125-cee5e3f90c2b', 'c45f0377-159e-4b66-90df-db6404748a5f', '66f3aee0-e00b-4238-bbaf-0720467bf9f3', '2026-11-23 04:47:33.945079'),
	('ee421752-179b-4b3c-a650-779baec7ea98', 'c45f0377-159e-4b66-90df-db6404748a5f', '9151175f-bd0e-4861-adb5-fb24cf8319ec', '2026-11-23 04:47:33.945079'),
	('4406afcc-5d3b-4ec3-9290-4078aa1714e0', 'c45f0377-159e-4b66-90df-db6404748a5f', '198c710a-3025-4f6f-8b58-39a7c42ee9b4', '2026-11-23 04:47:33.945079'),
	('507fb980-030c-4155-ba6d-6112854ebe40', 'c45f0377-159e-4b66-90df-db6404748a5f', '33bc4eab-bbd6-4c30-be79-5a108e0b7a3a', '2026-11-23 04:47:33.945079'),
	('633a6d5a-6c35-41f6-b298-f0eadfe4ba30', 'c45f0377-159e-4b66-90df-db6404748a5f', '649102dc-bd7f-493e-9801-cee8bd47d95a', '2026-11-23 04:47:33.945079'),
	('9e3f4feb-d037-40ba-ab04-e8a7fe72aa3a', 'c45f0377-159e-4b66-90df-db6404748a5f', 'b8c7a936-e5c0-423e-b2ac-4a5fa1d8eade', '2026-11-23 04:47:33.945079'),
	('621d7e9d-a3cd-4515-8020-3e5ef82eac2f', 'c45f0377-159e-4b66-90df-db6404748a5f', 'd0c4877e-fb8a-4538-b2a0-06af02fa552f', '2026-11-23 04:47:33.945079'),
	('668aab4d-dce0-4719-92a0-aff27197714f', 'c45f0377-159e-4b66-90df-db6404748a5f', 'ea82b906-9c82-4f4f-9e63-46b0dab93222', '2026-11-23 04:47:33.945079'),
	('db46b39f-5ca5-4a2f-b9e0-4afdf8eb8476', 'c45f0377-159e-4b66-90df-db6404748a5f', '8d560aa6-9e3f-4d76-862f-35ca6a48b40a', '2026-11-23 04:47:33.945079'),
	('6aff8753-fab5-48e6-a29a-237b75aa13b3', 'c45f0377-159e-4b66-90df-db6404748a5f', 'a2bde97a-0306-49e2-8840-c754bd3d6b5e', '2026-11-23 04:47:33.945079'),
	('7b7a73f9-86c6-4aff-896f-b973f18b6c9f', 'c45f0377-159e-4b66-90df-db6404748a5f', 'dac1922e-7057-415d-9890-5156bfa0e1a1', '2026-11-23 04:47:33.945079'),
	('7e4bdb3e-bc79-4b08-9474-4ea96102daf3', 'c45f0377-159e-4b66-90df-db6404748a5f', 'e7415222-deca-4e6e-a306-cc80dc2da51c', '2026-11-23 04:47:33.945079'),
	('f38bcbbd-42ac-4e05-9812-80d1bcb282f8', 'c45f0377-159e-4b66-90df-db6404748a5f', '13e4c947-0ef8-4543-a8e1-acdeaa217162', '2026-11-23 04:47:33.945079'),
	('948ff351-b1d7-4904-8e22-12378a988a33', 'c45f0377-159e-4b66-90df-db6404748a5f', '78ac336c-2260-489a-acf8-be63f22b4a34', '2026-11-23 04:47:33.945079'),
	('996a44c1-4333-43f3-bbf1-64d2e7bfbf73', 'c45f0377-159e-4b66-90df-db6404748a5f', 'a24a39ec-9874-42a2-baf9-5fca40c1ec2f', '2026-11-23 04:47:33.945079'),
	('f463108e-1f64-47e8-b8dc-5ba7b24b57f2', 'c45f0377-159e-4b66-90df-db6404748a5f', 'c330f658-a29a-4bd9-9f3d-b0f3a119f01a', '2026-11-23 04:47:33.945079'),
	('cd637aad-5b14-46c4-b970-515683692233', 'c45f0377-159e-4b66-90df-db6404748a5f', '13853ea6-61cf-4010-aac6-9304e7d2a763', '2026-11-23 04:47:33.945079'),
	('f5999490-4b9a-4be0-bbae-49570ef6df7c', 'c45f0377-159e-4b66-90df-db6404748a5f', '4ae907c5-f3b7-4cd9-8627-f9edc7402ac5', '2026-11-23 04:47:33.945079'),
	('d62ae3ed-34fb-4473-b8f8-e762f4c8a62f', 'c45f0377-159e-4b66-90df-db6404748a5f', '51a52508-0464-4458-b503-522ec78dc5fd', '2026-11-23 04:47:33.945079'),
	('20d5eec2-f356-4cdc-b242-46fab6d9defc', 'c45f0377-159e-4b66-90df-db6404748a5f', '6babf5cd-30c4-4352-b160-49435695b96f', '2026-11-23 04:47:33.945079'),
	('27ef86c0-6015-4f28-89c1-8d3324abc39e', 'c45f0377-159e-4b66-90df-db6404748a5f', 'd7ef156d-0854-4ce9-bc7e-fe37f0d35014', '2026-11-23 04:47:33.945079'),
	('1a0a9184-d344-4b6d-94a8-9ec13a9a478f', 'c45f0377-159e-4b66-90df-db6404748a5f', 'ee7a639c-310d-43e0-b8ee-b17bf13736e6', '2026-11-23 04:47:33.945079'),
	('55ef0564-21d7-425b-b606-574481cebdce', 'c45f0377-159e-4b66-90df-db6404748a5f', '2045604e-7a56-419e-b060-704378df31f4', '2026-11-23 04:47:33.945079'),
	('61aede10-c7b4-4a82-b7ce-52da9064309f', 'c45f0377-159e-4b66-90df-db6404748a5f', '3bbe7526-d322-47c8-bab4-6457393d88cb', '2026-11-23 04:47:33.945079'),
	('65ec6193-54d0-4626-bfad-e3b1a685d5e0', 'c45f0377-159e-4b66-90df-db6404748a5f', '63aade21-ee23-4218-9127-bc7774c05b66', '2026-11-23 04:47:33.945079'),
	('5514af63-ba7a-46fb-be51-473df73633d1', 'c45f0377-159e-4b66-90df-db6404748a5f', 'dfa49aa8-d740-4c64-ae0f-481162d972a2', '2026-11-23 04:47:33.945079'),
	('3fba8f40-9ccd-420c-9e58-ff8a14fa971e', 'c45f0377-159e-4b66-90df-db6404748a5f', 'e11b260e-9539-4902-a0e7-a1f7e8b52397', '2026-11-23 04:47:33.945079'),
	('bea96e82-66a0-425c-8a29-9bedc0cf4b16', 'c45f0377-159e-4b66-90df-db6404748a5f', 'e8666ccd-5f61-40b4-be04-a8e35c1cc033', '2026-11-23 04:47:33.945079'),
	('18add791-b600-4487-a654-c64d8f0e6684', 'c45f0377-159e-4b66-90df-db6404748a5f', '1d1f10b1-3478-40f5-ba41-d8278a978400', '2026-11-23 04:47:33.945079'),
	('8794b314-01b8-4266-b0ad-a90e3cd79734', 'c45f0377-159e-4b66-90df-db6404748a5f', '44627974-b34c-458f-8c08-491c59f88a45', '2026-11-23 04:47:33.945079'),
	('dc62a505-4079-460a-b947-88c3da0881c1', 'c45f0377-159e-4b66-90df-db6404748a5f', '9c6c117a-57d9-441c-862b-971414553d3c', '2026-11-23 04:47:33.945079'),
	('ff603d31-d833-4bf2-9562-549926108a97', 'c45f0377-159e-4b66-90df-db6404748a5f', 'c994a0e3-a17c-4e16-ac00-567f584e42ae', '2026-11-23 04:47:33.945079'),
	('2a2766e3-734f-46c8-b3c6-5ce85c5ae944', 'c45f0377-159e-4b66-90df-db6404748a5f', '3b5ba7d1-591b-4e4d-9e18-414f051b5d08', '2026-11-23 04:47:33.945079'),
	('a5870e52-ab1f-4735-b177-fa926caa8036', 'c45f0377-159e-4b66-90df-db6404748a5f', '9b385e53-fd0a-4b3d-b83a-330a9575c873', '2026-11-23 04:47:33.945079'),
	('ab90a5a4-771e-4856-9735-fbe45a6ddc07', 'c45f0377-159e-4b66-90df-db6404748a5f', 'b365f67c-46f3-4286-b8a2-dc0fce423aa7', '2026-11-23 04:47:33.945079'),
	('f2f26dd9-411f-454e-8b54-53328668b535', 'c45f0377-159e-4b66-90df-db6404748a5f', 'bc6b6ee1-f2fd-40a4-a7a3-ce43561bb978', '2026-11-23 04:47:33.945079'),
	('e31b0672-be2a-4427-a645-51cec73a8ad7', 'c45f0377-159e-4b66-90df-db6404748a5f', '3e22482d-452a-4629-9ced-1e2c82ea29ab', '2026-11-23 04:47:33.945079'),
	('a6b6ba4a-b590-45a6-8341-418669331f7b', 'c45f0377-159e-4b66-90df-db6404748a5f', '4b83f7f2-bce4-45b6-8669-8b4d37446b5a', '2026-11-23 04:47:33.945079'),
	('44a48f10-6442-4c4f-988e-a2a7df77d04e', 'c45f0377-159e-4b66-90df-db6404748a5f', '522bc4f1-e08c-4388-91cc-f6b839578893', '2026-11-23 04:47:33.945079'),
	('fe23bbc5-74c5-4e40-8c51-324a97f63fed', 'c45f0377-159e-4b66-90df-db6404748a5f', '67320042-f287-45f7-9da6-c4738843a88f', '2026-11-23 04:47:33.945079'),
	('8e948be2-ca5b-4413-aab8-b5ee349362bc', 'c45f0377-159e-4b66-90df-db6404748a5f', '9e2da601-02be-4a47-8f44-3d96374aaf39', '2026-11-23 04:47:33.945079'),
	('06d386c5-08b2-47dc-a390-ae9164dd413c', 'c45f0377-159e-4b66-90df-db6404748a5f', 'dfede3d1-3ecb-4bd7-9141-8468e00a0e34', '2026-11-23 04:47:33.945079'),
	('dfc8a63c-359b-42b0-9562-65137225c485', '7b4b041b-ffff-459e-82e2-635ee39beaac', '06f08b75-b40f-41e3-ba35-d44515e0c14b', '2026-11-23 04:47:33.945079'),
	('82a12aaf-2cc3-4d29-b832-92b1ad76e5b8', '7b4b041b-ffff-459e-82e2-635ee39beaac', '0bdf55d4-b854-4b49-9baa-7984f5103ef5', '2026-11-23 04:47:33.945079'),
	('ca6da279-0732-4133-b5f7-d7b6400ab4be', '7b4b041b-ffff-459e-82e2-635ee39beaac', '3348a529-f4ab-47ba-9b5c-d56de176c9f9', '2026-11-23 04:47:33.945079'),
	('4da4550d-ed46-4043-a3de-d5cc23e606f4', '7b4b041b-ffff-459e-82e2-635ee39beaac', '8d82820e-6b5a-4518-a025-8167a829b7dc', '2026-11-23 04:47:33.945079'),
	('77588562-3c66-416e-b7cd-ddfadd77c2b4', '7b4b041b-ffff-459e-82e2-635ee39beaac', '9d06eda3-af58-4278-ae8e-501e0524ecb2', '2026-11-23 04:47:33.945079'),
	('2ddd5b93-631a-4101-ae0e-6addfa548162', '7b4b041b-ffff-459e-82e2-635ee39beaac', '916be51e-8716-4107-aeeb-412ef963eaa5', '2026-11-23 04:47:33.945079'),
	('be360ab9-9668-4677-83a5-c02cf5326341', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'b9c780ac-23aa-47ef-bd19-6167ed107700', '2026-11-23 04:47:33.945079'),
	('87e39475-ee85-4b49-980c-1cf91ef6fdd2', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'c9bda9f7-86a5-4c77-b42e-79862b142345', '2026-11-23 04:47:33.945079'),
	('b3bf49a2-89fc-44d5-8d02-cc3ef4d914dd', '7b4b041b-ffff-459e-82e2-635ee39beaac', '43e92338-a063-41c6-8f5d-064e77b73019', '2026-11-23 04:47:33.945079'),
	('f97357fe-ef2c-404f-b0ea-d920bf9ba015', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'bb27a11c-82d7-487b-802e-c3c649990949', '2026-11-23 04:47:33.945079'),
	('e24fcb66-0256-4e6a-ac82-763ff1db09cb', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'fe385aeb-6676-48d3-ab9a-70613eddb6f1', '2026-11-23 04:47:33.945079'),
	('7336290d-410b-466d-a30f-ecf19d581832', '7b4b041b-ffff-459e-82e2-635ee39beaac', '6fd1e5bb-7a13-4be2-af3a-fa283a955067', '2026-11-23 04:47:33.945079'),
	('e62a6a08-7d6c-40ca-9795-03c5274be271', '7b4b041b-ffff-459e-82e2-635ee39beaac', '83ce75a4-6859-4e70-bb31-310aad39d1ec', '2026-11-23 04:47:33.945079'),
	('c0c7f0ea-b3d5-4e7e-88ef-ec57edb01159', '7b4b041b-ffff-459e-82e2-635ee39beaac', '950b64a8-0c44-48cd-ac1b-b217966a46e4', '2026-11-23 04:47:33.945079'),
	('e55f4a76-762c-48a6-aa5e-9a2b7d6a4769', '7b4b041b-ffff-459e-82e2-635ee39beaac', '16e2f5c7-0966-4d61-9f28-b2728a2a6882', '2026-11-23 04:47:33.945079'),
	('1d47e0f2-6243-417e-b803-24a07a995f8f', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'cc3610a2-c994-4ace-ace9-ecd50f7fbafe', '2026-11-23 04:47:33.945079'),
	('ec8e38a6-afa8-4c27-b0df-ffe7985e6767', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'dd5ddce0-e5bb-483e-8542-e59597a91e10', '2026-11-23 04:47:33.945079'),
	('fadb76d7-4e63-4b85-aad0-d3e39fc06adc', '7b4b041b-ffff-459e-82e2-635ee39beaac', '1bc5b019-8e3b-448b-ac2e-28b94cf6c5a8', '2026-11-23 04:47:33.945079'),
	('aa3e3bee-4be2-4dd3-b6e4-ba4b999e9e88', '7b4b041b-ffff-459e-82e2-635ee39beaac', '22855709-20ac-407d-960e-5e16029f3b82', '2026-11-23 04:47:33.945079'),
	('35e67c07-6ab7-4093-81c5-061c7d0a8048', '7b4b041b-ffff-459e-82e2-635ee39beaac', '74e56b63-7677-4cd1-bfc0-0481e4a74b25', '2026-11-23 04:47:33.945079'),
	('525cace1-bdce-44ab-93a2-2a5b0f62278a', '7b4b041b-ffff-459e-82e2-635ee39beaac', '8440bfa1-b21d-40b4-9b8c-6da486eeb13b', '2026-11-23 04:47:33.945079'),
	('70010432-d4e4-44e0-a132-94bd8e5b8380', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'b60f0a9f-5269-45df-ad29-0ec372ef75b2', '2026-11-23 04:47:33.945079'),
	('9329048e-a71b-4aee-81ab-be6a767eabd4', '7b4b041b-ffff-459e-82e2-635ee39beaac', '066da758-0388-42de-87f2-45ada21038a3', '2026-11-23 04:47:33.945079'),
	('52e22634-38fd-401c-856a-a9e4060d0a57', '7b4b041b-ffff-459e-82e2-635ee39beaac', '98640ce9-3fba-47b8-a515-a9f29889f4f3', '2026-11-23 04:47:33.945079'),
	('ef1d26d9-2e78-4a15-a63c-2fe091f77bad', '7b4b041b-ffff-459e-82e2-635ee39beaac', '3261ada3-a268-4cf1-9583-26c16aecf9d9', '2026-11-23 04:47:33.945079'),
	('7731c50f-5623-40a7-bf2a-98ce767a0d6a', '7b4b041b-ffff-459e-82e2-635ee39beaac', '8e2cb9d8-c655-4343-9db4-f100ec282bd9', '2026-11-23 04:47:33.945079'),
	('a8d9aed5-f695-4fec-bb04-bd27705141be', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'abc44d55-6917-41a4-a7ee-5cdf4e39a444', '2026-11-23 04:47:33.945079'),
	('64ae9b2d-c30a-445a-a9d0-1d79f7159f90', '7b4b041b-ffff-459e-82e2-635ee39beaac', '3eb45258-6f23-4f32-bd2f-94df93494d1a', '2026-11-23 04:47:33.945079'),
	('a2decf9c-7b96-43d4-865e-f37900e03052', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'b7d03684-41e2-499b-9535-548add0070e2', '2026-11-23 04:47:33.945079'),
	('b2de192d-78dc-43a5-9454-27b23c914315', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'f08a7e56-ba5a-49c8-871a-ce8ddaf74c8b', '2026-11-23 04:47:33.945079'),
	('cc6d5513-d7b4-476f-967e-92ebc700bff3', '7b4b041b-ffff-459e-82e2-635ee39beaac', '1abe5063-1bc6-4b46-a6c8-74086d380fd2', '2026-11-23 04:47:33.945079'),
	('5d5b92b3-c5c9-41b7-8beb-ca42cee964c6', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'f2eada37-f624-4ca5-94bd-132d424088db', '2026-11-23 04:47:33.945079'),
	('0b625bed-9d1b-4904-ac28-4be1a5e230b1', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'f60b7658-07f5-4c88-8474-99b55967f1d1', '2026-11-23 04:47:33.945079'),
	('59f1378b-c7dc-43da-ae12-e9b4081a1667', '7b4b041b-ffff-459e-82e2-635ee39beaac', '740eb670-16db-4bb6-a1d9-793924d41049', '2026-11-23 04:47:33.945079'),
	('93c44773-aac3-47f1-88d5-b734d69c2002', '7b4b041b-ffff-459e-82e2-635ee39beaac', '903aea4b-2143-4aa5-9f7f-7f639f62c1af', '2026-11-23 04:47:33.945079'),
	('9592390f-a50b-4272-9d81-1e006aa51897', '7b4b041b-ffff-459e-82e2-635ee39beaac', '9e82a5ae-6e09-42ad-8c0f-244aba63d47d', '2026-11-23 04:47:33.945079'),
	('b7097c49-65da-4ecb-b9a8-70ed956ba46f', '7b4b041b-ffff-459e-82e2-635ee39beaac', '01e50634-77e5-4242-b6f8-ae0b8d09c361', '2026-11-23 04:47:33.945079'),
	('44165dc8-99e7-489d-92c8-0c88bc346b19', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'a467822b-1069-4b2c-9b5a-7609fca5c16f', '2026-11-23 04:47:33.945079'),
	('bc00a6c6-2ca7-4653-be26-845998c857ff', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'be054b83-877a-42cc-86ca-46bdb39681e0', '2026-11-23 04:47:33.945079'),
	('a0ef1f0c-222c-4ad8-a320-5152704ad2fd', '7b4b041b-ffff-459e-82e2-635ee39beaac', '1627d04b-94c0-40f2-8891-31a698fa1a53', '2026-11-23 04:47:33.945079'),
	('c2f4c931-1369-4dd6-b443-23fd21f206f6', '7b4b041b-ffff-459e-82e2-635ee39beaac', '21e5a502-d081-4f18-923e-2eed75608a69', '2026-11-23 04:47:33.945079'),
	('1009cb7d-200b-49ea-9d68-25bf3897220b', '7b4b041b-ffff-459e-82e2-635ee39beaac', '66f3aee0-e00b-4238-bbaf-0720467bf9f3', '2026-11-23 04:47:33.945079'),
	('b52cdcd1-1c9b-4578-bc89-f69a92627940', '7b4b041b-ffff-459e-82e2-635ee39beaac', '198c710a-3025-4f6f-8b58-39a7c42ee9b4', '2026-11-23 04:47:33.945079'),
	('a227c1b4-d940-4851-b578-23926f2d0ea7', '7b4b041b-ffff-459e-82e2-635ee39beaac', '33bc4eab-bbd6-4c30-be79-5a108e0b7a3a', '2026-11-23 04:47:33.945079'),
	('b882e6ec-a88d-4256-9cc9-c9814d50f159', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'ea82b906-9c82-4f4f-9e63-46b0dab93222', '2026-11-23 04:47:33.945079'),
	('f470f4ae-b61e-4c6a-9213-eace5c0bd607', '7b4b041b-ffff-459e-82e2-635ee39beaac', '8d560aa6-9e3f-4d76-862f-35ca6a48b40a', '2026-11-23 04:47:33.945079'),
	('6b209a1d-9d98-4b1e-85b4-b655890cc663', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'dac1922e-7057-415d-9890-5156bfa0e1a1', '2026-11-23 04:47:33.945079'),
	('bcce23e7-e09c-4169-a57e-205a39b9afa0', '7b4b041b-ffff-459e-82e2-635ee39beaac', '78ac336c-2260-489a-acf8-be63f22b4a34', '2026-11-23 04:47:33.945079'),
	('f5412061-639f-4e4e-a645-a46ed755dc1f', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'c330f658-a29a-4bd9-9f3d-b0f3a119f01a', '2026-11-23 04:47:33.945079'),
	('784f7cdb-1456-42e5-8528-72b90025cc02', '7b4b041b-ffff-459e-82e2-635ee39beaac', '4ae907c5-f3b7-4cd9-8627-f9edc7402ac5', '2026-11-23 04:47:33.945079'),
	('e412ec73-712e-44f1-974e-e58bb76346c4', '7b4b041b-ffff-459e-82e2-635ee39beaac', '6babf5cd-30c4-4352-b160-49435695b96f', '2026-11-23 04:47:33.945079'),
	('74e1ef93-5c76-4b87-8ecf-caeb375779f6', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'ee7a639c-310d-43e0-b8ee-b17bf13736e6', '2026-11-23 04:47:33.945079'),
	('a5884e2d-b6d1-4f29-86ba-5c74033e4525', '7b4b041b-ffff-459e-82e2-635ee39beaac', '2045604e-7a56-419e-b060-704378df31f4', '2026-11-23 04:47:33.945079'),
	('1269b1f7-79ee-43a0-931c-608f5bc3c9ba', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'dfa49aa8-d740-4c64-ae0f-481162d972a2', '2026-11-23 04:47:33.945079'),
	('199e10c6-e26d-4c0c-8dc8-3e993275175d', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'e8666ccd-5f61-40b4-be04-a8e35c1cc033', '2026-11-23 04:47:33.945079'),
	('903c4a55-f204-46d9-9463-532c4c4f9c83', '7b4b041b-ffff-459e-82e2-635ee39beaac', '44627974-b34c-458f-8c08-491c59f88a45', '2026-11-23 04:47:33.945079'),
	('fe81ad36-4a0a-4ffb-9b69-1f2c97a11700', '7b4b041b-ffff-459e-82e2-635ee39beaac', '9c6c117a-57d9-441c-862b-971414553d3c', '2026-11-23 04:47:33.945079'),
	('c44bfb48-1c9e-4ccb-8b2b-dc7d6078a94d', '7b4b041b-ffff-459e-82e2-635ee39beaac', '9b385e53-fd0a-4b3d-b83a-330a9575c873', '2026-11-23 04:47:33.945079'),
	('9131c258-b871-4b82-baf5-71543402304e', '7b4b041b-ffff-459e-82e2-635ee39beaac', 'b365f67c-46f3-4286-b8a2-dc0fce423aa7', '2026-11-23 04:47:33.945079'),
	('696d1ec2-5ab9-47a0-886c-917d4d8d0f93', '7b4b041b-ffff-459e-82e2-635ee39beaac', '522bc4f1-e08c-4388-91cc-f6b839578893', '2026-11-23 04:47:33.945079'),
	('b0d94510-35fc-45a9-8a4d-5a76dd7e7d78', '7b4b041b-ffff-459e-82e2-635ee39beaac', '67320042-f287-45f7-9da6-c4738843a88f', '2026-11-23 04:47:33.945079'),
	('fa446c41-4011-480d-9fde-65cdedab7a8c', '7b4b041b-ffff-459e-82e2-635ee39beaac', '9e2da601-02be-4a47-8f44-3d96374aaf39', '2026-11-23 04:47:33.945079'),
	('4102796a-d636-4949-81d1-9c867400ef09', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '06f08b75-b40f-41e3-ba35-d44515e0c14b', '2026-11-23 04:47:33.945079'),
	('c0e2010a-95d1-4b57-9e25-549a00dde455', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '8d82820e-6b5a-4518-a025-8167a829b7dc', '2026-11-23 04:47:33.945079'),
	('f2e46db3-68f8-488c-b4f7-97a7b48f8455', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '840bf313-2abd-4070-9c18-177f186a400b', '2026-11-23 04:47:33.945079'),
	('a4f4a461-c211-4df1-8d6c-96af943347e8', '65b0ed3f-fa22-49b3-a17c-11611dd43646', 'e63557a3-79b8-454a-8605-d4e6680b01da', '2026-11-23 04:47:33.945079'),
	('78a4bd0c-5272-4e9d-bf3a-2679ea68fbdf', '65b0ed3f-fa22-49b3-a17c-11611dd43646', 'da2d4f9e-123e-4e88-af55-0696927eedd7', '2026-11-23 04:47:33.945079'),
	('ff21ce24-e548-4804-be1a-1add55706cb1', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '9c3e4496-21fc-4ea8-8dd9-021053d63657', '2026-11-23 04:47:33.945079'),
	('5607af06-e644-4c22-9024-cae1d52bdb02', '65b0ed3f-fa22-49b3-a17c-11611dd43646', 'b9c780ac-23aa-47ef-bd19-6167ed107700', '2026-11-23 04:47:33.945079'),
	('8fe0af5e-f752-40a8-9411-5b6aa9cca9d0', '65b0ed3f-fa22-49b3-a17c-11611dd43646', 'fe385aeb-6676-48d3-ab9a-70613eddb6f1', '2026-11-23 04:47:33.945079'),
	('7e9d4506-040c-4291-9707-a999d0162ffa', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '6fd1e5bb-7a13-4be2-af3a-fa283a955067', '2026-11-23 04:47:33.945079'),
	('6bb62318-9986-4cce-a3f9-e1a86edfaf92', '65b0ed3f-fa22-49b3-a17c-11611dd43646', 'cc3610a2-c994-4ace-ace9-ecd50f7fbafe', '2026-11-23 04:47:33.945079'),
	('586fecab-95ad-4dc9-b037-78ffeb5a24cd', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '1bc5b019-8e3b-448b-ac2e-28b94cf6c5a8', '2026-11-23 04:47:33.945079'),
	('64ae0376-3487-4f24-a150-ea2a59871dfe', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '8440bfa1-b21d-40b4-9b8c-6da486eeb13b', '2026-11-23 04:47:33.945079'),
	('b4478e7e-97c2-4899-adbf-b6dc277cde7e', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '066da758-0388-42de-87f2-45ada21038a3', '2026-11-23 04:47:33.945079'),
	('06bcdd43-64a7-4d5f-9e69-9e2fd8b33f07', '65b0ed3f-fa22-49b3-a17c-11611dd43646', 'abc44d55-6917-41a4-a7ee-5cdf4e39a444', '2026-11-23 04:47:33.945079'),
	('2ab7bf1a-7897-4f8e-bd44-f8ecaadf08e1', '65b0ed3f-fa22-49b3-a17c-11611dd43646', 'f08a7e56-ba5a-49c8-871a-ce8ddaf74c8b', '2026-11-23 04:47:33.945079'),
	('f1fba451-bcf3-4fbd-904b-fe7cf2303935', '65b0ed3f-fa22-49b3-a17c-11611dd43646', 'f60b7658-07f5-4c88-8474-99b55967f1d1', '2026-11-23 04:47:33.945079'),
	('0e4c1c12-ba51-46cf-9dec-a8a0766d93a4', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '740eb670-16db-4bb6-a1d9-793924d41049', '2026-11-23 04:47:33.945079'),
	('89779759-1514-4c3a-91a6-bfaecef69cad', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '01e50634-77e5-4242-b6f8-ae0b8d09c361', '2026-11-23 04:47:33.945079'),
	('5621da8f-46f7-48d2-99e3-454d4661d9d2', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '21e5a502-d081-4f18-923e-2eed75608a69', '2026-11-23 04:47:33.945079'),
	('eee03c2e-7848-4931-a105-e50d1f88413b', '65b0ed3f-fa22-49b3-a17c-11611dd43646', 'ea82b906-9c82-4f4f-9e63-46b0dab93222', '2026-11-23 04:47:33.945079'),
	('4d894669-414a-4c8b-8606-2e07bcbac03f', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '8d560aa6-9e3f-4d76-862f-35ca6a48b40a', '2026-11-23 04:47:33.945079'),
	('ff540dad-33a7-48f1-9399-414cf6b75880', '65b0ed3f-fa22-49b3-a17c-11611dd43646', 'c330f658-a29a-4bd9-9f3d-b0f3a119f01a', '2026-11-23 04:47:33.945079'),
	('97077357-801d-41e9-acb9-5749a5ca27b9', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '6babf5cd-30c4-4352-b160-49435695b96f', '2026-11-23 04:47:33.945079'),
	('41269463-e006-4ec8-8868-75f024ba205e', '65b0ed3f-fa22-49b3-a17c-11611dd43646', 'dfa49aa8-d740-4c64-ae0f-481162d972a2', '2026-11-23 04:47:33.945079'),
	('6fb86ccc-6477-46d3-9fba-2d0d67b3eb98', '65b0ed3f-fa22-49b3-a17c-11611dd43646', 'abccac12-638f-4252-a4e6-116df022f07f', '2026-11-23 04:47:33.945079'),
	('83a72bed-cad8-4229-ac7e-c54a065f1316', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '18b847d6-b7ac-4df1-ad07-89963e6b7cf5', '2026-11-23 04:47:33.945079'),
	('edc81346-d4d7-4448-9178-dfce807c3d8a', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '44627974-b34c-458f-8c08-491c59f88a45', '2026-11-23 04:47:33.945079'),
	('01b546c3-115c-4df2-b3ae-53e2f3e5a569', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '9b385e53-fd0a-4b3d-b83a-330a9575c873', '2026-11-23 04:47:33.945079'),
	('3a29464c-43f8-465b-acf5-14eabe857286', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '522bc4f1-e08c-4388-91cc-f6b839578893', '2026-11-23 04:47:33.945079'),
	('2a0cf69e-b0a8-4c49-ba06-4498b5b721c8', '65b0ed3f-fa22-49b3-a17c-11611dd43646', '74d509a1-ebc6-41c9-9e2a-2442b2c424dd', '2026-11-23 04:47:33.945079'),
	('4c6d4aa4-39b8-460f-bb5a-a8b5ca72250e', '9a3e3693-2279-4c89-88b9-e116a99bf813', 'f08a7e56-ba5a-49c8-871a-ce8ddaf74c8b', '2026-11-23 04:47:34.063243'),
	('5e7adbb5-4e56-4373-9131-26ad069fffe2', '9a3e3693-2279-4c89-88b9-e116a99bf813', 'aa7ddb1f-fd1c-4d44-9966-2ed9ab7519da', '2026-11-23 04:47:34.063243'),
	('2dd97a52-b48e-4098-ab1b-bc1d0cf90e72', '9a3e3693-2279-4c89-88b9-e116a99bf813', 'b9c780ac-23aa-47ef-bd19-6167ed107700', '2026-11-23 04:47:34.063243'),
	('d239c869-a308-4219-a242-05a62dd22478', '9a3e3693-2279-4c89-88b9-e116a99bf813', '6babf5cd-30c4-4352-b160-49435695b96f', '2026-11-23 04:47:34.063243'),
	('57cbdc6b-bc54-4959-9d7e-57509847db11', '9a3e3693-2279-4c89-88b9-e116a99bf813', '842d06ec-f173-4d78-ad68-0888f8704b71', '2026-11-23 04:47:34.063243'),
	('2ec27232-be55-462f-b80b-26a84d2a86e6', '9a3e3693-2279-4c89-88b9-e116a99bf813', '522bc4f1-e08c-4388-91cc-f6b839578893', '2026-11-23 04:47:34.063243'),
	('251f46ed-9b53-4e3f-aea9-c50fb79e2cdb', '9a3e3693-2279-4c89-88b9-e116a99bf813', '8440bfa1-b21d-40b4-9b8c-6da486eeb13b', '2026-11-23 04:47:34.063243'),
	('40b81829-0a0a-467b-b5df-b17309e579a6', '9a3e3693-2279-4c89-88b9-e116a99bf813', '950b64a8-0c44-48cd-ac1b-b217966a46e4', '2026-11-23 04:47:34.063243');



INSERT INTO public.roles VALUES
	('2ef21c81-cb3f-4e85-bb5f-684970565b18', 'Admin', 'admin', 'Everything except granting access to others', 90, true, '2026-11-23 04:47:33.945079', '2026-11-23 04:47:33.945079'),
	('c45f0377-159e-4b66-90df-db6404748a5f', 'Editor', 'editor', 'Full control of content and media, including publishing', 50, true, '2026-11-23 04:47:33.945079', '2026-11-23 04:47:33.945079'),
	('7b4b041b-ffff-459e-82e2-635ee39beaac', 'Author', 'author', 'Write content, but not publish or delete it', 30, true, '2026-11-23 04:47:33.945079', '2026-11-23 04:47:33.945079'),
	('65b0ed3f-fa22-49b3-a17c-11611dd43646', 'Viewer', 'viewer', 'Read content, change nothing', 10, true, '2026-11-23 04:47:33.945079', '2026-11-23 04:47:33.945079'),
	('9a3e3693-2279-4c89-88b9-e116a99bf813', 'Public', 'public', 'What anyone may do without signing in', 0, true, '2026-11-23 04:47:34.032949', '2026-11-23 04:47:34.032949');



















































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



ALTER TABLE ONLY public.dc_block_pages_locales
    ADD CONSTRAINT dc_block_pages_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.dc_block_pages
    ADD CONSTRAINT dc_block_pages_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.dc_categories_locales
    ADD CONSTRAINT dc_categories_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.dc_categories
    ADD CONSTRAINT dc_categories_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.dc_components_locales
    ADD CONSTRAINT dc_components_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.dc_components
    ADD CONSTRAINT dc_components_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.dc_form_submission_resends_locales
    ADD CONSTRAINT dc_form_submission_resends_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.dc_form_submission_resends
    ADD CONSTRAINT dc_form_submission_resends_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.dc_form_submission_sends_locales
    ADD CONSTRAINT dc_form_submission_sends_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.dc_form_submission_sends
    ADD CONSTRAINT dc_form_submission_sends_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.dc_form_submissions_locales
    ADD CONSTRAINT dc_form_submissions_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.dc_form_submissions
    ADD CONSTRAINT dc_form_submissions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.dc_form_uploads_locales
    ADD CONSTRAINT dc_form_uploads_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.dc_form_uploads
    ADD CONSTRAINT dc_form_uploads_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.dc_forms_locales
    ADD CONSTRAINT dc_forms_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.dc_forms
    ADD CONSTRAINT dc_forms_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.dc_layouts_locales
    ADD CONSTRAINT dc_layouts_locales_pkey PRIMARY KEY (_parent, _locale);



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



ALTER TABLE ONLY public.dc_pages_locales
    ADD CONSTRAINT dc_pages_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.dc_pages
    ADD CONSTRAINT dc_pages_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.dc_patterns_locales
    ADD CONSTRAINT dc_patterns_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.dc_patterns
    ADD CONSTRAINT dc_patterns_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.dc_posts_locales
    ADD CONSTRAINT dc_posts_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.dc_posts
    ADD CONSTRAINT dc_posts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.dc_tags_locales
    ADD CONSTRAINT dc_tags_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.dc_tags
    ADD CONSTRAINT dc_tags_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.dc_templates_locales
    ADD CONSTRAINT dc_templates_locales_pkey PRIMARY KEY (_parent, _locale);



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



ALTER TABLE ONLY public.nextly_external_identities
    ADD CONSTRAINT nextly_external_identities_pkey PRIMARY KEY (id);



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



ALTER TABLE ONLY public.nextly_translation_provenance
    ADD CONSTRAINT nextly_translation_provenance_pkey PRIMARY KEY (id);



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



ALTER TABLE ONLY public.page_builder__binding_uses
    ADD CONSTRAINT page_builder__binding_uses_pkey PRIMARY KEY (id);



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



ALTER TABLE ONLY public.reading__list_items
    ADD CONSTRAINT reading__list_items_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.reading__lists
    ADD CONSTRAINT reading__lists_pkey PRIMARY KEY (id);



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



ALTER TABLE ONLY public.single_homepage_locales
    ADD CONSTRAINT single_homepage_locales_pkey PRIMARY KEY (_parent, _locale);



ALTER TABLE ONLY public.single_homepage
    ADD CONSTRAINT single_homepage_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.single_landing_page_locales
    ADD CONSTRAINT single_landing_page_locales_pkey PRIMARY KEY (_parent, _locale);



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



CREATE INDEX email_deliveries_provider_origin_idx ON public.email_deliveries USING btree (provider_origin, created_at);



CREATE INDEX email_deliveries_provider_type_idx ON public.email_deliveries USING btree (provider_type, created_at);



CREATE INDEX email_deliveries_queued_idx ON public.email_deliveries USING btree (queued_id);



CREATE INDEX email_deliveries_recipient_idx ON public.email_deliveries USING btree (recipient_hash, created_at);



CREATE INDEX email_deliveries_retention_idx ON public.email_deliveries USING btree (retention_class, created_at);



CREATE INDEX email_deliveries_status_created_idx ON public.email_deliveries USING btree (status, created_at);



CREATE INDEX email_deliveries_template_created_idx ON public.email_deliveries USING btree (template_slug, created_at, id);



CREATE INDEX email_deliveries_template_idx ON public.email_deliveries USING btree (template_slug, status, created_at);



CREATE INDEX email_providers_created_at_idx ON public.email_providers USING btree (created_at);



CREATE UNIQUE INDEX email_providers_default_unique_idx ON public.email_providers USING btree (is_default) WHERE (is_default = true);



CREATE INDEX email_providers_is_active_idx ON public.email_providers USING btree (is_active);



CREATE INDEX email_providers_type_idx ON public.email_providers USING btree (type);



CREATE INDEX email_queue_created_idx ON public.email_queue USING btree (created_at, id);



CREATE INDEX email_queue_principal_idx ON public.email_queue USING btree (principal_kind, principal_id);



CREATE INDEX email_queue_provider_origin_idx ON public.email_queue USING btree (provider_origin, created_at);



CREATE INDEX email_queue_provider_type_idx ON public.email_queue USING btree (provider_type, created_at);



CREATE INDEX email_queue_recipients_hash_idx ON public.email_queue_recipients USING btree (recipient_hash);



CREATE INDEX email_queue_state_idx ON public.email_queue USING btree (state, settled_at);



CREATE INDEX email_queue_template_idx ON public.email_queue USING btree (template_slug, created_at);



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



CREATE INDEX idx_dc_categories_created_at ON public.dc_categories USING btree (created_at);



CREATE INDEX idx_dc_categories_created_by ON public.dc_categories USING btree (created_by);



CREATE INDEX idx_dc_components_created_at ON public.dc_components USING btree (created_at);



CREATE INDEX idx_dc_components_created_by ON public.dc_components USING btree (created_by);



CREATE UNIQUE INDEX idx_dc_components_slug ON public.dc_components USING btree (slug);



CREATE INDEX idx_dc_form_submission_resends_created_at ON public.dc_form_submission_resends USING btree (created_at);



CREATE INDEX idx_dc_form_submission_resends_created_by ON public.dc_form_submission_resends USING btree (created_by);



CREATE UNIQUE INDEX idx_dc_form_submission_resends_slug ON public.dc_form_submission_resends USING btree (slug);



CREATE INDEX idx_dc_form_submission_resends_submission ON public.dc_form_submission_resends USING btree (submission);



CREATE INDEX idx_dc_form_submission_sends_created_at ON public.dc_form_submission_sends USING btree (created_at);



CREATE INDEX idx_dc_form_submission_sends_created_by ON public.dc_form_submission_sends USING btree (created_by);



CREATE INDEX idx_dc_form_submission_sends_form_notification_06wq5om ON public.dc_form_submission_sends USING btree (form, notification);



CREATE INDEX idx_dc_form_submission_sends_queued_id ON public.dc_form_submission_sends USING btree (queued_id);



CREATE UNIQUE INDEX idx_dc_form_submission_sends_slug ON public.dc_form_submission_sends USING btree (slug);



CREATE INDEX idx_dc_form_submission_sends_submission ON public.dc_form_submission_sends USING btree (submission);



CREATE INDEX idx_dc_form_submissions_created_at ON public.dc_form_submissions USING btree (created_at);



CREATE INDEX idx_dc_form_submissions_created_by ON public.dc_form_submissions USING btree (created_by);



CREATE INDEX idx_dc_form_submissions_form ON public.dc_form_submissions USING btree (form);



CREATE UNIQUE INDEX idx_dc_form_submissions_slug ON public.dc_form_submissions USING btree (slug);



CREATE INDEX idx_dc_form_submissions_status ON public.dc_form_submissions USING btree (status);



CREATE INDEX idx_dc_form_submissions_submitted_at ON public.dc_form_submissions USING btree (submitted_at);



CREATE INDEX idx_dc_form_uploads_created_at ON public.dc_form_uploads USING btree (created_at);



CREATE INDEX idx_dc_form_uploads_created_by ON public.dc_form_uploads USING btree (created_by);



CREATE INDEX idx_dc_form_uploads_form ON public.dc_form_uploads USING btree (form);



CREATE UNIQUE INDEX idx_dc_form_uploads_slug ON public.dc_form_uploads USING btree (slug);



CREATE INDEX idx_dc_form_uploads_submission ON public.dc_form_uploads USING btree (submission);



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



CREATE INDEX idx_dc_patterns_created_at ON public.dc_patterns USING btree (created_at);



CREATE INDEX idx_dc_patterns_created_by ON public.dc_patterns USING btree (created_by);



CREATE UNIQUE INDEX idx_dc_patterns_slug ON public.dc_patterns USING btree (slug);



CREATE INDEX idx_dc_posts_created_at ON public.dc_posts USING btree (created_at);



CREATE INDEX idx_dc_posts_created_by ON public.dc_posts USING btree (created_by);



CREATE INDEX idx_dc_posts_featured_image ON public.dc_posts USING btree (featured_image);



CREATE INDEX idx_dc_posts_last_saved_at ON public.dc_posts USING btree (last_saved_at);



CREATE INDEX idx_dc_tags_created_at ON public.dc_tags USING btree (created_at);



CREATE INDEX idx_dc_tags_created_by ON public.dc_tags USING btree (created_by);



CREATE INDEX idx_dc_templates_created_at ON public.dc_templates USING btree (created_at);



CREATE INDEX idx_dc_templates_created_by ON public.dc_templates USING btree (created_by);



CREATE INDEX idx_dc_templates_entry_collection ON public.dc_templates USING btree (entry_collection);



CREATE INDEX idx_dc_templates_forked_from ON public.dc_templates USING btree (forked_from);



CREATE UNIQUE INDEX idx_dc_templates_slug ON public.dc_templates USING btree (slug);



CREATE INDEX idx_page_builder__binding_issues_dirty ON public.page_builder__binding_issues USING btree (dirty);



CREATE INDEX idx_page_builder__binding_uses_document_key ON public.page_builder__binding_uses USING btree (document_key);



CREATE INDEX idx_page_builder__binding_uses_source_kind_source_key_001e79k ON public.page_builder__binding_uses USING btree (source_kind, source_key);



CREATE INDEX idx_page_builder__breakpoint_removal_fragments_created_at ON public.page_builder__breakpoint_removal_fragments USING btree (created_at);



CREATE INDEX idx_page_builder__breakpoint_removal_fragments_run_id ON public.page_builder__breakpoint_removal_fragments USING btree (run_id);



CREATE INDEX idx_page_builder__breakpoint_removal_fragments_run_id_d_04ki5jv ON public.page_builder__breakpoint_removal_fragments USING btree (run_id, document_key);



CREATE INDEX idx_page_builder__class_usage_class_id ON public.page_builder__class_usage USING btree (class_id);



CREATE INDEX idx_page_builder__class_usage_entity_entity_key_178r965 ON public.page_builder__class_usage USING btree (entity, entity_key);



CREATE INDEX idx_page_builder__component_usage_component_id ON public.page_builder__component_usage USING btree (component_id);



CREATE INDEX idx_page_builder__component_usage_entity_entity_key_178r965 ON public.page_builder__component_usage USING btree (entity, entity_key);



CREATE INDEX idx_page_builder__token_usage_entity_entity_key_178r965 ON public.page_builder__token_usage USING btree (entity, entity_key);



CREATE INDEX idx_page_builder__token_usage_token_id ON public.page_builder__token_usage USING btree (token_id);



CREATE INDEX idx_reading__list_items_post_id ON public.reading__list_items USING btree (post_id);



CREATE INDEX idx_reading__lists_owner_id ON public.reading__lists USING btree (owner_id);



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



CREATE UNIQUE INDEX nextly_external_identities_key_uidx ON public.nextly_external_identities USING btree (key_digest);



CREATE INDEX nextly_external_identities_user_idx ON public.nextly_external_identities USING btree (user_id);



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



CREATE INDEX nextly_release_members_doc_walk_idx ON public.nextly_release_members USING btree (scope_kind, scope_slug, entry_id, id);



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



CREATE INDEX nextly_review_states_waiting_idx ON public.nextly_review_states USING btree (scope_kind, scope_slug, stage, entered_at, part_key);



CREATE INDEX nextly_schedule_windows_window_idx ON public.nextly_schedule_windows USING btree (window_at);



CREATE UNIQUE INDEX nextly_schema_events_filename_applied_idx ON public.nextly_schema_events USING btree (filename) WHERE ((event_type = 'file_apply'::text) AND (status = 'applied'::text));



CREATE INDEX nextly_schema_events_scope_idx ON public.nextly_schema_events USING btree (scope_kind, scope_slug);



CREATE INDEX nextly_schema_events_started_at_idx ON public.nextly_schema_events USING btree (started_at);



CREATE INDEX nextly_translation_provenance_field_idx ON public.nextly_translation_provenance USING btree (scope_kind, scope_slug, entry_id, field_path, part_state);



CREATE UNIQUE INDEX nextly_translation_provenance_uidx ON public.nextly_translation_provenance USING btree (scope_kind, scope_slug, entry_id, locale, part_state, field_path);



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



CREATE UNIQUE INDEX uq_dc_block_pages_locales_slug__locale_1mvq6jl ON public.dc_block_pages_locales USING btree (NULLIF(slug, ''::text), _locale);



CREATE UNIQUE INDEX uq_dc_categories_locales_slug__locale_1mvq6jl ON public.dc_categories_locales USING btree (NULLIF(slug, ''::text), _locale);



CREATE UNIQUE INDEX uq_dc_form_submissions_form_response_key_1ak966i ON public.dc_form_submissions USING btree (form, response_key);



CREATE UNIQUE INDEX uq_dc_form_uploads_media_submission_1v7nb99 ON public.dc_form_uploads USING btree (media, submission);



CREATE UNIQUE INDEX uq_dc_nx_pb_address_claims_claim_key ON public.dc_nx_pb_address_claims USING btree (claim_key);



CREATE UNIQUE INDEX uq_dc_nx_pb_component_retired_identity ON public.dc_nx_pb_component_retired USING btree (identity);



CREATE UNIQUE INDEX uq_dc_pages_locales_slug__locale_1mvq6jl ON public.dc_pages_locales USING btree (NULLIF(slug, ''::text), _locale);



CREATE UNIQUE INDEX uq_dc_posts_locales_slug__locale_1mvq6jl ON public.dc_posts_locales USING btree (NULLIF(slug, ''::text), _locale);



CREATE UNIQUE INDEX uq_dc_tags_locales_slug__locale_1mvq6jl ON public.dc_tags_locales USING btree (NULLIF(slug, ''::text), _locale);



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



CREATE UNIQUE INDEX uq_reading__list_items_list_id_post_id_11e06ud ON public.reading__list_items USING btree (list_id, post_id);



CREATE INDEX user_field_defs_created_at_idx ON public.user_field_definitions USING btree (created_at);



CREATE INDEX user_field_defs_is_active_idx ON public.user_field_definitions USING btree (is_active);



CREATE UNIQUE INDEX user_field_defs_name_unique_idx ON public.user_field_definitions USING btree (name);



CREATE INDEX user_field_defs_sort_order_idx ON public.user_field_definitions USING btree (sort_order);



CREATE INDEX user_field_defs_source_idx ON public.user_field_definitions USING btree (source);



CREATE INDEX user_roles_expires_at_idx ON public.user_roles USING btree (expires_at);



CREATE INDEX user_roles_role_id_idx ON public.user_roles USING btree (role_id);



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



ALTER TABLE ONLY public.dc_block_pages_locales
    ADD CONSTRAINT dc_block_pages_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_block_pages(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_categories_locales
    ADD CONSTRAINT dc_categories_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_categories(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_components_locales
    ADD CONSTRAINT dc_components_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_components(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_form_submission_resends_locales
    ADD CONSTRAINT dc_form_submission_resends_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_form_submission_resends(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_form_submission_sends_locales
    ADD CONSTRAINT dc_form_submission_sends_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_form_submission_sends(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_form_submissions_locales
    ADD CONSTRAINT dc_form_submissions_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_form_submissions(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_form_uploads_locales
    ADD CONSTRAINT dc_form_uploads_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_form_uploads(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_forms_locales
    ADD CONSTRAINT dc_forms_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_forms(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_layouts_locales
    ADD CONSTRAINT dc_layouts_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_layouts(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_pages_locales
    ADD CONSTRAINT dc_pages_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_pages(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_patterns_locales
    ADD CONSTRAINT dc_patterns_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_patterns(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_posts_locales
    ADD CONSTRAINT dc_posts_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_posts(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_tags_locales
    ADD CONSTRAINT dc_tags_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_tags(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dc_templates_locales
    ADD CONSTRAINT dc_templates_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.dc_templates(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.dynamic_collections
    ADD CONSTRAINT dynamic_collections_created_by_users_id_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);



ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_provider_id_email_providers_id_fkey FOREIGN KEY (provider_id) REFERENCES public.email_providers(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.reading__list_items
    ADD CONSTRAINT fk_reading__list_items_list_id FOREIGN KEY (list_id) REFERENCES public.reading__lists(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.reading__lists
    ADD CONSTRAINT fk_reading__lists_owner_id FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;



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



ALTER TABLE ONLY public.nextly_external_identities
    ADD CONSTRAINT nextly_external_identities_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



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



ALTER TABLE ONLY public.single_homepage_locales
    ADD CONSTRAINT single_homepage_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.single_homepage(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.single_landing_page_locales
    ADD CONSTRAINT single_landing_page_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.single_landing_page(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.single_site_settings_locales
    ADD CONSTRAINT single_site_settings_locales__parent_fkey FOREIGN KEY (_parent) REFERENCES public.single_site_settings(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.user_invite_tokens
    ADD CONSTRAINT user_invite_tokens_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_roles_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;




