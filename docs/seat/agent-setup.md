# Seat setup for a coding agent

**Paste this whole file into your coding agent.** The agent sets up one Limen seat: a Linux VPS, x86_64 or arm64, that runs jobs while the laptop lid is closed. It works from the laptop over SSH, runs a Check after each step, and stops at each HUMAN step. Background: [remote.md](../remote.md).

## Phase map

| Phase | What | Who | Where |
|---|---|---|---|
| 0 | Laptop ready | HUMAN | laptop |
| 1 | CPU, box, break-glass SSH | HUMAN, then agent | laptop → public IP |
| 2 | Tailscale, admin SSH | HUMAN approves, agent | laptop → tailnet |
| 3 | Worker without sudo | agent | root |
| 4 | Tools and logins | agent, then HUMAN logins | root, worker |
| 5 | Project and `limen init` | agent | worker |
| 6 | Phone bell | agent, then HUMAN pairs | root, worker |
| 7 | Herdr coordinator | HUMAN | coordinator pane |
| 8 | Prune timer | agent | root |
| 9 | Preview | agent, HUMAN gate | worker, root |
| 10 | Lid-closed proof, lock-down | HUMAN, agent | pane, laptop |
| 11–14 | GitHub doorbell (opt-in) | HUMAN, agent | GitHub, root, pane |

## Fill in

```sh
# Ask the human for these values once, at the start.
SEAT_NAME=        # Tailscale machine name, e.g. shop-seat
PUBLIC_IP=        # VPS public IPv4; break-glass SSH only
ADMIN_KEY=        # laptop private key for root over Tailscale (daily admin), e.g. ~/.ssh/shop-seat-admin
BREAK_GLASS_KEY=  # a different laptop private key for root over PUBLIC_IP, e.g. ~/.ssh/shop-seat-glass
WORKER=           # Unix user for the coordinator and all jobs; never sudo
WORKER_KEY=       # a third laptop private key, for WORKER, e.g. ~/.ssh/shop-seat-worker
PROJECT_REPO=     # OWNER/REPO on github.com
PROJECT_BRANCH=   # an existing work branch, not only the default branch
LIMEN_REV=        # 40-hex Limen commit on main that contains this file; the human picks it
MODEL_FLAGS=      # --provider P --model M --thinking T (pi flags)
BELL=moshi        # moshi, or ntfy if the phone does not use Moshi
# The agent writes these during the run.
SEAT_HOST=        # phase 2: the full MagicDNS name
APP_ID=           # phase 11: the human gives it; not a secret
# Fixed values. Do not ask for them.
PROJECT_DIR=/home/$WORKER/REPO_NAME  # REPO_NAME: the REPO part of PROJECT_REPO
ADMIN_SSH=$SEAT_NAME-root            # laptop alias: root over Tailscale
BREAK_GLASS_SSH=$SEAT_NAME-public    # laptop alias: root over PUBLIC_IP
LIMEN_REPO=https://github.com/overment/limen.git
PEM_SOURCE=/root/limen-app.pem       # root-only file; never in a worker home
```

## Who runs a step, and where

| Label | Who | Where |
|---|---|---|
| `mac$` | agent | the laptop |
| `root$` | agent | root on the seat, through `$BREAK_GLASS_SSH` (phases 1–2) or `$ADMIN_SSH` (after phase 2) |
| `worker$` | agent | `WORKER` on the seat, through `ssh $SEAT_HOST` |
| `pane$` | HUMAN | the coordinator pane in Herdr on the seat |
| **HUMAN** | the human | a terminal **on the laptop**, unless the step says `pane$` |

**HUMAN steps run on the laptop.** The SSH keys are on the laptop, so every HUMAN `ssh` starts there. Never run a HUMAN step from another server (for example an older seat). The wrong machine shows `Permission denied (publickey)` or `no such identity`.

## Rules for the agent

