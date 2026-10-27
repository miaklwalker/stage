// The happy path: edit a value in several steps, read it back, sync once.
import { Stage } from "../main.ts";

interface Wizard {
	id: number;
	name: string;
	status: "alive" | "not alive";
}

// Stand-in for a REST client. Every call costs against a rate limit, which is
// the whole reason to stage edits rather than send them as they happen.
const api = {
	calls: 0,
	async patch(path: string, body: unknown) {
		api.calls += 1;
		console.log(`PATCH ${path}`, body);
	},
};

const stage = new Stage().entity("wizard", {
	key: (wizard: Wizard) => wizard.id,
	// `change.patch` holds only the fields that differ from what the server
	// last saw, so this is a minimal PATCH body.
	push: (change) => api.patch(`/wizards/${change.key}`, change.patch),
});

const tom = stage.track("wizard", {
	id: 1,
	name: "tom riddle",
	status: "alive",
});
console.log("current name before update:", tom.value.name);
tom.update((draft) => {
	draft.name = "lord voldemort";
});

// Elsewhere in the program: read the current value through the handle, or
// look the handle up by key if you don't have it to hand.
console.log("current name after:", tom.value.name);
console.log("via get:", stage.get("wizard", 1)?.value.name);
console.log("server still has:", tom.base.name);

tom.update((draft) => {
	draft.status = "not alive";
});

console.log(
	"pending:",
	stage.changes().map((change) => change.patch),
);
await stage.sync();
console.log(`${api.calls} API call(s); dirty afterwards: ${tom.dirty}`);
