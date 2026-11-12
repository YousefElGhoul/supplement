-- Unbind unused keybinds to declutter Keybinds Menu
hl.unbind("SUPER + SHIFT + A")
hl.unbind("SUPER + SHIFT + ALT + A")
hl.unbind("SUPER + SHIFT + E")
hl.unbind("SUPER + SHIFT + ALT + E")
hl.unbind("SUPER + SHIFT + Y")
hl.unbind("SUPER + SHIFT + ALT + G")
hl.unbind("SUPER + SHIFT + CTRL + G")
hl.unbind("SUPER + SHIFT + P")
hl.unbind("SUPER + SHIFT + S")
hl.unbind("SUPER + SHIFT + X")
hl.unbind("SUPER + SHIFT + ALT + ")

hl.unbind("SUPER + CTRL + RETURN")
hl.unbind("SUPER + CTRL + K")
hl.unbind("SUPER + SHIFT + M")
hl.unbind("SUPER + SHIFT + ALT + M")
hl.unbind("SUPER + SHIFT + G")
hl.unbind("SUPER + SHIFT + SLASH")

hl.unbind("SUPER + A")

-- Change Keybind for btop
hl.unbind("SUPER + CTRL + T")
o.bind("CTRL + SHIFT + ESCAPE", "Activity", { tui = "btop" })

-- KeePassXC
hl.unbind("SUPER + SHIFT + SLASH")
o.bind("SUPER + SHIFT + SLASH", "KeePassXC", { launch = "keepassxc" })

-- Better Keybind for Toggle Dictate
hl.unbind("SUPER + CTRL + X")
o.bind("SUPER + F9", "Toggle dictation", "voxtype record toggle")

-- Better Calendar than HEY unironically
hl.unbind("SUPER + SHIFT + C")
hl.unbind("SUPER + CTRL + ALT + D")
o.bind("SUPER + SHIFT + C", "Calendar", "omarchy-shell shell toggle omarchy.clock")

-- Hermes Desktop
o.bind("SUPER + H", "Hermes Desktop", { launch = "hermes-desktop" })

-- Switch behavior of Super + Space and Super + Alt + Space
hl.unbind("SUPER + SPACE")
hl.unbind("SUPER + ALT + SPACE")
o.bind("SUPER + SPACE", "Apps menu", "omarchy-menu toggle apps")
o.bind("SUPER + ALT + SPACE", "Omarchy menu", "omarchy-menu toggle")

-- Switch behavior of Super + F and Super + Alt + F
hl.unbind("SUPER + F")
hl.unbind("SUPER + ALT + F")
o.bind("SUPER + F", "Full width", hl.dsp.window.fullscreen({ mode = "maximized" }))
o.bind("SUPER + ALT + F", "Full screen", hl.dsp.window.fullscreen({ mode = "fullscreen" }))