1. Never ask for, read, print, or store a secret: the App PEM, a Moshi pairing token, a provider login, a `gh` token, an ntfy topic. The HUMAN types them in their own terminal.
2. At a HUMAN step, say what the human must do, with the fill-in values in each command. Then wait until the human says it is done. Then run the Check.
3. Run every Check. A Check states the expected result; some expected results are a non-zero exit. If the result differs, STOP: show the command and its output, and ask the human. Do not invent a repair. `ExperimentalWarning` lines on stderr are not failures.
4. Before you send a command, replace each `$NAME` from the fill-in block with its value. Lower-case variables, such as `$node_arch` or `$token`, belong to the block; leave them. `root$` runs `ssh $ADMIN_SSH bash -ls <<'EOF'`, then `set -euo pipefail`, the commands, and `EOF`, so a failed line stops the block. `worker$` runs the same through `ssh $SEAT_HOST`. Run each Check in its own call without `set -e`. Each call starts in the home directory.
5. A word in capitals inside a HUMAN command, such as `TOPIC` or `PEM_FILE`, is a value that the human types. Never put `<…>` in a command that the human types: the shell reads `<` as a redirect.
6. Identify the seat by `PUBLIC_IP` and its Tailscale address, never by its hostname. A provider can name the VPS `ubuntu-s-…`, the same style as other servers.
7. Public inbound: port 22 only, for break-glass SSH with `BREAK_GLASS_KEY`. Admin and worker SSH run over the tailnet only. Tailnet inbound: allowed. Never run `tailscale up --ssh` (this guide uses OpenSSH keys on the tailnet), `tailscale funnel`, an unattended reboot, or Docker `-p` without `127.0.0.1:`.
8. Run `limen init` only in `PROJECT_DIR`. Never run it in a tool folder such as `~/.nvm`.
9. Do not push, and do not merge into `main`, in any repository. Only the human does that, after the human says "land".
10. Never run `limen github poll`. Never enable `limen-github.timer` while `limen github doctor` shows a `FIX` other than the timer row.

## 0 · Laptop ready

- **HUMAN · laptop:** the laptop has `ssh`, `curl`, Tailscale, Herdr 0.9.3, and Limen ([setup](../setup.md)). Limen runs on the Mac and, from phase 4 on, on the seat too.
- **HUMAN · laptop:** three different key pairs exist at `ADMIN_KEY`, `BREAK_GLASS_KEY`, and `WORKER_KEY`, each with its `.pub` file. To make a missing pair: `ssh-keygen -t ed25519 -f $ADMIN_KEY` (and the same for the other two paths).
- **HUMAN · phone:** Tailscale and Moshi (or the ntfy app).
- **Check:** mac$ `herdr --version` prints `herdr 0.9.3`; `command -v limen` prints a path; `ssh-keygen -lf $ADMIN_KEY.pub; ssh-keygen -lf $BREAK_GLASS_KEY.pub; ssh-keygen -lf $WORKER_KEY.pub` prints three different `SHA256:` fingerprints; `test -f $ADMIN_KEY && test -f $BREAK_GLASS_KEY && test -f $WORKER_KEY` exits 0. **STOP** if not.

## 1 · CPU, box, and break-glass SSH

- **HUMAN:** create an Ubuntu LTS VPS, x86_64 or arm64, with 8 GB RAM, 150 GB disk or more, 2+ vCPU, and the `BREAK_GLASS_KEY` public key. Write down its public IPv4 as `PUBLIC_IP`. The provider hostname does not matter (rule 6).
- **HUMAN · laptop:** add `Host $BREAK_GLASS_SSH` to `~/.ssh/config`: `HostName $PUBLIC_IP`, `User root`, `IdentityFile $BREAK_GLASS_KEY`, `IdentitiesOnly yes`.
- **Check, before any download:** mac$ `ssh -o StrictHostKeyChecking=accept-new $BREAK_GLASS_SSH uname -m` prints `x86_64` or `aarch64`. **STOP** on any other value. Each later download picks its file from this value. Until phase 2 ends, `root$` runs through `$BREAK_GLASS_SSH`.
- root$ `printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/00-limen.conf && sshd -t && systemctl reload ssh && printf 'Unattended-Upgrade::Automatic-Reboot "false";\n' > /etc/apt/apt.conf.d/51-no-auto-reboot`
- root$ `ufw allow OpenSSH && ufw --force enable && apt-get update && apt-get install -y git gh acl mosh python3` (apt checks the signed Ubuntu archive and picks the CPU type).
- **Check:** root$ `sshd -T | grep -E '^(port|passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '` shows `port 22`, both authentications `no`, and `permitrootlogin without-password`; `ufw status verbose` shows `Status: active`, `Default: deny (incoming)`, and only `22/tcp (OpenSSH)` rules. **STOP** if not.

## 2 · Tailscale and admin SSH

