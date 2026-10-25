# Jobs

[README](../README.md) · [Command reference](commands.md)

Use this guide to start, inspect, review, and recover coding jobs.

![A coordinator starts workers and reviewers in separate Git worktrees](https://raw.githubusercontent.com/overment/limen/main/docs/limen.gif)

## How work runs

1. Tell the coordinator the outcome that you want.
2. The coordinator writes or moves the ticket. When the work lands, `limen land` moves the ticket to `done/` and regenerates NOW and PROVEN on `spec/build.md`.
3. The coordinator commits the ticket, so that the worker can see it.
4. The coordinator starts a job.
5. Stay in that conversation. A wake comes when a job ends.

Speak only when something looks wrong, or when the coordinator asks you. The coordinator asks about product ambiguity, a real tradeoff, credentials, or a merge.

### Requests

A good request names the outcome and the first artifact. It does not describe the whole repository. The coordinator changes the request into a short spawn with a `Ticket:` pointer. It does not paste the ticket into the prompt.

### Wakes

The type of coordinator controls how the wake comes:

| Coordinator | How the wake comes |
|---|---|
| **Pi** | The coordinator subscribes its session at spawn. The wake hook then puts the completion into that session. |
| **Herdr, without a Pi session** | The job records the coordinator pane as `origin-pane`. When the job ends, Limen runs `herdr agent prompt` on that pane. Then Limen waits until Herdr sees the pane at work. |
| **Group lead** | A team coordinator's finish reaches the lead as a group event through `hook/group-peer.ts`. When that hook is not live for the lead session, Limen prompts the lead pane through Herdr instead, with the group status and the reload hint. Workers inside a team never wake the lead. |

For a Herdr wake, `limen jobs <id>` shows the result as `herdr-wake`: `turn observed`, `delivered …, turn not seen` (Herdr sent the text; a busy pane may queue it), `may have reached …; not resent` (Herdr timed out after it may have sent the text), or `not sent …` (Herdr refused before it sent input). Limen sends the wake again only after `not sent`, and stops after two attempts; text that may have reached the pane is never sent twice. A wake up to 96 KiB goes as one `herdr agent prompt` argument, below Linux's 128 KiB limit for one argument. A longer wake goes whole as the same `agent.prompt` request on the Herdr socket that `herdr status --json` names. Herdr 0.9.5 reads at most 1 MiB in one request, and only while the request arrives within 5 seconds. No Herdr request can carry a longer wake, so it is `not sent …: prompt_too_large`; the job record keeps the whole final message.

`limen continue` from a shell with no wake route (no Pi session and no Herdr pane), for example a remote executor, keeps the parent's route: the parent's coordinator gets the continuation's wake.

Both routes carry the same completion facts: the task, branch and repository, stop reason, at most ten commits, the whole final message, and undelivered steers when present. The final message is never cut: the coordinator decides the next step from it. `limen wait`, the finish webhook's `handoff` and the group lead's result carry it whole too. A job with zero recorded tool calls and no commits says that it produced nothing. Missing evidence files remain absent from the wake; the route-specific next-step instruction may differ.

### Job states

| State | Meaning |
|---|---|
| `done` | The run ended cleanly. The selected engine exited 0, or a hosted session ended, and the last stop reason was not `error` or `aborted`. |
| `failed` | The run had a provider error, and Limen records the reason. A limit also records `failed` (see [Limits](#limits)). A failed job keeps its worktree and transcript. |

A `done` job whose final "Note check" leaves an item open is `done with open checks`. Limen keeps the `done` state and writes one line for each open item to `open-checks` in the job record: an item marked not proven, changed, dropped or broken, a proven item with no proof that its command ran in the session and no such file, or a check that was sent and not answered. A command counts only when one recorded bash call ended with exit 0 and joined its simple commands with `&&` alone, and no pipe follows the command; any other call may have skipped it or hidden its failure, and the open line names the reason. The wake and the finish webhook's handoff list these lines and ask the coordinator to continue the job, start a review, or accept each item with a reason before it lands. `limen jobs` and `limen status` show the same state.

Failed rows use the recorded `stop-reason`, not a later webhook or tab-close log line. Rate-limit rows show the HTTP status and approximate retry minutes; `jobs <id>` retains the full provider reason. Older records without `stop-reason` use the last `failed:` or `stopped:` log entry.

**Neither state is approval.** Neither state means that the ticket is finished or that the branch is safe to merge, because `done` only means that the run exited cleanly. The coordinator reads the record, the diff, and the checks. Then, under the review policy of the project, it merges, or resumes a repair, or asks you.

### Reviews

When a mistake would be expensive, the coordinator starts a new reviewer on the candidate. The reviewer gives a verdict. The reviewer does not change the branch.

## What the coordinator runs

These commands are the harness. The coordinator types them. This list helps you recognize a job ID, a wake, or a recovery step. It is not a daily script.

```bash
# Start a worker
limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> \
  --label "session handler · F001" \
  'Implement F001: sign-in survives a restart. Start with the failing session test. One commit. Ticket: spec/features/active/F001-auth/ticket.md'

# Ticket pointers accept whitespace after Ticket: and strip closing sentence punctuation.

# Inspect
limen status
limen jobs
limen jobs <id|suffix|label>
git diff HEAD...<branch>

# Review
limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> \
  --review --detached --branch limen/<job-id> --label "session handler review 1 · F001" \
  'Review the F001 candidate against spec/features/active/F001-auth/ticket.md. Name the commit reviewed.'

# Correct, stop, repair, or continue
limen steer <id> "stay on the session test; do not widen"
limen stop <id> "reason"
limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> \
  --branch limen/<job-id> --label "session handler repair 1 · F001" 'Focused resume instruction'
limen continue <id> 'Follow-up instruction'

# Follow and land
limen watch <id|label>
# When the work changed a ticket, fix its links on a keeper branch first, then land the keeper job
limen keeper spec/features/active/F001-auth/ticket.md --job <id> \
  --engine <engine> --provider <provider> --model <model> --thinking <level>
limen land <id>
```

### Job IDs and labels

- **Job ID:** The last line of `spawn` output is the durable job ID. Spawn also prints it as soon as the job record exists, so a spawn killed during setup still names its job.
- **Labels:** A label names the change first and the feature number last. A repair label or a review label names its round.
- **Hosted labels:** Ordinary text such as `Fix the lead-in paragraph · F900` is allowed. Lead ownership comes from the coordinator pane, not the label; `--role coordinator` and `--role lead` remain refused.
- **Group labels:** Team jobs read `team-2 coordinator · F773`, so jobs on the same feature remain distinct.

### Steer, stop, and resume

Use these steps in this order:

1. **Steer.** A running job reads a steer between tool calls.
2. **Stop.** Stop a job only after it ignores a steer, or when it is clearly dead. Stop sends TERM, and then a stronger signal.
3. **Resume.** A resume uses the same branch and worktree, with the uncommitted files, so the coordinator reads that state first.

### Watch and land

- **Watch:** To take over a job that another coordinator started, watch that job by name. `watch --running` subscribes to every running job, but it is not a takeover.
- **Land:** `limen land` merges a `done` job onto the current branch. Read [Job states](#job-states) first.
- **Ticket check on land:** before it merges, `limen land` checks every ticket the branch adds, moves or changes, at the branch tip, against the plant map's place ids. An error refuses the land and prints the `limen keeper` command that fixes it. A warning prints and does not block. Without a map, land skips the place ids and says so. `limen ticket check <branch>` runs the same check before an ordinary `git merge`.

### Spec keeper

`limen keeper <ticket> (--job <id> [--job <id> …] | --group <id>) [--candidate <branch>]` starts a short detached job (default timeout 20 minutes) that fixes the spec links of finished work: ticket front matter, a planned or dropped board line, and map sources. `--group` adds every member job of that group. The coordinator starts it; no hook does.

- It refuses while a listed job is still running, so it never races a worker. In a group, only the lead starts it.
- It creates `limen/keeper-<fnnn>-<tip>` at the candidate tip: the single job's branch, or `--candidate` for several jobs on one integration branch. The keeper commits only there.
- When the job moved its ticket to another lane, the old path still works: the keeper follows the one folder at the tip with that number and prints `ticket moved: <old> -> <new>`.
- Its task is a packet: the ticket, board and map paths, the candidate, the changed tickets, the current land check, and per job the label, state, branch with base and tip, worktree, session transcript and task. Both engines write the transcript as `.limen/jobs/<id>/session/<time>_<uuid>.jsonl`; the packet names the newest one.
- The keeper edits only `spec/features/**`, `spec/build.md`, and map files that cite a changed ticket. Map edits apply in place and do not land.
- Land the keeper job: it carries the work and the fixes. If the keeper commits nothing, land the original job.

### Finished jobs

Finished jobs keep their files in `.limen/jobs/`, but not their worktrees. The next job removes finished worktrees before its engine starts and logs one line per removal: path, job, reason. A resume with `--branch` keeps that worktree.

| Command | Effect |
|---|---|
| `limen prune` | Removes finished worktrees, as the next job does, and prints the path, job and reason of each removal. |
| `limen prune --retire` | Deletes finished, failed, or stopped job records whose branch is landed (ancestor or cherry-pick) or deleted, and the landed local `limen/*` branches of those records. |
| `limen prune --retire --dry-run` | Prints the IDs and removes nothing. |

Spawn and sweep never retire records. A branch stays while any job that names it is still running or starting, or while a checkout other than a finished job's worktree holds it. Remote branches stay.

### Continue a finished job

To keep the conversation of a finished job, run:

```bash
limen continue <job-id> "Follow-up instruction"
```

Limen copies the saved session into a new linked job. The new job keeps the worktree safe from prune. If prune removed the old checkout before then, Limen restores it at the recorded path from the local branch. A landed job has no local branch left, because `land` and `prune --retire` delete it; to continue one, first recreate the branch at its landed commit (`git branch <branch> <commit>`). If Limen cannot create the new job, the parent job and its saved session do not change.

**Only committed branch contents come back.** Uncommitted files that prune removed are lost. Recovery is not possible without the branch or the transcript. Limen does not take over a branch that is checked out in a different place.

**Every job can call `finish`.** A detached continuation of a hosted job keeps the hosted transcript, so the worker may call `finish` again. The handoff becomes the job result, and the job ends `done` when the engine exits. A later reply does not replace that handoff.

### Start queue

Every plant on the seat shares one machine, so detached jobs wait in one queue for the whole seat, under `$LIMEN_HOME/.limen/start-queue/` (`~/.limen/start-queue/` by default). The job's own wrapper waits after its handshake and before prune, `--prepare` and the engine. No daemon runs the queue.

- **Order.** Priority first (`--priority 1|2|3`, 1 the most urgent, 2 the default), then the time the job entered the queue.
- **Priority budget.** A [seat rule](commands.md#seat-wide-rules) with `--start-priority N` holds every detached job less urgent than N until the rule ends: `limen rule set claude-week --until <reset> --start-priority 1 "…"` starts only priority 1 jobs. A held job waits with its own reason, `held by rule <name> until <end> (start priority N)`, one per rule that holds it. Spawn prints it after `queued`, `limen jobs` shows it after the wait, and `limen queue` shows it under the job. A held job never reads the load and never blocks a more urgent job. The hold applies also when `LIMEN_START_GATE` is `off`. When the rule ends, at its end time or by `limen rule end`, the held jobs start in queue order as the gate allows, and each coordinator gets the start notice. Hosted (`--tab`) jobs, group launches and Devin jobs are not held.
- **Budget reading.** Limen does not read the Claude budget; a person reads it and sets the rule. Today the reading comes from the Pi Claude bridge, which receives Claude's rate-limit events and warns at 80% without a number. The bridge does not write the reading to a file. Source: `evidence.md` in the F951 feature folder under `spec/features/`, section "The budget reading".
- **Gate.** Only the first job in the queue reads the load: CPU idle across all cores over about two seconds, and free memory. On macOS free memory is the `memory_pressure` free percentage; on Linux it is MemAvailable over MemTotal. The job starts when CPU is at least 25% idle and memory at least 20% free. A value the machine cannot report does not hold a job back.
- **Settle.** After one start, the next start waits a settle interval of 60 seconds, so the new job's load shows in the next reading.
- **Values.** `$LIMEN_HOME/.limen/start-gate.json` changes them for the whole seat: `{ "cpuIdle": 25, "memoryFree": 20, "settle": "60s" }`. A waiting job reads the file again on each poll, so an edit reaches jobs already in the queue. `LIMEN_START_GATE` overrides the file for the jobs started under it: `off` turns the gate off, and a JSON object in the same form replaces the file. The job log names each value that Limen ignores. `LIMEN_START_READING` names a file that holds the reading instead of the machine (`{ "cpuIdle": 10, "memoryFree": 80 }`); tests and manual checks use it.
- **What a coordinator sees.** A job that the gate admits at once and that has nobody ahead starts as before; its log says `start gate: open`. A job that must wait makes spawn print `queued`, shows the pulse `queued` in `limen jobs`, and logs `queued: …`. When it starts, its log says `start queue: started after …`, and its coordinator gets one start notice on the route its finish uses: the Pi wake hook for a subscribed session, or `herdr agent prompt` to the recorded `origin-pane`. The notice says no action is needed. Its receipt is its own (`notify/delivered/_start.<session>`, `notify/herdr-start`) and never counts as the completion wake. The Pi "started" toast waits until the job leaves the queue. A start notice is news only while the job runs: when the job ends before the Pi hook delivers it, no late notice follows, and the session's completion wake carries the notice's line instead. The Herdr route starts its notice as the job leaves the queue, before prune, `--prepare` and the engine; the job does not wait for the pane's answer.
- **Stop and loss.** `limen stop` ends a queued job `stopped` with the stop reason. A queue entry whose wrapper is gone, or whose job ended, is removed and does not block the queue. A recycled pid can keep a lost entry until the reaper ends its job.
- **Limits.** The job timeout and a group deadline count from engine start; time in the queue never counts against them. Hosted (`--tab`) jobs, group launches and Devin jobs start at once.

### Limits

| Limit | Detached job | Hosted job |
|---|---|---|
| Time | 90 minutes (change it with `--timeout 20m`) | None |
| Tool-start events | 900 (`LIMEN_MAX_TOOL_CALLS`) | None |
| `--prepare` command | 5 minutes (`LIMEN_PREPARE_MS`, or the plant limits file) | 5 minutes |
| Stalled tool | 3 minutes (`LIMEN_TOOL_STALL_MS`, or the plant limits file) | None |

A prepare command that runs out of time is stopped, and the job log records `prepare failed: timed out`. The job still starts.

**Stalled tools.** Detached jobs retain the three-minute CPU-idle tool containment rule; `LIMEN_TOOL_STALL_MS` or the plant limits file changes that confirmation time. Hosted observation never signals an engine or its children: a quiet external wait is not proof of a stuck tool. Explicit stops and configured group deadlines still apply.

**Plant limits.** A plant can set the prepare limit and the stalled-tool time in a tracked file, `.agents/limen/limits.json`. Cargo plants use it. Their builds wait for each other: a Mac-wide cargo wrapper that queues builds, or cargo's own lock on a build directory. A prepare command that builds Rust can need more than 5 minutes. A cargo command that waits on cargo's lock uses no CPU, so the stalled-tool rule can stop it. A cargo plant commits this file:

```json
{ "prepare": "20m", "toolStall": "15m" }
```

- Values use the `--timeout` form: `90s`, `20m`, `2h`.
- `LIMEN_PREPARE_MS` or `LIMEN_TOOL_STALL_MS`, when it is set, wins over the file.
- A plant with no file keeps 5 minutes and 3 minutes.
- Limen reads the file in the project root each time it uses a limit, so an edit applies to running jobs too.
- The job log names each entry that Limen ignores, such as an unknown key or a value without a unit.
- The file does not change the job time limit.

**Hosted ownership.** On Linux, Limen checks that a hosted Pi job still owns its pane. While it does, the job shows no ownership note. A pane reload keeps that proof, and a reload is not completion. When Limen loses the proof, the job shows an `ownership` note. See [How it works](#how-it-works) for what counts as proof.

**Engine and platform limit.** Only hosted Pi on Linux binds its pane. Every hosted job on macOS never binds, so Limen cannot prove which process owns their pane. They get an ownership note only when their pane moves to a place Limen cannot verify; the absence of a note is not proof of ownership.

**Job notes.** A running row in `limen jobs` and `limen status` names the kind of its note: `blocked`, `errored`, `idle`, or `ownership`. A healthy running job shows no note. A blocked, errored, or idle note hides an ownership note. An ownership note appears when a bound job loses its ownership proof, or when its pane moves to a place Limen cannot verify. When an ownership note stays for one minute, each coordinator that follows the job gets one wake about it. The note clears when the job ends or Limen proves ownership again.

### Seat notifications

`limen sweep` scans registered projects for terminal jobs that nobody heard, hosted-stall advisories and persistent ownership uncertainty. A running job's notification title names its note kind, for example `limen: fix login · blocked`. Changes to an unresolved uncertainty diagnostic keep the same seat receipt and do not ring again. Each event gets one seat notification, also across restarts and concurrent sweeps. Old timestamp receipts stay valid. When an advisory clears and a new one starts, the new one can send a notification again.

If a notification fails in an unclear way, the sweep logs an error and does not send that event again automatically. Seat notifications do not use up coordinator wakes or finish webhooks.

## Ticket authorship

`limen ticket-author` shows the name, email, and commit that first added a ticket. Collaborators who share a project can run it:

```bash
limen ticket-author spec/features/active/F001-auth/ticket.md
```

It follows renames between lanes when Git recognizes them. Paths are relative to the current directory. Absolute paths in the repository also work. The lookup reads the committed `HEAD` of the current branch. It never reads the Git config or the GitHub session of the current operator, and it writes nothing.

### What the result means

The result is the **author** of the creation commit. It is not the committer or the latest editor. It is **evidence from Git, not a verified human identity**. Shared bot credentials identify the bot, not the person who asked the bot to file the ticket. So if collaborators need different attribution, use different authors on filing commits.

For a GitHub noreply email, the lookup also gives the recorded login. A usual email is still a usable identity, without a GitHub account or network access. Spawn records that creation `@login` on the job for finish routing. If no login is available, spawn records the reason.

### When authorship is not available

For uncommitted paths and shallow history, the lookup says that authorship is not available. It does not guess. So commit a new ticket before you look it up, and fetch the full history for a shallow clone.

A move that Git cannot recognize, a squash, or changed history can lose the original attribution. If you delete a path and create it again, a new ticket history starts. Limen adds no author tags to ticket Markdown.

## Recovery

The coordinator does this. You need it only if you look at a stuck tab yourself.

| Symptom | Safe next step |
|---|---|
| The job is quiet or repeats itself | Read `limen jobs <id>`, the log, and the worktree. Stop only on evidence. Then resume with a narrower task. |
| The worker has a real question | Read its durable note. Answer it. Resume the branch. |
| The wrapper is dead, but the state says `running` | Check the recorded PID. Correct the plain `state` file. Then resume. |
| A completion wake did not come | Read `.limen/jobs/` and Git. The job files stay the source of truth when a notification does not come. |

## How it works

You do not need these mechanics to run jobs. They explain the notes and records above.

- **Binding:** the launch record of a hosted Pi job on Linux. At launch, the Pi hook writes exclusive records of the controlled launch, the canonical job and session, the initial pane, the shell parent, the engine PID and start time, and the boot ID (the kernel's ID for the current boot). Reload keeps the binding.
- **Ownership proof:** the check that the bound job still owns its pane. It needs the saved process identity and a fresh check that this exact PID is in the foreground of the current verified pane. Visible launch arguments do not count. A foreign session, an old record with only a PID, a failed pane query, or a pane move that Limen cannot verify leaves the job unowned.
- **Ownership wake:** the wake about a standing `ownership` note. After one minute, each subscribed recipient can receive one confirmed wake for that condition. Its recipients share at most two unsuccessful attempts. The wake waits for an idle recipient; it never queues text into a running turn as a follow-up. Tool and thinking changes and supervisor recovery keep the original timestamp and receipts. Only proven recovery rearms the wake; engine recovery alone cannot clear an unavailable child observation. Real failures and completion use separate wake allowances. A terminal state retires the condition.
- **Publication:** how spawn and continue create a job. Limen writes the complete starting record in a hidden directory, then publishes it with one rename. A publication failure removes the hidden record and leaves the parent record and saved session unchanged.
- **Seat receipt:** the job file `notify/seat`. The sweep writes it before it sends a notification, so one event rings once, also across restarts and concurrent sweeps.
