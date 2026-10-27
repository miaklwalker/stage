import assert from "node:assert";
import test, { describe } from "node:test";
import { type Change, track } from "../modules/index.ts";
import { TOM, type Wizard } from "./support.ts";

describe("track", () => {
	test("stages and syncs a single value", async () => {
		const sent: Change<Wizard, "value">[] = [];
		const tom = track(TOM, {
			push: async (change) => {
				sent.push(change);
			},
		});

		tom.update((draft) => {
			draft.name = " lord voldemort";
		});
		tom.update((draft) => {
			draft.status = "not alive";
		});
		await tom.sync();

		assert.strictEqual(sent.length, 1);
		assert.strictEqual(sent[0]?.key, "value");
		assert.deepStrictEqual(sent[0]?.patch, {
			name: " lord voldemort",
			status: "not alive",
		});
		assert.strictEqual(tom.dirty, false);
	});
});
