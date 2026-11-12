#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
dry_run=false
if [[ ${1:-} == --dry-run && $# -eq 1 ]]; then
  dry_run=true
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--dry-run]" >&2
  exit 2
fi

packages=()
for path in "$repo_dir"/dotfiles/*; do
  [[ -d $path ]] || continue
  package=${path##*/}
  [[ $package == bashrc ]] && continue
  [[ -n $(find "$path" -type f -print -quit) ]] || continue
  packages+=("$package")
done

((${#packages[@]})) || { echo "No Stow packages found."; exit 0; }
if ! command -v stow >/dev/null; then
  if $dry_run; then
    echo "GNU Stow is not installed; setup will install it before deployment."
    exit 0
  fi
  echo "GNU Stow is required; run ./scripts/setup.sh first." >&2
  exit 1
fi

args=()
$dry_run && args+=(--dry-run)
python3 "$repo_dir/scripts/configs/deploy-stow.py" "${args[@]}" "${packages[@]}"
