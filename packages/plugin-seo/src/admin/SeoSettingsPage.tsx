/**
 * The SEO section's Settings: rules for the whole site under six tabs, each
 * a card of rows with Cancel and Save changes under it, all saving one
 * draft; and, the first time it opens, the three-step setup over it.
 *
 * Drawn from the admin's own parts (`PageFrame`, `PageHeader` with
 * `PageTabs`, `Card`, `SettingsRowGroup`, `FieldShell`, `FormActions`,
 * `Alert`), so it reads like the admin's own settings pages. Each tab has its
 * own address (`?tab=`), so a link can land on it.
 *
 * @module admin/SeoSettingsPage
 */
import {
  Alert,
  AlertDescription,
  apiErrorMessage,
  isApiError,
  Badge,
  Button,
  FormActions,
  navigateTo,
  PageFrame,
  PageHeader,
  PageTab,
  PageTabs,
  toastMutationResult,
  usePluginClientConfig,
  usePluginRoute,
  useSingleDocument,
  useUpdateSingleDocument,
} from "@nextlyhq/plugin-sdk/admin";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";

import { OVERVIEW_PAGE_HREF } from "../overview/contract";
import {
  AI_CRAWLER_CHOICES,
  CONTENT_TYPES_ROUTE_PATH,
  SEO_PLUGIN_NAME,
  SETTINGS_DOCUMENT_ROUTE_PATH,
  SETTINGS_PAGE_HREF,
  SETUP_STEPS,
  type AiCrawlerChoice,
  type SettingsDocumentBody,
  isSwitchedOff,
  type ListedContentType,
  type SeoContentType,
  type SwitchedOffType,
} from "../settings/contract";

import { useAddressParam } from "./address";
import { ConnectionsTab } from "./connections";
import { ContentTypesTab } from "./content-types";
import { useLeaveWarning } from "./leave-warning";
import { ownRulesSaveProblem, useRobotsRulesCheck } from "./robots-rules";
import { AdminLink, SeoTrail } from "./section";
import {
  changesOf,
  verificationDraftOf,
  draftOf,
  switchChangesText,
  rebasedDraft,
  robotsRulesDraftOf,
  structuredDataOf,
  type SettingsDefaults,
  type SettingsDraft,
  type StoredSettings,
} from "./settings-draft";
import { SetupDialog } from "./SetupDialog";
import {
  BrandTab,
  CrawlersTab,
  draftProblem,
  GeneralTab,
  isTabId,
  ShareImagesTab,
  TABS,
  type TabId,
  type TabProps,
} from "./tabs";

/** The tab the screen opens on when the address names none. */
const FIRST_TAB: TabId = "general";

/** The list the content types route answers with. */
interface ContentTypesBody {
  items: ListedContentType[];
}

/** The types with SEO, which every tab works on, and those without. */
function splitTypes(items: readonly ListedContentType[] = []): {
  types: SeoContentType[];
  switchedOff: SwitchedOffType[];
} {
  const types: SeoContentType[] = [];
  const switchedOff: SwitchedOffType[] = [];
  for (const item of items) {
    if (isSwitchedOff(item)) switchedOff.push(item);
    else types.push(item);
  }
  return { types, switchedOff };
}

/** The open tab: the one the address names, else the first. */
function useOpenTab(): TabId {
  const named = useAddressParam("tab");
  return isTabId(named) ? named : FIRST_TAB;
}

/** The address of one tab. */
function tabHref(id: TabId): string {
  return `${SETTINGS_PAGE_HREF}?tab=${id}`;
}

/** The tab row, Content types counting the types with no public address. */
function SettingsTabs({
  open,
  notPublic,
}: {
  open: TabId;
  notPublic: number;
}): JSX.Element {
  return (
    <PageTabs label="Settings">
      {TABS.map(tab => (
        <PageTab key={tab.id} asChild current={tab.id === open}>
          <AdminLink
            href={tabHref(tab.id)}
            onClick={event => {
              // A save on its way finishes before another tab opens: a
              // screen mounted again meanwhile would not see what it stored.
              if (saveInFlight) event.preventDefault();
            }}
          >
            {tab.label}
            {tab.id === "types" && notPublic > 0 ? (
              <Badge
                variant="warning"
                className="ml-1.5"
                title={`${notPublic} content type${notPublic === 1 ? " has" : "s have"} no public address`}
              >
                {notPublic}
              </Badge>
            ) : null}
          </AdminLink>
        </PageTab>
      ))}
    </PageTabs>
  );
}

