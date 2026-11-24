# Token Monitor headless agent

Run these commands from the Supplement repository root:

```bash
./scripts/configs/install-token-monitor.sh
./scripts/configs/set-token-monitor-secret.sh
systemctl --user enable --now token-monitor.service
```

Use the Worker's existing shared secret at the prompt. The script doesn't echo
the secret or overwrite an existing file. It saves the secret with mode `0600`
at `~/.config/token-monitor/hub.secret`, which systemd loads as a service
credential. Don't put the secret in chat, shell arguments, or the repository.
To rotate it, edit that file locally, keep its permissions, and restart the
service.

`scripts/setup.sh` also installs the agent using mise-managed Node and npm.
`--dry-run` previews the agent install without writing files or contacting
upstream; `--no-pkg` deploys the Stow links but skips the agent download and
dependency install.

The [headless agent](https://github.com/Javis603/token-monitor/blob/main/docs/headless-agent.md)
sends usage to the existing [Cloudflare Worker](https://token-monitor-hub.yousefelghoul03.workers.dev).
It tracks Claude Code, Codex, OpenCode, and Hermes usage and archives their
history. Adaptive quota refresh uses available local sign-ins for Claude Code,
Codex, and supported OpenCode accounts (such as OpenCode Go). Hermes has no
upstream quota probe. Session titles are not synced.

The device ID defaults to the hostname. If hostnames collide, set a unique
`TOKEN_MONITOR_DEVICE_ID` in a `systemctl --user edit token-monitor.service`
drop-in and keep it stable. The agent uses the existing upstream Linux state
directory (`${XDG_CONFIG_HOME:-$HOME/.config}/Token Monitor`). Keep that directory
to preserve history and stop any previous collector scanning the same usage
before starting this one.

## Service management

```bash
~/.local/bin/token-monitor-agent --dry-run       # Preview usage without uploading
systemctl --user status token-monitor.service
journalctl --user -u token-monitor.service -f
systemctl --user restart token-monitor.service
systemctl --user disable --now token-monitor.service  # Stop without deleting history
```

## Updates

Fresh installs use a tested upstream revision; rerunning setup leaves the
installed revision alone. To check upstream and update explicitly:

```bash
./scripts/configs/install-token-monitor.sh --update
```

Updates prepare a new checkout and verify its pinned scanner before switching
`${XDG_DATA_HOME:-$HOME/.local/share}/supplement/token-monitor/current`.
Failed preparation leaves the running release in place. A successful update
restarts the service only if it was running. Previous checkouts, credentials,
and usage history are retained.
