import assert from "node:assert";
import test, { describe } from "node:test";
import { Stage, StageError, SyncError } from "../modules/index.ts";
import {
	FakeApi,
	HARRY,
	HERMIONE,
	type House,
	TOM,
	tick,
	type Wizard,
} from "./support.ts";

function rename(name: string) {
	return (draft: { name: string }) => {
		draft.name = name;
	};
}

describe("Stage.entity", () => {
	test("rejects a duplicate name", () => {
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: async () => {},
		});
		assert.throws(() => {
			// @ts-expect-error "wizard" is already registered.
			stage.entity("wizard", {
				key: (wizard: Wizard) => wizard.id,
				push: async () => {},
			});
		}, StageError);
	});

	test("rejects a config with neither push nor pushMany", () => {
		assert.throws(() => {
			// @ts-expect-error push or pushMany is required.
			new Stage().entity("wizard", {
				key: (wizard: Wizard) => wizard.id,
			});
		}, StageError);
	});

	test("rejects a missing key function", () => {
		assert.throws(() => {
			// @ts-expect-error key is required.
			new Stage().entity("wizard", { push: async () => {} });
		}, StageError);
	});

	for (const [option, config] of [
		["concurrency 0", { concurrency: 0 }],
		["fractional concurrency", { concurrency: 1.5 }],
		["pushMany.max 0", { pushMany: { max: 0, run: async () => {} } }],
	] as const) {
		test(`rejects ${option}`, () => {
			assert.throws(() => {
				new Stage().entity("wizard", {
					key: (wizard: Wizard) => wizard.id,
					push: async () => {},
					...config,
				});
			}, StageError);
		});
	}

	test("lists registered names in order", () => {
		const stage = new Stage()
			.entity("wizard", { key: (w: Wizard) => w.id, push: async () => {} })
			.entity("house", { key: (h: House) => h.slug, push: async () => {} });
		assert.deepStrictEqual(stage.entities, ["wizard", "house"]);
	});
});

describe("Stage.track", () => {
	const stage = () =>
		new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: async () => {},
		});

	test("rejects tracking the same key twice", () => {
		const wizards = stage();
		wizards.track("wizard", TOM);
		assert.throws(() => wizards.track("wizard", TOM), StageError);
	});

	test("rejects an unregistered entity", () => {
		assert.throws(() => {
			// @ts-expect-error "house" was never registered.
			stage().track("house", { slug: "slytherin", points: 0 });
		}, StageError);
	});

	test("rejects a key that is neither string nor number", () => {
		const bad = new Stage().entity("wizard", {
			// @ts-expect-error keys must be strings or numbers.
			key: (wizard: Wizard) => wizard.wand,
			push: async () => {},
		});
		assert.throws(() => bad.track("wizard", TOM), StageError);
	});
});

describe("Stage.get and Stage.untrack", () => {
	test("get finds the tracked handle by key, from anywhere", () => {
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: async () => {},
		});
		const tom = stage.track("wizard", TOM);
		tom.update(rename("lord voldemort"));

		assert.strictEqual(stage.get("wizard", 1), tom);
		assert.strictEqual(stage.get("wizard", 1)?.value.name, "lord voldemort");
		assert.strictEqual(stage.get("wizard", 404), undefined);
	});

	test("untrack forgets the value and its pending edits", async () => {
		const api = new FakeApi<Wizard, number>();
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: api.push,
		});
		stage.track("wizard", TOM).update(rename("lord voldemort"));

		assert.strictEqual(stage.untrack("wizard", 1), true);
		assert.strictEqual(stage.untrack("wizard", 1), false);
		await stage.sync();
		assert.strictEqual(api.single.length, 0);
		stage.track("wizard", TOM);
	});
});