/** The SEO settings screen, as the admin mounts it. */
export function SeoSettingsPage(): JSX.Element {
  // The Single as the host registered it: a host may rename it.
  const where = usePluginRoute<SettingsDocumentBody>({
    plugin: SEO_PLUGIN_NAME,
    path: SETTINGS_DOCUMENT_ROUTE_PATH,
  });
  const slug = where.data?.single;
  const settings = useSingleDocument(slug, {
    queryOptions: { enabled: slug !== undefined },
  });
  const types = usePluginRoute<ContentTypesBody>({
    plugin: SEO_PLUGIN_NAME,
    path: CONTENT_TYPES_ROUTE_PATH,
    // A type's newest page and address change elsewhere in the admin.
    staleTime: 0,
  });
  const open = useOpenTab();
  const split = splitTypes(types.data?.items);

  const failed = where.error ?? settings.error;
  let body: JSX.Element;
  if (settings.data !== undefined && slug !== undefined && !types.pending) {
    // Once read, the form stays: a later read that fails is said above it,
    // never by replacing it and the edits it holds.
    body = (
      <>
        {failed ? (
          <Alert variant="warning" className="mb-4">
            <AlertDescription>
              The SEO settings could not be read again. What is on screen is
              kept. {readFailure(failed)}
            </AlertDescription>
          </Alert>
        ) : null}
        <SettingsScreen
          slug={slug}
          tab={open}
          stored={settings.data}
          serverAddresses={where.data?.serverAddresses ?? []}
          // Yes until the server says otherwise.
          canChange={where.data?.canChange !== false}
          {...split}
          typesFailed={types.error !== null}
          reread={async () => {
            // Only a read that succeeded is an answer: a failed one still
            // carries the copy cached before the save.
            const read = await settings.refetch();
            return read.error ? undefined : read.data;
          }}
        />
      </>
    );
  } else if (failed) {
    body = (
      <Alert variant="destructive">
        <AlertDescription>
          The SEO settings could not be read. {readFailure(failed)}
        </AlertDescription>
      </Alert>
    );
  } else {
    body = (
      <p className="text-sm text-muted-foreground" role="status">
        Loading the SEO settings…
      </p>
    );
  }
  return (
    <PageFrame type="form">
      <PageHeader
        title="Settings"
        description="Rules for the whole site. A page's own values always win over these."
        breadcrumbs={<SeoTrail steps={[{ label: "Settings" }]} />}
        tabs={
          <SettingsTabs
            open={open}
            notPublic={split.types.filter(type => !type.public).length}
          />
        }
      />
      {body}
    </PageFrame>
  );
}

/**
 * What the plugin's own options answer while the settings hold nothing, as
 * the plugin publishes them to the admin.
 */
function useSettingsDefaults(): SettingsDefaults {
  const config = usePluginClientConfig(SEO_PLUGIN_NAME);
  const aiCrawlers = config?.aiCrawlers;
  const hiddenTypes = config?.hiddenTypes;
  const structuredData = config?.structuredData;
  return useMemo(
    () => ({
      ...((AI_CRAWLER_CHOICES as readonly unknown[]).includes(aiCrawlers)
        ? { aiCrawlers: aiCrawlers as AiCrawlerChoice }
        : {}),
      ...(Array.isArray(hiddenTypes)
        ? {
            hiddenTypes: hiddenTypes.filter(
              (key): key is string => typeof key === "string"
            ),
          }
        : {}),
      structuredData: structuredDataOf(structuredData),
    }),
    [aiCrawlers, hiddenTypes, structuredData]
  );
}

/** Whether a save answered with the stored document, version and all. */
function isStoredDocument(value: unknown): value is StoredSettings {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { _rev?: unknown })._rev === "string"
  );
}

/**
 * Which stored settings a draft was made from: the document, and its
 * version, else its time.
 */
function versionOf(stored: StoredSettings): string {
  const version = stored._rev ?? stored.updatedAt;
  const id =
    typeof stored.id === "string" ? stored.id : JSON.stringify(stored.id);
  return `${id}@${typeof version === "string" ? version : JSON.stringify(stored)}`;
}

/** Whether a save of the settings is on its way, which holds the tabs still. */
let saveInFlight = false;

/**
 * Unsaved changes, kept while the screen is mounted again: the admin may
 * mount the page anew when a tab link changes the address, which would drop
 * what was typed on the tab left. Kept with the stored settings they were
 * made from, and let go once the screen is left for another page.
 */
let heldDraft:
  | {
      slug: string;
      version: string;
      base: StoredSettings;
      draft: SettingsDraft;
    }
  | undefined;

