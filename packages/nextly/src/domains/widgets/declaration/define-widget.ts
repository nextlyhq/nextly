/**
 * One declaration that gives a widget its data and its view.
 *
 * `defineWidget()` takes everything a widget is: who it is, the sizes it
 * allows, its settings, where its data comes from and how it is drawn. The
 * compiler reads the settings once and hands their types to every reader --
 * the data function, the query core runs, and the widget's own component --
 * with no cast and no generated file. The component gets them through a
 * type-only import of the declaration (`WidgetProps<typeof myWidget>`), which
 * the bundler erases, so no server code follows it into the browser.
 *
 * The same declaration is accepted from a plugin and from the site's config.
 *
 * @module domains/widgets/declaration/define-widget
 */

import type { UserContext } from "../../collections/services/collection-types";
import type { WidgetSizeDeclaration } from "../grid-size";
import type { WidgetQuerySpec } from "../query";
import type { WidgetScope } from "../resolved-sources";
import type { DeclaredComponentProps } from "../result";
import type { WidgetOp } from "../sources";

import type {
  CoreDisplay,
  DisplayData,
  DisplayOf,
  DisplayOp,
  QueryAnswer,
  WidgetView,
} from "./displays";
import type {
  DependentSettings,
  SettingValues,
  WidgetFilter,
  WidgetSettings,
} from "./setting-builders";
import type { TransportableFields, TransportableValue } from "./transportable";

/**
 * Reads a data function may make, already bound to the person asking.
 *
 * 🔴 They take no person, user or access option: core binds the person before
 * handing them over, so a data function cannot leave the person out and read
 * as the system. Rows come back as transportable values, so a function can
 * answer them as they are.
 */
export interface WidgetReadServices {
  count(
    collection: string,
    options?: { where?: WidgetFilter; signal?: AbortSignal }
  ): Promise<number>;
  find(
    collection: string,
    options?: {
      where?: WidgetFilter;
      sort?: string;
      limit?: number;
      select?: readonly string[];
      signal?: AbortSignal;
    }
  ): Promise<{ items: { readonly [field: string]: TransportableValue }[] }>;
}

/** What a data function is handed. */
export interface WidgetDataInput<Values> {
  /** The card's settings: the person's values, or the starting ones. */
  settings: Values;
  /** The person looking at the card. */
  user: UserContext;
  /** Aborted when the person leaves or the card's time budget runs out. */
  signal: AbortSignal;
  services: WidgetReadServices;
  /**
   * Work shared by every card of this widget's owner within one batch, asked
   * for by one person: two cards that need the same scan ask for it under one
   * key, and the scan runs once. Kept apart from every other owner's keys and
   * from every content source's, so the same key in two places never meets.
   *
   * @experimental
   */
  scope: WidgetScope;
  /**
   * The batch's one instant: measure "since" and "until" from it rather than
   * from `new Date()`, so every card on the dashboard, and every read this
   * function makes, asks about the same days. This card's own copy.
   *
   * @experimental
   */
  now: Date;
}

/** A widget's own data function, run on the server for each card. */
export type WidgetDataFunction<Values, Data> = (
  input: WidgetDataInput<Values>
) => Promise<Data>;

/**
 * A query core runs over content, as the widget's settings write it.
 *
 * Today's query with `collection` in place of `source`: a widget reads a
 * collection by its slug, and the `collection:` prefix is core's business.
 */
export type ContentQuery = WidgetQuerySpec extends infer Spec
  ? Spec extends WidgetQuerySpec
    ? Omit<Spec, "source"> & { collection: string }
    : never
  : never;

/**
 * A query core runs over content, written from the card's settings.
 *
 * 🔴 A function under a `query` key, not a call to a `query()` helper. A helper
 * call nested in the declaration is checked before the declaration's settings
 * type is known, so its `settings` came out as `unknown`; a function in an
 * object is read after them, like a data function is. The answer's type
 * follows from the `op` the function returns.
 */
export interface WidgetQuerySource<
  Values,
  Op extends WidgetOp,
  Requires = unknown,
> {
  query: (input: { settings: Values }) => ContentQuery & { op: Op } & Requires;
}

/**
 * The core displays that draw rows: those whose query answers a list.
 *
 * Derived from the display-to-op table (`DisplayOp`), so a display core adds
 * that draws rows is one without a second edit here.
 */
