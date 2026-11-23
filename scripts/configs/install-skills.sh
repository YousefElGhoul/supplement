#!/usr/bin/env bash
# Install or update the agent skills listed in scripts/packages/skills.txt.
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
dry_run=false
if [[ ${1:-} == --dry-run && $# -eq 1 ]]; then
  dry_run=true
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--dry-run]" >&2
  exit 2
fi

npx=(npx)
if ! command -v npx >/dev/null; then
  command -v mise >/dev/null || {
    echo "npx is required to install skills; install Node first." >&2
    exit 1
  }
  npx=(mise x node -- npx)
fi

# Skills used to be Stow-managed: drop links left behind by the removed package.
skills_dir=$HOME/.agents/skills
claude_skills_dir=$HOME/.claude/skills
if ! $dry_run && [[ -d $skills_dir ]]; then
  find "$skills_dir" -xtype l -delete
  find "$skills_dir" -mindepth 1 -depth -type d -empty -delete
  if [[ -d $claude_skills_dir ]]; then
    find "$claude_skills_dir" -maxdepth 1 -xtype l -delete
  fi
fi

while IFS= read -r skill_file; do
  skill_dir=${skill_file%/SKILL.md}
  skill_id=${skill_dir##*/}
  target=$claude_skills_dir/$skill_id
  if [[ -e $target && ! -L $target ]] || { [[ -L $target ]] && [[ $(readlink "$target") != "$skill_dir" ]]; }; then
    echo "Refusing to replace existing skill: $target" >&2
    exit 1
  fi
  if $dry_run; then
    printf '[dry-run] link %s -> %s\n' "$target" "$skill_dir"
  else
    mkdir -p "$claude_skills_dir"
    [[ -L $target ]] || ln -s "$skill_dir" "$target"
  fi
done < <(find "$repo_dir/skills" -mindepth 2 -maxdepth 2 -type f -name SKILL.md 2>/dev/null | sort)

# Re-adding a skill fetches its latest upstream version into ~/.agents/skills
# and links it for each agent, so this one command both installs and updates.
while read -r source skill; do
  command=("${npx[@]}" --yes skills add "$source" --skill "$skill" --global --agent claude-code --agent opencode --yes)
  if $dry_run; then
    printf '[dry-run]'
    printf ' %q' "${command[@]}"
    printf '\n'
  else
    "${command[@]}" </dev/null
  fi
done < <(grep -Ev '^[[:space:]]*(#|$)' "$repo_dir/scripts/packages/skills.txt")