describe("Stage.changes", () => {
	test("lists only dirty values, optionally for one entity", () => {
		const stage = new Stage()
			.entity("wizard", { key: (w: Wizard) => w.id, push: async () => {} })
			.entity("house", { key: (h: House) => h.slug, push: async () => {} });
		stage.track("wizard", TOM).update(rename("lord voldemort"));
		stage.track("wizard", HARRY);
		stage.track("house", { slug: "gryffindor", points: 0 }).update((draft) => {
			draft.points += 10;
		});

		assert.deepStrictEqual(
			stage.changes().map((change) => change.key),
			[1, "gryffindor"],
		);
		assert.deepStrictEqual(
			stage.changes("wizard").map((change) => change.patch),
			[{ name: "lord voldemort" }],
		);
	});

	test("is empty for an empty stage", () => {
		assert.deepStrictEqual(new Stage().changes(), []);
	});
});

describe("Stage.sync batching", () => {
	test("uses push for each value when there is no pushMany", async () => {
		const api = new FakeApi<Wizard, number>();
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: api.push,
		});
		for (const wizard of [TOM, HARRY, HERMIONE]) {
			stage.track("wizard", wizard).update(rename(`${wizard.name}!`));
		}

		await stage.sync();

		assert.strictEqual(api.single.length, 3);
		assert.strictEqual(stage.changes().length, 0);
	});

	test("chunks into pushMany calls of at most max", async () => {
		const api = new FakeApi<Wizard, number>();
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			pushMany: { max: 2, run: api.pushMany },
		});
		for (const wizard of [TOM, HARRY, HERMIONE]) {
			stage.track("wizard", wizard).update(rename(`${wizard.name}!`));
		}

		await stage.sync();

		assert.deepStrictEqual(
			api.bulk.map((batch) => batch.map((change) => change.key)),
			[[1, 2], [3]],
		);
	});

	test("without max, sends everything in one pushMany call", async () => {
		const api = new FakeApi<Wizard, number>();
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			pushMany: { run: api.pushMany },
		});
		for (const wizard of [TOM, HARRY, HERMIONE]) {
			stage.track("wizard", wizard).update(rename(`${wizard.name}!`));
		}

		await stage.sync();

		assert.strictEqual(api.bulk.length, 1);
		assert.strictEqual(api.bulk[0]?.length, 3);
	});

	test("with both, a lone change uses push and several use pushMany", async () => {
		const api = new FakeApi<Wizard, number>();
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: api.push,
			pushMany: { run: api.pushMany },
		});
		const tom = stage.track("wizard", TOM);
		const harry = stage.track("wizard", HARRY);

		tom.update(rename("lord voldemort"));
		await stage.sync();
		assert.deepStrictEqual([api.single.length, api.bulk.length], [1, 0]);

		tom.update(rename("you-know-who"));
		harry.update(rename("the chosen one"));
		await stage.sync();
		assert.deepStrictEqual([api.single.length, api.bulk.length], [1, 1]);
	});

	test("with only pushMany, a lone change is sent as a batch of one", async () => {
		const api = new FakeApi<Wizard, number>();
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			pushMany: { run: api.pushMany },
		});
		const tom = stage.track("wizard", TOM).update(rename("lord voldemort"));

		await tom.sync();

		assert.strictEqual(api.bulk[0]?.length, 1);
	});

	test("sync(name) leaves other entities dirty", async () => {
		const stage = new Stage()
			.entity("wizard", { key: (w: Wizard) => w.id, push: async () => {} })
			.entity("house", { key: (h: House) => h.slug, push: async () => {} });
		stage.track("wizard", TOM).update(rename("lord voldemort"));
		stage.track("house", { slug: "slytherin", points: 0 }).update((draft) => {
			draft.points = 100;
		});

		await stage.sync("wizard");

		assert.deepStrictEqual(
			stage.changes().map((change) => change.key),
			["slytherin"],
		);
	});

	test("sync with nothing dirty makes no calls", async () => {
		const api = new FakeApi<Wizard, number>();
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: api.push,
		});
		stage.track("wizard", TOM);
		await stage.sync();
		assert.strictEqual(api.single.length, 0);
	});

	test("sync of an unregistered entity throws synchronously", () => {
		assert.throws(() => {
			// @ts-expect-error "house" was never registered.
			void new Stage().sync("house");
		}, StageError);
	});
});

