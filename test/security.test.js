"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/admin-data.js"), "utf8");
const secret = crypto.randomBytes(32).toString("hex");
const adminPassword = crypto.randomBytes(20).toString("hex");

function frontend(fetchImpl) {
  const storage = new Map([["ywai.admin.db.v1", "old private data"]]);
  const window = { addEventListener() {} };
  vm.runInNewContext(source, {
    window, fetch: fetchImpl, setTimeout, clearTimeout,
    localStorage: { removeItem: key => storage.delete(key), setItem: (k, v) => storage.set(k, v) }
  });
  return { api: window.AdminDB, storage };
}
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
function blankDoc() {
  return require("../lib/admin-seed").seed({ demo: false });
}

async function start(t, extra = {}, existingDir) {
  const dir = existingDir || fs.mkdtempSync(path.join(os.tmpdir(), "yiwu-security-"));
  const env = { ...process.env, NODE_ENV: "development", PORT: "0", HOST: "127.0.0.1",
    DATA_DIR: dir, SESSION_SECRET: secret, ADMIN_USER: "review-admin", ADMIN_PASS: adminPassword,
    SMS_MODE: "demo", COOKIE_SECURE: "0", TRUST_PROXY: "0", PUBLIC_URL: "https://ywai.example.com", ...extra };
  let log = "";
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", c => { log += c; });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("startup timeout: " + log)), 5000);
    child.stdout.on("data", chunk => {
      log += chunk;
      const match = log.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error("startup exit " + code + ": " + log)); });
  });
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) {
      const done = once(child, "exit"); child.kill(); await done;
    }
  }
  t.after(async () => { await stop(); if (!existingDir) fs.rmSync(dir, { recursive: true, force: true }); });
  const port = await ready;
  const url = "http://127.0.0.1:" + port;
  async function request(method, endpoint, body, cookie, headers = {}) {
    const res = await fetch(url + endpoint, { method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json();
    return { status: res.status, data, cookie: (res.headers.get("set-cookie") || "").split(";")[0], headers: res.headers };
  }
  async function login() {
    const result = await request("POST", "/api/admin/login", { user: env.ADMIN_USER, pass: env.ADMIN_PASS });
    assert.equal(result.status, 200); return result.cookie;
  }
  return { request, login, stop, dir, url, logs: () => log };
}

test("admin transactions validate the document, revision, and session", async t => {
  const app = await start(t);
  assert.equal((await app.request("GET", "/api/admin/db")).status, 401);
  const cookie = await app.login();
  let loaded = await app.request("GET", "/api/admin/db", undefined, cookie);
  assert.equal(loaded.data.rev, 1);
  assert.ok(loaded.data.doc.products.length > 0);
  assert.equal(loaded.data.account.source, "env");

  for (const rev of [undefined, "1", null]) {
    assert.equal((await app.request("PUT", "/api/admin/db", { doc: blankDoc(), rev }, cookie)).data.error, "invalid_revision");
  }

  for (const change of [
    doc => { doc.merchants = [null]; },
    doc => { doc.settings = []; },
    doc => { doc.settings.admin.pass = "unexpected"; },
    doc => { doc.settings.pay.trialDays = "1"; },
    doc => { doc.stats.revenue = [-1]; },
    doc => { doc.products = [require("../lib/admin-seed").seed().products[0]]; doc.products[0].id = "invalid id"; }
  ]) {
    const doc = blankDoc(); change(doc);
    assert.equal((await app.request("PUT", "/api/admin/db", { doc, rev: 1 }, cookie)).data.error, "invalid_doc");
  }
  const doc = loaded.data.doc;
  doc.settings.siteName = "审核测试站";
  const writes = await Promise.all([1, 2].map(() => app.request("PUT", "/api/admin/db", { doc, rev: 1 }, cookie)));
  assert.deepEqual(writes.map(r => r.status).sort(), [200, 409]);
  loaded = await app.request("GET", "/api/admin/db", undefined, cookie);
  assert.equal(loaded.data.doc.settings.siteName, "审核测试站");
  assert.equal(loaded.data.rev, 2);
  assert.equal((await app.request("GET", "/api/admin/audit", undefined, cookie)).data.items[0].action, "保存后台数据");
  assert.equal((await app.request("POST", "/api/admin/logout", undefined, cookie)).status, 200);
  assert.equal((await app.request("GET", "/api/admin/db", undefined, cookie)).status, 401);
});

test("admin client stops live operations when the document write conflicts", async () => {
  const calls = [];
  const f = frontend(async (url, opts) => {
    calls.push(opts.method + " " + url);
    if (opts.method === "GET") return reply(200, { ok: true, doc: blankDoc(), rev: 1, demoAllowed: true });
    return reply(409, { ok: false, error: "conflict" });
  });
  await f.api.pull();
  assert.equal(f.storage.size, 0);
  f.api.db.users.push({ id: "local-new-user", name: "New user" });
  const first = f.api.push();
  assert.strictEqual(f.api.push(), first);
  await first;
  assert.equal(f.api.isOnline(), false);
  assert.deepEqual(calls, ["GET /api/admin/db", "PUT /api/admin/db"]);
});

test("SMS provider garbage 200 cannot authenticate; failures lock consistently", async t => {
  let mode = "garbage";
  const mock = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(req.url === "/send" ? '{"ok":true}' : mode === "garbage" ? "<html>bad gateway</html>" : '{"ok":false}');
  }).listen(0, "127.0.0.1");
  await once(mock, "listening");
  t.after(() => mock.close());
  const base = "http://127.0.0.1:" + mock.address().port;
  const app = await start(t, { SMS_MODE: "api", SMS_SEND_URL: base + "/send", SMS_VERIFY_URL: base + "/verify" });
  const phone = "13800138199";
  assert.equal((await app.request("POST", "/api/auth/send", { phone })).status, 200);
  assert.equal((await app.request("POST", "/api/auth/session", { phone, code: "123456" })).status, 502);
  mode = "wrong";
  const results = [];
  for (let i = 0; i < 5; i++) results.push((await app.request("POST", "/api/auth/session", { phone, code: "000000" })).status);
  assert.deepEqual(results, [401, 401, 401, 401, 429]);
});

