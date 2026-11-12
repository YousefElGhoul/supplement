#!/usr/bin/env bash
# Back up conflicting targets, deploy using Stow, and verify the links.
set -euo pipefail

# Tests point SUPPLEMENT_REPO and HOME at a disposable tree.
repo_dir=${SUPPLEMENT_REPO:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)}
stow_dir=$repo_dir/dotfiles
home=$HOME
dry_run=false
if [[ ${1:-} == --dry-run && $# -eq 1 ]]; then
  dry_run=true
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--dry-run]" >&2
  exit 2
fi

packages=()
herdr=false
for path in "$stow_dir"/*; do
  [[ -d $path ]] || continue
  package=${path##*/}
  [[ $package == bashrc ]] && continue
  [[ -n $(find "$path" -type f -print -quit) ]] || continue
  if [[ $package == herdr-app ]]; then
    herdr=true
  else
    packages+=("$package")
  fi
done

if ! $herdr && ((${#packages[@]} == 0)); then
  echo "No Stow packages found."
  exit 0
fi
if ! command -v stow >/dev/null; then
  if $dry_run; then
    echo "GNU Stow is not installed; setup will install it before deployment."
    exit 0
  fi
  echo "GNU Stow is required; run ./scripts/setup.sh first." >&2
  exit 1
fi

die() {
  echo "$*" >&2
  exit 1
}
present() { [[ -e $1 || -L $1 ]]; }
resolve() { realpath -m -- "$1"; }
relative_link() { realpath -ms --relative-to="${2%/*}" -- "$1"; }
new_backup() {
  local base=${XDG_STATE_HOME:-$home/.local/state}/supplement/backups
  mkdir -p "$base"
  mktemp -d "$base/$1XXXXXXXX"
}

# Keep Herdr's modules and assets inside one canonical application root.
deploy_herdr() {
  local relative=.config/herdr-app
  local source=$stow_dir/herdr-app/$relative target=$home/$relative
  local retired=() pending=() archived=() path old new rel
  for path in \
    layouts/catppuccin.json layouts/catppuccin.svg layouts/github.json \
    layouts/lazygit.json themes/catppuccin-frappe.json \
    themes/catppuccin-latte.json themes/catppuccin-macchiato.json \
    mods/catppuccin-changes mods/catppuccin-chrome mods/catppuccin-files \
    mods/catppuccin-status mods/catppuccin-tabs mods/tabs-github; do
    if present "$source/$path"; then retired+=("$path"); fi
  done

  if [[ -L $target && $(resolve "$target") == "$(resolve "$source")" ]]; then
    # Do not let Stow traverse runtime files written into the linked root.
    echo "Verified Herdr root Stow symlink: $target"
    return
  fi
  [[ ! -L ${target%/*} ]] ||
    die "Refusing to migrate Herdr through a linked parent: ${target%/*}"
  if [[ -L $target ]] || { present "$target" && [[ ! -d $target ]]; }; then
    die "Herdr root needs manual review before migration: $target"
  fi

  # Shipped defaults and runtime state move into the repository root unchanged.
  if [[ -d $target ]]; then
    while IFS= read -r -d '' old; do
      rel=${old#"$target"/}
      new=$source/$rel
      if [[ -L $old ]]; then
        [[ $(resolve "$old") == "$(resolve "$new")" ]] ||
          die "Unexpected Herdr symlink needs review: $old"
      elif [[ -d $old ]]; then
        if present "$new" && [[ ! -d $new ]]; then
          die "Herdr directory conflicts with repository file: $new"
        fi
        pending+=("$rel")
      elif [[ -f $old ]]; then
        if ! present "$new"; then pending+=("$rel"); fi
      elif [[ ! -S $old ]]; then
        die "Unexpected Herdr file needs review: $old"
      fi
    done < <(find "$target" -mindepth 1 -print0 | sort -z)
  fi

  if $dry_run; then
    echo "[dry-run] preserve Herdr defaults/state, back up $target, and Stow its whole root"
    for path in "${retired[@]}"; do
      echo "[dry-run] archive unused customization: $path"
    done
    return
  fi

  local sock=$target/herdr-app.sock code=0
  if [[ -S $sock ]]; then
    command -v curl >/dev/null || die "curl is required to check whether Herdr is running."
    # Exit 7 means nothing accepted the connection: the window is closed.
    curl -s -o /dev/null --max-time 1 --unix-socket "$sock" http://herdr/ || code=$?
    [[ $code -eq 7 ]] ||
      die "Close the Herdr window before migrating its config; core terminals can keep running."
  fi

  local backup_root='' backup=''
  if [[ -e $target ]] || ((${#retired[@]})); then
    backup_root=$(new_backup stow-herdr-)
    backup=$backup_root/$relative
    mkdir -p "${backup%/*}"
    for rel in "${pending[@]}"; do
      if [[ -d $target/$rel ]]; then
        mkdir -p "$source/$rel"
      else
        mkdir -p "$(dirname -- "$source/$rel")"
        cp -p -- "$target/$rel" "$source/$rel"
      fi
    done
    if [[ -e $target ]]; then mv -- "$target" "$backup"; fi
    echo "Herdr backup: $backup_root"
  fi
  mkdir -p "${target%/*}"

  local failed=false saved
  for path in "${retired[@]}"; do
    saved=$backup_root/retired-customizations/$path
    if mkdir -p "${saved%/*}" && mv -- "$source/$path" "$saved"; then
      archived+=("$path")
    else
      failed=true
      break
    fi
  done
  if ! $failed; then
    stow -d "$stow_dir" -t "$home" herdr-app || failed=true
  fi
  if ! $failed && [[ ! -L $target || $(resolve "$target") != "$(resolve "$source")" ]]; then
    echo "Herdr root Stow symlink verification failed: $target" >&2
    failed=true
  fi
  if $failed; then
    for path in "${archived[@]}"; do
      mv -- "$backup_root/retired-customizations/$path" "$source/$path"
    done
    if [[ -n $backup && -e $backup ]] && ! present "$target"; then
      mv -- "$backup" "$target"
    fi
    die "Herdr deployment failed; the original config root was restored."
  fi
  echo "Verified Herdr root Stow symlink: $target"
}

if $herdr; then deploy_herdr; fi
((${#packages[@]})) || exit 0

# Map every deployable file and its parent directories, relative to $HOME.
declare -A files=() directories=() conflicts=()
for package in "${packages[@]}"; do
  root=$stow_dir/$package
  while IFS= read -r -d '' source; do
    relative=${source#"$root"/}
    # Secrets stay local even if an ignored copy exists in the package.
    [[ $source == *.env ]] && continue
    [[ ! -L $source ]] || die "Source symlinks need explicit review: $source"
    [[ -d $source ]] && continue
    [[ -z ${files[$relative]+set} ]] || die "Packages both supply $relative"
    files[$relative]=$source
    parent=$relative
    while [[ $parent == */* ]]; do
      parent=${parent%/*}
      [[ -n ${directories[$parent]+set} ]] || directories[$parent]=$root/$parent
    done
  done < <(find "$root" -mindepth 1 -print0 | sort -z)
done

under_conflict() {
  local parent=$1
  while [[ $parent == */* ]]; do
    parent=${parent%/*}
    [[ -z ${conflicts[$parent]+set} ]] || return 0
  done
  return 1
}

mapfile -t by_depth < <(printf '%s\n' "${!directories[@]}" | awk -F/ '{print NF "\t" $0}' | sort -n | cut -f2-)
for relative in "${by_depth[@]}"; do
  under_conflict "$relative" && continue
  target=$home/$relative
  if [[ -L $target ]]; then
    # Keep valid Stow-owned directory links: removing watched configs causes reload races.
    if [[ $(resolve "$target") != "$(resolve "${directories[$relative]}")" || $(readlink -- "$target") == /* ]]; then
      conflicts[$relative]=1
    fi
  elif present "$target" && [[ ! -d $target ]]; then
    conflicts[$relative]=1
  fi
done
for relative in "${!files[@]}"; do
  under_conflict "$relative" && continue
  target=$home/$relative
  present "$target" || continue
  if [[ $(resolve "$target") != "$(resolve "${files[$relative]}")" ]] ||
    [[ -L $target && $(readlink -- "$target") == /* ]]; then
    conflicts[$relative]=1
  fi
done

# OpenCode V2 uses one cli.json. Retire obsolete files without following their links.
if [[ -d $stow_dir/opencode ]]; then
  for name in cli.jsonc tui.json tui.jsonc; do
    relative=.config/opencode/$name
    if ! under_conflict "$relative" && present "$home/$relative"; then
      conflicts[$relative]=1
    fi
  done
fi

backup=''
if ((${#conflicts[@]})); then
  mapfile -t sorted < <(printf '%s\n' "${!conflicts[@]}" | LC_ALL=C sort)
  for relative in "${sorted[@]}"; do
    target=$home/$relative
    if $dry_run; then
      echo "[dry-run] back up $target"
      continue
    fi
    if [[ -z $backup ]]; then
      backup=$(new_backup stow-)
      echo "Backups: $backup"
    fi
    destination=$backup/$relative
    mkdir -p "${destination%/*}"
    if [[ -n ${files[$relative]+set} && ! -d $target ]]; then
      # Running apps recreate missing settings: replace without a missing-file window.
      cp -pP -- "$target" "$destination"
      temporary=${target%/*}/.${target##*/}.stow-$$-$RANDOM
      ln -s -- "$(relative_link "${files[$relative]}" "$target")" "$temporary"
      mv -T -- "$temporary" "$target" || {
        rm -f -- "$temporary"
        exit 1
      }
    else
      mv -- "$target" "$destination"
    fi
  done
fi

command=(stow -d "$stow_dir" -t "$home" '--ignore=.*\.env$' --no-folding)
if $dry_run; then
  if ((${#conflicts[@]})); then
    # Stow cannot simulate removal of targets that still exist.
    echo "[dry-run] after ${#conflicts[@]} backups, Stow will deploy ${#files[@]} files; no targets changed."
  else
    "${command[@]}" --simulate "${packages[@]}"
  fi
  exit 0
fi

# Keep runtime-writing directories real for the remaining packages.
for relative in "${by_depth[@]}"; do
  mkdir -p "$home/$relative"
done
"${command[@]}" "${packages[@]}"

invalid=()
for relative in "${!files[@]}"; do
  target=$home/$relative
  linked=false
  part=$relative
  while :; do
    if [[ -L $home/$part ]]; then linked=true; fi
    [[ $part == */* ]] || break
    part=${part%/*}
  done
  if ! $linked || [[ $(resolve "$target") != "$(resolve "${files[$relative]}")" ]]; then
    invalid+=("$target")
  fi
done
if ((${#invalid[@]})); then
  echo "Symlink verification failed:" >&2
  printf '%s\n' "${invalid[@]}" >&2
  exit 1
fi
echo "Verified ${#files[@]} Stow symlinks across ${#packages[@]} packages."
