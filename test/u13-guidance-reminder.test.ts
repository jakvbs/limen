// U13: an edit asks once per area for the unread guidance lines that apply, until the agent reads them or compacts.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import limenCommunication from "../hook/communication.ts";

test("guidance reminders name the unread lines for the edited area, once until read or compaction", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "u13-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const dir = join(cwd, ".agents/limen");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "styleguide.md"), "# S\n\n## `core/`\n\n1\n\n## `web/`\n\n2\n\n## Rust\n\n3\n");
	delete process.env.LIMEN_CONTEXT_ROOT;
	const handlers = new Map<string, unknown>();
	limenCommunication({ on: (name: string, handler: unknown) => handlers.set(name, handler) });
	const call = (name: string, ...args: unknown[]) => {
		const handler = handlers.get(name);
		return typeof handler === "function" ? handler(...args) : undefined;
	};
	const tool = (toolName: string, input: object, isError = false): string =>
		call("tool_result", { toolName, input, isError, content: [] }, { cwd })?.content.at(-1)?.text ?? "";
	assert.match(tool("edit", { path: "core/a.rs" }), /styleguide\.md lines 1-6, 11-13\. .*`core\/`, Rust/);
	assert.equal(tool("edit", { path: "core/b.rs" }), "", "same area, already asked");
	assert.match(tool("edit", { path: "web/x.ts" }), /lines 1-2, 7-10\. .* web\/x\.ts,/);
	tool("read", { path: ".agents/limen/styleguide.md", offset: 1, limit: 10 });
	tool("read", { path: ".agents/limen/styleguide.md", offset: 11, limit: 3 });
	assert.equal(tool("edit", { path: "io/c.rs" }), "", "every line that applies was read");
	call("session_compact");
	assert.equal(tool("edit", { path: "web/y.ts" }, true), "", "a failed edit asks nothing");
	assert.match(tool("edit", { path: "web/y.ts" }), /lines 1-2, 7-10\./);
	assert.match(tool("write", { path: "spec/features/planned/F1-x/ticket.md" }), /Specs: .* lines \d+-\d+\. They hold/);
});
