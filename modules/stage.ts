import { freeze, type Immutable, produce } from "immer";
import { changedFields, isEqual } from "./diff.ts";
import {
	type Change,
	type EntityConfig,
	type EntityMap,
	type EntityShape,
	type Key,
	type KeyOf,
	type Prettify,
	type Recipe,
	StageError,
	type Staged,
	type SyncFailure,
	SyncError,
	type ValueOf,
} from "./types.ts";

// The registry stores configs and handles for many different entity types side
// by side, so their generics are erased to the widest shape. Every value that
// reaches one of these was produced by the same `.entity()` call that typed it.
type ErasedConfig = EntityConfig<object, Key>;
type ErasedHandle = StagedHandle<object, Key>;

/**
 * The concrete tracked value. Not exported: consumers hold it as `Staged`,
 * which leaves out `commit()` so only the stage can move the sync baseline.
 */
class StagedHandle<T extends object, K extends Key> implements Staged<T, K> {
	readonly entity: string;
	readonly key: K;
	#base: T;
	#current: T;
	readonly #keyOf: (value: T) => K;
	readonly #sync: (handle: StagedHandle<T, K>) => Promise<void>;

	constructor(
		entity: string,
		key: K,
		value: T,
		keyOf: (value: T) => K,
		sync: (handle: StagedHandle<T, K>) => Promise<void>,
	) {
		this.entity = entity;
		this.key = key;
		this.#base = value;
		this.#current = value;
		this.#keyOf = keyOf;
		this.#sync = sync;
	}

	get value(): Immutable<T> {
		return this.#current as Immutable<T>;
	}

	get base(): Immutable<T> {
		return this.#base as Immutable<T>;
	}

	get dirty(): boolean {
		return this.#base !== this.#current && !isEqual(this.#base, this.#current);
	}

