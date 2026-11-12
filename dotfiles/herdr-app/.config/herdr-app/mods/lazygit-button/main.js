// Lazygit button: sits beside Herdr's own tab bar and opens or closes the Lazygit page of the right panel.
//
// Remembering the page per space is left to Herdr's own tab bar. It already saves whichever child of
// `panel-body` is open for each space, and on a switch restores it in the same frame, but only if the
// child is listed in shared("workspace.panels"). So this mod adds "lazygit" to that list. The tab bar
// draws buttons only for "files" and "changes", so the extra entry adds no second button.
import { View, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, theme, layout, shared, setShared } from "herdr";

const PAGE = "lazygit";
const DEFAULT_PANELS = ["files", "changes"]; // what Herdr's tab bar uses when the setting is unset
const stop = (_e, cx) => cx.stop_propagation();

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The Lazygit page is open: the panel shows the lazygit child of its stack.
function lazygitShown(root) {
  const panel = find(root, "panel"), body = find(root, "panel-body");
  return !!body && body.active === PAGE && (!panel || !panel.hidden);
}

// Lets Herdr's tab bar remember and restore the Lazygit page per space. Writes only when missing.
function enableRestore() {
  if (!["lazygit", "ghoul"].includes(shared("layout"))) return;
  const panels = shared("workspace.panels");
  const list = Array.isArray(panels) ? panels : DEFAULT_PANELS;
  if (!list.includes(PAGE)) setShared("workspace.panels", [...list, PAGE]);
}

export default class LazygitButton extends View {
  render() {
    enableRestore();
    const t = theme();
    const on = lazygitShown(layout());
    return h_flex().size_full().pl(3).pr(10).items_center().bg(t.chrome).border_b(1).border_color(t.border).child(
      h_flex().id("lazygit-open").h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12)
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else {
            run("layout.select", { stack: "panel-body", child: PAGE });
            run("layout.show", { id: "panel" });
          }
        })
        .child(svg("mods/lazygit-button/lazygit.svg").size(14))
        .child("Lazygit"));
  }
}
