/**
 * The record of content events, as the package publishes it: the agent's
 * name beside the actor is optional on both read shapes, so a record built
 * by hand without it, as every record was before it existed, still types.
 *
 * Written as explicit assignability, which a required field would break.
 */
import { expectTypeOf } from "vitest";

import type {
  ContentEventProducer,
  ContentEventRecord,
} from "../repository";

type Assignable<A, B> = [A] extends [B] ? true : false;

type WithoutAgent<T> = Omit<T, "actorAgentName">;

// A record or producer without the agent's name is still one.
expectTypeOf<
  Assignable<WithoutAgent<ContentEventRecord>, ContentEventRecord>
>().toEqualTypeOf<true>();
expectTypeOf<
  Assignable<WithoutAgent<ContentEventProducer>, ContentEventProducer>
>().toEqualTypeOf<true>();

// And when present, it is a name or nothing.
expectTypeOf<ContentEventRecord["actorAgentName"]>().toEqualTypeOf<
  string | null | undefined
>();
