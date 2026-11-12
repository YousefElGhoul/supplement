import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../../dotfiles/herdr-app/.config/herdr-app/", import.meta.url);
const mod = new URL("mods/markdown-panel/", root);

async function fixture(entry = new URL("main.js", mod)) {
  const state = { focus: { space: "a", cwd: "/a" }, props: { docked: true }, commands: [], files: new Map() };
  const tasks = [];
  const cx = { notify() {}, timer: { after() {} }, spawn(fn) { tasks.push(Promise.resolve().then(() => fn(cx))); } };
  const context = vm.createContext({});
  const native = {
    "gpui-kit": { View: class {}, div() {}, svg() {}, image() {} },
    "gpui-base": { v_flex() {}, h_flex() {}, Editor: {}, EditorState: {}, TextView: {}, Textarea: {}, TextareaState: {} },
    herdr: {
      focused: () => state.focus, spaces: () => [{ id: "a", folder: "/a" }, { id: "b", folder: "/b", machine: "remote" }],
      props: () => state.props, home: () => "/home/test", appHome: () => "/config", theme: () => ({}), settings: () => ({}),
      panes: () => [], window: () => ({}), shared: () => [], layout: () => state.layout,
      nextCommand: () => new Promise(() => {}), openOverlay() {},
      run: (...args) => state.commands.push(args), closeOverlay: id => state.commands.push(["closeOverlay", id]),
      exec: async () => ({ code: 0, stdout: "README.md\n", stderr: "" }), watchFolder: () => new Promise(() => {}),
      readTextFile: async path => state.files.get(path) ?? null,
      writeTextFile: async (path, text, expected) => {
        if (state.files.get(path) !== expected) throw new Error("changed on disk");
        state.files.set(path, text);
      },
    },
  };
  const cache = new Map();
  async function load(url) {
    const key = String(url);
    if (cache.has(key)) return cache.get(key);
    const exports = native[key];
    const module = exports
      ? new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      }, { context, identifier: key })
      : new vm.SourceTextModule(await readFile(url, "utf8"), { context, identifier: key });
    cache.set(key, module);
    await module.link((specifier, parent) => load(native[specifier] ? specifier : new URL(specifier, parent.identifier)));
    return module;
  }
  const module = await load(entry);
  await module.evaluate();
  const doc = cache.get(String(new URL("doc.js", mod)))?.namespace;
  const blocks = cache.get(String(new URL("blocks.js", mod)))?.namespace;
  return { state, cx, doc, blocks, Panel: module.namespace.default, async drain() { while (tasks.length) await tasks.shift(); } };
}

test("Markdown blocks round-trip without touching file bytes", async () => {
  const { blocks } = await fixture();
  for (const text of ["", "# Hello\r\n\r\n世界\r\n", "---\nname: test\n---\n\n```js\na()\n```\n", "| a | b |\n| --- | ---: |\n| x\\|y | z |\n"]) {
    assert.equal(blocks.joinBlocks(blocks.parseBlocks(text)), text);
  }
  const table = blocks.parseTable(["| a | b |", "| --- | ---: |", "| x\\|y | z |"]);
  assert.equal(table.rows[0][0], "x|y");
  assert.match(blocks.tableLines(table)[2], /x\\\|y/);
});

test("autosave and flush refuse concurrent disk edits", async () => {
  const f = await fixture();
  f.state.files.set("/a/readme.md", "original");
  const doc = new f.doc.MarkdownDoc("/a/readme.md");
  doc.load(f.cx); await f.drain();
  doc.text = "edited"; doc.save(f.cx); await f.drain();
  assert.equal(f.state.files.get(doc.path), "edited");
  doc.text = "my draft";
  f.state.files.set(doc.path, "agent draft");
  assert.equal(await doc.flush(), false);
  assert.equal(doc.conflict, true);
  assert.equal(f.state.files.get(doc.path), "agent draft");
  doc.takeTheirs(f.cx);
  assert.equal(doc.text, "agent draft");
});

test("remote documents stay read only and links get the current context", async () => {
  const f = await fixture();
  let followed;
  const doc = new f.doc.MarkdownDoc("/a/readme.md", "remote", (...args) => { followed = args; });
  doc.saved = "old"; doc.text = "new";
  assert.equal(doc.canEdit, false);
  assert.equal(await doc.flush(), true);
  assert.equal(f.state.files.size, 0);
  doc.follow("other.md", f.cx);
  assert.equal(followed[0], "/a/other.md");
  assert.equal(followed[1], f.cx);
});

