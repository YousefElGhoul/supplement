// Lazygit panel: a bar, and a live lazygit terminal for the active space's git repo.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, exec, run, theme, layout, terminals, shared, home } from "herdr";

const TERM = "lazygit-term"; // the layout block that shows the terminal
const LABEL_SPACE = "herdr-lazygit.space";
const LABEL_REPO = "herdr-lazygit.repo";
const SYNC_MS = 16; // a terminal write waits this long, so it never overwrites the tab bar's restore
const RETRY_MS = 3000; // at most one (re)start per space + repo this often
const stop = (_e, cx) => cx.stop_propagation();

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function parentOf(node, id) {
  for (const child of node?.children ?? []) {
    if (child.id === id) return node;
    const found = parentOf(child, id);
    if (found) return found;
  }
  return null;
}

// The machine a space runs on (its `hc machine` name), or null for a local space.
function machineOf(space) {
  const m = space.machine;
  if (!m) return null;
  return typeof m === "string" ? m : m.name ?? m.id ?? null;
}

// Where lazygit opens: the focused pane's folder when it is in this space, else the space's first
// pane with a folder, else the space's own folder. A local space falls back to the home folder; a
// remote one to "" (that machine's home: hc runs remote commands there by default).
function folderOf(space, machine) {
  const f = focused();
  if (f?.space === space.id && f.cwd) return f.cwd;
  const tabs = new Set(space.tabs.map((t) => t.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder || (machine ? "" : home());
}

// Runs a program in `folder`, here or on `machine`, and gives back { code, stdout, stderr }.
// `hc exec` passes the program's own output and exit code through.
function execOn(machine, folder, argv) {
  if (!machine) return exec(argv[0], argv.slice(1));
  return exec("hc", ["exec", "--on", machine, ...(folder ? ["--cwd", folder] : []), "--", ...argv]);
}

// hc's own failure (unknown machine, missing folder, connection lost), which it prints as JSON
// `{ error: { kind, message } }` on stderr. Null when the program itself ran.
function hcError(r) {
  if (!r || r.code === 0) return null;
  for (const out of [r.stderr, r.stdout]) {
    // The JSON is the last line; anything printed before it (warnings) is skipped.
    const line = (out ?? "").trim().split("\n").pop();
    try {
      const e = JSON.parse(line).error;
      if (e?.message) return e;
    } catch {}
  }
  return null;
}

// A remote machine's commands get a bare system PATH, without ~/.local/bin, where tools installed
// without root usually live (hc itself, and lazygit from its release tarball).
const withLocalBin = (argv) => ["sh", "-c", 'PATH="$HOME/.local/bin:$PATH" exec "$@"', "sh", ...argv];

// A remote address is `machine/t7`.
const isRemote = (address) => !!address && address.includes("/");

// The terminal block already shows `address` (or is hidden when `address` is null).
const matches = (node, address) => !node || (address ? !node.hidden && node.content?.terminal === address : !!node.hidden);

const lastPart = (path) => path.replace(/\/+$/, "").split("/").pop() || path;

export default class LazygitPanel extends View {
  init() {
    this.key = null; // space id + folder last seen
    this.roots = new Map(); // machine + folder -> repo root, or null when not a repo (what git last said)
    this.resolving = new Set(); // machine + folder keys git is being asked about
    this.unreachable = new Map(); // machine + folder -> why git could not be asked (remote only)
    this.probes = new Map(); // remote address -> { live, at }: what `hc get` last said
    this.probing = new Set(); // remote addresses being asked about
    this.reprobe = null; // pending timer to ask about a remote terminal again
    this.looking = new Set(); // space + repo keys whose remote lazygit is being looked up by label
    this.terms = {}; // space id + repo root -> { address, at }
    this.view = null; // what the bar shows
    this.starting = false; // a start or restart is in flight
    this.cleaning = false; // a stale-terminal cleanup is in flight
    this.error = null;
    this.retry = null; // pending retry timer
    this.set = null; // { json, from, at } of the last terminal write, while it may not have landed
    this.want = null; // { spaceId, address }: what the terminal block should show
    this.syncing = null; // the pending terminal write
  }

  render(cx) {
    const t = theme();
    const root = layout();
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const space = spaces().find((s) => s.active);
    // The app drops a shown terminal block when its terminal ends, and with it the panel column
    // around the stack. Without the column the stack is still shown; put the layout back first.
    const onLazygit = !!body && body.active === "lazygit" && ["lazygit", "ghoul"].includes(shared("layout"));
    if (onLazygit && !panel) this.heal(root);
    const showing = onLazygit && (!panel || !panel.hidden);
    if (space && showing) this.work(space, root, cx);
    return this.bar(t, cx);
  }

  // Puts back what the app removed: the panel column around the stack, and the terminal block on the lazygit page.
  heal(root) {
    const next = JSON.parse(JSON.stringify(root));
    const body = find(next, "panel-body"), parent = parentOf(next, "panel-body");
    if (parent && !find(next, "panel")) {
      const size = body.size ?? { px: 520 };
      delete body.size;
      parent.children[parent.children.indexOf(body)] = { id: "panel", type: "column", size, min: 280, max: 900, children: [body] };
    }
    const page = find(next, "lazygit");
    if (page && !find(next, TERM)) page.children.push({ id: TERM, type: "block", hidden: true, content: { terminal: "none" } });
    const json = JSON.stringify(next);
    if (this.healed?.json === json && Date.now() - this.healed.at < 2000) return;
    this.healed = { json, at: Date.now() };
    run("layout.set", { layout: next });
  }

  // Runs only while the panel shows lazygit. Decides what the bar says and which terminal the block shows.
  work(space, root, cx) {
    this.cleanup(cx);
    const machine = machineOf(space);
    const folder = folderOf(space, machine);
    const fkey = `${machine ?? ""}\n${folder}`;
    const key = `${space.id}\n${fkey}`;
    // A known folder is shown at once from the cache; git checks it again in the background.
    if (this.key !== key) {
      this.key = key;
      this.resolve(machine, folder, cx);
    }
    const repo = this.roots.get(fkey);
    const why = this.unreachable.get(fkey);
    if (repo === undefined && why) {
      this.view = { kind: "unreachable", machine, folder, why };
      return this.syncTerm(space.id, null, cx);
    }
    if (repo === undefined) {
      // First look at this folder: show this space's lazygit if it has one, and never another space's.
      this.view = { kind: "checking", folder };
      const live = terminals().find((x) => x.state === "live" && x.labels?.[LABEL_SPACE] === space.id);
      return this.syncTerm(space.id, live?.address ?? null, cx);
    }
    if (!repo) {
      this.view = { kind: "norepo", folder };
      return this.syncTerm(space.id, null, cx);
    }
    const tkey = `${space.id}\n${repo}`;
    const address = this.addressFor(space.id, machine, repo, tkey, cx);
    this.view = { kind: "repo", repo, machine, space: space.id, tkey, address };
    this.syncTerm(space.id, address, cx);
  }

  // Asks git (here, or on the space's machine through hc) for the folder's repo root.
  resolve(machine, folder, cx) {
    const fkey = `${machine ?? ""}\n${folder}`;
    if (this.resolving.has(fkey)) return;
    this.resolving.add(fkey);
    cx.spawn(async (cx) => {
      const argv = machine ? withLocalBin(["git", "rev-parse", "--show-toplevel"]) : ["git", "-C", folder, "rev-parse", "--show-toplevel"];
      let r = null, err = null;
      try {
        r = await execOn(machine, folder, argv);
      } catch (e) {
        err = String(e?.message ?? e);
      }
      this.resolving.delete(fkey);
      // On a remote space, tell "not a repo" (git ran and said so, or the folder is gone: the only
      // spawn_failed, since sh always starts) apart from "could not reach the machine" and "no git there"
      // (sh's 127).
      const hcErr = machine ? hcError(r) : null;
      const why = !machine ? null
        : err ?? (hcErr && hcErr.kind !== "spawn_failed" ? hcErr.message : null)
        ?? (r?.code === 127 ? `git not found (${r.stderr?.trim() || "exit 127"})` : null);
      if (why) {
        // A folder seen before keeps its cached root, so one failed re-check doesn't hide a working
        // lazygit; whether that terminal is live is checked on its own.
        if (this.roots.get(fkey)) return;
        this.roots.delete(fkey);
        this.unreachable.set(fkey, why);
        return cx.notify();
      }
      this.unreachable.delete(fkey);
      const repo = r?.code === 0 ? r.stdout.trim() || null : null;
      if (this.roots.get(fkey) === repo) return;
      this.roots.set(fkey, repo);
      cx.notify();
    });
  }

  // Whether a terminal is live: true, false, or undefined while a remote one is being asked about.
  // The app may not list other machines' terminals, so a remote one it doesn't list is asked with
  // `hc get`. That is asked again only when the block is not showing it (it was just dropped, or is
  // about to be shown) and the last answer is older than RETRY_MS, so nothing polls.
  isLive(address, cx) {
    const listed = terminals().find((x) => x.address === address);
    if (listed) return listed.state === "live";
    if (!isRemote(address)) return false;
    const p = this.probes.get(address);
    const node = find(layout(), TERM);
    const shown = !!node && !node.hidden && node.content?.terminal === address;
    const age = p ? Date.now() - p.at : Infinity;
    // A fresh answer for a terminal that is not shown: look again once it is old enough.
    if (p && !shown && age <= RETRY_MS && !this.reprobe) {
      this.reprobe = cx.timer.after(RETRY_MS - age + 50, (cx) => {
        this.reprobe = null;
        cx.notify();
      });
    }
    if ((!p || (!shown && age > RETRY_MS)) && !this.probing.has(address)) {
      this.probing.add(address);
      cx.spawn(async (cx) => {
        const r = await exec("hc", ["get", address, "--json"]).catch(() => null);
        let live = false;
        try {
          live = r?.code === 0 && JSON.parse(r.stdout).state === "live";
        } catch {}
        this.probing.delete(address);
        this.probes.set(address, { live, at: Date.now() });
        cx.notify();
      });
    }
    return p?.live;
  }

  // Finds a live lazygit for this space and repo on a remote machine by its labels, for when this
  // controller did not start it (for example after the app restarted). Asks that machine's own hc.
  lookup(machine, spaceId, repo, tkey, cx) {
    if (this.looking.has(tkey)) return;
    this.looking.add(tkey);
    cx.spawn(async (cx) => {
      let address = null;
      try {
        const r = await execOn(machine, "", ["sh", "-c", 'PATH="$HOME/.local/bin:$PATH" exec hc ls --json "$@"', "sh",
          "--label", `${LABEL_SPACE}=${spaceId}`, "--label", `${LABEL_REPO}=${repo}`]);
        const t = r?.code === 0 ? JSON.parse(r.stdout).terminals?.find((x) => x.state === "live") : null;
        if (t?.address) address = `${machine}/${t.address}`;
      } catch {}
      this.looking.delete(tkey);
      // at: 0, so a lazygit that turns out to be gone is replaced at once.
      if (!this.terms[tkey]) this.terms[tkey] = { address, at: 0 };
      if (address) this.probes.set(address, { live: true, at: Date.now() });
      cx.notify();
    });
  }

  // The live lazygit for this space and repo: found by labels, else the one we started, else a new one.
  addressFor(spaceId, machine, repo, tkey, cx) {
    const all = terminals();
    const live = all.find((x) => x.state === "live" && x.labels?.[LABEL_SPACE] === spaceId && x.labels?.[LABEL_REPO] === repo);
    if (live) return live.address;
    if (this.starting) return null;
    if (machine && !this.terms[tkey]) {
      this.lookup(machine, spaceId, repo, tkey, cx);
      return null;
    }
    const rec = this.terms[tkey];
    if (rec?.address) {
      const state = this.isLive(rec.address, cx);
      if (state) return rec.address;
      if (state === undefined) return null;
    }
    // Finished (the person quit lazygit), gone, or never started: start one, at most once per RETRY_MS.
    const wait = rec ? RETRY_MS - (Date.now() - rec.at) : 0;
    if (wait > 0) {
      if (!this.retry) {
        this.retry = cx.timer.after(wait + 50, (cx) => {
          this.retry = null;
          cx.notify();
        });
      }
      return null;
    }
    this.start(spaceId, machine, repo, tkey, rec?.address ?? null, cx);
    return null;
  }

  // Starts a lazygit for a space and repo, here or on `machine`. `old` (if any) is killed and removed first.
  start(spaceId, machine, repo, tkey, old, cx) {
    this.starting = true;
    this.terms[tkey] = { address: null, at: Date.now() };
    cx.spawn(async (cx) => {
      try {
        if (old) {
          await exec("hc", ["kill", old]).catch(() => null);
          await exec("hc", ["rm", old]).catch(() => null);
        }
        const on = machine ? ["--on", machine] : [];
        const r = await exec("hc", ["run", "--bg", "--json", "--no-parent", ...on, "--cwd", repo, "--label", `${LABEL_SPACE}=${spaceId}`, "--label", `${LABEL_REPO}=${repo}`, "--", ...(machine ? withLocalBin(["lazygit"]) : ["lazygit"])]);
        let address = r.code === 0 ? JSON.parse(r.stdout).address : null;
        if (!address) throw new Error(hcError(r)?.message || r.stderr?.trim() || `hc exited with ${r.code}`);
        if (machine && !isRemote(address)) address = `${machine}/${address}`;
        this.terms[tkey] = { address, at: Date.now() };
        if (machine) this.probes.set(address, { live: true, at: Date.now() });
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.starting = false;
        cx.notify();
      }
    });
  }

  restart(cx) {
    const v = this.view;
    if (v?.kind === "unreachable") {
      // Ask the machine again.
      this.unreachable.delete(`${v.machine ?? ""}\n${v.folder}`);
      this.resolve(v.machine, v.folder, cx);
      return cx.notify();
    }
    // While a remote lookup is in flight the found lazygit isn't known yet; a start now would leave it running.
    if (v?.kind !== "repo" || this.starting || this.looking.has(v.tkey)) return;
    this.start(v.space, v.machine, v.repo, v.tkey, v.address, cx);
  }

  // Kills and removes lazygit terminals whose space is gone: those the app lists, and remote ones
  // this controller started (the app may not list other machines' terminals).
  cleanup(cx) {
    const ids = new Set(spaces().map((s) => s.id));
    if (this.cleaning || !ids.size) return;
    const stale = terminals().filter((x) => x.state === "live" && x.labels?.[LABEL_SPACE] && !ids.has(x.labels[LABEL_SPACE]))
      .map((x) => x.address);
    const gone = Object.keys(this.terms).filter((tkey) => !ids.has(tkey.split("\n")[0]));
    for (const tkey of gone) {
      const address = this.terms[tkey].address;
      if (isRemote(address) && !stale.includes(address)) stale.push(address);
      delete this.terms[tkey];
    }
    if (!stale.length) return;
    this.cleaning = true;
    cx.spawn(async (cx) => {
      try {
        for (const address of stale) {
          await exec("hc", ["kill", address]).catch(() => null);
          await exec("hc", ["rm", address]).catch(() => null);
          this.probes.delete(address);
        }
      } finally {
        this.cleaning = false;
        cx.notify();
      }
    });
  }

  // Makes the layout's terminal block show `address`, or hide it when `address` is null.
  // layout.set replaces the whole tree, so the write waits a moment and is built from a fresh layout():
  // on a space switch Herdr's tab bar restores that space's panel in the same frame, and a tree read
  // before its restore landed would undo it. The write is dropped if the space or page changed meanwhile.
  syncTerm(spaceId, address, cx) {
    this.want = { spaceId, address };
    if (this.syncing || matches(find(layout(), TERM), address)) return;
    this.syncing = cx.timer.after(SYNC_MS, (cx) => {
      this.syncing = null;
      const { spaceId, address } = this.want ?? {};
      const root = layout();
      const panel = find(root, "panel"), body = find(root, "panel-body"), node = find(root, TERM);
      if (!node || !["lazygit", "ghoul"].includes(shared("layout"))) return;
      if (spaces().find((s) => s.active)?.id !== spaceId) return;
      if (body?.active !== "lazygit" || panel?.hidden) return;
      this.writeTerm(root, node, address);
    });
  }

  // Writes the layout only when the terminal block differs from what is wanted.
  writeTerm(root, node, address) {
    if (matches(node, address)) return;
    const hidden = !address;
    // Skip only a repeat of a write that hasn't landed yet. Once the node has changed since, write
    // again at once, so quick A -> B -> A switches never leave B's terminal on screen.
    const json = JSON.stringify([address, hidden]);
    const from = JSON.stringify(node);
    if (this.set?.json === json && this.set.from === from && Date.now() - this.set.at < 2000) return;
    this.set = { json, from, at: Date.now() };
    const next = JSON.parse(JSON.stringify(root));
    const n = find(next, TERM);
    n.hidden = hidden;
    if (!hidden) n.content = { terminal: address };
    run("layout.set", { layout: next });
  }

  bar(t, cx) {
    const v = this.view ?? { kind: "checking" };
    const row = h_flex().id("lazygit-bar").size_full().min_w(0).px(10).gap(6).items_center()
      .bg(t.chrome).border_b(1).border_color(t.border).text_size(12);
    const head = (el) => el
      .child(svg("mods/lazygit-button/lazygit.svg").size(14).flex_none().text_color(t.muted))
      .child(div().flex_none().text_color(t.foreground).child("Lazygit"));
    if (v.kind === "repo") {
      const restart = div().id("lazygit-restart").size(22).flex_none().flex().items_center().justify_center().rounded(6)
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.restart(cx)).child("↻");
      const name = v.machine ? `${v.machine}: ${lastPart(v.repo)}` : lastPart(v.repo);
      const label = this.error && !v.address ? `Could not start lazygit: ${this.error}` : name;
      return head(row).child(div().flex_1().min_w(0).truncate().text_color(this.error && !v.address ? t.blocked : t.muted).child(label)).child(restart);
    }
    if (v.kind === "unreachable") {
      const retry = div().id("lazygit-retry").size(22).flex_none().flex().items_center().justify_center().rounded(6)
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.restart(cx)).child("↻");
      return head(row).child(div().flex_1().min_w(0).truncate().text_color(t.blocked).child(`Could not reach ${v.machine}: ${v.why}`)).child(retry);
    }
    const text = v.kind === "norepo" ? `Not a git repository: ${v.folder || "~"}` : "Checking repository…";
    return head(row).child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(text));
  }
}