	get change(): Change<T, K> | null {
		const fields = changedFields(this.#base, this.#current);
		if (fields.length === 0) return null;

		const patch: Partial<T> = {};
		for (const field of fields) patch[field] = this.#current[field];

		return {
			key: this.key,
			base: this.#base as Immutable<T>,
			current: this.#current as Immutable<T>,
			patch: freeze(patch) as Immutable<Partial<T>>,
			fields,
		};
	}

	update(recipe: Recipe<T>): this {
		const next = produce(this.#current, recipe);
		const nextKey = this.#keyOf(next);
		if (nextKey !== this.key) {
			throw new StageError(
				`An update changed the key of ${this.entity} ${JSON.stringify(this.key)} to ${JSON.stringify(nextKey)}. Keys identify a value across syncs and can't be edited; track the new value separately instead.`,
			);
		}
		this.#current = next;
		return this;
	}

	discard(): this {
		this.#current = this.#base;
		return this;
	}

	sync(): Promise<void> {
		return this.#sync(this);
	}

	/**
	 * Records that `pushed` reached the server, which now holds `received` if
	 * the response said so. Edits made while the push was in flight are kept,
	 * re-applied field by field over the server's version.
	 */
	commit(pushed: Immutable<T>, received?: T): void {
		if (received === undefined) {
			this.#base = pushed as T;
		} else {
			const local = changedFields(pushed as T, this.#current);
			const current = this.#current as Record<string, unknown>;
			this.#base = received;
			this.#current =
				local.length === 0
					? received
					: produce(received, (draft) => {
							const target = draft as Record<string, unknown>;
							for (const field of local) {
								if (Object.hasOwn(current, field)) {
									target[field] = current[field];
								} else {
									delete target[field];
								}
							}
						});
		}
		if (isEqual(this.#base, this.#current)) this.#current = this.#base;
	}
}

/**
 * Tracks values locally, lets you edit them with Immer drafts, and syncs the
 * net result in as few API calls as each entity's endpoints allow.
 *
 * Register each kind of entity once with `.entity()`, then `track()` values
 * as you load them. Every `.entity()` call teaches the stage a name and a
 * value type, so `track()`, `get()` and `sync()` reject names and shapes it
 * hasn't seen.
 *
 * ```ts
 * const stage = new Stage()
 * 	.entity("wizard", {
 * 		key: (wizard: Wizard) => wizard.id,
 * 		push: (change) => api.patch(`/wizards/${change.key}`, change.patch),
 * 		pushMany: { max: 50, run: (changes) => api.post("/wizards/bulk", changes) },
 * 	});
 *
 * const tom = stage.track("wizard", { id: 1, name: "tom riddle", status: "alive" });
 * tom.update((draft) => { draft.name = "lord voldemort"; });
 * tom.update((draft) => { draft.status = "not alive"; });
 *
 * console.log(tom.value.name); // "lord voldemort" — nothing sent yet
 * await stage.sync();          // one call, carrying both fields
 * ```
 */
export class Stage<TEntities extends EntityMap = Record<never, never>> {
	readonly #configs = new Map<string, ErasedConfig>();
	readonly #handles = new Map<string, Map<Key, ErasedHandle>>();
	// Syncs run one after another, so a value is never pushed twice at once and
	// each sync starts from the baseline the previous one left behind.
	#queue: Promise<void> = Promise.resolve();

	/** The names of every registered entity, in registration order. */
	get entities(): (keyof TEntities & string)[] {
		return [...this.#configs.keys()] as (keyof TEntities & string)[];
	}

	/**
	 * Registers a kind of entity and how to sync it. The value type is inferred
	 * from the parameter annotation on `key`.
	 */
	entity<
		TName extends string,
		T extends object,
		K extends Key,
		ROne = unknown,
		RMany = unknown,
	>(
		name: TName extends keyof TEntities ? never : TName,
		config: EntityConfig<T, K, ROne, RMany>,
	): Stage<Prettify<TEntities & { [N in TName]: EntityShape<T, K> }>> {
		if (this.#configs.has(name)) {
			throw new StageError(`An entity named "${name}" is already registered.`);
		}
		if (typeof config.key !== "function") {
			throw new StageError(`Entity "${name}" needs a key function.`);
		}
		if (!config.push && !config.pushMany) {
			throw new StageError(
				`Entity "${name}" has no way to sync. Give it push, pushMany, or both.`,
			);
		}
		if (
			config.push &&
			typeof config.push !== "function" &&
			(typeof config.push.run !== "function" ||
				typeof config.push.receive !== "function")
		) {
			throw new StageError(
				`Entity "${name}" has a push object without both run and receive. Pass a plain function if there's no response to read.`,
			);
		}
		assertPositiveInteger(name, "concurrency", config.concurrency);
		assertPositiveInteger(name, "pushMany.max", config.pushMany?.max);

		this.#configs.set(name, config as unknown as ErasedConfig);
		this.#handles.set(name, new Map());
		return this as unknown as Stage<
			Prettify<TEntities & { [N in TName]: EntityShape<T, K> }>
		>;
	}

	/**
	 * Starts tracking a value. The stage keeps its own deep copy, so later
	 * changes to the object you passed in are not picked up.
	 */
	track<TName extends keyof TEntities & string>(
		name: TName,
		value: ValueOf<TEntities, TName>,
	): Staged<ValueOf<TEntities, TName>, KeyOf<TEntities, TName>> {
		const config = this.#config(name);
		const key = config.key(value);
		if (typeof key !== "string" && typeof key !== "number") {
			throw new StageError(
				`The key function for "${name}" returned ${typeof key}; keys must be strings or numbers.`,
			);
		}

		const handles = this.#handles.get(name) as Map<Key, ErasedHandle>;
		if (handles.has(key)) {
			throw new StageError(
				`${name} ${JSON.stringify(key)} is already tracked. Use stage.get("${name}", ${JSON.stringify(key)}) to reach it.`,
			);
		}

		const handle = new StagedHandle(
			name,
			key,
			freeze(structuredClone(value), true),
			config.key,
			(staged) => this.#enqueue(() => this.#push([staged])),
		);
		handles.set(key, handle);
		return handle as unknown as Staged<
			ValueOf<TEntities, TName>,
			KeyOf<TEntities, TName>
		>;
	}

	/** The tracked value with this key, if there is one. */
	get<TName extends keyof TEntities & string>(
		name: TName,
		key: KeyOf<TEntities, TName>,
	): Staged<ValueOf<TEntities, TName>, KeyOf<TEntities, TName>> | undefined {
		this.#config(name);
		return this.#handles.get(name)?.get(key) as unknown as
			| Staged<ValueOf<TEntities, TName>, KeyOf<TEntities, TName>>
			| undefined;
	}

	/**
	 * Stops tracking a value, discarding any unsynced edits. Returns whether it
	 * was tracked. Use it in long-running processes so finished values can be
	 * garbage collected.
	 */
	untrack<TName extends keyof TEntities & string>(
		name: TName,
		key: KeyOf<TEntities, TName>,
	): boolean {
		this.#config(name);
		return this.#handles.get(name)?.delete(key) ?? false;
	}

	/**
	 * Every pending change, optionally for one entity — what the next `sync()`
	 * would send. Handy for logging or a dry run.
	 */
	changes<TName extends keyof TEntities & string>(
		name?: TName,
	): Change<ValueOf<TEntities, TName>, KeyOf<TEntities, TName>>[] {
		return this.#tracked(name).flatMap((handle) => {
			const change = handle.change;
			return change ? [change] : [];
		}) as unknown as Change<
			ValueOf<TEntities, TName>,
			KeyOf<TEntities, TName>
		>[];
	}

	/**
	 * Pushes every dirty value — or every dirty value of one entity — using
	 * `pushMany` wherever it saves calls. Rejects with a `SyncError` if any push
	 * fails, after every other push has been attempted.
	 */
	sync<TName extends keyof TEntities & string>(name?: TName): Promise<void> {
		if (name !== undefined) this.#config(name);
		return this.#enqueue(() => this.#push(this.#tracked(name)));
	}

	#config(name: string): ErasedConfig {
		const config = this.#configs.get(name);
		if (!config) {
			throw new StageError(
				`"${name}" is not a registered entity. Registered: ${this.entities.join(", ") || "(none)"}.`,
			);
		}
		return config;
	}

	#tracked(name: string | undefined): ErasedHandle[] {
		if (name !== undefined) {
			this.#config(name);
			return [...(this.#handles.get(name)?.values() ?? [])];
		}
		return [...this.#handles.values()].flatMap((handles) => [
			...handles.values(),
		]);
	}

	#enqueue(task: () => Promise<void>): Promise<void> {
		const run = this.#queue.then(task);
		this.#queue = run.catch(() => undefined);
		return run;
	}

	async #push(handles: readonly ErasedHandle[]): Promise<void> {
		// Snapshot the changes up front: edits made while a push is in flight
		// belong to the next sync, not this one.
		const byEntity = new Map<
			string,
			{ handle: ErasedHandle; change: Change<object, Key> }[]
		>();
		for (const handle of handles) {
			const change = handle.change;
			if (!change) continue;
			const group = byEntity.get(handle.entity) ?? [];
			group.push({ handle, change });
			byEntity.set(handle.entity, group);
		}

		const failures: SyncFailure[] = [];
		await Promise.all(
			[...byEntity].map(([entity, pending]) => {
				const config = this.#config(entity);
				const calls = planCalls(config, pending);
				return runWithConcurrency(
					calls.map((call) => async () => {
						try {
							const response = await call.send();
							// Match the server's versions back to tracked values by key,
							// so a bulk response can arrive in any order or be partial.
							const received = new Map<Key, object>();
							for (const value of call.receive?.(response) ?? []) {
								received.set(
									config.key(value),
									freeze(structuredClone(value), true),
								);
							}
							for (const { handle, change } of call.items) {
								handle.commit(change.current, received.get(change.key));
							}
						} catch (error) {
							failures.push({
								entity,
								keys: call.items.map(({ change }) => change.key),
								error,
							});
						}
					}),
					config.concurrency ?? 1,
				);
			}),
		);

		if (failures.length > 0) throw new SyncError(failures);
	}
}

interface PlannedCall {
	items: { handle: ErasedHandle; change: Change<object, Key> }[];
	send: () => Promise<unknown>;
	/** Turns `send`'s response into the server's versions of the entities. */
	receive?: (response: unknown) => Iterable<object>;
}

/** Splits one entity's pending changes into the fewest calls its config allows. */
function planCalls(
	config: ErasedConfig,
	pending: PlannedCall["items"],
): PlannedCall[] {
	const { push, pushMany } = config;
	if (push && (!pushMany || pending.length === 1)) {
		if (typeof push === "function") {
			return pending.map((item) => ({
				items: [item],
				send: () => push(item.change),
			}));
		}
		return pending.map((item) => ({
			items: [item],
			send: () => push.run(item.change),
			receive: (response) => {
				const value = push.receive(response, item.change);
				return value === undefined ? [] : [value];
			},
		}));
	}
	if (!pushMany) return [];

	const max = pushMany.max ?? pending.length;
	const calls: PlannedCall[] = [];
	for (let start = 0; start < pending.length; start += max) {
		const items = pending.slice(start, start + max);
		const changes = items.map(({ change }) => change);
		const { receive } = pushMany;
		calls.push({
			items,
			send: () => pushMany.run(changes),
			receive: receive && ((response) => receive(response, changes)),
		});
	}
	return calls;
}

async function runWithConcurrency(
	tasks: readonly (() => Promise<void>)[],
	limit: number,
): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < tasks.length) {
			const task = tasks[next];
			next += 1;
			if (task) await task();
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, tasks.length) }, worker),
	);
}

function assertPositiveInteger(
	entity: string,
	option: string,
	value: number | undefined,
): void {
	if (value === undefined) return;
	if (!Number.isInteger(value) || value < 1) {
		throw new StageError(
			`Entity "${entity}" has ${option} ${value}; it must be a positive integer.`,
		);
	}
}