/**
 * The draft to start from: one held for these settings, moved onto a newer
 * version of the same document read since (a value edited stays as edited,
 * every other takes the newer stored one), else theirs.
 */
function startingDraft(
  slug: string,
  stored: StoredSettings,
  defaults: SettingsDefaults
): SettingsDraft {
  if (heldDraft?.slug !== slug || heldDraft.base.id !== stored.id) {
    return draftOf(stored, defaults);
  }
  if (heldDraft.version === versionOf(stored)) return heldDraft.draft;
  return rebasedDraft(
    heldDraft.draft,
    draftOf(heldDraft.base, defaults),
    draftOf(stored, defaults)
  );
}

/** Keeps `draft` while it holds changes, and lets it go off this screen. */
function useHeldDraft(
  slug: string,
  stored: StoredSettings,
  draft: SettingsDraft,
  changed: boolean
): void {
  const version = versionOf(stored);
  useEffect(() => {
    heldDraft = changed ? { slug, version, base: stored, draft } : undefined;
  }, [slug, version, stored, draft, changed]);
  useEffect(
    () => () => {
      // Unmounted for another page, not for another tab of this one.
      if (window.location.pathname !== SETTINGS_PAGE_HREF) {
        heldDraft = undefined;
      }
    },
    []
  );
}

