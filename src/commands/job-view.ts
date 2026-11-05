import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveJob } from "../job/lookup.ts";
import { engineBinary, jobProfile } from "../runtime/engine.ts";

export async function viewCommand(args: readonly string[], cwd: string): Promise<void> {
	const query = args[0];
	if (!query || args.length !== 1) {
		throw new Error("view requires exactly one job id");
	}
	const { jobDir } = await resolveJob(cwd, query, "read");
	const profile = await jobProfile(jobDir);
	const text = (name: string) => readFile(join(jobDir, name), "utf8").catch(() => "");
	const follow = (await text("state")).trim() === "running";
	if (profile.id === "pi" && !(await text("hosted")).trim()) {
		// Pi resolves a directory only once. Wait for the worker's single session file.
		const directory = join(jobDir, "session");
		let session: string | undefined;
		while (!session) {
			session = (await readdir(directory, { withFileTypes: true }).catch(() => [])).find(
				(entry) => entry.isFile() && entry.name.endsWith(".jsonl"),
			)?.name;
			if (!session) {
				await delay(200);
			}
		}
		if (spawnSync(engineBinary(profile), ["--view", join(directory, session)], { stdio: "inherit" }).status === 0) {
			return;
		}
	}
	const tail = spawnSync("tail", [...(follow ? ["-f"] : ["-n", "+1"]), join(jobDir, "log")], { stdio: "inherit" });
	process.exitCode = tail.status ?? 1;
}
