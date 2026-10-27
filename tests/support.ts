import type { Change, Key } from "../modules/index.ts";

export interface Wizard {
	id: number;
	name: string;
	status: "alive" | "not alive";
	house?: string;
	wand: { wood: string; core: string };
}

export interface House {
	slug: string;
	points: number;
}

export const TOM: Wizard = {
	id: 1,
	name: "tom riddle",
	status: "alive",
	house: "slytherin",
	wand: { wood: "yew", core: "phoenix feather" },
};

export const HARRY: Wizard = {
	id: 2,
	name: "harry potter",
	status: "alive",
	house: "gryffindor",
	wand: { wood: "holly", core: "phoenix feather" },
};

export const HERMIONE: Wizard = {
	id: 3,
	name: "hermione granger",
	status: "alive",
	house: "gryffindor",
	wand: { wood: "vine", core: "dragon heartstring" },
};

/**
 * A stand-in API that records every call. Set `failOn` to make calls carrying
 * those keys reject, and `hold()` to keep calls pending until released.
 */
export class FakeApi<T extends object, K extends Key> {
	/** Each `push` call's change, in call order. */
	readonly single: Change<T, K>[] = [];
	/** Each `pushMany` call's batch, in call order. */
	readonly bulk: (readonly Change<T, K>[])[] = [];
	failOn = new Set<K>();
	/** The most calls that were ever in flight at once. */
	peak = 0;
	#inFlight = 0;
	#gate: Promise<void> | null = null;
	#open: (() => void) | null = null;

	hold(): void {
		this.#gate = new Promise((resolve) => {
			this.#open = resolve;
		});
	}

	release(): void {
		this.#open?.();
		this.#gate = null;
	}

	push = async (change: Change<T, K>): Promise<void> => {
		this.single.push(change);
		await this.#call([change.key]);
	};

	pushMany = async (changes: readonly Change<T, K>[]): Promise<void> => {
		this.bulk.push(changes);
		await this.#call(changes.map((change) => change.key));
	};

	async #call(keys: readonly K[]): Promise<void> {
		this.#inFlight += 1;
		this.peak = Math.max(this.peak, this.#inFlight);
		try {
			await (this.#gate ?? Promise.resolve());
			if (keys.some((key) => this.failOn.has(key))) {
				throw new Error(`rejected ${keys.join(",")}`);
			}
		} finally {
			this.#inFlight -= 1;
		}
	}
}

/** Lets pending promise callbacks run. */
export const tick = () => new Promise((resolve) => setImmediate(resolve));

export type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

export type Expect<T extends true> = T;