/** The draft, the settings it is compared with, and how a save goes. */
function useSettingsSave(
  slug: string,
  initial: StoredSettings,
  reread: () => Promise<StoredSettings | undefined>,
  defaults: SettingsDefaults
) {
  const update = useUpdateSingleDocument(slug);
  // The settings as last read or saved, which the draft is compared with.
  const [stored, setStored] = useState(initial);
  const [draft, setDraft] = useState<SettingsDraft>(() =>
    startingDraft(slug, initial, defaults)
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const initialVersion = versionOf(initial);
  const latestRead = useRef(initial);
  latestRead.current = initial;
  const latestStored = useRef(stored);
  // The version of the last read this screen moved its draft onto.
  const lastRead = useRef(versionOf(initial));
  latestStored.current = stored;

  /** Saves `next`, and reports whether it was stored. */
  const save = useCallback(
    async (next: SettingsDraft): Promise<boolean> => {
      const sent = changesOf(stored, next, defaults);
      setDraft(next);
      if (sent === null) return true;
      setSaving(true);
      saveInFlight = true;
      setFailure(null);
      try {
        // What the save stored is the new baseline, its version with it; a
        // re-read that succeeds after it replaces it with the latest.
        const saved: unknown = await update.mutateAsync(sent);
        const fresh =
          (await reread()) ??
          (isStoredDocument(saved) ? saved : { ...stored, ...sent });
        setStored(fresh);
        // A read that landed while the save was on its way is older than
        // what it stored: taken as read, so it never replaces it.
        lastRead.current = versionOf(latestRead.current);
        // Edits made while the save was on its way are kept: only a draft
        // nobody touched since is replaced by what was stored.
        setDraft(current =>
          current === next ? draftOf(fresh, defaults) : current
        );
        return true;
      } catch (error) {
        setFailure(
          error instanceof Error ? apiErrorMessage(error) : String(error)
        );
        return false;
      } finally {
        saveInFlight = false;
        setSaving(false);
      }
    },
    [stored, update, reread, defaults]
  );

  // A newer copy of the settings read since, such as the one a save made
  // just before the screen was mounted again for another tab, or another
  // person's, becomes the baseline. The draft moves onto it: a value edited
  // here stays as edited, every other takes the newer stored one, so a save
  // never sends back a value someone else changed meanwhile.
  useEffect(() => {
    // A read that lands while this screen's own save is on its way waits:
    // the save sets the baseline it stored, measured against what was
    // sent, so an edit made meanwhile is never taken for an untouched one.
    if (saving) return;
    // Only a version not read before is a new baseline: a read this screen
    // has seen, older than what its own save stored, changes nothing.
    if (lastRead.current === initialVersion) return;
    lastRead.current = initialVersion;
    const was = latestStored.current;
    if (versionOf(was) === initialVersion) return;
    const fresh = latestRead.current;
    setStored(fresh);
    setDraft(current =>
      rebasedDraft(current, draftOf(was, defaults), draftOf(fresh, defaults))
    );
  }, [initialVersion, defaults, setDraft, saving]);

  /** Lets go of every unsaved change. */
  const cancel = useCallback(() => {
    setFailure(null);
    setDraft(draftOf(stored, defaults));
  }, [stored, defaults]);

  return { stored, draft, setDraft, save, cancel, saving, failure };
}

/** The line that offers setup again until it is finished. */
function SetupBanner({
  stepsDone,
  reopen,
}: {
  stepsDone: number;
  reopen: () => void;
}): JSX.Element {
  return (
    <Alert variant="info" role="status" className="mb-4">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <b className="font-semibold">Finish setting up SEO.</b>{" "}
          {Math.min(stepsDone, SETUP_STEPS)} of {SETUP_STEPS} steps done. Your
          answers so far are saved.
        </span>
        <Button type="button" size="sm" variant="outline" onClick={reopen}>
          Finish setup
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Why the settings could not be read, for a person: a database not migrated
 * for a field the settings gained says what to run, in plain words, rather
 * than core's message naming the field and the Single.
 */
function readFailure(failed: Error): string {
  if (isApiError(failed) && failed.code === "ENTITY_NOT_MIGRATED") {
    return "The database needs `nextly migrate` for the new SEO settings. A developer runs `nextly migrate:create` and then `nextly migrate`; the site keeps serving its pages meanwhile.";
  }
  return apiErrorMessage(failed);
}

/** The open tab's rows. */
function SettingsPanel({
  tab,
  tabProps,
  types,
  switchedOff,
  typesFailed,
  serverAddresses,
  rulesCheck,
  stored,
  canChange,
}: {
  tab: TabId;
  tabProps: TabProps;
  /** Whether the reader may change the settings. */
  canChange: boolean;
  /** Which sitemap pages the own robots.txt rules being typed block. */
  rulesCheck: ReturnType<typeof useRobotsRulesCheck>;
  /** The settings as stored, which what was saved is read from. */
  stored: StoredSettings;
  types: readonly SeoContentType[];
  switchedOff: readonly SwitchedOffType[];
  typesFailed: boolean;
  serverAddresses: readonly string[];
}): JSX.Element {
  switch (tab) {
    case "general":
      return <GeneralTab {...tabProps} serverAddresses={serverAddresses} />;
    case "images":
      return <ShareImagesTab {...tabProps} />;
    case "brand":
      return <BrandTab {...tabProps} />;
    case "crawlers":
      return (
        <CrawlersTab
          {...tabProps}
          serverAddresses={serverAddresses}
          rulesCheck={rulesCheck.check}
          retryRulesCheck={rulesCheck.retry}
        />
      );
    case "connections":
      return (
        <ConnectionsTab
          {...tabProps}
          saved={verificationDraftOf(stored.verificationCodes)}
          serverAddresses={serverAddresses}
        />
      );
    case "types":
      return typesFailed ? (
        <Alert variant="destructive">
          <AlertDescription>
            The content types could not be read. Reload the page to try again.
          </AlertDescription>
        </Alert>
      ) : (
        <ContentTypesTab
          {...tabProps}
          types={types}
          switchedOff={switchedOff}
          savedOff={draftOf(stored).typesWithSeoOff}
          canChange={canChange}
        />
      );
  }
}

/** The step setup opens on: the first not yet answered, else the first. */
function firstSetupStep(stepsDone: number): 1 | 2 | 3 {
  return stepsDone >= SETUP_STEPS
    ? 1
    : (Math.min(stepsDone + 1, SETUP_STEPS) as 1 | 2 | 3);
}

/**
 * The content type switches `draft` changes from what is stored, in words,
 * each type by its label; null where none changed.
 */
function switchSummary(
  stored: StoredSettings,
  draft: SettingsDraft,
  defaults: SettingsDefaults,
  types: readonly { key: string; label: string }[],
  switchedOff: readonly { key: string; label: string }[]
): string | null {
  return switchChangesText(
    draftOf(stored, defaults),
    draft,
    new Map([...types, ...switchedOff].map(type => [type.key, type.label]))
  );
}

/**
 * What stops `draft` being saved, if anything: a value the form refuses, or
 * own robots.txt rules that would block what the sitemap lists.
 */
function saveProblem(
  draft: SettingsDraft,
  types: readonly SeoContentType[],
  serverAddresses: readonly string[],
  stored: StoredSettings,
  check: ReturnType<typeof useRobotsRulesCheck>["check"]
): string | null {
  return (
    draftProblem(draft, types, serverAddresses) ??
    ownRulesSaveProblem(
      draft.robotsRules,
      robotsRulesDraftOf(stored.robotsRules).text,
      check
    )
  );
}

/** Cancel and Save changes under a tab, saying what waits to be saved. */
function SaveBar({
  changed,
  problem,
  summary,
  saving,
  cancel,
  save,
}: {
  changed: boolean;
  /** What stops the changes being saved, if anything does. */
  problem: string | null;
  /** The content type switches waiting to be saved, in words, if any. */
  summary?: string | null;
  saving: boolean;
  cancel: () => void;
  save: () => void;
}): JSX.Element {
  return (
    <FormActions
      dirty={changed}
      {...(changed && problem !== null
        ? { message: problem }
        : changed && summary
          ? { message: summary }
          : {})}
    >
      <Button
        type="button"
        variant="outline"
        disabled={!changed || saving}
        onClick={cancel}
      >
        Cancel
      </Button>
      <Button
        type="button"
        disabled={!changed || problem !== null || saving}
        onClick={save}
      >
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </FormActions>
  );
}

/**
 * First-time setup over the screen: closed part-way it lands on the tab an
 * item names, and finished it goes on to the Overview.
 */
function FirstSetup({
  draft,
  change,
  types,
  serverAddresses,
  save,
  failure,
  close,
}: TabProps & {
  types: readonly SeoContentType[];
  serverAddresses: readonly string[];
  save: (next: SettingsDraft) => Promise<boolean>;
  failure: string | null;
  close: () => void;
}): JSX.Element {
  return (
    <SetupDialog
      open
      firstStep={firstSetupStep(draft.setupStep)}
      draft={draft}
      change={change}
      types={types}
      serverAddresses={serverAddresses}
      save={save}
      failure={failure}
      close={landOn => {
        close();
        if (landOn !== undefined) navigateTo(tabHref(landOn));
      }}
      finish={() => {
        // An edit made while the last step saved is saved first; a failed
        // save keeps the person here, where it is said.
        void save(draft).then(saved => {
          if (!saved) return;
          close();
          navigateTo(OVERVIEW_PAGE_HREF);
        });
      }}
    />
  );
}

/** The screen once the settings are read. */
function SettingsScreen({
  slug,
  tab,
  stored: initial,
  serverAddresses,
  types,
  switchedOff,
  typesFailed,
  reread,
  canChange,
}: {
  slug: string;
  tab: TabId;
  stored: StoredSettings;
  serverAddresses: readonly string[];
  /** Whether the reader may change the settings. */
  canChange: boolean;
  types: readonly SeoContentType[];
  switchedOff: readonly SwitchedOffType[];
  typesFailed: boolean;
  reread: () => Promise<StoredSettings | undefined>;
}): JSX.Element {
  const defaults = useSettingsDefaults();
  const { stored, draft, setDraft, save, cancel, saving, failure } =
    useSettingsSave(slug, initial, reread, defaults);
  const finished = draft.setupStep >= SETUP_STEPS;
  // Read from the draft the screen starts from, a held one included, so a
  // dismissal it holds keeps setup closed when the screen is mounted again.
  const [setupOpen, setSetupOpen] = useState(
    () => !finished && !draft.setupDismissed
  );
  const changes = changesOf(stored, draft, defaults);
  const rulesCheck = useRobotsRulesCheck(
    draft.robotsRules.text,
    draft.hiddenTypes
  );
  const problem = saveProblem(
    draft,
    types,
    serverAddresses,
    stored,
    rulesCheck.check
  );
  useLeaveWarning(changes !== null);
  useHeldDraft(slug, stored, draft, changes !== null);

  const tabProps: TabProps = { draft, change: next => setDraft(next) };
  const saveChanges = () => {
    void save(draft).then(saved => {
      if (saved) toastMutationResult("SEO settings saved", undefined);
    });
  };

  return (
    <>
      {!finished && !setupOpen ? (
        <SetupBanner
          stepsDone={draft.setupStep}
          reopen={() => setSetupOpen(true)}
        />
      ) : null}
      {failure === null ? null : (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>Not saved. {failure}</AlertDescription>
        </Alert>
      )}
      <SettingsPanel
        tab={tab}
        tabProps={tabProps}
        types={types}
        switchedOff={switchedOff}
        typesFailed={typesFailed}
        serverAddresses={serverAddresses}
        rulesCheck={rulesCheck}
        stored={stored}
        canChange={canChange}
      />
      <SaveBar
        changed={changes !== null}
        problem={problem}
        summary={switchSummary(stored, draft, defaults, types, switchedOff)}
        saving={saving}
        cancel={cancel}
        save={saveChanges}
      />
      {setupOpen ? (
        <FirstSetup
          draft={draft}
          change={tabProps.change}
          types={types}
          serverAddresses={serverAddresses}
          save={save}
          failure={failure}
          close={() => setSetupOpen(false)}
        />
      ) : null}
    </>
  );
}
