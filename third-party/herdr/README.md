# Herdr community sources

The Ghoul layout's vendored mods and Mocha palette were imported from:

- GitHub: https://github.com/alarboulletmarin/herdr-github
- Lazygit: https://github.com/o101k/herdr-lazygit
- Catppuccin: https://github.com/theverything/herdr-catppuccin
- Markdown panel: https://github.com/jlopezlira/herdr-kanso/tree/main/markdown-panel
  (commit `1d17b8af97a621b2ef3a7fc5cd559ff6a8844303`)

The matching recipes and available upstream license/notice files are retained
here. Catppuccin icon notices also remain with the icon assets. The upstream
Lazygit snapshot did not contain a root LICENSE file.

Local additions: the `ghoul` layout and `tabs-ghoul` mod combine the GitHub and
Lazygit panels. The Lazygit controller/button also recognize the `ghoul` layout.
Only Ghoul, Mocha and their required mods are tracked; other community layouts,
Catppuccin mods and palettes are archived on the first root-link migration.
Herdr's shipped defaults, including Win98, remain intact and Git-ignored.
Lazygit can persist a live terminal address in the layout; review it before
committing. No upstream installers or icon-regeneration scripts run during deployment.

The Markdown panel is adapted to Ghoul's existing panel stack: Close/Escape
save before hiding, clean documents follow space changes, and `md-review` opens
the dock instead of a second window. The Kanso layout and theme are not installed.
Local changes also await lifecycle saves and pass the current event context to
document links. Ctrl/Cmd+Shift+M toggles Ghoul's dock rather than an overlay.
Upstream recipe, Apache-2.0 license and notice are retained under
`markdown-panel/`; its Lucide-derived chevron remains under Lucide's ISC license
(see `markdown-panel/LICENSE-Lucide.txt`).
