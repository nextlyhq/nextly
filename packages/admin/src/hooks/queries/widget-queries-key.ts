/**
 * The prefix of every widget batch's query key, in a module of its own so a
 * screen that only invalidates the dashboard's cards (the entry editor's pin)
 * does not load the batching code to name it.
 *
 * Invalidating it asks every card on the dashboard again, each keeping what it
 * shows until its answer arrives: for a change made outside a card that its
 * answer depends on, such as a pin.
 *
 * @module hooks/queries/widget-queries-key
 */
export const WIDGET_QUERIES_KEY = ["dashboard", "widget-queries"] as const;