type RowDisplay = {
  [D in CoreDisplay]: DisplayOp<D> extends "list" ? D : never;
}[CoreDisplay];

/**
 * What a query must hold beyond its op, for the display that draws it.
 *
 * 🔴 A row display needs at least one selected field. Its rows are drawn from
 * the fields `select` names, in that order, and a list or table whose query
 * selects nothing is refused when it is drawn: there is no field to show in
 * a row. Required here, that is a compile error in the declaration rather
 * than an error card on every load.
 *
 * Required, not typed non-empty: the query function's answer is read while
 * its op is still being inferred, and an array literal there widens to
 * `string[]`, so a `[string, ...string[]]` refused `select: ["title"]` too.
 * An EMPTY selection is refused at startup instead, by
 * `displaySelectProblem`, before any card is drawn.
 */
type QueryRequires<Display> = Display extends RowDisplay
  ? { select: string[] }
  : unknown;

/** Carries a declaration's data type without a runtime property. */
declare const widgetData: unique symbol;

/**
 * Marks a value made by `defineWidget`.
 *
 * Required, not optional, so a hand-written `{ id, view }` is not a widget:
 * only a declaration that went through every check above can be contributed,
 * put in the site config or given a component. Carried by the type alone.
 */
declare const declared: unique symbol;

/**
 * Who may be offered a widget: a permission they hold, such as
 * `"read-orders"`.
 *
 * The collections it reads, and a predicate of the person, are typed for the
 * release that judges them. Until then a declaration using either is refused
 * at startup, naming it, rather than started with its access unjudged.
 *
 * @experimental
 */
export type WidgetAccess =
  | string
  | { collections: readonly string[] }
  | ((input: { user: UserContext }) => boolean);

/**
 * What a widget's summary counts for the dashboard's header: a label, and a
 * count run as the person asking.
 *
 * @experimental
 */
export interface WidgetSummary {
  label: string;
  count: (
    input: Pick<WidgetDataInput<unknown>, "user" | "signal" | "services">
  ) => Promise<number>;
}

/**
 * One case the preview page draws the card's ready state from: a name, the
 * data, and the settings it was drawn with when they matter.
 */
export interface WidgetPreviewCase<Data, Values> {
  name: string;
  data: Data;
  settings?: Partial<Values>;
}

/**
 * What a widget declares.
 *
 * - `View` is the view as written: a core view's name, or a component's path.
 * - `Data` is a data function's answer, inferred from what it returns.
 * - `Op` is a query's op, inferred from the query it writes; its answer is
 *   what core sends for that op.
 * - `Preview` is the preview cases as written, checked against the data in
 *   the return type for a component view (`CheckedDeclaration`).
 *
 * 🔴 Two parameters for the two sources, rather than one, because only a data
 * function's answer is the author's to keep transportable: a query's answer is
 * core's, already sent as JSON. One parameter would hold either, and the bound
 * that refuses a `Date` in a data function's answer would then have to be
 * waived for queries as well.
 */
export interface WidgetDeclarationInput<
  Id extends string,
  S,
  View extends WidgetView,
  Data,
  Op extends WidgetOp,
  Preview,
