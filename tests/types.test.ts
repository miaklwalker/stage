import assert from "node:assert";
import test, { describe } from "node:test";
import type { Immutable } from "immer";
import {
	type Change,
	Stage,
	StageError,
	type Staged,
	track,
} from "../modules/index.ts";
import {
	type Equal,
	type Expect,
	type House,
	TOM,
	type Wizard,
} from "./support.ts";

const stage = new Stage()
	.entity("wizard", {
		key: (wizard: Wizard) => wizard.id,
		push: async (change) => {
			type _Change = Expect<Equal<typeof change, Change<Wizard, number>>>;
		},
	})
	.entity("house", {
		key: (house: House) => house.slug,
		pushMany: { run: async () => {} },
	});

describe("type inference", () => {
	test("entity accumulates names, value types and key types", () => {
		type Entities = typeof stage extends Stage<infer T> ? T : never;
		type _Names = Expect<Equal<keyof Entities, "wizard" | "house">>;
		type _Wizard = Expect<Equal<Entities["wizard"]["value"], Wizard>>;
		type _HouseKey = Expect<Equal<Entities["house"]["key"], string>>;

		assert.deepStrictEqual(stage.entities, ["wizard", "house"]);
	});

	test("track returns a handle typed by entity name", () => {
		const local = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: async () => {},
		});
		const tom = local.track("wizard", TOM);
		type _Handle = Expect<Equal<typeof tom, Staged<Wizard, number>>>;
		type _Value = Expect<Equal<typeof tom.value, Immutable<Wizard>>>;
		type _Name = Expect<Equal<typeof tom.value.name, string>>;
		assert.strictEqual(tom.value.name, "tom riddle");
	});

	test("get is typed by entity and key", () => {
		const found = stage.get("house", "slytherin");
		type _Found = Expect<
			Equal<typeof found, Staged<House, string> | undefined>
		>;
		assert.strictEqual(found, undefined);
	});

	test('track(value) keys the single value as "value"', () => {
		const tom = track(TOM, { push: async () => {} });
		type _Handle = Expect<Equal<typeof tom, Staged<Wizard, "value">>>;
		assert.strictEqual(tom.key, "value");
	});
});

describe("receive handlers", () => {
	test("infer their response type from run", () => {
		new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: {
				run: async () => ({ data: TOM }),
				receive: (response) => {
					type _One = Expect<Equal<typeof response, { data: Wizard }>>;
					return response.data;
				},
			},
			pushMany: {
				run: async () => ({ results: [TOM], total: 1 }),
				receive: (response) => {
					type _Many = Expect<
						Equal<typeof response, { results: Wizard[]; total: number }>
					>;
					return response.results;
				},
			},
		});
	});

	test("must return the entity's type", () => {
		new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: {
				run: async () => ({ data: TOM }),
				// @ts-expect-error the response wrapper is not a wizard.
				receive: (response) => response,
			},
		});
	});
});

describe("misuse is a compile error", () => {
	test("track rejects a value of the wrong shape", () => {
		const local = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: async () => {},
		});
		assert.throws(() => {
			// @ts-expect-error a house is not a wizard.
			local.track("wizard", { slug: "x", points: 1 });
		}, StageError);
	});

	test("get rejects a key of the wrong type", () => {
		// @ts-expect-error wizard keys are numbers.
		stage.get("wizard", "1");
	});

	test("update drafts are typed against the value", () => {
		const local = new Stage().entity("wizard", {
			key: (wizard: Wizard) => wizard.id,
			push: async () => {},
		});
		local.track("wizard", TOM).update((draft) => {
			// @ts-expect-error status is a union of two literals.
			draft.status = "undead";
		});
	});

	test("changes(name) is typed by the entity it names", () => {
		const changes = stage.changes("house");
		type _Changes = Expect<Equal<typeof changes, Change<House, string>[]>>;
		assert.deepStrictEqual(changes, []);
	});

	test("an unconfigured stage accepts no entity names", () => {
		const empty = new Stage();
		assert.throws(() => {
			// @ts-expect-error nothing is registered.
			empty.track("wizard", TOM);
		});
	});
});
