import assert from "node:assert";
import test, { describe } from "node:test";
import { Stage, StageError } from "../modules/index.ts";
import { FakeApi, TOM, type Wizard } from "./support.ts";

function setup() {
	const api = new FakeApi<Wizard, number>();
	const stage = new Stage().entity("wizard", {
		key: (wizard: Wizard) => wizard.id,
		push: api.push,
	});
	return { api, stage, tom: stage.track("wizard", TOM) };
}

describe("Staged.value", () => {
	test("reflects every update immediately, before any sync", () => {
		const { api, tom } = setup();
		tom.update((draft) => {
			draft.name = "lord voldemort";
		});

		assert.strictEqual(tom.value.name, "lord voldemort");
		assert.strictEqual(tom.base.name, "tom riddle");
		assert.strictEqual(api.single.length, 0);
	});

	test("is deeply frozen, so edits must go through update", () => {
		const { tom } = setup();
		assert.throws(() => {
			// @ts-expect-error value is readonly.
			tom.value.wand.wood = "elder";
		}, TypeError);
	});

	test("is a copy, unaffected by later changes to the tracked object", () => {
		const stage = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: async () => {},
		});
		const original = structuredClone(TOM);
		const tom = stage.track("wizard", original);
		original.name = "changed behind its back";

		assert.strictEqual(tom.value.name, "tom riddle");
		assert.strictEqual(tom.dirty, false);
	});
});

describe("Staged.change", () => {
	test("is null when nothing has been edited", () => {
		const { tom } = setup();
		assert.strictEqual(tom.change, null);
		assert.strictEqual(tom.dirty, false);
	});

	test("collapses several updates into one net patch", () => {
		const { tom } = setup();
		tom
			.update((draft) => {
				draft.name = "lord voldemort";
			})
			.update((draft) => {
				draft.status = "not alive";
			})
			.update((draft) => {
				draft.name = "you-know-who";
			});

		assert.deepStrictEqual(tom.change?.patch, {
			name: "you-know-who",
			status: "not alive",
		});
		assert.deepStrictEqual(tom.change?.fields, ["name", "status"]);
		assert.strictEqual(tom.change?.key, 1);
	});

	test("an edit that is reverted drops out entirely", () => {
		const { tom } = setup();
		tom.update((draft) => {
			draft.wand = { wood: "elder", core: "thestral hair" };
		});
		tom.update((draft) => {
			draft.wand = { wood: "yew", core: "phoenix feather" };
		});

		assert.strictEqual(tom.dirty, false);
		assert.strictEqual(tom.change, null);
	});

	test("a nested edit reports its top-level field with the whole new value", () => {
		const { tom } = setup();
		tom.update((draft) => {
			draft.wand.wood = "elder";
		});

		assert.deepStrictEqual(tom.change?.patch, {
			wand: { wood: "elder", core: "phoenix feather" },
		});
	});

	test("a deleted field appears in the patch as undefined", () => {
		const { tom } = setup();
		tom.update((draft) => {
			delete draft.house;
		});

		assert.deepStrictEqual(tom.change?.fields, ["house"]);
		assert.ok("house" in (tom.change?.patch ?? {}));
		assert.strictEqual(tom.change?.patch.house, undefined);
	});
});

describe("Staged.update", () => {
	test("refuses to change the key, leaving the value untouched", () => {
		const { tom } = setup();
		assert.throws(
			() =>
				tom.update((draft) => {
					draft.id = 99;
				}),
			StageError,
		);
		assert.strictEqual(tom.value.id, 1);
		assert.strictEqual(tom.dirty, false);
	});
});

describe("Staged.discard", () => {
	test("restores the last synced value", async () => {
		const { tom } = setup();
		tom.update((draft) => {
			draft.name = "lord voldemort";
		});
		await tom.sync();
		tom.update((draft) => {
			draft.status = "not alive";
		});
		tom.discard();

		assert.strictEqual(tom.value.name, "lord voldemort");
		assert.strictEqual(tom.value.status, "alive");
		assert.strictEqual(tom.dirty, false);
	});
});

describe("Staged.sync", () => {
	test("pushes only this value", async () => {
		const { api, stage, tom } = setup();
		const harry = stage.track("wizard", { ...TOM, id: 2, name: "harry" });
		tom.update((draft) => {
			draft.name = "lord voldemort";
		});
		harry.update((draft) => {
			draft.name = "the boy who lived";
		});

		await tom.sync();

		assert.deepStrictEqual(
			api.single.map((change) => change.key),
			[1],
		);
		assert.strictEqual(harry.dirty, true);
	});

	test("does nothing when clean", async () => {
		const { api, tom } = setup();
		await tom.sync();
		assert.strictEqual(api.single.length, 0);
	});

	test("moves the baseline, so the next sync sends only newer edits", async () => {
		const { api, tom } = setup();
		tom.update((draft) => {
			draft.name = "lord voldemort";
		});
		await tom.sync();
		tom.update((draft) => {
			draft.status = "not alive";
		});
		await tom.sync();

		assert.deepStrictEqual(
			api.single.map((change) => change.patch),
			[{ name: "lord voldemort" }, { status: "not alive" }],
		);
		assert.strictEqual(tom.base.status, "not alive");
	});
});
