// U3: what a coordinator is told. One ended turn tells the shepherd only when no running job it owns will wake the
// coordinator again; an aborted turn means the owner is at the pane and never counts. A completion wake sends only a
// done job that is not a scout to landing; a done scout has nothing to land (F936).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type CoordinatorTurn, turnSignal } from "../src/integrations/coordinator-signal.ts";
import { promptPane } from "../src/integrations/coordinator-wake.ts";
import { completionWake } from "../src/job/wake-text.ts";
import { FINAL } from "./plant.ts";

const base: CoordinatorTurn = { stop: "stop", ownedRunning: 0, said: "Report sent" };

test("an ended turn signals idle with its last message unless an owned job runs or the owner aborted it", () => {
	assert.equal(turnSignal({ ...base, ownedRunning: 1 }), undefined);
	assert.equal(turnSignal({ ...base, stop: "aborted" }), undefined);
	assert.deepEqual(turnSignal(base), { kind: "coordinator.idle", reason: "turn ended; last message: Report sent" });
	assert.equal(turnSignal({ ...base, stop: "error", said: "" })?.reason, "last turn failed");
});

test("only a done job that is not a scout is sent to landing; a fallback or scout wake has the whole message, a Herdr wake past one request is not sent", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "u12-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(join(dir, "task.md"), "Scout F001.\n");
	await writeFile(join(dir, "tool-calls"), "4\n");
	await writeFile(join(dir, "result"), `${FINAL.text}\n`);
	const wake = (state: string, fallback = false) =>
		completionWake(dir, "F001", state, "id", "limen/id", "", { instruction: "Inspect it before landing.", fallback });
	assert.doesNotMatch(wake("failed"), /landing/);
	assert.match(wake("done"), /is done \(id\).*before landing/s);
	await writeFile(join(dir, "role"), "scout\n");
	assert.match(wake("done"), /Nothing to land/);
	assert.doesNotMatch(wake("done"), /before landing|land it/);
	assert.ok([wake("done"), wake("stopped", true)].every((text) => text.includes(`Final message:\n${FINAL.text}\n\n`)));
	await promptPane("/usr/bin/true", "w1:p1", wake("done").repeat(130), Date.now() + 60_000, join(dir, "p")); // 1.2 MB
	assert.match(await readFile(join(dir, "p"), "utf8"), /^attempt 1: not sent to w1:p1: prompt_too_large: \d{7} /);
});