> {
  /** `namespace/name`, unique across core, every plugin and the site. */
  id: Id;
  title: string;
  /** One line, shown in the add panel. */
  description: string;
  /** A Lucide icon's name, shown beside the title in the add panel. */
  icon?: string;
  /** The add panel's group for it: "Other" when absent. */
  category?: string;
  /**
   * The card's size in grid units (`{ w, h }`, twelve columns wide): the size
   * a new card starts at, and the smallest and largest a person may resize
   * it to.
   *
   * 🔴 The grid's own type, the one a stored placement, the site config and
   * the admin say a size in, so a declared size reaches the layout as it is
   * written, with nothing to translate.
   */
  size: WidgetSizeDeclaration;
  /** Who may be offered this widget at all; everyone who can open the dashboard when absent. */
  access?: WidgetAccess;
  /**
   * Whether the card shows at all for the person asking, judged before its
   * data is loaded. Typed for the release that judges it: until then a
   * declaration using it is refused at startup, so it is never shown to
   * someone it should not be.
   *
   * @experimental
   */
  shows?: (
    input: WidgetDataInput<SettingValues<S>>
  ) => boolean | Promise<boolean>;
  /** Whether a person may add it more than once. Once, unless it says so. */
  several?: boolean;
  /**
   * Whether the card leaves the dashboard while its answer is empty, by its
   * `isEmpty` test or its view's own rule, rather than saying so. A card that
   * failed, or whose source the reader may not see, is never hidden, and
   * customise mode still shows it, marked.
   */
  hidesWhenEmpty?: boolean;
  settings?: S;
  /** Where the card's data comes from: a function of its own, run on the server, or a query core runs. */
  load:
    | WidgetDataFunction<
        SettingValues<S>,
        FunctionAnswer<DisplayOf<View>, Data>
      >
    | WidgetQuerySource<
        SettingValues<S>,
        OpFor<DisplayOf<View>, Op>,
        QueryRequires<DisplayOf<View>>
      >;
  /** How the card is drawn: one of core's views, or the widget's own component. */
  view: View & OneView<View> & LiteralPath<View>;
  /**
   * Whether this data is empty. Run on the server with the answer, so only
   * the verdict reaches the browser. A core view's own rule when absent (no
   * rows, no groups, no points); required for a view of the widget's own,
   * which is never empty unless this says so.
   *
   * The frame draws every state but ready (loading, empty, no permission,
   * error), so a card looks the same as every other in each of them; "empty"
   * is the one of those only the widget can judge from its data, so it says so
   * here, typed by its own data.
   */
  isEmpty?: (data: DataFor<DisplayOf<View>, Data | QueryAnswer<Op>>) => boolean;
  /** What the empty state says and offers, in place of the frame's own. */
  empty?: WidgetEmpty;
  /**
   * Cases the preview page and the scaffold draw the ready state from, of the
   * widget's own data type, so a case that drifts from the data it stands in
   * for fails to compile. How that is checked depends on the view
   * (`PreviewFor`, `CheckedDeclaration`).
   */
  preview?: PreviewFor<DisplayOf<View>, Preview, SettingValues<S>>;
  /** @experimental */
  summary?: WidgetSummary;
}

/** What a widget's empty state says and offers. */
export interface WidgetEmpty {
  /** One line saying why there is nothing, in place of the frame's own. */
  message?: string;
  /**
   * The empty state's single action, such as "Add a product": a path relative
   * to the admin, offered only to a person holding `permission` when it names
   * one, so nobody is shown a step they cannot take.
   */
  action?: { label: string; link: string; permission?: string };
}

/**
 * What a declaration must hold beyond `WidgetDeclarationInput`: nothing for a
 * core view, which has an empty rule of its own to fall back to; the
 * `isEmpty` test, for a view of the widget's own, whose empty message and
 * action could otherwise never be shown.
 *
 * 🔴 Depends on the view ONLY, and adds `isEmpty: unknown` rather than the
 * test's own type. Intersected with the input, that makes `isEmpty` required
 * while leaving it one signature, typed by the data. Any version of this that
 * mentioned the data type made the compiler settle that type when it typed
 * the test's parameter, before the data function was read, as `never`; and an
 * intersection of two signatures leaves the parameter untyped.
 */
type ViewRequires<View> =
  DisplayOf<View> extends CoreDisplay ? unknown : { isEmpty: unknown };

/**
 * The data a widget draws: its display's shape for a core display, or its own
 * data for a component.
 */
type DataFor<Display, Own> = Display extends CoreDisplay
  ? DisplayData<Display>
  : Own;

/** True when `T` is a union of more than one member. */
type IsUnion<T, Whole = T> = T extends unknown
  ? [Whole] extends [T]
    ? false
    : true
  : never;

/**
 * Refuses a view typed as a choice of several.
 *
 * A `view` read from a variable typed `CoreView` is a union, and the pairing
 * below distributes over it: data that one member draws satisfies the union,
 * while the view the widget gets at run time may be another. The error names
 * the fault in words.
 */
type OneView<View> =
  true extends IsUnion<View>
    ? {
        "view must be exactly one view, not a choice of several": View;
      }
    : unknown;

/**
 * Refuses a component view whose path is not a literal.
 *
 * 🔴 The component map (`WidgetComponentMap`) is keyed by each declared path,
 * so a component written for another widget, or a path with no component, is
 * refused there. A path that names no one string turns that check off: a map
 * keyed by `string`, or by a pattern such as `@acme/${string}#Card`, is an
 * index signature that even an empty map satisfies. A view read from a
 * variable typed `ComponentDisplay` has such a path, and so does one built
 * from a template. So the path must be literal: one whose record an empty
 * object does not satisfy, which `string` and every open pattern do. The
 * error names the fault in words, as `OneView`'s does.
 */