describe("Stage.sync concurrency", () => {
	test("defaults to one call in flight at a time", async () => {
		const api = new FakeApi<Wizard, number>();
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: api.push,
		});
		for (const wizard of [TOM, HARRY, HERMIONE]) {
			stage.track("wizard", wizard).update(rename(`${wizard.name}!`));
		}
		await stage.sync();
		assert.strictEqual(api.peak, 1);
	});

	test("respects a higher concurrency limit", async () => {
		const api = new FakeApi<Wizard, number>();
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: api.push,
			concurrency: 2,
		});
		for (const wizard of [TOM, HARRY, HERMIONE]) {
			stage.track("wizard", wizard).update(rename(`${wizard.name}!`));
		}
		await stage.sync();
		assert.strictEqual(api.peak, 2);
	});

	test("edits made while a push is in flight stay dirty for the next sync", async () => {
		const api = new FakeApi<Wizard, number>();
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: api.push,
		});
		const tom = stage.track("wizard", TOM).update(rename("lord voldemort"));

		api.hold();
		const syncing = stage.sync();
		await tick();
		tom.update((draft) => {
			draft.status = "not alive";
		});
		api.release();
		await syncing;

		assert.strictEqual(tom.base.name, "lord voldemort");
		assert.strictEqual(tom.base.status, "alive");
		assert.deepStrictEqual(tom.change?.patch, { status: "not alive" });
	});

	test("overlapping syncs run one after another and never double-send", async () => {
		const api = new FakeApi<Wizard, number>();
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: api.push,
		});
		const tom = stage.track("wizard", TOM).update(rename("lord voldemort"));

		api.hold();
		const first = stage.sync();
		const second = tom.sync();
		await tick();
		api.release();
		await Promise.all([first, second]);

		assert.strictEqual(api.single.length, 1);
	});
});

describe("Stage.sync failures", () => {
	test("attempts every push, then throws a SyncError naming the failures", async () => {
		const api = new FakeApi<Wizard, number>();
		api.failOn.add(2);
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: api.push,
		});
		for (const wizard of [TOM, HARRY, HERMIONE]) {
			stage.track("wizard", wizard).update(rename(`${wizard.name}!`));
		}

		await assert.rejects(stage.sync(), (error: unknown) => {
			assert.ok(error instanceof SyncError);
			assert.ok(error instanceof StageError);
			assert.deepStrictEqual(
				error.failures.map((failure) => [failure.entity, failure.keys]),
				[["wizard", [2]]],
			);
			assert.ok(error.cause instanceof Error);
			return true;
		});

		assert.strictEqual(api.single.length, 3);
		assert.deepStrictEqual(
			stage.changes().map((change) => change.key),
			[2],
		);
	});

	test("a failed bulk call leaves its whole chunk dirty, and a retry resends it", async () => {
		const api = new FakeApi<Wizard, number>();
		api.failOn.add(3);
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			pushMany: { max: 2, run: api.pushMany },
		});
		for (const wizard of [TOM, HARRY, HERMIONE, { ...TOM, id: 4 }]) {
			stage.track("wizard", wizard).update(rename(`${wizard.name}!`));
		}

		await assert.rejects(stage.sync(), SyncError);
		assert.deepStrictEqual(
			stage.changes().map((change) => change.key),
			[3, 4],
		);

		api.failOn.clear();
		await stage.sync();
		assert.deepStrictEqual(
			api.bulk.at(-1)?.map((change) => change.key),
			[3, 4],
		);
		assert.strictEqual(stage.changes().length, 0);
	});

	test("a failed sync does not block the next one", async () => {
		const api = new FakeApi<Wizard, number>();
		api.failOn.add(1);
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: api.push,
		});
		stage.track("wizard", TOM).update(rename("lord voldemort"));

		const failed = stage.sync();
		const retried = stage.sync();

		await assert.rejects(failed, SyncError);
		await assert.rejects(retried, SyncError);
		assert.strictEqual(api.single.length, 2);

		api.failOn.clear();
		await stage.sync();
		assert.strictEqual(stage.changes().length, 0);
	});
});
