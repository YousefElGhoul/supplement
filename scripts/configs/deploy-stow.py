#!/usr/bin/env python3
"""Back up conflicting targets, deploy using Stow, and verify the links."""

import argparse
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import tempfile
import uuid


def present(path):
    return path.exists() or path.is_symlink()


def deploy_herdr(repo, home, dry_run=False):
    """Keep modules and assets inside one canonical application root."""
    relative = Path(".config/herdr-app")
    source = repo / "dotfiles/herdr-app" / relative
    target = home / relative
    retired = [
        source / path
        for path in (
            "layouts/catppuccin.json",
            "layouts/catppuccin.svg",
            "layouts/github.json",
            "layouts/lazygit.json",
            "themes/catppuccin-frappe.json",
            "themes/catppuccin-latte.json",
            "themes/catppuccin-macchiato.json",
            "mods/catppuccin-changes",
            "mods/catppuccin-chrome",
            "mods/catppuccin-files",
            "mods/catppuccin-status",
            "mods/catppuccin-tabs",
            "mods/tabs-github",
        )
        if present(source / path)
    ]
    command = ["stow", "-d", str(repo / "dotfiles"), "-t", str(home), "herdr-app"]
    if target.is_symlink() and target.resolve() == source.resolve():
        # Do not let Stow traverse runtime files written into the linked root.
        print(f"Verified Herdr root Stow symlink: {target}")
        return
    if target.parent.is_symlink():
        raise RuntimeError(
            f"Refusing to migrate Herdr through a linked parent: {target.parent}"
        )
    if target.is_symlink() or present(target) and not target.is_dir():
        raise RuntimeError(f"Herdr root needs manual review before migration: {target}")

    pending = []

    def collect(directory):
        for old in sorted(directory.iterdir()):
            new = source / old.relative_to(target)
            if old.is_symlink():
                if old.resolve() != new.resolve():
                    raise RuntimeError(f"Unexpected Herdr symlink needs review: {old}")
            elif old.is_dir():
                if present(new) and not new.is_dir():
                    raise RuntimeError(
                        f"Herdr directory conflicts with repository file: {new}"
                    )
                pending.append((old, new))
                collect(old)
            elif stat.S_ISREG(old.stat().st_mode):
                if not present(new):
                    pending.append((old, new))
            elif not stat.S_ISSOCK(old.stat().st_mode):
                raise RuntimeError(f"Unexpected Herdr file needs review: {old}")

    if target.exists():
        collect(target)
    if dry_run:
        print(
            f"[dry-run] preserve Herdr defaults/state, back up {target}, and Stow its whole root"
        )
        for path in retired:
            print(f"[dry-run] archive unused customization: {path.relative_to(source)}")
        return
    sock = target / "herdr-app.sock"
    if sock.exists():
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(1)
            try:
                client.connect(str(sock))
            except (ConnectionRefusedError, FileNotFoundError):
                pass
            else:
                raise RuntimeError(
                    "Close the Herdr window before migrating its config; core terminals can keep running."
                )

    backup = None
    if target.exists() or retired:
        state = Path(os.environ.get("XDG_STATE_HOME", home / ".local/state"))
        base = state / "supplement/backups"
        base.mkdir(parents=True, exist_ok=True)
        backup_root = Path(tempfile.mkdtemp(prefix="stow-herdr-", dir=base))
        backup = backup_root / relative
        backup.parent.mkdir(parents=True, exist_ok=True)
        for old, new in pending:
            if old.is_dir():
                new.mkdir(parents=True, exist_ok=True)
            else:
                new.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(old, new)
        if target.exists():
            shutil.move(str(target), str(backup))
        print(f"Herdr backup: {backup_root}")
    target.parent.mkdir(parents=True, exist_ok=True)
    archived = []
    try:
        for path in retired:
            saved = backup_root / "retired-customizations" / path.relative_to(source)
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(path), str(saved))
            archived.append((path, saved))
        subprocess.run(command, check=True)
        if not target.is_symlink() or target.resolve() != source.resolve():
            raise RuntimeError(f"Herdr root Stow symlink verification failed: {target}")
    except Exception:
        for path, saved in reversed(archived):
            shutil.move(str(saved), str(path))
        if backup is not None and backup.exists() and not present(target):
            shutil.move(str(backup), str(target))
        raise
    print(f"Verified Herdr root Stow symlink: {target}")


CLAUDE_SKILLS = ("archify", "find-skills", "frontend-design", "ponytail")


def link_claude_skills(repo, home, dry_run=False):
    """Expose the shared ~/.agents skills to Claude Code through relative links."""
    for name in CLAUDE_SKILLS:
        if not (repo / "dotfiles/opencode/.agents/skills" / name).is_dir():
            continue
        shared = home / ".agents/skills" / name
        link = home / ".claude/skills" / name
        if present(link):
            if not link.is_symlink() or link.resolve() != shared.resolve():
                raise RuntimeError(f"Claude skill needs manual review: {link}")
        elif dry_run:
            print(f"[dry-run] link Claude skill: {link}")
        else:
            link.parent.mkdir(parents=True, exist_ok=True)
            link.symlink_to(os.path.relpath(shared, link.parent))


