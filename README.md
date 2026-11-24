# Supplement

Install everything:

```bash
./scripts/setup.sh [--dry-run] [--no-pkg]
```

Deploy only the dotfiles:

```bash
./scripts/stow.sh [--dry-run]
```

Install or update agent skills:

```bash
./scripts/configs/install-skills.sh
```

## Token Monitor

See the [headless agent setup and service guide](dotfiles/token-monitor/.local/share/doc/token-monitor/README.md).

## Tests

```bash
python3 scripts/tests/stow.py
python3 scripts/tests/token-monitor.py
node scripts/tests/indicator-hover.cjs
node scripts/tests/patch-nightlight.cjs
```
