import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, exec, home, notify, readTextFile, theme } from "herdr";
import { duration, quotaGroups, quotaTiming } from "./quota.js";

function quotaRow(row, now, disconnected, t) {
  const { stale, resetIn, evenLeft, runsOutIn } = quotaTiming(row, now, disconnected);
  const color = stale ? t.muted : row.left < 20 ? t.ansi1 : row.left < 50 ? t.ansi3 : t.ansi2;
  const reset = !Number.isFinite(resetIn) ? "Reset unknown"
    : resetIn <= 0 ? "Reset passed" : `Resets in ${duration(resetIn)}`;
  return v_flex().flex_none().gap(4)
    .child(h_flex().justify_between().gap(4)
      .child(div().min_w(0).truncate().text_color(t.muted).child(row.label))
      .child(div().flex_none().text_color(color).font_semibold().child(`${Math.floor(row.left)}% left`)))
    .child(div().relative().w_full().h(12)
      .child(div().absolute().w_full().top(4).h(4).rounded(2).bg(t.input))
      .child(div().absolute().w(`${row.left}%`).top(4).h(4).rounded(2).bg(color))
      .when(evenLeft !== undefined, (bar) =>
        bar.child(div().absolute().left(`${evenLeft}%`).ml(-2).top(0)
          .w(5).h(12).rounded(2).bg(t.foreground).border(1).border_color(t.chrome))))
    .child(h_flex().min_h(12).justify_between().gap(4).text_size(10).line_height("12px").text_color(t.muted)
      .when(row.notStarted, (line) => line.justify_end())
      .when(!row.notStarted, (line) => line.child(div().min_w(0).truncate().child(reset)))
      .when(stale, (line) => line.child(div().flex_none().child("Stale")))
      .when(runsOutIn != null, (line) => line.child(div().flex_none().text_color(t.ansi3)
        .child(`Runs out in ${duration(runsOutIn)}`))));
}

export default class Usage extends View {
  init(_props, cx) {
    this.message = "Reading Token Monitor…";
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(60_000, (cx) => this.refresh(cx));
  }

  refresh(cx, fromSource = false) {
    if (this.pending) {
      if (fromSource && !this.refreshingSource) this.queuedSourceRefresh = true;
      return;
    }
    this.pending = true;
    this.refreshingSource = fromSource;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (fromSource) {
          try {
            const result = await exec(`${home()}/.local/bin/token-monitor-refresh`, ["--limits-only"], { timeout: 25_000 });
            if (result.code !== 0) throw new Error("Refresh failed");
          } catch {
            notify({ title: "Token Monitor refresh failed", body: "Showing the latest data available from the Hub." });
          }
        }
        const config = `${home()}/.config/token-monitor`;
        const hub = (await readTextFile(`${config}/hub-url`))?.trim().replace(/\/+$/, "");
        if (!hub || !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(hub)) {
          this.message = "Token Monitor needs a Hub HTTPS origin";
          return;
        }
        const secret = (await readTextFile(`${config}/herdr-hub-secret`))?.trim();
        if (!secret) {
          this.message = "Token Monitor needs a hub secret";
          return;
        }
        const response = await fetch(`${hub}/api/stats`, { headers: {
          Authorization: `Bearer ${secret}`,
          Accept: "application/json",
          "User-Agent": "herdr-app",
        } });
        if (response.status === 401 || response.status === 403) {
          this.message = "Token Monitor needs a hub secret";
        } else {
          if (!response.ok) throw new Error("Hub request failed");
          this.groups = quotaGroups(await response.json());
          this.message = null;
        }
      } catch {
        this.message = "Token Monitor unavailable";
      } finally {
        this.pending = false;
        this.refreshingSource = false;
        if (this.queuedSourceRefresh) {
          this.queuedSourceRefresh = false;
          this.refresh(cx, true);
        }
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const now = Date.now();
    const disconnected = Boolean(this.message);
    const title = div().text_size(11.5).font_medium().text_color(t.dim).child("Usage");
    const refresh = div().id("usage-refresh").size(26).flex_none().flex()
      .items_center().justify_center().rounded(6).text_color(t.dim)
      .when(!this.pending, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_event, cx) => this.refresh(cx, true))
      .tooltip(this.pending ? "Refreshing quota…" : "Refresh quota")
      .child(svg("mods/git/icons/refresh.svg").size(14).when(this.pending, (el) => el.spin(900)));
    const root = v_flex().id("usage").size_full().min_h(0).bg(t.chrome)
      .border_t(1).border_color(t.border)
      .on_size_change(({ width }, cx) => {
        const compact = width < 172;
        if (this.compact === compact) return;
        this.compact = compact;
        cx.notify();
      });
    const rows = this.groups?.flatMap((group) => group.rows) ?? [];
    if (this.compact) {
      const fresh = rows.filter((row) => !quotaTiming(row, now, disconnected).stale);
      const lowest = fresh.length ? Math.min(...fresh.map((row) => row.left)) : null;
      return root.items_center().justify_center().gap(4).text_size(10)
        .child(title)
        .child(div().text_color(t.foreground).child(lowest == null ? "—" : `${Math.floor(lowest)}%`))
        .child(refresh);
    }

    return root.child(h_flex().pl(16).pr(10).h(41).pt(14).pb(5).flex_none()
      .items_center().justify_between().child(title).child(refresh))
      .child(v_flex().id("usage-rows").flex_1().min_h(0).px(16).pb(12).gap(10)
        .text_size(11).line_height("13px").overflow_y_scrollbar()
        .when(disconnected, (el) => el.child(div().text_color(t.muted).child(this.message)))
        .children((this.groups ?? []).map(({ id, label, rows }, index) =>
          v_flex().flex_none().gap(8)
            .when(index > 0, (el) => el.pt(10).border_t(1).border_color(t.border))
            .child(h_flex().h(20).items_center().gap(7)
              .child(image(`icons/${id}.svg`).size(14).flex_none())
              .child(div().text_size(12).font_medium().text_color(t.foreground).child(label)))
            .children(rows.length ? rows.map((row) => quotaRow(row, now, disconnected, t))
              : [div().text_color(t.muted).child("Quota unavailable")]))));
  }
}
