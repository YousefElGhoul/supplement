import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, home, readTextFile, theme } from "herdr";
import { duration, quotaGroups, quotaTiming } from "./quota.js";

const ENDPOINT = "https://token-monitor-hub.yousefelghoul03.workers.dev/api/stats";

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
    .child(h_flex().justify_between().gap(4).text_size(10).line_height("12px").text_color(t.muted)
      .child(div().min_w(0).truncate().child(reset))
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

  refresh(cx) {
    if (this.pending) return;
    this.pending = true;
    cx.spawn(async (cx) => {
      try {
        const secret = (await readTextFile(`${home()}/.config/token-monitor/herdr-hub-secret`))?.trim();
        if (!secret) {
          this.message = "Token Monitor needs a hub secret";
          return;
        }
        const response = await fetch(ENDPOINT, { headers: {
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
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const now = Date.now();
    const disconnected = Boolean(this.message);
    const title = div().text_size(11.5).font_medium().text_color(t.dim).child("Usage");
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
        .child(div().text_color(t.foreground).child(lowest == null ? "—" : `${Math.floor(lowest)}%`));
    }

    return root.child(h_flex().px(16).h(41).pt(14).pb(5).flex_none().items_center().child(title))
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
