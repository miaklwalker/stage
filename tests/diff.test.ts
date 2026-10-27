import assert from "node:assert";
import test, { describe } from "node:test";
import { changedFields, isEqual } from "../modules/index.ts";

describe("isEqual", () => {
	test("compares primitives with Object.is", () => {
		assert.strictEqual(isEqual(1, 1), true);
		assert.strictEqual(isEqual(Number.NaN, Number.NaN), true);
		assert.strictEqual(isEqual(0, -0), false);
		assert.strictEqual(isEqual("a", "b"), false);
		assert.strictEqual(isEqual(null, undefined), false);
	});

	test("compares plain objects and arrays structurally", () => {
		assert.strictEqual(
			isEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }),
			true,
		);
		assert.strictEqual(isEqual({ a: 1 }, { a: 1, b: undefined }), false);
		assert.strictEqual(isEqual([1, 2], [1, 2, 3]), false);
		assert.strictEqual(isEqual([], {}), false);
	});

	test("compares dates by time", () => {
		assert.strictEqual(isEqual(new Date(0), new Date(0)), true);
		assert.strictEqual(isEqual(new Date(0), new Date(1)), false);
	});

	test("compares maps by entry and sets by membership", () => {
		assert.strictEqual(
			isEqual(new Map([["a", { x: 1 }]]), new Map([["a", { x: 1 }]])),
			true,
		);
		assert.strictEqual(
			isEqual(new Map([["a", 1]]), new Map([["a", 2]])),
			false,
		);
		assert.strictEqual(isEqual(new Set([1, 2]), new Set([2, 1])), true);
		assert.strictEqual(isEqual(new Set([1]), new Set([2])), false);
	});
});

describe("changedFields", () => {
	test("lists added, changed and removed top-level fields", () => {
		assert.deepStrictEqual(
			changedFields<Record<string, unknown>>(
				{ same: 1, changed: 1, removed: 1 },
				{ same: 1, changed: 2, added: 1 },
			),
			["changed", "removed", "added"],
		);
	});

	test("is empty for equal values", () => {
		assert.deepStrictEqual(changedFields({ a: { b: 1 } }, { a: { b: 1 } }), []);
	});
});