test("docked Close saves before hiding and keeps conflicts visible", async () => {
  const f = await fixture();
  const panel = new f.Panel();
  let released = false;
  panel.doc = { flush: async () => false, release() { released = true; } };
  panel.dismiss(f.cx); await f.drain();
  assert.equal(f.state.commands.length, 0);
  assert.equal(released, false);
  panel.doc.flush = async () => true;
  panel.dismiss(f.cx); await f.drain();
  assert.equal(released, true);
  assert.equal(f.state.commands[0][0], "layout.hide");
  assert.equal(f.state.commands[0][1].id, "panel");
  assert.equal(panel.doc, null);
});

test("lifecycle cleanup awaits the save without spawning work", async () => {
  const { Panel } = await fixture();
  const panel = new Panel();
  const events = [];
  panel.doc = { async flush() { await Promise.resolve(); events.push("saved"); return true; }, release() { events.push("released"); } };
  await panel.close();
  assert.deepEqual(events, ["saved", "released"]);
});

test("space changes never discard unsaved or conflicted documents", async () => {
  const f = await fixture();
  const panel = new f.Panel();
  panel.space = "a";
  panel.doc = { dirty: true, conflict: false, release() {} };
  f.state.focus = { space: "b", cwd: "/b" };
  panel.syncPlace(f.cx);
  assert.equal(panel.space, "a");
  panel.doc.dirty = false; panel.doc.conflict = true;
  panel.syncPlace(f.cx);
  assert.equal(panel.space, "a");
  panel.doc.conflict = false;
  panel.syncPlace(f.cx); await f.drain();
  assert.equal(panel.space, "b");
  assert.equal(panel.on, "remote");
  assert.equal(panel.folder, "/b");
  assert.equal(panel.doc, null);
});

test("Ghoul wires Markdown to the existing panel with internal assets", async () => {
  const layout = JSON.parse(await readFile(new URL("layouts/ghoul.json", root), "utf8"));
  const find = (node, id) => node.id === id ? node : node.children?.map(child => find(child, id)).find(Boolean);
  const stack = find(layout, "panel-body");
  assert.equal(stack.type, "stack");
  const markdown = stack.children.find(child => child.id === "markdown");
  assert.deepEqual(markdown.content, { mod: "markdown-panel", props: { docked: true } });
  assert.equal(layout.theme.dark, "catppuccin-mocha");
  const tabs = await readFile(new URL("mods/tabs-ghoul/main.js", root), "utf8");
  assert.match(tabs, /panelButton\("markdown", "Markdown", "mods\/markdown-panel\/icons\/markdown.svg"\)/);
  assert.match(await readFile(new URL("icons/markdown.svg", mod), "utf8"), /<svg/);
  const review = await readFile(new URL("md-review", mod), "utf8");
  assert.match(review, /layout.select --stack panel-body --child markdown/);
  const keys = JSON.parse(await readFile(new URL("keys.json", root), "utf8"));
  assert.equal(keys["layout:ghoul"]["ctrl-shift-m"], "tabs-ghoul.markdown");
  assert.equal(keys["layout:ghoul"]["cmd-shift-m"], "tabs-ghoul.markdown");
});

test("the toolbar and shortcut toggle the same dock without overlays", async () => {
  const f = await fixture(new URL("mods/tabs-ghoul/main.js", root));
  f.state.layout = { id: "root", children: [{ id: "panel", hidden: true, children: [{ id: "panel-body", active: "github" }] }] };
  const tabs = new f.Panel();
  tabs.togglePanel("markdown");
  assert.equal(f.state.commands[0][0], "layout.select");
  assert.equal(f.state.commands[0][1].child, "markdown");
  assert.equal(f.state.commands[1][0], "layout.show");
  f.state.layout.children[0].hidden = false;
  f.state.layout.children[0].children[0].active = "markdown";
  tabs.togglePanel("markdown");
  assert.equal(f.state.commands[2][0], "layout.hide");
});

test("md-review selects Ghoul's dock without opening a duplicate overlay", async () => {
  const temp = await mkdtemp("/tmp/opencode/markdown-review-test-");
  try {
    await writeFile(`${temp}/note.md`, "# Review\n");
    await writeFile(`${temp}/herdr-app`, '#!/bin/sh\nif [ "$1" = status ]; then printf \'{ "layout": "ghoul" }\\n\'; else printf "%s\\n" "$*" >> "$LOG"; fi\n');
    await chmod(`${temp}/herdr-app`, 0o755);
    await promisify(execFile)("sh", [new URL("md-review", mod).pathname, "--no-wait", `${temp}/note.md`], {
      env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, HERDR_APP_HOME: temp, HC_TERMINAL_ID: "test", LOG: `${temp}/calls` },
    });
    assert.equal(await readFile(`${temp}/calls`, "utf8"), "do layout.select --stack panel-body --child markdown\ndo layout.show --id panel\n");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
