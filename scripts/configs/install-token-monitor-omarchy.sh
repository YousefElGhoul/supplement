#!/usr/bin/env bash
set -euo pipefail

# Build a private clone from the installed Omarchy version, not a vendored
# copy of its UI. Refuse unknown upstream versions rather than reenable probes.
python3 - <<'PY'
import json
import os
from pathlib import Path
import re
import tempfile

source = Path("/usr/share/omarchy/shell/plugins/agents")
if not source.is_dir():
    raise SystemExit(0)
home = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "omarchy"
target = home / "plugins/ghoul.token-monitor-agents"
manifest = json.loads((source / "manifest.json").read_text())
if manifest["id"] != "omarchy.agents":
    raise SystemExit("Unrecognized Omarchy Agents manifest")
files = {}
for name in ("Main.qml", "Panel.qml", "Agent.qml"):
    body = (source / name).read_text()
    if name in ("Main.qml", "Panel.qml"):
        if body.count("omarchy-agent-usage-update") != (2 if name == "Main.qml" else 1):
            raise SystemExit(f"Unrecognized Omarchy Agents refresh paths in {name}")
        helper = str(Path.home() / ".local/bin/token-monitor-omarchy-update")
        if name == "Main.qml":
            body = body.replace('"omarchy-agent-usage-update"', json.dumps(helper))
            timer = 'onTriggered: root.runUpdate(root.nearLimit ? "limits" : "normal")'
            if timer not in body:
                raise SystemExit("Unrecognized Omarchy Agents refresh timer")
            body = body.replace(timer, timer.replace('"limits"', '"cached-limits"'))
            body = body.replace('if (kind === "limits") command.push("--limits-only")',
                                'if (kind === "limits" || kind === "cached-limits") command.push("--limits-only")\n'
                                '    if (kind === "cached-limits") command.push("--hub-only")')
            body = body.replace('if (kind === "force" || root.pendingUpdateKind === "")',
                                'if (kind === "force" || root.pendingUpdateKind === "" ||\n'
                                '          (kind === "limits" && root.pendingUpdateKind !== "force"))')
        else:
            body = body.replace("&& omarchy-agent-usage-update", '&& "$HOME/.local/bin/token-monitor-omarchy-update"')
    if name == "Panel.qml":
        body = body.replace('ipcTarget: "omarchy.agents"', 'ipcTarget: "ghoul.token-monitor-agents"')
        # Remove the starter section, including its separator and keyboard stops.
        for pattern in (
            r'^      if \(!blankSlate\) \{\n        var tiles = \[\]\n[^\n]*starterPrompts[^\n]*\n        rows.push\(tiles\)\n      \}\n',
            r'^  // A few ways into making Omarchy your own,.*?\n(?=  function renameAccount\b)',
            r'^    else if \(target.kind === "starter"\)[^\n]*\n',
            r'^          // ---------- Make something ----------\n.*?(?=^          Text \{)',
            r'^  // A starter: its glyph.*?(?=^  // The tinted square in the hero)',
        ):
            body = re.sub(pattern, "", body, flags=re.MULTILINE | re.DOTALL)
        if re.search(r'makeSomethingCool|starterPrompts|StarterTile|startPrompt|"starter"', body):
            raise SystemExit("Unrecognized Omarchy Agents starter section")
        body = body.replace(
            "  // header, its Sign-in required link or switchable accounts, and the starter\n"
            "  // tiles, or the agents to add while picking one. Up and down change rows, left and right move along one.",
            "  // header and its sign-in or account controls, or the agents to add while picking one.\n"
            "  // Up and down change rows; left and right move along one.",
        )
        # Hub account IDs are not Omarchy account registry IDs.
        for function, args in (("renameAccount", "p, account, label"),
                               ("useAccount", "p, account"), ("setSwitchMode", "p, mode")):
            signature = f"function {function}({args}) {{"
            if signature not in body:
                raise SystemExit(f"Unrecognized Omarchy account action: {function}")
            body = body.replace(signature, signature + '\n    if (p && (p.providerId === "claude" || p.providerId === "codex")) return')
    files[name] = body

def save(path, text):
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w", delete=False) as file:
        file.write(text)
    os.replace(file.name, path)

target.mkdir(parents=True, exist_ok=True)
assets = target / "assets"
if not assets.exists():
    assets.symlink_to(source / "assets", target_is_directory=True)
for name, body in files.items():
    save(target / name, body)
manifest["id"] = target.name
manifest["barWidget"]["aliases"] = []
save(target / "manifest.json", json.dumps(manifest, indent=2) + "\n")

layout = home / "shell.json"
if layout.is_file():
    # Swap only the widget ID; preserve the user's live layout and settings.
    body = layout.read_text()
    updated = re.sub(r'("id"\s*:\s*)"omarchy\.agents"', r'\1"ghoul.token-monitor-agents"', body)
    if updated != body:
        json.loads(updated)
        save(layout, updated)
PY