def deploy(repo, home, packages, dry_run=False):
    claude = "claude" in packages and "opencode" in packages
    if "herdr-app" in packages:
        deploy_herdr(repo, home, dry_run)
        packages = [package for package in packages if package != "herdr-app"]
    if not packages:
        return
    stow_dir = repo / "dotfiles"
    files = {}
    directories = {}
    for package in packages:
        root = stow_dir / package
        for source in sorted(root.rglob("*")):
            relative = source.relative_to(root)
            # Secrets stay local even if an ignored copy exists in the package.
            if source.name.endswith(".env"):
                continue
            if source.is_symlink():
                raise RuntimeError(f"Source symlinks need explicit review: {source}")
            if source.is_dir():
                continue
            if relative in files:
                raise RuntimeError(f"Packages both supply {relative}")
            files[relative] = source
            for parent in relative.parents:
                if parent != Path("."):
                    directories.setdefault(parent, root / parent)

    conflicts = set()
    for relative, source in sorted(
        directories.items(), key=lambda pair: len(pair[0].parts)
    ):
        if any(parent in conflicts for parent in relative.parents):
            continue
        target = home / relative
        if target.is_symlink():
            # Keep valid Stow-owned directory links: removing watched configs causes reload races.
            if (
                target.resolve() != source.resolve()
                or Path(os.readlink(target)).is_absolute()
            ):
                conflicts.add(relative)
        elif present(target) and not target.is_dir():
            conflicts.add(relative)
    for relative, source in files.items():
        if any(parent in conflicts for parent in relative.parents):
            continue
        target = home / relative
        if present(target) and (
            target.resolve() != source.resolve()
            or target.is_symlink()
            and Path(os.readlink(target)).is_absolute()
        ):
            conflicts.add(relative)

    # V2 uses one cli.json. Retire obsolete files without following their links.
    if "opencode" in packages:
        for name in ("cli.jsonc", "tui.json", "tui.jsonc"):
            relative = Path(".config/opencode") / name
            if not any(parent in conflicts for parent in relative.parents) and present(
                home / relative
            ):
                conflicts.add(relative)

    backup = None
    for relative in sorted(conflicts, key=str):
        target = home / relative
        if dry_run:
            print(f"[dry-run] back up {target}", flush=True)
            continue
        if backup is None:
            state = Path(os.environ.get("XDG_STATE_HOME", home / ".local/state"))
            base = state / "supplement/backups"
            base.mkdir(parents=True, exist_ok=True)
            backup = Path(tempfile.mkdtemp(prefix="stow-", dir=base))
            print(f"Backups: {backup}", flush=True)
        destination = backup / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if relative in files and not target.is_dir():
            # Running apps recreate missing settings: replace without a missing-file window.
            shutil.copy2(target, destination, follow_symlinks=False)
            temporary = target.with_name(f".{target.name}.stow-{uuid.uuid4().hex}")
            try:
                temporary.symlink_to(os.path.relpath(files[relative], target.parent))
                os.replace(temporary, target)
            finally:
                if temporary.is_symlink():
                    temporary.unlink()
        else:
            shutil.move(str(target), str(destination))

    command = [
        "stow",
        "-d",
        str(stow_dir),
        "-t",
        str(home),
        "--ignore=.*\\.env$",
    ]
    commands = [command + ["--no-folding"] + packages]
    if dry_run:
        if claude:
            link_claude_skills(repo, home, dry_run)
        if conflicts:
            # Stow cannot simulate removal of targets that still exist.
            print(
                f"[dry-run] after {len(conflicts)} backups, Stow will deploy {len(files)} files; no targets changed."
            )
            return
        for command in commands:
            subprocess.run(command + ["--simulate"], check=True)
        return
    # Keep runtime-writing directories real for the remaining packages.
    for relative in sorted(directories, key=lambda path: len(path.parts)):
        (home / relative).mkdir(parents=True, exist_ok=True)
    for command in commands:
        subprocess.run(command, check=True)
    invalid = [
        str(home / relative)
        for relative, source in files.items()
        if (home / relative).resolve() != source.resolve()
        or not any(
            (home / part).is_symlink()
            for part in (relative, *relative.parents)
            if part != Path(".")
        )
    ]
    if invalid:
        raise RuntimeError("Symlink verification failed:\n" + "\n".join(invalid))
    if claude:
        link_claude_skills(repo, home)
    print(f"Verified {len(files)} Stow symlinks across {len(packages)} packages.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("packages", nargs="+")
    args = parser.parse_args()
    deploy(
        Path(__file__).resolve().parents[2], Path.home(), args.packages, args.dry_run
    )
