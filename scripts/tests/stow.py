#!/usr/bin/env python3
"""Exercise deployment against a disposable home, never the real config."""

import os
import socket
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "stow.sh"


def deploy(repo, home, dry_run=False, path=None):
    """Run the Bash deployment against a disposable repository and home."""
    env = {**os.environ, "HOME": str(home), "SUPPLEMENT_REPO": str(repo)}
    if path:
        env["PATH"] = f"{path}:{env['PATH']}"
    result = subprocess.run(
        ["bash", str(SCRIPT), *(["--dry-run"] if dry_run else [])],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr)


class DeploymentTests(unittest.TestCase):
    def test_conflicts_dry_run_and_idempotence(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as temp:
            root = Path(temp)
            repo, home, state = root / "repo", root / "home", root / "state"
            source = repo / "dotfiles/opencode/.config/opencode"
            source.mkdir(parents=True)
            target = home / ".config/opencode"
            target.mkdir(parents=True)
            for name in ("cli.json", "wrong", "broken"):
                (source / name).write_text("repository")
            (source / "server.env").write_text("never deploy")
            (target / "cli.json").write_text("local")
            (target / "cli.json.bak").write_text("old backup")
            (target / "tui.jsonc").write_text("legacy")
            outside = root / "outside"
            outside.write_text("do not touch")
            (target / "wrong").symlink_to(outside)
            (target / "broken").symlink_to(root / "missing")
            (target / "service.json").write_text("local state")
            with patch.dict(os.environ, {"XDG_STATE_HOME": str(state)}):
                deploy(repo, home, dry_run=True)
                self.assertEqual((target / "cli.json").read_text(), "local")
                self.assertFalse(state.exists())
                deploy(repo, home)
                backups = list((state / "supplement/backups").iterdir())
                self.assertEqual(len(backups), 1)
                saved = backups[0] / ".config/opencode"
                self.assertEqual((saved / "cli.json").read_text(), "local")
                self.assertTrue((saved / "wrong").is_symlink())
                self.assertTrue((saved / "broken").is_symlink())
                self.assertTrue((saved / "tui.jsonc").is_file())
                deploy(repo, home)
                self.assertEqual(
                    list((state / "supplement/backups").iterdir()), backups
                )
                deploy(repo, home, dry_run=True)
            self.assertEqual(outside.read_text(), "do not touch")
            self.assertEqual((target / "cli.json.bak").read_text(), "old backup")
            self.assertEqual((target / "service.json").read_text(), "local state")
            self.assertFalse((target / "server.env").exists())

    def test_parent_link_and_directory_conflicts(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as temp:
            root = Path(temp)
            repo, home = root / "repo", root / "home"
            source = repo / "dotfiles/test/.config/app"
            source.mkdir(parents=True)
            (source / "settings").write_text("new")
            (source / "file").write_text("file")
            outside = root / "outside"
            outside.mkdir()
            (outside / "untouched").write_text("safe")
            home.mkdir()
            (home / ".config").symlink_to(outside, target_is_directory=True)
            with patch.dict(os.environ, {"XDG_STATE_HOME": str(root / "state")}):
                deploy(repo, home)
                self.assertFalse((home / ".config").is_symlink())
                self.assertEqual((outside / "untouched").read_text(), "safe")
                (home / ".config/app/file").unlink()
                (home / ".config/app/file").mkdir()
                (home / ".config/app/file/keep").write_text("keep")
                deploy(repo, home)
                self.assertEqual(
                    len(list((root / "state/supplement/backups").iterdir())), 2
                )
                self.assertEqual(
                    len(list((root / "state/supplement/backups").rglob("keep"))), 1
                )

    def test_herdr_root_link_preserves_defaults_and_state(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as temp:
            root = Path(temp)
            repo, home = root / "repo", root / "home"
            base = repo / "dotfiles/herdr-app/.config/herdr-app"
            mod = base / "mods/example"
            mod.mkdir(parents=True)
            (mod / "main.js").write_text("import './ui.js'")
            (mod / "ui.js").write_text("export {}")
            (mod / "icon.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
            (base / "settings.json").write_text("{}")
            (base / "mods/tabs-github").mkdir()
            (base / "mods/tabs-github/main.js").write_text("unused community mod")
            (base / "layouts").mkdir()
            (base / "layouts/catppuccin.json").write_text("unused layout")
            target = home / ".config/herdr-app"
            (target / "mods").mkdir(parents=True)
            (target / "mods/example").symlink_to(os.path.relpath(mod, target / "mods"))
            (target / "mods/win98").mkdir()
            (target / "mods/win98/main.js").write_text("default")
            (target / "shared.json").write_text('{"layout":"ghoul"}')
            (target / "settings.json").write_text("local preferences")
            with patch.dict(os.environ, {"XDG_STATE_HOME": str(root / "state")}):
                deploy(repo, home, dry_run=True)
                self.assertFalse(target.is_symlink())
                self.assertFalse((base / "shared.json").exists())
                self.assertFalse((root / "state").exists())
                deploy(repo, home)
                inode = target.lstat().st_ino
                deploy(repo, home)
            self.assertTrue(target.is_symlink())
            self.assertEqual(target.lstat().st_ino, inode)
            self.assertFalse((target / "mods/example").is_symlink())
            self.assertFalse((mod / "main.js").is_symlink())
            self.assertFalse((target / "settings.json").is_symlink())
            self.assertTrue(
                (target / "mods/example/icon.svg")
                .resolve()
                .is_relative_to(target.resolve())
            )
            self.assertEqual((target / "mods/win98/main.js").read_text(), "default")
            self.assertEqual((target / "shared.json").read_text(), '{"layout":"ghoul"}')
            saved = list((root / "state/supplement/backups").iterdir())
            self.assertEqual(len(saved), 1)
            self.assertEqual(
                (saved[0] / ".config/herdr-app/settings.json").read_text(),
                "local preferences",
            )
            self.assertEqual((target / "settings.json").read_text(), "{}")
            self.assertFalse((base / "mods/tabs-github").exists())
            self.assertFalse((base / "layouts/catppuccin.json").exists())
            self.assertEqual(
                (
                    saved[0] / "retired-customizations/mods/tabs-github/main.js"
                ).read_text(),
                "unused community mod",
            )

    def test_herdr_migration_requires_closed_window(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as temp:
            root = Path(temp)
            repo, home = root / "repo", root / "home"
            base = repo / "dotfiles/herdr-app/.config/herdr-app"
            base.mkdir(parents=True)
            (base / "settings.json").write_text("{}")
            target = home / ".config/herdr-app"
            target.mkdir(parents=True)
            with socket.socket(socket.AF_UNIX) as server:
                server.bind(str(target / "herdr-app.sock"))
                server.listen()
                with self.assertRaisesRegex(RuntimeError, "Close the Herdr window"):
                    deploy(repo, home)
            self.assertFalse(target.is_symlink())

    def test_herdr_stow_failure_restores_original_root(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as temp:
            root = Path(temp)
            repo, home = root / "repo", root / "home"
            (repo / "dotfiles/herdr-app/.config/herdr-app").mkdir(parents=True)
            target = home / ".config/herdr-app"
            target.mkdir(parents=True)
            (target / "shared.json").write_text("preserve")
            retired = repo / "dotfiles/herdr-app/.config/herdr-app/mods/tabs-github"
            retired.mkdir(parents=True)
            (retired / "main.js").write_text("restore on failure")
            fake = root / "bin"
            fake.mkdir()
            (fake / "stow").write_text("#!/bin/sh\nexit 1\n")
            (fake / "stow").chmod(0o755)
            with (
                patch.dict(os.environ, {"XDG_STATE_HOME": str(root / "state")}),
                self.assertRaisesRegex(RuntimeError, "original config root was restored"),
            ):
                deploy(repo, home, path=fake)
            self.assertFalse(target.is_symlink())
            self.assertEqual((target / "shared.json").read_text(), "preserve")
            self.assertEqual((retired / "main.js").read_text(), "restore on failure")

    def test_herdr_fresh_install_and_unexpected_symlink(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as temp:
            root = Path(temp)
            repo, home = root / "repo", root / "home"
            source = repo / "dotfiles/herdr-app/.config/herdr-app"
            source.mkdir(parents=True)
            (source / "settings.json").write_text("{}")
            deploy(repo, home)
            target = home / ".config/herdr-app"
            self.assertTrue(target.is_symlink())
            self.assertEqual(target.resolve(), source.resolve())
            target.unlink()
            target.mkdir()
            (target / "outside").symlink_to(root / "outside")
            with self.assertRaisesRegex(RuntimeError, "Unexpected Herdr symlink"):
                deploy(repo, home)
            self.assertFalse(target.is_symlink())

    def test_existing_folded_package_link(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as temp:
            root = Path(temp)
            repo, home = root / "repo", root / "home"
            source = repo / "dotfiles/test/.config/app"
            source.mkdir(parents=True)
            (source / "settings").write_text("safe")
            (home / ".config").mkdir(parents=True)
            (home / ".config/app").symlink_to(source)
            with patch.dict(os.environ, {"XDG_STATE_HOME": str(root / "state")}):
                deploy(repo, home)
            self.assertEqual((source / "settings").read_text(), "safe")
            self.assertTrue((root / "state").exists())
            self.assertFalse((home / ".config/app").is_symlink())
            self.assertTrue((home / ".config/app/settings").is_symlink())

    def test_valid_relative_directory_link_is_never_moved(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as temp:
            root = Path(temp)
            repo, home = root / "repo", root / "home"
            source = repo / "dotfiles/hyprland/.config/hypr/supplement"
            source.mkdir(parents=True)
            (source / "hyprland_overrides.lua").write_text("-- config")
            target = home / ".config/hypr/supplement"
            target.parent.mkdir(parents=True)
            target.symlink_to(os.path.relpath(source, target.parent))
            inode = target.lstat().st_ino
            with patch.dict(os.environ, {"XDG_STATE_HOME": str(root / "state")}):
                deploy(repo, home)
            self.assertEqual(target.lstat().st_ino, inode)
            self.assertEqual(
                (target / "hyprland_overrides.lua").read_text(), "-- config"
            )
            self.assertFalse((root / "state").exists())


if __name__ == "__main__":
    unittest.main()
