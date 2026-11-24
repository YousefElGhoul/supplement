#!/usr/bin/env bash
# Install the headless agent without modifying the active checkout or its state.
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
upstream=https://github.com/Javis603/token-monitor.git
revision=084e143a7acd00d088b8ba7ee6c7b115fef8ec5d
install_dir=${XDG_DATA_HOME:-$HOME/.local/share}/supplement/token-monitor
dry_run=false
update=false
while (($#)); do
  case "$1" in
  --dry-run) dry_run=true ;;
  --update) update=true ;;
  *) echo "Usage: $0 [--dry-run] [--update]" >&2; exit 2 ;;
  esac
  shift
done

if $dry_run; then
  echo "[dry-run] Stow token-monitor and install its headless agent in $install_dir using mise"
  if $update; then
    echo '[dry-run] Check upstream main and restart the service only if active and updated'
  fi
  exit 0
fi

install_dir=$(realpath -m -- "$install_dir")
case "$install_dir/" in
  "$repo_dir/"*) echo "Token Monitor must be installed outside $repo_dir" >&2; exit 1 ;;
esac
umask 077
mkdir -p -- "$install_dir"
exec 9<"$install_dir"
flock -x 9

current=$install_dir/current
installed=
if [[ -e $current || -L $current ]]; then
  if [[ ! -L $current || $(realpath -m -- "$current") != "$install_dir"/release.* ||
    ! -d $current/.git || ! -f $current/src/agent/agent.js ]]; then
    echo "Refusing to replace an unrecognized installation: $current" >&2
    exit 1
  fi
  installed=$(git -C "$current" rev-parse HEAD)
fi
if $update; then
  remote=$(git ls-remote --exit-code "$upstream" refs/heads/main)
  revision=${remote%%$'\t'*}
else
  revision=${installed:-$revision}
fi

stow -d "$repo_dir/dotfiles" -t "$HOME" --no-folding token-monitor

if [[ $installed != "$revision" ]]; then
  candidate=$(mktemp -d "$install_dir/release.XXXXXXXX")
  trap 'if [[ ! $current -ef $candidate ]]; then rm -rf -- "$candidate" "$candidate.next"; fi' EXIT
  git clone --quiet --depth 1 --revision "$revision" "$upstream" "$candidate"
  (
    cd -- "$candidate"
    mise x node npm -- npm ci --omit=dev --include=optional --no-audit --no-fund --engine-strict
    mise x node -- node scripts/ensure-vendored-tokscale.js
  )
  # Publish only a prepared checkout. The running agent can still use the previous one.
  ln -s -- "${candidate##*/}" "$candidate.next"
  mv -Tf -- "$candidate.next" "$current"
fi

if systemctl --user show-environment >/dev/null 2>&1; then
  systemctl --user daemon-reload
  if [[ -n $installed && $installed != "$revision" ]]; then
    systemctl --user try-restart token-monitor.service
  fi
else
  echo 'No systemd user manager; run systemctl --user daemon-reload from your login session.'
fi
echo "Token Monitor headless agent ready: $current"
