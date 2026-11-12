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

Test:

```bash
python3 scripts/tests/stow.py
node scripts/tests/indicator-hover.cjs
node scripts/tests/patch-nightlight.cjs
node --experimental-vm-modules --test scripts/tests/markdown-panel.test.mjs
```
