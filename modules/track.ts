import { Stage } from "./stage.ts";
import type { PushOne, Staged } from "./types.ts";

/**
 * Tracks a single value with its own private stage, for scripts that only
 * ever edit one thing. Every change carries the key `"value"`.
 *
 * Reach for {@link Stage} as soon as there is more than one value: a shared
 * stage is what lets edits to many values go out in bulk calls.
 *
 * ```ts
 * const tom = track(wizard, {
 * 	push: (change) => api.patch(`/wizards/${wizard.id}`, change.patch),
 * });
 * tom.update((draft) => { draft.name = "lord voldemort"; });
 * await tom.sync();
 * ```
 */
export function track<T extends object>(
	value: T,
	config: { readonly push: PushOne<T, "value"> },
): Staged<T, "value"> {
	return new Stage()
		.entity("value", { key: (_: T) => "value" as const, push: config.push })
		.track("value", value);
}