type LiteralPath<View> = View extends {
  component: infer Path extends string;
}
  ? Record<never, never> extends Record<Path, true>
    ? {
        "a component view's path must be written as a literal string": View;
      }
    : unknown
  : unknown;

/**
 * What a data function must answer: its display's shape AND its own inferred
 * type, for a core display; its own type, for a component.
 *
 * 🔴 `& Data` on the core branch. Without it a core display's shape was the
 * whole contextual type of the answer, nothing was inferred into `Data`, and
 * the transport bound on `Data` had nothing to check: a `metric` answering a
 * `bigint` beside its total, or `list` rows holding a `Date`, compiled. With
 * it, the answer is inferred as `Data` and checked twice: against the display
 * and against what JSON carries.
 */
type FunctionAnswer<Display, Data> = Display extends CoreDisplay
  ? DisplayData<Display> & Data
  : Data;

/** The op a widget's query may have: its display's, or any for a component. */
type OpFor<Display, Own extends WidgetOp> = Display extends CoreDisplay
  ? DisplayOp<Display>
  : Own;

/**
 * What a widget's `preview` is typed as where it is written.
 *
 * For a core view, cases of the view's own shape, so a wrong case is refused
 * at the property that is wrong. For a component, whatever the author wrote:
 * see `CheckedDeclaration` for where that is checked, and why there.
 */
type PreviewFor<Display, Preview, Values> = Display extends CoreDisplay
  ? readonly WidgetPreviewCase<DisplayData<Display>, Values>[]
  : Preview;

/**
 * `T` with every array and property read-only.
 *
 * What the preview cases are compared against. They are inferred `const`, so
 * `"7d"` stays the literal a date-range setting allows rather than widening to
 * `string`; `const` also makes their arrays read-only, and a read-only array
 * is not assignable to a mutable one, which is no fault of the case's.
 */
type ReadonlyDeep<T> = T extends object
  ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
  : T;

/**
 * The declaration, once its preview cases have been checked against its data
 * and settings.
 *
 * 🔴 Checked HERE, in the return type, for a component widget. Its data type
 * is inferred from what its data function answers, and that function is read
 * last, after every property that is not a function. Any type relating the
 * cases to the data, given to the preview where it is written, made the
 * compiler settle the data type before the function was read, as `never`.
 * The return type is worked out once everything is inferred, so the check sees
 * the real data type; the cost is that the error appears where the widget is
 * used rather than at the case, so the error is made to say what is wrong.
 */
type CheckedDeclaration<
  Id extends string,
  S,
  View extends WidgetView,
  Data,
  Op extends WidgetOp,
  Preview,
> =
  DisplayOf<View> extends CoreDisplay
    ? WidgetDeclaration<Id, S, View, Data, Op, Preview>
    : [Preview] extends [
          readonly ReadonlyDeep<
            WidgetPreviewCase<Data | QueryAnswer<Op>, SettingValues<S>>
          >[],
        ]
      ? WidgetDeclaration<Id, S, View, Data, Op, Preview>
      : {
          // Stands in for the declaration, so the widget cannot be contributed,
          // put in the site config or given a component. Written inline, with
          // the fault as its one key: the compiler prints an anonymous type by
          // its shape, so the error where the widget is used opens with the
          // fault in words and the two types to compare. A named type would
          // print as its name and type arguments, to be looked up.
          readonly "This widget's preview cases are not of the type its data and settings have": {
            preview: Preview;
            expected: readonly WidgetPreviewCase<
              Data | QueryAnswer<Op>,
              SettingValues<S>
            >[];
          };
        };

/** A declared widget, carrying the types its readers need. */
export type WidgetDeclaration<
  Id extends string,
  S,
  View extends WidgetView,
  Data,
  Op extends WidgetOp,
  Preview = never,
> = WidgetDeclarationInput<Id, S, View, Data, Op, Preview> & {
  readonly [widgetData]?: DataFor<DisplayOf<View>, Data | QueryAnswer<Op>>;
  readonly [declared]: true;
};

/**
 * Declares a widget.
 *
 * The type parameters are all inferred; an author writes none of them.
 *
 * - `S extends DependentSettings<S>` checks that every dependent setting names
 *   one of the widget's own Collection settings.
 * - `Data extends TransportableFields<Data>` keeps a data function's answer to
 *   what JSON carries unchanged, its keys included, and reports the property
 *   that is not.
 * - The view is inferred before the data function is read, so a core view's
 *   shape is the type its data function must answer.
 */
