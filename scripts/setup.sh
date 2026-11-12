#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
dry_run=false
no_pkg=false

while (($#)); do
  case "$1" in
  --dry-run) dry_run=true ;;
  --no-pkg) no_pkg=true ;;
  *)
    echo "Usage: $0 [--dry-run] [--no-pkg]" >&2
    exit 2
    ;;
  esac
  shift
done

run() {
  if $dry_run; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

[[ -r /etc/arch-release ]] || {
  echo "This setup targets Arch Linux." >&2
  exit 1
}
command -v pacman >/dev/null || {
  echo "pacman is required." >&2
  exit 1
}

omarchy=false
[[ -d /usr/share/omarchy ]] && omarchy=true

sudo_keepalive_pid=
cleanup() {
  if [[ -n $sudo_keepalive_pid ]]; then
    kill "$sudo_keepalive_pid" 2>/dev/null || true
    wait "$sudo_keepalive_pid" 2>/dev/null || true
  fi
}
if ! $dry_run && { ! $no_pkg || $omarchy; }; then
  sudo -v
  (
    sleep_pid=
    trap '[[ -z $sleep_pid ]] || kill "$sleep_pid" 2>/dev/null || true' TERM
    while sudo -n -v; do
      sleep 60 &
      sleep_pid=$!
      wait "$sleep_pid"
      sleep_pid=
    done
  ) &
  sudo_keepalive_pid=$!
  trap cleanup EXIT
elif $dry_run && { ! $no_pkg || $omarchy; }; then
  run sudo -v
  echo '[dry-run] start sudo credential refresh loop'
fi

if ! $no_pkg; then
  run sudo pacman -Sy --noconfirm

  if $omarchy; then
    if $dry_run; then
      sed -n 's/^\(omarchy .\+\)$/[dry-run] \1/p' "$repo_dir/scripts/packages/omarchy.sh"
    else
      bash "$repo_dir/scripts/packages/omarchy.sh"
    fi
  fi

  if ! command -v stow >/dev/null; then
    run sudo pacman -S --needed --noconfirm stow
  fi

  mapfile -t pacman_packages < <(grep -Ev '^[[:space:]]*(#|$)' "$repo_dir/scripts/packages/pacman.txt")
  if ((${#pacman_packages[@]})); then
    run sudo pacman -S --needed --noconfirm "${pacman_packages[@]}"
  fi

  mapfile -t yay_packages < <(grep -Ev '^[[:space:]]*(#|$)' "$repo_dir/scripts/packages/yay.txt")
  if ((${#yay_packages[@]})); then
    if ! $dry_run && ! command -v yay >/dev/null; then
      echo "Install yay to install the AUR selections." >&2
      exit 1
    fi
    run yay -S --needed --noconfirm "${yay_packages[@]}"
  fi

  if $omarchy && [[ ! -d $HOME/.config/omarchy/plugins/monitor-layout ]]; then
    run omarchy plugin add https://github.com/kris-1/omarchy-monitor-layout.git --enable
  fi
fi

if $dry_run; then
  stow_preview_failed=false
  if ! "$repo_dir/scripts/stow.sh" --dry-run; then
    stow_preview_failed=true
    echo 'Stow preview reported conflicts; review them before setup.' >&2
  fi
  run "$repo_dir/scripts/configs/install-bash-hook.sh"
  $no_pkg || "$repo_dir/scripts/configs/install-skills.sh" --dry-run
else
  "$repo_dir/scripts/stow.sh"
  "$repo_dir/scripts/configs/install-bash-hook.sh"
  $no_pkg || "$repo_dir/scripts/configs/install-skills.sh"
fi

if $omarchy; then
  if $dry_run; then
    run "$repo_dir/scripts/configs/install-hyprland-hook.sh"
    echo '[dry-run] sudo ./overrides/omarchy/patch-nightlight.sh'
  else
    "$repo_dir/scripts/configs/install-hyprland-hook.sh"
    sudo "$repo_dir/overrides/omarchy/patch-nightlight.sh"
  fi

fi

if ! $no_pkg && $omarchy; then
  if ((${#pacman_packages[@]} + ${#yay_packages[@]})); then
    if $dry_run; then
      run omarchy pkg present "${pacman_packages[@]}" "${yay_packages[@]}"
    else
      omarchy pkg present "${pacman_packages[@]}" "${yay_packages[@]}" || {
        echo "Package verification failed; leaving unwanted packages installed." >&2
        exit 1
      }
    fi
  fi

  mapfile -t unwanted_packages < <(grep -Ev '^[[:space:]]*(#|$)' "$repo_dir/scripts/packages/unwanted.txt")
  installed_unwanted=()
  for package in "${unwanted_packages[@]}"; do
    if [[ $package == foot ]] && ! pacman -Qq kitty >/dev/null 2>&1; then
      echo 'Keeping foot because kitty is not installed.'
    elif pacman -Qq "$package" >/dev/null 2>&1; then
      installed_unwanted+=("$package")
    fi
  done
  if ((${#installed_unwanted[@]})); then
    run sudo pacman -R --noconfirm "${installed_unwanted[@]}"
  fi
fi

if $dry_run; then
  echo 'Dry run complete.'
  if $stow_preview_failed; then exit 1; fi
else
  echo 'Setup complete.'
fi
