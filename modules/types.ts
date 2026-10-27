import type { Draft, Immutable } from "immer";

/** The identity of a tracked value. Keys are compared with `===`. */
export type Key = string | number;

/** Flattens an intersection into a single, readable object type. */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * What a {@link Stage} knows about one registered entity: the shape of its
 * values and the type of their key. The stage accumulates one of these per
 * `.entity()` call, which is how `track("wizard", ...)` knows what a wizard is.
 */
export interface EntityShape<T extends object = object, K extends Key = Key> {
	value: T;
	key: K;
}

/** Every entity a stage has registered, by name. */
export type EntityMap = Record<string, EntityShape>;

/**
 * The net difference between what the server last saw and what the value is
 * now. This is what your `push` / `pushMany` functions receive.
 *
 * It describes the *result* of every `update()` since the last successful
 * sync, not the sequence of edits: setting a field twice yields one entry, and
 * setting it back to its synced value yields none.
 */
export interface Change<T extends object, K extends Key = Key> {
	/** The value's key, as returned by the entity's `key` function. */
	readonly key: K;
	/** The value as of the last successful sync (or as first tracked). */
	readonly base: Immutable<T>;
	/** The value as it will be once this change is pushed. */
	readonly current: Immutable<T>;
	/**
	 * Only the top-level fields that differ, holding their current values — the
	 * body of a PATCH request. A field removed in a draft appears here as
	 * `undefined`. Send `current` instead if your API wants the whole resource.
	 */
	readonly patch: Immutable<Partial<T>>;
	/** The names of the fields in `patch`. Never empty. */
	readonly fields: readonly (keyof T & string)[];
}

/** Sends one change to the API. */
export type PushOne<T extends object, K extends Key> = (
	change: Change<T, K>,
) => Promise<unknown>;

/**
 * Sends many changes in a single call, for APIs with a bulk endpoint. The
 * stage splits pending changes into chunks of at most `max` and calls `run`
 * once per chunk.
 */
export interface PushMany<T extends object, K extends Key, R = unknown> {
	/** The most changes the endpoint accepts per call. Defaults to unlimited. */
	readonly max?: number;
	readonly run: (changes: readonly Change<T, K>[]) => Promise<R>;
	/**
	 * Pulls the server's version of each entity out of `run`'s response. Each
	 * returned value is matched to its tracked value with the entity's `key`
	 * function, so order doesn't matter and the response may leave entities
	 * out. Values whose key wasn't in this batch are ignored.
	 *
	 * Without `receive`, the stage assumes the server now holds exactly what
	 * was sent.
	 */
	readonly receive?: (
		response: R,
		changes: readonly Change<T, K>[],
	) => Iterable<T>;
}

/**
 * `push` with a handler for its response, for endpoints that return the
 * updated entity (with new timestamps, server-computed fields, and so on).
 */
export interface PushOneWithReceive<T extends object, K extends Key, R> {
	readonly run: (change: Change<T, K>) => Promise<R>;
	/**
	 * Pulls the server's version of the entity out of `run`'s response. Return
	 * `undefined` to keep what was sent. A value whose key doesn't match the
	 * change is ignored.
	 */
	readonly receive: (response: R, change: Change<T, K>) => T | undefined;
}

interface EntityConfigBase<T extends object, K extends Key> {
	/**
	 * Returns the value's identity. Annotate its parameter
	 * (`key: (w: Wizard) => w.id`) — that annotation is where the stage learns
	 * the entity's type.
	 */
	readonly key: (value: T) => K;
	/**
	 * How many pushes for this entity may be in flight at once. Defaults to 1,
	 * because the reason to stage changes is usually a rate limit.
	 */
	readonly concurrency?: number;
}

/**
 * How to sync one kind of entity. Give it `push`, `pushMany`, or both.
 *
 * With both, a lone change goes through `push` and anything more goes through
 * `pushMany` — single-resource endpoints are often cheaper against a rate
 * limit than a bulk call carrying one item.
 */
export type EntityConfig<
	T extends object,
	K extends Key,
	ROne = unknown,
	RMany = unknown,
> = EntityConfigBase<T, K> &
	(
		| {
				readonly push: Push<T, K, ROne>;
				readonly pushMany?: PushMany<T, K, RMany>;
		  }
		| {
				readonly push?: Push<T, K, ROne>;
				readonly pushMany: PushMany<T, K, RMany>;
		  }
	);

/** Either a bare push function, or one paired with a response handler. */
export type Push<T extends object, K extends Key, R = unknown> =
	| PushOne<T, K>
	| PushOneWithReceive<T, K, R>;

/** An edit to a value, written as a mutation against an Immer draft. */
export type Recipe<T extends object> = (draft: Draft<T>) => void;

/**
 * A tracked value. Read it with `.value`, edit it with `.update()`, and send
 * the edits with `.sync()` (or with the owning stage's `sync()`, which batches
 * across every tracked value).
 */
export interface Staged<T extends object, K extends Key = Key> {
	/** The name the entity was registered under. */
	readonly entity: string;
	readonly key: K;
	/**
	 * The current value, including unsynced edits. Deeply frozen: change it
	 * through `update()` so the edit is tracked.
	 */
	readonly value: Immutable<T>;
	/** The value as of the last successful sync (or as first tracked). */
	readonly base: Immutable<T>;
	/** Whether `value` differs from `base`. */
	readonly dirty: boolean;
	/** The pending change, or `null` when there is nothing to sync. */
	readonly change: Change<T, K> | null;
	/** Applies an edit locally. Nothing is sent until a sync. */
	update(recipe: Recipe<T>): this;
	/** Throws away every unsynced edit, restoring `base`. */
	discard(): this;
	/** Syncs this value alone. Resolves immediately when it isn't dirty. */
	sync(): Promise<void>;
}

/** The value type of a registered entity. */
export type ValueOf<
	TEntities extends EntityMap,
	TName extends keyof TEntities,
> = TEntities[TName]["value"];

/** The key type of a registered entity. */
export type KeyOf<
	TEntities extends EntityMap,
	TName extends keyof TEntities,
> = TEntities[TName]["key"];

/** One push that failed during a sync. */
export interface SyncFailure {
	readonly entity: string;
	/** Every key the failed call carried — one for `push`, a chunk for `pushMany`. */
	readonly keys: readonly Key[];
	readonly error: unknown;
}

/** Thrown when a stage or a tracked value is used incorrectly. */
export class StageError extends Error {
	override name = "StageError";
}

/**
 * Thrown by `sync()` when one or more pushes fail. Every push is still
 * attempted; the values behind a failed push stay dirty, so calling `sync()`
 * again retries exactly what didn't make it.
 */
export class SyncError extends StageError {
	override name = "SyncError";
	readonly failures: readonly SyncFailure[];

	constructor(failures: readonly SyncFailure[]) {
		const count = failures.reduce((sum, f) => sum + f.keys.length, 0);
		super(
			`${failures.length} push${failures.length === 1 ? "" : "es"} failed, covering ${count} value${count === 1 ? "" : "s"}. They remain dirty; call sync() again to retry.`,
			{ cause: failures[0]?.error },
		);
		this.failures = failures;
	}
}
