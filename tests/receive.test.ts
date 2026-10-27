import assert from "node:assert";
import test, { describe } from "node:test";
import { type Change, Stage, StageError, SyncError } from "../modules/index.ts";
import { tick } from "./support.ts";

interface Wizard {
	id: number;
	name: string;
	status: "alive" | "not alive";
	updatedAt?: number;
}

const TOM: Wizard = { id: 1, name: "tom riddle", status: "alive" };
const HARRY: Wizard = { id: 2, name: "harry potter", status: "alive" };
const RON: Wizard = { id: 3, name: "ron weasley", status: "alive" };

/** What a typical API does with a write: trims strings and stamps the record. */
function serverSide(change: Change<Wizard, number>, at: number): Wizard {
	return { ...change.current, name: change.current.name.trim(), updatedAt: at };
}

describe("push with receive", () => {
	test("the server's version becomes both base and value", async () => {
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: {
				run: async (change) => ({ data: serverSide(change, 100) }),
				receive: (response) => response.data,
			},
		});
		const tom = stage.track("wizard", TOM).update((draft) => {
			draft.name = " lord voldemort";
		});

		await stage.sync();

		assert.deepStrictEqual(tom.value, {
			id: 1,
			name: "lord voldemort",
			status: "alive",
			updatedAt: 100,
		});
		assert.strictEqual(tom.base, tom.value);
		assert.strictEqual(tom.dirty, false);
		assert.ok(Object.isFrozen(tom.value));
	});

	test("returning undefined keeps what was sent", async () => {
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: { run: async () => null, receive: () => undefined },
		});
		const tom = stage.track("wizard", TOM).update((draft) => {
			draft.name = " lord voldemort";
		});

		await stage.sync();

		assert.strictEqual(tom.value.name, " lord voldemort");
		assert.strictEqual(tom.dirty, false);
	});

	test("a received value with a different key is ignored", async () => {
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: {
				run: async (change) => serverSide(change, 100),
				receive: (response) => ({ ...response, id: 99 }),
			},
		});
		const tom = stage.track("wizard", TOM).update((draft) => {
			draft.name = "lord voldemort";
		});

		await stage.sync();

		assert.strictEqual(tom.value.updatedAt, undefined);
		assert.strictEqual(tom.dirty, false);
	});

	test("edits made in flight are re-applied over the server's version", async () => {
		let open = () => {};
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: {
				run: async (change) => {
					await gate;
					return serverSide(change, 100);
				},
				receive: (response) => response,
			},
		});
		const tom = stage.track("wizard", TOM).update((draft) => {
			draft.name = " lord voldemort";
		});

		const syncing = stage.sync();
		await tick();
		tom.update((draft) => {
			draft.status = "not alive";
		});
		open();
		await syncing;

		assert.deepStrictEqual(tom.base, {
			id: 1,
			name: "lord voldemort",
			status: "alive",
			updatedAt: 100,
		});
		assert.deepStrictEqual(tom.value, { ...tom.base, status: "not alive" });
		// The server's own fields don't leak into the next patch.
		assert.deepStrictEqual(tom.change?.patch, { status: "not alive" });
	});

	test("a receive that throws fails the call and leaves the value dirty", async () => {
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: {
				run: async () => ({}),
				receive: () => {
					throw new Error("unexpected response shape");
				},
			},
		});
		const tom = stage.track("wizard", TOM).update((draft) => {
			draft.name = "lord voldemort";
		});

		await assert.rejects(stage.sync(), SyncError);
		assert.strictEqual(tom.dirty, true);
	});

	test("a push object needs both run and receive", () => {
		assert.throws(() => {
			new Stage().entity("wizard", {
				key: (wizard: Wizard) => wizard.id,
				// @ts-expect-error receive is required in the object form.
				push: { run: async () => {} },
			});
		}, StageError);
	});
});

describe("pushMany with receive", () => {
	function setup(
		respond: (changes: readonly Change<Wizard, number>[]) => Wizard[],
	) {
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			pushMany: {
				run: async (changes) => ({ results: respond(changes) }),
				receive: (response) => response.results,
			},
		});
		const handles = [TOM, HARRY, RON].map((wizard) =>
			stage.track("wizard", wizard).update((draft) => {
				draft.status = "not alive";
			}),
		);
		return { stage, handles };
	}

	test("matches each returned entity to its value by key, in any order", async () => {
		const { stage, handles } = setup((changes) =>
			changes.map((change) => serverSide(change, change.key * 10)).reverse(),
		);

		await stage.sync();

		assert.deepStrictEqual(
			handles.map((handle) => handle.value.updatedAt),
			[10, 20, 30],
		);
		assert.strictEqual(stage.changes().length, 0);
	});

	test("values missing from the response keep what was sent", async () => {
		const { stage, handles } = setup((changes) =>
			changes
				.filter((change) => change.key !== 2)
				.map((change) => serverSide(change, 5)),
		);

		await stage.sync();

		assert.deepStrictEqual(
			handles.map((handle) => handle.value.updatedAt),
			[5, undefined, 5],
		);
		assert.strictEqual(handles[1]?.value.status, "not alive");
		assert.strictEqual(stage.changes().length, 0);
	});

	test("entities in the response that weren't in the batch are ignored", async () => {
		const { stage, handles } = setup((changes) => [
			...changes.map((change) => serverSide(change, 5)),
			{ id: 404, name: "stranger", status: "alive", updatedAt: 5 },
		]);

		await stage.sync();

		assert.strictEqual(stage.get("wizard", 404), undefined);
		assert.strictEqual(handles.length, 3);
	});

	test("each chunk's receive sees only that chunk's changes", async () => {
		const seen: number[][] = [];
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			pushMany: {
				max: 2,
				run: async (changes) => changes.map((change) => change.current),
				receive: (response, changes) => {
					seen.push(changes.map((change) => change.key));
					return response;
				},
			},
		});
		for (const wizard of [TOM, HARRY, RON]) {
			stage.track("wizard", wizard).update((draft) => {
				draft.status = "not alive";
			});
		}

		await stage.sync();

		assert.deepStrictEqual(seen, [[1, 2], [3]]);
	});
});
