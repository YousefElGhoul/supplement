#!/usr/bin/env bash
# Save the existing Worker secret without echoing it or replacing a credential.
set +x
set -euo pipefail

umask 077
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
file=$HOME/.config/token-monitor/hub.secret
if [[ -e $file || -L $file ]]; then
  printf 'Secret already exists; leaving it unchanged: %s\n' "$file" >&2
  exit 1
fi
case $(realpath -m -- "$file") in
  "$repo_dir"/*) echo 'Refusing to save the secret inside the repository.' >&2; exit 1 ;;
esac

if ! IFS= read -rsp 'Worker hub secret: ' secret || [[ ! $secret =~ [^[:space:]] ]]; then
  printf '\nNo secret saved: enter a nonblank secret.\n' >&2
  exit 1
fi
printf '\n' >&2

mkdir -p -- "${file%/*}"
set -o noclobber
printf '%s\n' "$secret" > "$file"
printf 'Saved the Token Monitor hub secret to %s\n' "$file"
