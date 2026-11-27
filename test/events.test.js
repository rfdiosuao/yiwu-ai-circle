"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const qrcode = require("../lib/qrcode");

const root = path.resolve(__dirname, "..");
const adminPassword = crypto.randomBytes(20).toString("hex");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d8a8a70000000049454e44ae426082", "hex");
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(4000, 7)]);

async function start(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yiwu-events-"));
  const env = { ...process.env, NODE_ENV: "development", PORT: "0", HOST: "127.0.0.1", DATA_DIR: dir,
    SESSION_SECRET: crypto.randomBytes(32).toString("hex"), ADMIN_USER: "events-admin", ADMIN_PASS: adminPassword,
    SMS_MODE: "demo", COOKIE_SECURE: "0", TRUST_PROXY: "0", PUBLIC_URL: "https://ywai.example.com" };
  let log = "";
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", c => { log += c; });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("startup timeout: " + log)), 5000);
    child.stdout.on("data", chunk => {
      log += chunk;
      const m = log.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timeout); resolve(Number(m[1])); }
    });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error("startup exit " + code + ": " + log)); });
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const done = once(child, "exit"); child.kill(); await done; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + port;
  async function request(method, endpoint, body, cookie, headers = {}) {
    const res = await fetch(base + endpoint, { method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data, headers: res.headers, cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
  }
  const login = await request("POST", "/api/admin/login", { user: "events-admin", pass: adminPassword });
  assert.equal(login.status, 200);
  return { request, admin: login.cookie, base, dir };
}

async function createEvent(app, extra) {
  const poster = await app.request("POST", "/api/admin/uploads", { name: "poster.png", kind: "image", data: PNG.toString("base64") }, app.admin);
  const music = await app.request("POST", "/api/admin/uploads", { name: "bg.mp3", kind: "audio", data: MP3.toString("base64") }, app.admin);
  assert.equal(poster.status, 200);
  assert.equal(music.status, 200);
  const created = await app.request("POST", "/api/admin/events", Object.assign({
    title: "义乌AI圈春季选品对接会", place: "国际商贸城二区", startAt: "2026-12-20T14:00",
    poster: poster.data.upload.id, music: music.data.upload.id,
    fields: { name: "required", company: "optional", project: "optional" }, status: "open"
  }, extra || {}), app.admin);
  assert.equal(created.status, 200);
  return created.data.event;
}

test("QR encoder produces a valid symbol size and quiet-zone SVG", () => {
  const qr = qrcode.encode("https://ywai.example.com/e/spring-2026", { ecl: "M" });
  assert.equal(qr.size, qr.version * 4 + 17);
  assert.equal(qr.modules.length, qr.size);
  const svg = qrcode.toSvg(qr);
  assert.match(svg, /^<\?xml/);
  assert.match(svg, new RegExp('viewBox="0 0 ' + (qr.size + 8) + " " + (qr.size + 8) + '"'));
});

test("admins create events from uploads; drafts stay private; QR points at PUBLIC_URL", async t => {
  const app = await start(t);
  assert.equal((await app.request("POST", "/api/admin/uploads", { name: "x.exe", data: Buffer.from("MZ" + "\0".repeat(30)).toString("base64") }, app.admin)).status, 415);
  assert.equal((await app.request("POST", "/api/admin/uploads", { name: "p.png", kind: "audio", data: PNG.toString("base64") }, app.admin)).status, 415);
  assert.equal((await app.request("POST", "/api/admin/events", { title: "未登录" })).status, 401);

  const draft = await createEvent(app, { status: "draft" });
  assert.equal(draft.url, "https://ywai.example.com/e/" + draft.slug);
  assert.equal((await app.request("GET", "/api/events/" + draft.slug)).status, 404);
  assert.equal((await app.request("GET", "/api/events/" + draft.slug, undefined, app.admin)).status, 200);
  assert.equal((await app.request("POST", "/api/events/" + draft.slug + "/register", { phone: "13900001111", name: "王", consent: true })).status, 404);

  const qr = await fetch(app.base + "/api/admin/events/" + draft.id + "/qr.svg", { headers: { Cookie: app.admin } });
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get("content-type"), /image\/svg\+xml/);
  assert.equal((await fetch(app.base + "/api/admin/events/" + draft.id + "/qr.svg")).status, 401);

  const open = await app.request("PATCH", "/api/admin/events/" + draft.id, { status: "open", slug: "spring-2026" }, app.admin);
  assert.equal(open.status, 200);
  const pub = await app.request("GET", "/api/events/spring-2026");
  assert.equal(pub.data.event.state, "open");
  assert.match(pub.data.event.posterUrl, /^\/uploads\/[a-f0-9]{24}\.png$/);
  assert.equal(pub.data.event.id, undefined);

  const page = await fetch(app.base + "/e/spring-2026");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /data-ev/);

  const range = await fetch(app.base + pub.data.event.musicUrl, { headers: { Range: "bytes=0-99" } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 0-99/" + MP3.length);
  assert.equal((await range.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(app.base + "/uploads/../db.json")).status, 404);
});

test("registration validates, de-duplicates by phone and respects capacity and status", async t => {
  const app = await start(t);
  const ev = await createEvent(app, { capacity: 2 });
  const reg = body => app.request("POST", "/api/events/" + ev.slug + "/register", body);

  const invalid = await reg({ phone: "123", consent: false });
  assert.equal(invalid.status, 400);
  assert.deepEqual(Object.keys(invalid.data.errors).sort(), ["consent", "name", "phone"]);

  assert.deepEqual((await reg({ phone: "13900001111", name: "王老板", company: "三立注塑", project: "找中东物流", consent: true })).data, { ok: true, updated: false });
  assert.deepEqual((await reg({ phone: "139 0000 1111", name: "王总", consent: true })).data, { ok: true, updated: true });
  assert.equal((await reg({ phone: "13900002222", name: "李姐", consent: true })).status, 200);
  const full = await reg({ phone: "13900003333", name: "赵", consent: true });
  assert.equal(full.status, 409);
  assert.equal(full.data.error, "event_full");
  assert.equal((await reg({ phone: "13900002222", name: "李总", consent: true })).status, 200);

  const leads = (await app.request("GET", "/api/admin/leads?event=" + ev.id, undefined, app.admin)).data.leads;
  assert.equal(leads.length, 2);
  const wang = leads.find(l => l.phone === "13900001111");
  assert.equal(wang.name, "王总");
  assert.equal(wang.company, "三立注塑", "blank fields on a repeat submission keep earlier answers");
  assert.equal(wang.submits, 2);

  assert.equal((await app.request("PATCH", "/api/admin/events/" + ev.id, { status: "closed" }, app.admin)).status, 200);
  assert.equal((await reg({ phone: "13900001111", name: "王", consent: true })).data.error, "event_closed");
  assert.equal((await app.request("DELETE", "/api/admin/events/" + ev.id, undefined, app.admin)).status, 409);
});

test("leads are admin-only, follow-up is audited and CSV export is Excel-safe", async t => {
  const app = await start(t);
  const ev = await createEvent(app);
  await app.request("POST", "/api/events/" + ev.slug + "/register", { phone: "13900005555", name: "=HYPERLINK(\"x\")", company: "+cmd", consent: true });
  assert.equal((await app.request("GET", "/api/admin/leads")).status, 401);
  assert.equal((await fetch(app.base + "/api/admin/leads.csv")).status, 401);

  const lead = (await app.request("GET", "/api/admin/leads", undefined, app.admin)).data.leads[0];
  assert.equal((await app.request("PATCH", "/api/admin/leads/" + lead.id, { status: "nope" }, app.admin)).status, 400);
  assert.equal((await app.request("PATCH", "/api/admin/leads/" + lead.id, { status: "contacted", note: "已加微信" }, app.admin)).status, 200);

  const csv = await fetch(app.base + "/api/admin/leads.csv?event=" + ev.id, { headers: { Cookie: app.admin } });
  assert.equal(csv.status, 200);
  const bytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM so Excel shows Chinese correctly");
  const text = bytes.toString("utf8");
  assert.match(text, /"'=HYPERLINK\(""x""\)"/);
  assert.match(text, /"'\+cmd"/);
  assert.match(text, /"已联系","已加微信"/);

  const auditLog = (await app.request("GET", "/api/admin/audit", undefined, app.admin)).data.items.map(i => i.action);
  assert.ok(auditLog.includes("导出客资"));
  assert.ok(auditLog.includes("跟进客资"));
});
