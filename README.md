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

To recover a backup, inspect its matching relative path, remove only the
corresponding deployed symlink, then move the backed-up file into its place.
Do not restore an entire config directory over a running application's state.

Test deployment with `python3 scripts/tests/stow.py`.
