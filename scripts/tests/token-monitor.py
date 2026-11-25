#!/usr/bin/env python3
"""Exercise the Token Monitor installer without using the network or user services."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[2]
INSTALLER = REPO / "scripts/configs/install-token-monitor.sh"
LAUNCHER = REPO / "dotfiles/token-monitor/.local/bin/token-monitor-agent"
SET_SECRET = REPO / "scripts/configs/set-token-monitor-secret.sh"
FIRST_REVISION = "084e143a7acd00d088b8ba7ee6c7b115fef8ec5d"


class TokenMonitorTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(dir="/tmp/opencode")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        home, bin_dir = self.root / "home", self.root / "bin"
        home.mkdir()
        bin_dir.mkdir()
        self.log = self.root / "calls"
        self.env = {
            **os.environ,
            "HOME": str(home),
            "XDG_DATA_HOME": str(self.root / "data"),
            "XDG_CONFIG_HOME": str(home / ".config"),
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "CALLS": str(self.log),
        }
        self.install_dir = self.root / "data/supplement/token-monitor"
        self.current = self.install_dir / "current"
        self.secret = home / ".config/token-monitor/hub.secret"
        self.history = home / ".config/Token Monitor/session-usage-archive.sqlite"
        for file in (self.secret, self.history):
            file.parent.mkdir(parents=True)
            file.write_text("preserve me")
        mocks = {
            "git": """
case "$1" in
  -C)
    if [[ "$3" == rev-parse ]]; then cat "$2/revision"; fi
    if [[ "$3" == apply && "$4" == --reverse && ${PATCH_CHANGED:-0} == 1 ]]; then exit 1; fi
    ;;
  ls-remote) printf '%s\\trefs/heads/main\\n' "$NEXT_REVISION" ;;
  clone)
    dest=${!#}
    mkdir -p "$dest/.git" "$dest/src/agent"
    touch "$dest/src/agent/agent.js"
    printf '%s\\n' "$6" > "$dest/revision"
    ;;
  apply) : ;;
  *) exit 1 ;;
esac
""",
            "mise": "[[ ${FAIL_MISE:-0} != 1 ]]",
            "systemctl": ":",
            "stow": ":",
        }
        for command, body in mocks.items():
            stub = bin_dir / command
            stub.write_text(
                f'#!/usr/bin/env bash\nprintf "%s\\n" "{command} $*" >> "$CALLS"\n'
                f"{body}\n"
            )
            stub.chmod(0o755)

    def install(self, *args, **env):
        return subprocess.run(
            ["bash", str(INSTALLER), *args],
            env={**self.env, **env},
            capture_output=True,
            text=True,
        )

    def test_dry_run_never_calls_external_install_tools(self):
        result = self.install("--dry-run", "--update")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("[dry-run]", result.stdout)
        self.assertFalse(self.install_dir.exists())
        self.assertFalse(self.log.exists())

    def test_launcher_requires_a_nonblank_systemd_credential(self):
        credentials = self.root / "credentials"
        credentials.mkdir()
        (credentials / "hub.secret").write_text(" \n")
        result = subprocess.run(
            ["bash", str(LAUNCHER)],
            env={**self.env, "CREDENTIALS_DIRECTORY": str(credentials)},
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 78)
        self.assertIn("hub secret is blank", result.stderr)
        self.assertFalse(self.log.exists())

    def test_secret_script_creates_private_file_once(self):
        self.secret.unlink()

        def save(secret):
            return subprocess.run(
                ["bash", str(SET_SECRET)],
                input=secret + "\n",
                env=self.env,
                capture_output=True,
                text=True,
            )

        self.assertNotEqual(save(" ").returncode, 0)
        self.assertFalse(self.secret.exists())
        result = save("test-secret")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("test-secret", result.stdout + result.stderr)
        self.assertEqual(self.secret.stat().st_mode & 0o777, 0o600)
        self.assertNotEqual(save("replacement").returncode, 0)
        self.assertEqual(self.secret.read_text(), "test-secret\n")

    def test_install_and_update_preserve_credentials_and_history(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        original = self.current.resolve()
        self.assertEqual((original / "revision").read_text().strip(), FIRST_REVISION)
        calls = self.log.read_text()
        self.assertIn("npm ci --omit=dev --include=optional", calls)
        self.assertIn("node scripts/ensure-vendored-tokscale.js", calls)
        self.assertNotIn("try-restart", calls)
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.current.resolve(), original)
        self.assertEqual(self.log.read_text().count("git clone"), 1)

        revision = "b" * 40
        result = self.install("--update", NEXT_REVISION=revision, FAIL_MISE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.current.resolve(), original)
        self.assertEqual(list(self.install_dir.glob("release.*")), [original])
        self.assertNotIn("try-restart", self.log.read_text())

        result = self.install("--update", NEXT_REVISION=revision)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotEqual(self.current.resolve(), original)
        self.assertEqual((self.current / "revision").read_text().strip(), revision)
        self.assertTrue(original.exists())
        self.assertIn(
            "systemctl --user try-restart token-monitor.service", self.log.read_text()
        )
        self.assertEqual(self.secret.read_text(), "preserve me")
        self.assertEqual(self.history.read_text(), "preserve me")

    def test_patch_upgrade_builds_new_release_without_touching_installed_files(self):
        self.assertEqual(self.install().returncode, 0)
        original = self.current.resolve()
        original_agent = original / "src/agent/agent.js"
        original_agent.write_text("local change")
        result = self.install(PATCH_CHANGED="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotEqual(self.current.resolve(), original)
        self.assertEqual(original_agent.read_text(), "local change")
        self.assertEqual(
            (self.current / "revision").read_text().strip(), FIRST_REVISION
        )


if __name__ == "__main__":
    unittest.main()