export function defineWidget<
  const Id extends string,
  const View extends WidgetView,
  S extends WidgetSettings & DependentSettings<S> = Record<never, never>,
  Data extends TransportableFields<Data> = never,
  Op extends WidgetOp = never,
  const Preview = never,
>(
  declaration: WidgetDeclarationInput<Id, S, View, Data, Op, Preview> &
    ViewRequires<View>
): CheckedDeclaration<Id, S, View, Data, Op, Preview>;
// The implementation hands the declaration back as it came: every type above
// is the compiler's reading of it, and nothing at run time changes. `object`,
// because the declaration as written does not carry the `declared` mark the
// overload's result does; only the overload is what callers see.
export function defineWidget(declaration: object): object {
  return declaration;
}

/** Any widget made by `defineWidget`. */
export interface AnyWidget {
  readonly id: string;
  readonly view: WidgetView;
  readonly [declared]: true;
}

/** The settings a widget's readers are handed. */
export type WidgetSettingValues<W> = W extends { settings?: infer S }
  ? SettingValues<NonNullable<S>>
  : never;

/** The data a widget's component draws. */
export type WidgetData<W> = W extends { readonly [widgetData]?: infer D }
  ? D
  : never;

// A card's size, declared beside the props the admin builds so both read one
// shape, and published from here as it always was.
export type { WidgetRenderSize } from "../result";

/**
 * What a widget's own component is handed: its settings, its size and its
 * data, all typed from the declaration (`WidgetProps<typeof myWidget>`).
 *
 * 🔴 The data is a PROP, not something a hook fetches by naming the widget.
 * A hook typed by a type argument (`useData<typeof w>()`) takes whatever
 * widget it is told, so a component naming the wrong one compiles and is
 * lied to; a prop is typed by the same `W` as the settings beside it, so the
 * two cannot disagree. A component is then also a plain function of its
 * props: a test or the preview page renders it with data in hand, with no
 * provider around it.
 *
 * `W extends AnyWidget`, so a declaration refused by its own checks (see
 * `CheckedDeclaration`) cannot be given a component.
 */
export interface WidgetProps<W extends AnyWidget>
  extends Omit<DeclaredComponentProps, "settings" | "data"> {
  settings: WidgetSettingValues<W>;
  /**
   * The card's data, always present: the host draws loading, no permission
   * and error itself, and calls the component only once there is data.
   */
  data: WidgetData<W>;
}

/**
 * The component path a widget declares, for one drawn by its own component. Exported for the
 * site's generated component map, which keeps only the widgets whose path is a literal.
 */
export type ComponentPathOf<W> = W extends {
  readonly view: { component: infer Path extends string };
}
  ? Path
  : never;

/**
 * The component map an admin entry registers, checked against the widgets it
 * draws: one entry per declared component path, each a component taking THAT
 * widget's props.
 *
 * 🔴 What closes the gap props alone leave. A component reaches the admin by
 * the path string its declaration names, and its own signature says which
 * widget's props it takes; nothing related the two. The path is a literal
 * type (`view` is inferred `const`), so the map keyed by it can demand the
 * right component for each key: a component written for another widget is
 * refused, and so is a declared path with no component, which would otherwise
 * be an empty card.
 *
 * ```ts
 * export const components = {
 *   "@acme/shop/admin#RevenueCard": RevenueCard,
 * } satisfies WidgetComponentMap<(typeof widgets)[number]>;
 * ```
 */
export type WidgetComponentMap<W extends AnyWidget> = {
  [Path in ComponentPathOf<W>]: (
    props: PropsOfEach<WidgetsAt<W, Path>>
  ) => unknown;
};

/** The widgets among `W` that name this component path. */
type WidgetsAt<W, Path> = W extends unknown
  ? Path extends ComponentPathOf<W>
    ? W
    : never
  : never;

/**
 * The props of each widget, as a union of whole prop objects.
 *
 * 🔴 Distributed, so two widgets sharing one component path ask for a
 * component taking EITHER widget's props, each whole. Keyed by widget instead,
 * the shared key merged into a union of component types, and a component
 * written for one of the two satisfied it while the host would call it with
 * the other's data.
 */
type PropsOfEach<W> = W extends AnyWidget ? WidgetProps<W> : never;
