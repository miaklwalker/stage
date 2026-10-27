// A GET returns one version of an entity; by the time we sync, the server's
// copy has moved on. The PATCH response hands back the server's latest
// version, and `receive` makes that the new baseline.
import { Stage } from "../main.ts";

interface Wizard {
	id: number;
	name: string;
	status: "alive" | "not alive";
	wand: string;
	revision: number;
	updatedAt: string;
}

// ------------------------------------------------------------- mock server
// The "database" lives in module scope. Each handler returns a copy, as a real
// response body would, never a reference into the store.
const db = new Map<number, Wizard>([
	[
		1,
		{
			id: 1,
			name: "tom riddle",
			status: "alive",
			wand: "yew",
			revision: 1,
			updatedAt: "1938-09-01",
		},
	],
]);
let clock = 0;
const now = () => `1998-05-0${++clock}`;

const server = {
	async get(id: number): Promise<{ data: Wizard }> {
		const wizard = db.get(id);
		if (!wizard) throw new Error(`404 /wizards/${id}`);
		console.log(`GET   /wizards/${id}`);
		return { data: structuredClone(wizard) };
	},

	async patch(id: number, body: Partial<Wizard>): Promise<{ data: Wizard }> {
		const existing = db.get(id);
		if (!existing) throw new Error(`404 /wizards/${id}`);
		console.log(`PATCH /wizards/${id}`, body);
		// The server merges the patch into whatever it holds *now*, then trims
		// the name and stamps its own fields — none of which the client sent.
		const saved: Wizard = {
			...existing,
			...body,
			name: (body.name ?? existing.name).trim(),
			revision: existing.revision + 1,
			updatedAt: now(),
		};
		db.set(id, saved);
		return { data: structuredClone(saved) };
	},
};

// ------------------------------------------------------------------ client
const stage = new Stage().entity("wizard", {
	key: (wizard: Wizard) => wizard.id,
	push: {
		run: (change) => server.patch(change.key, change.patch),
		// Without this, the stage would assume the server holds exactly what we
		// sent, and we'd never see the new revision or the other client's edit.
		receive: (response) => response.data,
	},
});

const { data } = await server.get(1);
const tom = stage.track("wizard", data);
console.log("after GET:  ", tom.value);

tom.update((draft) => {
	draft.name = "  lord voldemort  ";
});
tom.update((draft) => {
	draft.status = "not alive";
});

// Meanwhile, someone else writes to the same record. Our patch only carries
// the fields we changed, so it won't clobber theirs.
await server.patch(1, { wand: "elder" });

console.log("pending:    ", tom.change?.patch);
await stage.sync();

// The value now reflects the server: our edits (with the name trimmed), the
// other client's wand, and the server's revision and timestamp.
console.log("after sync: ", tom.value);
console.log("dirty:      ", tom.dirty);
console.log(
	"matches db: ",
	JSON.stringify(tom.value) === JSON.stringify(db.get(1)),
);
