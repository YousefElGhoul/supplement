# Supplement

```bash
./scripts/setup.sh [--dry-run] [--no-pkg]
```

Full setup updates the system, installs selected apps, deploys configs, then
removes unwanted packages. `--no-pkg` skips package and plugin operations.

Run `./scripts/stow.sh [--dry-run]` to deploy just the dotfiles. It discovers all
packages, backs up conflicting files/directories/symlinks without following them,
uses GNU Stow and verifies every managed symlink. Most packages use
`--no-folding` for new links; existing valid directory links are kept untouched
to avoid gaps in watched configurations. Herdr's entire config root is linked as
one unit: both JavaScript modules and SVG assets must stay inside its canonical
application directory. Backups go
to `${XDG_STATE_HOME:-~/.local/state}/supplement/backups/stow-*`, with a unique
directory per run; old `.bak` files are left alone. Dry runs change no targets
and report planned backups (Stow simulation runs when no backups are needed).
Python 3 and GNU Stow are required.

OpenCode uses `cli.json` for terminal settings and `opencode.jsonc` for server
settings. Deployment backs up and retires legacy `tui.json(c)` and duplicate
`cli.jsonc` files. Herdr's integration source is included because `cli.json`
loads its `herdr-opencode` entrypoint. Credentials (`*.env`), `service.json`,
dependencies and runtime state are not deployed.

Herdr's tracked package includes personal settings/keys, the Ghoul layout,
Catppuccin Mocha palette, and the GitHub/Git/Lazygit/Markdown mods it needs. Upstream
notices/recipes are under `third-party/herdr/`. Install Herdr separately.
Close its window before the first root-link migration; core terminals can keep
running. Deployment preserves shipped defaults (including Win98) and runtime
state in the linked root, and backs up the original config directory. Defaults,
generated files, sockets, caches and runtime state are Git-ignored; only an
explicit customization allowlist is tracked. Subsequent deployments leave the
root link untouched. Herdr recreates its shipped files on a fresh installation.
The first migration also archives the unused Catppuccin/GitHub/Lazygit layouts,
Catppuccin mods, extra palettes and redundant `tabs-github` mod under the same
backup's `retired-customizations/` directory; shipped defaults are not removed.
Lazygit can rewrite `layouts/ghoul.json` with a live terminal address via
`layout.set`; review that file before committing and use the hidden `none`
placeholder instead of backing up a machine-specific terminal address.
Herdr/OpenCode may save settings atomically, replacing a symlink:
capture intentional live edits in the repository before redeploying, otherwise
deployment backs them up and restores the repository version.

To recover a backup, inspect its matching relative path, remove only the
corresponding deployed symlink, then move the backed-up file into its place.
Do not restore an entire config directory over a running application's state.

Test deployment with `python3 scripts/tests/stow.py`.

Ghoul's **Markdown** button opens the Kanso Markdown mod in the existing right
panel, without installing the Kanso layout or changing Mocha. Double-click a
block to edit; Ctrl+Shift+M (Cmd+Shift+M on macOS) toggles this same dock, not a
second window. Changes autosave with disk-conflict checks. Remote files are read
only. Close/Escape hides the panel after saving. The mod reads the focused
terminal/clipboard for recent Markdown paths and runs local file-listing helpers.
The optional `mods/markdown-panel/md-review` command also targets Ghoul's panel;
it is not added to PATH automatically. The macOS file-handler installer is
included upstream code only and is never run by deployment.

Test Markdown with `node --experimental-vm-modules --test scripts/tests/markdown-panel.test.mjs`.