- root$ `curl -fsSL https://tailscale.com/install.sh | sh` (the script adds the signed Tailscale apt repository; apt picks the CPU type).
- **HUMAN · laptop:** `ssh -t $BREAK_GLASS_SSH tailscale up --hostname=$SEAT_NAME`. Open the URL that it prints and approve the node. The command returns after the approval. `--hostname` sets the tailnet name only; the Linux hostname can stay as the provider set it.
- root$ `ufw allow in on tailscale0 && tailscale ip -4 && tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'`. Write the last line into `SEAT_HOST`.
- mac$ `{ printf 'from="100.64.0.0/10,fd7a:115c:a1e0::/48" '; cat $ADMIN_KEY.pub; } | ssh $BREAK_GLASS_SSH 'cat >> /root/.ssh/authorized_keys'`. With the `from=` prefix, sshd accepts `ADMIN_KEY` only from tailnet addresses ([100.x](https://tailscale.com/kb/1015/100.x-addresses), [IPv6](https://tailscale.com/kb/1033/ip-and-dns-addresses)).
- **HUMAN · laptop:** add two hosts to `~/.ssh/config`. `Host $ADMIN_SSH`: `HostName $SEAT_HOST`, `User root`, `IdentityFile $ADMIN_KEY`, `IdentitiesOnly yes`. `Host $SEAT_HOST`: `User $WORKER`, `IdentityFile $WORKER_KEY`, `IdentitiesOnly yes`.
- **Check:** mac$ `tailscale status | grep -w $SEAT_NAME` shows the same `100.` address that root$ `tailscale ip -4` printed. mac$ `ssh -o StrictHostKeyChecking=accept-new $ADMIN_SSH 'echo ${SSH_CONNECTION%% *}'` prints an address that starts with `100.` or `fd7a:115c:a1e0:`; `ssh -o HostName=$PUBLIC_IP $ADMIN_SSH true` exits 255 with `Permission denied (publickey)`. root$ `tailscale status` lists the laptop and the phone; `ufw status verbose` shows `Default: deny (incoming)` and only `22/tcp (OpenSSH)`, `Anywhere on tailscale0`, and their `(v6)` rules. **STOP** if any differs.
- From now on, `root$` runs through `$ADMIN_SSH`. Admin SSH runs over Tailscale only. `$BREAK_GLASS_SSH` is break-glass: use it only when Tailscale is down.

## 3 · Worker without sudo

- root$ `adduser --disabled-password --gecos "" $WORKER && install -d -o $WORKER -g $WORKER -m 700 /home/$WORKER/.ssh && loginctl enable-linger $WORKER`
- mac$ `ssh $ADMIN_SSH "cat > /home/$WORKER/.ssh/authorized_keys && chown $WORKER:$WORKER /home/$WORKER/.ssh/authorized_keys && chmod 600 /home/$WORKER/.ssh/authorized_keys" < $WORKER_KEY.pub`
- root$ `printf 'AllowUsers root %s@100.64.0.0/10 %s@fd7a:115c:a1e0::/48\n' $WORKER $WORKER >> /etc/ssh/sshd_config.d/00-limen.conf && sshd -t && systemctl reload ssh`. The worker logs in over the tailnet only, even with a key that a job adds. Root keeps the public break-glass login.
- **Check:** root$ `id -nG $WORKER` has no `sudo`, `wheel`, or `admin`; `sudo -l -U $WORKER` says `not allowed`; `grep -rl $WORKER /etc/sudoers /etc/sudoers.d` prints nothing; `loginctl show-user $WORKER -p Linger` is `Linger=yes`. mac$ `ssh -o StrictHostKeyChecking=accept-new $SEAT_HOST true` exits 0; `ssh -o IdentitiesOnly=yes -i $WORKER_KEY $WORKER@$PUBLIC_IP true` exits 255 with `Permission denied (publickey)`. **STOP** if any differs.

## 4 · Tools and logins

- root$ one root-owned Limen release, for the worker now and the poller later. Never `npm link` a worker clone. `git clone $LIMEN_REPO /opt/limen && git -C /opt/limen checkout --detach $LIMEN_REV && chown -R root:root /opt/limen && chmod -R go-w /opt/limen && ln -sfnT /opt/limen/bin/limen /usr/local/bin/limen`
- root$ stage and install root-owned Node 24.21.0 and Herdr 0.9.3. The `case` picks the file and checksum for this CPU. Each checksum is checked before the file runs. Do not install pi as root.
```sh
case $(uname -m) in
  x86_64)  node_arch=x64 herdr_arch=x86_64
           node_sha=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
           herdr_sha=18a8dc65f1c2fa485884344356dea1cfd911c6f06cf46fa78e193f4087f4dba7 ;;
  aarch64) node_arch=arm64 herdr_arch=aarch64
           node_sha=6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2
           herdr_sha=4de7aa3e25678812e92960de64f7c2aaa1bca1f0f80a3c5e559837e231e1f5c0 ;;
  *) echo "unsupported CPU $(uname -m)" >&2; exit 1 ;;
esac
install -d -o root -g root -m 0700 /root/install
curl -fsSL https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-$node_arch.tar.xz -o /root/install/node.tar.xz
echo "$node_sha  /root/install/node.tar.xz" | sha256sum -c -
tar -xJf /root/install/node.tar.xz -C /root/install --strip-components=2 node-v24.21.0-linux-$node_arch/bin/node
curl -fsSL https://github.com/herdrdev/herdr/releases/download/v0.9.3/herdr-linux-$herdr_arch -o /root/install/herdr
echo "$herdr_sha  /root/install/herdr" | sha256sum -c -
chown root:root /root/install/node /root/install/herdr
chmod 0755 /root/install/node /root/install/herdr
install -o root -g root -m 0755 /root/install/node /usr/bin/node
install -o root -g root -m 0755 /root/install/node /usr/local/bin/node
install -o root -g root -m 0755 /root/install/herdr /usr/local/bin/herdr
```
- Checksum sources: Node [SHASUMS256.txt](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt); Herdr, the `sha256:` digest of each asset on the [Herdr v0.9.3](https://github.com/herdrdev/herdr/releases/tag/v0.9.3) release page. **STOP** if a `sha256sum -c` line does not end in `OK`.
- worker$ install worker-owned pi 1.4.0 into `~/.local/share/pi`, linked from `~/.local/bin/pi` (no sudo). Checksum before it runs. Never install a root-owned `/usr/local/bin/pi`.
```sh
case $(uname -m) in
  x86_64)  pi_arch=x64   pi_sha=f2e4e4329603223d03260cdb8bd5033dbdc1f73ba58ab8939db2e56546e115d2 ;;
  aarch64) pi_arch=arm64 pi_sha=fa5829c7ef83ffeaebba015715c8306220f89b2aa8a00154efbba98dd5440156 ;;
  *) echo "unsupported CPU $(uname -m)" >&2; exit 1 ;;
esac
mkdir -p ~/.local/bin ~/.local/share
curl -fsSL https://github.com/earendil-works/pi/releases/download/v1.4.0/pi-linux-$pi_arch.tar.gz -o ~/.local/share/pi.tar.gz
echo "$pi_sha  $HOME/.local/share/pi.tar.gz" | sha256sum -c -
rm -rf ~/.local/share/pi && tar -xzf ~/.local/share/pi.tar.gz -C ~/.local/share && rm ~/.local/share/pi.tar.gz
ln -sfn ../share/pi/pi ~/.local/bin/pi
grep -qF '.local/bin' ~/.bashrc 2>/dev/null || printf '\n[ -d "$HOME/.local/bin" ] && PATH="$HOME/.local/bin:$PATH"\n' >> ~/.bashrc
```
- Checksum source: pi [SHA256SUMS](https://github.com/earendil-works/pi/releases/download/v1.4.0/SHA256SUMS) (same digests as the [v1.4.0](https://github.com/earendil-works/pi/releases/tag/v1.4.0) asset list). **STOP** if a `sha256sum -c` line does not end in `OK`.
- **HUMAN · laptop** (not from another server): `ssh -t $SEAT_HOST`. In that seat shell, run `gh auth login --hostname github.com --git-protocol https --web`, then `gh auth setup-git`, then `pi` and log in to the model provider.
- **Why HTTPS:** Git over SSH on the seat needs a seat key. A key with a passphrase blocks every batch `git` call, and a key without one is a new secret on the seat. HTTPS with the `gh` credential helper needs neither.
- **Check:** worker$ `node -v` is `v24.21.0`; `command -v limen` is `/usr/local/bin/limen`; `git -C /opt/limen -c safe.directory=/opt/limen rev-parse HEAD` is `LIMEN_REV`; `test -f /opt/limen/docs/seat/agent-setup.md` exits 0; `herdr --version` is `herdr 0.9.3`; `command -v pi` is `$HOME/.local/bin/pi`; `pi --version` is `1.4.0`; `test ! -e /usr/local/bin/pi` exits 0; `gh auth status` exits 0; `gh config get git_protocol -h github.com` is `https`. **STOP** on any mismatch.

## 5 · Project and `limen init`

`limen init` registers the Git top-level folder of the current directory in `~/.limen/projects` (`src/commands/init.ts:25-26,64`). In a tool folder that is a Git clone, it registers a junk project.

- worker$ `gh repo clone $PROJECT_REPO $PROJECT_DIR -- --branch $PROJECT_BRANCH && cd $PROJECT_DIR && test "$(git rev-parse --show-toplevel)" = $PROJECT_DIR && limen init`
- If the clone asks for a passphrase or fails with `Permission denied (publickey)`, Git uses SSH. Run worker$ `gh config set git_protocol https -h github.com && rm -rf $PROJECT_DIR`, then clone again. Do not add a seat SSH key for this.
- **Check:** worker$ `git -C $PROJECT_DIR remote get-url origin` starts with `https://github.com/`; `git -C $PROJECT_DIR branch --show-current` is `PROJECT_BRANCH`; `cat ~/.limen/projects` prints `PROJECT_DIR` and no other line (on a seat with older projects: only roots that the HUMAN names); `test -d $PROJECT_DIR/.limen/jobs` exits 0. **STOP** if not.
- Fix, only with HUMAN approval, for a junk line such as `/home/$WORKER/.nvm`: worker$ `grep -vFx /home/$WORKER/.nvm ~/.limen/projects > ~/.limen/projects.new; cat ~/.limen/projects.new > ~/.limen/projects; rm ~/.limen/projects.new` (`cat >` keeps the file and the poller's read ACL). If the doorbell already runs on this seat, run the first phase 14 Check (`cd $PROJECT_DIR && limen github doctor && limen github status`) again after this. `limen init` in a new project replaces the list file and drops that ACL (`src/project/seat.ts:15-20`); with the doorbell, run the phase 12 block again after it.
- worker$ `cd $PROJECT_DIR && git status --short`. Show it to the HUMAN: `limen init` adds `spec/`, `.agents/limen/`, `.pi/extensions/limen.ts`, and a `.gitignore` line. The HUMAN decides whether to commit them. Do not push. Jobs branch from the last commit.

Each checkout where `limen init` runs is its own plant, with its own `.limen/` job files. A plant can live on the Mac, on the seat, or on both. Never copy `.limen/` between machines. A job is visible only on the machine that started it. Only a seat plant gets GitHub doorbell wakes.

## 6 · Phone bell

Moshi has two separate features. **Host setup** (Easy Pair) gives the phone SSH access to the seat. **Agent hooks** ring the phone when an agent needs you. This phase sets up agent hooks only. The hook token is not an SSH key.

- Moshi: root$ install `moshi-hook` 0.3.19 for this CPU. Checksum source: [checksums.txt](https://cdn.getmoshi.app/hook/v0.3.19/checksums.txt).
```sh
case $(uname -m) in
  x86_64)  moshi_arch=x86_64 moshi_sha=c94ce3de5b8e7b6d1b9f12d501a95db047f01bf32b6b837e29a4229267ee79d4 ;;
  aarch64) moshi_arch=arm64  moshi_sha=12c06299a4770f0ad8125e95cd49cc6f712d18ae12308af9d2250859b67a7b8e ;;
  *) echo "unsupported CPU $(uname -m)" >&2; exit 1 ;;
esac
curl -fsSL https://cdn.getmoshi.app/hook/v0.3.19/moshi-hook_Linux_$moshi_arch.tar.gz -o /root/install/moshi.tgz
echo "$moshi_sha  /root/install/moshi.tgz" | sha256sum -c -
tar -xzf /root/install/moshi.tgz -C /usr/local/bin moshi-hook
chown root:root /usr/local/bin/moshi-hook && chmod 0755 /usr/local/bin/moshi-hook
```
- worker$ `moshi-hook install --target pi && moshi-hook service install`
- **HUMAN · phone:** in Moshi, open Settings → **Hooks** (Agent Hooks), not Integrations, and copy the pairing token.
- **HUMAN · laptop:** pair on the seat, not in the Mac Keychain. The command asks for the token and does not echo it: `ssh -t $SEAT_HOST 'read -rsp "Moshi token: " token; echo; moshi-hook pair --store file --name $SEAT_NAME --token "$token"'`
- **Check:** worker$ `moshi-hook status` says paired and the daemon runs. **STOP** on `unpaired`. This proves the pairing only.
- ntfy instead: the HUMAN subscribes the phone to a long random topic, then runs mac$ `curl -d test https://ntfy.sh/TOPIC`; the phone must buzz. root$ `install -m 0644 /opt/limen/docs/seat/limen-bell.service /opt/limen/docs/seat/limen-bell.timer /etc/systemd/system/ && install -d /etc/systemd/system/limen-bell.service.d && printf '[Service]\nUser=%s\nEnvironment=LIMEN_ROOT=%s\nExecStart=\nExecStart=/opt/limen/docs/seat/bell.sh\n' $WORKER $PROJECT_DIR > /etc/systemd/system/limen-bell.service.d/override.conf`. **HUMAN**, as root in their own terminal: add `Environment=NTFY_TOPIC=TOPIC` to that file. root$ `systemctl daemon-reload && systemctl enable --now limen-bell.timer`. **Check:** root$ `systemctl is-active limen-bell.timer` is `active`. **STOP** if not.

## 7 · Herdr coordinator

- worker$ `herdr integration install pi`. **STOP** if it exits non-zero.
- **HUMAN · laptop:** `herdr --remote $WORKER@$SEAT_HOST`. Open a tab, `cd $PROJECT_DIR`, then pane$ `export LIMEN_COORDINATOR=1 && pi $MODEL_FLAGS`. Ask the coordinator to run `echo $HERDR_ENV $LIMEN_COORDINATOR $HERDR_PANE_ID`.
- **Check:** the human reports `1 1` and a pane id. The human detaches and attaches again: the same tab is there. **STOP** if not.
- Live coordinator rule (used by the doorbell in phases 12–14): Herdr reports the pane with `agent_status` idle, working, blocked, or done. Herdr can leave out `interactive_ready`. Limen counts the field as live when it is `true` or absent; only `interactive_ready: false` is not live.

## 8 · Prune timer

- root$ (`limen prune` drops finished job worktrees; the unit runs it daily as `WORKER`)
```sh
install -m 0644 /opt/limen/docs/seat/limen-prune.service /opt/limen/docs/seat/limen-prune.timer /etc/systemd/system/
install -d /etc/systemd/system/limen-prune.service.d
printf '[Service]\nUser=%s\nWorkingDirectory=%s\nEnvironment=PATH=/usr/local/bin:/usr/bin:/bin\n' $WORKER $PROJECT_DIR > /etc/systemd/system/limen-prune.service.d/override.conf
systemctl daemon-reload && systemctl enable --now limen-prune.timer && systemctl start limen-prune.service
```
- **Check:** root$ `systemctl show -p Result limen-prune.service` is `Result=success`; `systemctl is-active limen-prune.timer` is `active`. **STOP** if not.

## 9 · Preview

- worker$ `nohup timeout 600 python3 -m http.server 3000 --bind 127.0.0.1 --directory "$(mktemp -d)" >/dev/null 2>&1 &` (a stand-in app that serves an empty folder and stops after 10 minutes).
- root$ `tailscale serve --bg 3000`.
- **HUMAN gate (once per tailnet):** if that command prints a `https://login.tailscale.com/…` URL to enable Serve or HTTPS, it does not serve yet. The HUMAN opens the URL on the laptop, enables the feature, and says done. Then the agent runs `tailscale serve --bg 3000` again. **STOP** until the human says done. Never use `tailscale funnel` to get past this.
- **Check:** root$ `tailscale serve status` shows one `https://…` URL marked `(tailnet only)` that proxies to `http://127.0.0.1:3000`. mac$ `curl -fsS URL` exits 0, with the URL exactly as printed. mac$ `curl -m 5 http://$PUBLIC_IP:3000/` fails. **STOP** if the public call answers or the status names Funnel.
- root$ `tailscale serve reset` (a new seat has no other routes to keep).

## 10 · Lid-closed proof and lock-down

- **HUMAN:** pane$ ask the coordinator to run `limen spawn --detached --engine pi $MODEL_FLAGS --label seat-smoke "Print seat-smoke and finish. Change no files."`. Then close the laptop lid for five minutes.
- **Check:** worker$ `cd $PROJECT_DIR && limen jobs seat-smoke` starts with `DONE` (`produced nothing` is fine here). mac$ `herdr --remote $WORKER@$SEAT_HOST` shows the same coordinator tab. **STOP** if not.
- Prove later, not a gate: the Moshi phone ring. Ask the human if the phone rang, and write the answer in your report. A silent phone does not stop setup. Jobs start with `--no-extensions` (`src/runtime/engine.ts:109`), so only the coordinator's turn after the completion wake can ring Moshi.
- **Check (lock-down end state):** mac$ `ssh $ADMIN_SSH 'echo ${SSH_CONNECTION%% *}'` prints a `100.` or `fd7a:115c:a1e0:` address; `ssh -o HostName=$PUBLIC_IP $ADMIN_SSH true` and `ssh -o IdentitiesOnly=yes -i $WORKER_KEY $WORKER@$PUBLIC_IP true` both exit 255 with `Permission denied (publickey)`; `ssh $BREAK_GLASS_SSH true` exits 0, so break-glass still works. **STOP** if any differs.

The seat is ready after this phase. **HUMAN:** decide whether this project uses the opt-in GitHub doorbell (phases 11–14): a PR or issue comment with `@limen` or `/limen` from a writer wakes the coordinator. If not, setup ends here.

## 11 · GitHub App (HUMAN)

- **HUMAN:** under the account that owns `PROJECT_REPO`: Settings → Developer settings → GitHub Apps → New GitHub App. Name: any unique name. Homepage URL: `https://github.com/$PROJECT_REPO`. Webhook: clear **Active**. Repository permissions: Metadata **Read-only**, Issues **Read & write**, Pull requests **Read-only**; all others **No access**. Where can this GitHub App be installed: **Only on this account**.
- **HUMAN:** give the agent the App ID for `APP_ID`. Generate a private key. Install the App with **Only select repositories** → `PROJECT_REPO`. One App and one key per seat.
- If GitHub shows an **Authorize** page, its scopes come from the App permissions above. You cannot change them on that page. Click **Authorize**. To change a permission, edit the App settings.
- **MUST: the App is installed on `PROJECT_REPO` before connect, doctor, or any `@limen` test.** Without the install, the poller fails with **HTTP 404** on `GET /repos/$PROJECT_REPO/installation`, and no `@limen` comment reaches the coordinator.
- **Doctor green is not proof.** `limen github doctor` checks the seat, not GitHub. It can pass while the App is not installed on the repository.
- **Check:** HUMAN · laptop, browser: `https://github.com/$PROJECT_REPO/settings/installations` lists this App. **STOP** if not: install it, as in the last step.
- **HUMAN · laptop:** copy the key to the seat. Type the real path of the downloaded file in place of `PEM_FILE`: `ssh $ADMIN_SSH "umask 077; cat > $PEM_SOURCE" < PEM_FILE`
- **Check:** root$ `stat -c '%U %a' $PEM_SOURCE` is `root 600`. Never read the file. **STOP** if not. Then the HUMAN deletes the laptop copy. Keep `PEM_SOURCE`: every setup run reads it.

## 12 · Doorbell install and connect

- root$ (a root-owned installer checkout at the same revision, then the installer)
```sh
test -d /root/limen-deploy/.git || git clone $LIMEN_REPO /root/limen-deploy
git -C /root/limen-deploy fetch origin $LIMEN_REV && git -C /root/limen-deploy checkout --detach $LIMEN_REV
WORKER=$WORKER APP_ID=$APP_ID PEM_SOURCE=$PEM_SOURCE LIMEN_REPO=$LIMEN_REPO LIMEN_REV=$LIMEN_REV \
  NODE_SOURCE=/root/install/node HERDR_SOURCE=/root/install/herdr /root/limen-deploy/docs/seat/github-setup.sh
```
- **Check:** it exits 0 and prints a line that starts `Setup installed`; root$ `systemctl is-enabled limen-github.timer` prints `disabled` (setup runs `systemctl disable --now limen-github.timer`, so a reboot cannot start polling before phase 13 enables it); worker$ `test ! -r /etc/limen-github/app.pem` exits 0. **STOP** if not, and show the script's message.
- **Check:** worker$ `cd $PROJECT_DIR && limen jobs --running` prints `no running jobs` or `no jobs`. **STOP** if it lists a job: wait until the jobs finish.
- The installer added `WORKER` to the `limen-github` group. A process that started before that keeps its old groups. This includes the Herdr server and the user manager that linger keeps alive.
- worker$ `herdr server stop`. This closes every pane.
- **Check:** worker$ `id -nG` (a new SSH login) lists `limen-github`. **STOP** if not: the installer did not add the group.
- **HUMAN · laptop:** `herdr --remote $WORKER@$SEAT_HOST`, open a tab, `cd $PROJECT_DIR`, pane$ `export LIMEN_COORDINATOR=1 && pi $MODEL_FLAGS`. Ask the coordinator to run `id -nG`.
- If the pane's `id -nG` does not list `limen-github`, the Herdr server started from the old user manager. root$ `systemctl restart user@$(id -u $WORKER).service` (this also restarts the worker's user services, such as `moshi-hook`). Then the HUMAN attaches again and starts the coordinator again, as in the last step.
- **HUMAN:** pane$ ask the coordinator to run `id -nG`, then `limen github connect`.
- **Check:** `id -nG` lists `limen-github`; connect prints a line that starts `connected $PROJECT_REPO → Herdr`. **STOP** if not.

## 13 · Doctor, then the timer

- **Check:** worker$ `cd $PROJECT_DIR && limen github doctor` exits 1; this is expected here. The only `FIX` line starts `FIX enabled active GitHub timer`; stderr ends with `github doctor: 1 prerequisite need repair`; `SKIP` lines are fine. **STOP** on any other `FIX`. Doctor also checks every other project bound on this seat; a closed coordinator there is a `FIX` too.
- If the `live registered Herdr agent` row is a `FIX`: worker$ `herdr agent get PANE` with the pane id from the connect line. The coordinator is live when the pane matches, `agent_status` is idle, working, blocked, or done, and `interactive_ready` is `true` or absent (phase 7). If the field is `false` or the status is different, the HUMAN attaches, restarts the coordinator in that pane, and runs `limen github connect` again.
- root$ `systemctl enable --now limen-github.timer`
- **Check:** root$ `systemctl is-enabled limen-github.timer` is `enabled`; `systemctl is-active limen-github.timer` is `active`. **STOP** if not.
- **Check (App install, after one poll):** wait 2 minutes. root$ `journalctl -u limen-github.service --since -3min --no-pager | grep -i 'installation\|404'` prints nothing. **STOP** if it prints `HTTP 404`: the App is not installed on `PROJECT_REPO` (phase 11 MUST). Doctor can stay green here.

## 14 · Doctor again and live trial

- **Check:** worker$ `cd $PROJECT_DIR && limen github doctor && limen github status` exits 0, doctor prints no `FIX`, and status prints `$PROJECT_REPO → Herdr` and the pane id. If not: root$ `systemctl disable --now limen-github.timer`, then **STOP**.
- **HUMAN:** on an open PR in `PROJECT_REPO`, in the **Conversation** tab (not a review or a line comment), comment `@limen please review this PR`. If no PR is open, the HUMAN opens one first.
- **Check:** in about two minutes the coordinator pane gets the request; worker$ `cd $PROJECT_DIR && limen github status` names that PR; root$ `journalctl -u limen-github.service -n 50 --no-pager` shows no error. An `installation` **HTTP 404** means the App is not installed on `PROJECT_REPO` (phase 11 MUST). If not: root$ `systemctl disable --now limen-github.timer`, then **STOP**.

## Upgrade

1. With the doorbell: root$ the phase 12 block with the new `LIMEN_REV`. It disables and stops the timer, moves `/opt/limen`, and keeps the CLI and the poller on one release. Without the doorbell: root$ `git -C /opt/limen fetch origin $LIMEN_REV && git -C /opt/limen checkout --detach $LIMEN_REV && chmod -R go-w /opt/limen`.
2. **HUMAN:** restart the coordinator in its pane, so that it loads the new release. Then run the phase 4 Check; **STOP** on any mismatch. With the doorbell, then run phases 13 and 14.
3. New pinned versions: take the hash for both CPU types from the vendor source that phase 4 or phase 6 names. Never compute a hash yourself.
