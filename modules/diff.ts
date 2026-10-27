/**
 * Structural equality for the data an API sends and receives: primitives,
 * plain objects, arrays, `Date`, `Map` and `Set`. Anything else is compared by
 * reference.
 *
 * This is what lets an edit that is later reverted drop out of a sync — Immer
 * gives the reverted field a new reference, so `===` alone would still see a
 * change.
 */
export function isEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object") return false;
	if (a === null || b === null) return false;
	if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;

	if (a instanceof Date && b instanceof Date) {
		return a.getTime() === b.getTime();
	}

	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((item, index) => isEqual(item, b[index]));
	}

	if (a instanceof Map && b instanceof Map) {
		if (a.size !== b.size) return false;
		for (const [key, value] of a) {
			if (!b.has(key) || !isEqual(value, b.get(key))) return false;
		}
		return true;
	}

	if (a instanceof Set && b instanceof Set) {
		if (a.size !== b.size) return false;
		for (const value of a) {
			if (!b.has(value)) return false;
		}
		return true;
	}

	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	const bRecord = b as Record<string, unknown>;
	const aRecord = a as Record<string, unknown>;
	return aKeys.every(
		(key) => Object.hasOwn(bRecord, key) && isEqual(aRecord[key], bRecord[key]),
	);
}

/**
 * The top-level fields of `current` that differ from `base`. A field present
 * in `base` but deleted from `current` is included.
 */
export function changedFields<T extends object>(
	base: T,
	current: T,
): (keyof T & string)[] {
	const before = base as Record<string, unknown>;
	const after = current as Record<string, unknown>;
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	return [...keys].filter(
		(key) => !isEqual(before[key], after[key]),
	) as (keyof T & string)[];
}