test("production rejects weak config before listen; blocks demo, enforces Secure cookies", async t => {
  const invalidDir = fs.mkdtempSync(path.join(os.tmpdir(), "yiwu-invalid-"));
  t.after(() => fs.rmSync(invalidDir, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["server.js"], { cwd: root, windowsHide: true, env: {
    ...process.env, DATA_DIR: invalidDir, PORT: "0", NODE_ENV: "production", SMS_MODE: "demo", SESSION_SECRET: "short", ADMIN_USER: "admin", ADMIN_PASS: "ywai2026"
  }});
  let output = "";
  child.stdout.on("data", c => { output += c; });
  child.stderr.on("data", c => { output += c; });
  const [code] = await once(child, "exit");
  assert.equal(code, 1); assert.ok(!output.includes("http://"));
  assert.ok(output.includes("configuration invalid"));
  const app = await start(t, { NODE_ENV: "production", SMS_MODE: "api", COOKIE_SECURE: "1",
    TRUST_PROXY: "1", SMS_SEND_URL: "http://127.0.0.1:9/send", SMS_VERIFY_URL: "http://127.0.0.1:9/verify" });
  const auth = await app.request("POST", "/api/admin/login", { user: "review-admin", pass: adminPassword }, undefined, { "X-Forwarded-Proto": "https" });
  assert.equal(auth.status, 200);
  assert.match(auth.headers.get("set-cookie"), /; Secure/);
  assert.match(auth.headers.get("strict-transport-security"), /max-age=/);
  assert.equal((await app.request("GET", "/api/admin/db", undefined, auth.cookie)).data.demoAllowed, false);
  const data = await app.request("GET", "/api/admin/db", undefined, auth.cookie);
  assert.deepEqual(data.data.doc.orders, []);
  assert.deepEqual(data.data.doc.merchants, []);
  assert.equal((await app.request("POST", "/api/admin/reset", undefined, auth.cookie)).status, 403);
});

test("credential rotation invalidates old cookies with the same session signing secret", async t => {
  const app = await start(t);
  const old = await app.login();
  await app.stop();
  const next = await start(t, { ADMIN_PASS: crypto.randomBytes(20).toString("hex") }, app.dir);
  assert.equal((await next.request("GET", "/api/admin/db", undefined, old)).status, 401);
  const cookie = await next.login();
  assert.equal((await next.request("GET", "/api/admin/db", undefined, cookie)).status, 200);
  await next.stop();
});

test("direct requests cannot evade administrator rate limits with spoofed forwarding headers", async t => {
  const app = await start(t);
  const statuses = [];
  for (let i = 0; i < 9; i++) {
    statuses.push((await app.request("POST", "/api/admin/login", { user: "review-admin", pass: "wrong" }, undefined, { "X-Forwarded-For": "192.0.2." + i })).status);
  }
  assert.deepEqual(statuses, Array(8).fill(401).concat(429));
});

test("moderation hides the post, comments and reactions while retaining built-in post interactions", async t => {
  const app = await start(t);
  const admin = await app.login();
  const phone = "13800138196";
  const otp = await app.request("POST", "/api/auth/send", { phone });
  assert.equal(otp.status, 200);
  const member = await app.request("POST", "/api/auth/session", { phone, code: otp.data.demoCode });
  assert.equal(member.status, 200);
  const created = await app.request("POST", "/api/posts", { title: "回归帖子", body: "验证隐藏操作" }, member.cookie);
  const id = created.data.post.id;
  assert.equal((await app.request("POST", "/api/posts/" + id + "/comments", { text: "回归评论" }, member.cookie)).status, 200);
  assert.equal((await app.request("POST", "/api/posts/" + id + "/react", { kind: "like" }, member.cookie)).status, 200);
  assert.equal((await app.request("PATCH", "/api/admin/posts/" + id, { status: "hidden" }, admin)).status, 200);
  const feed = (await app.request("GET", "/api/posts")).data;
  assert.ok(!feed.posts.some(post => post.id === id));
  assert.equal(feed.reactions[id], undefined);
  assert.equal(feed.comments[id], undefined);
  assert.equal((await app.request("POST", "/api/posts/" + id + "/comments", { text: "新评论" }, member.cookie)).status, 404);
  assert.equal((await app.request("POST", "/api/posts/p0/react", { kind: "like" }, member.cookie)).status, 200);
});

test("production keeps an existing admin catalog and its revision during upgrade", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yiwu-upgrade-"));
  const doc = require("../lib/admin-seed").seed();
  doc.settings.siteName = "已运营资料";
  fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify({ admin: doc, adminRev: 7 }));
  const app = await start(t, { NODE_ENV: "production", SMS_MODE: "api", COOKIE_SECURE: "1",
    SMS_SEND_URL: "http://127.0.0.1:9/send", SMS_VERIFY_URL: "http://127.0.0.1:9/verify" }, dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cookie = await app.login();
  const result = await app.request("GET", "/api/admin/db", undefined, cookie);
  assert.equal(result.data.rev, 7);
  assert.equal(result.data.doc.settings.siteName, "已运营资料");
  assert.ok(result.data.doc.products.length > 0);
  result.data.doc.settings.tagline = "升级后的修改";
  const saved = await app.request("PUT", "/api/admin/db", { rev: result.data.rev, doc: result.data.doc }, cookie);
  assert.equal(saved.data.rev, 8);
});
