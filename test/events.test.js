"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const qrcode = require("../lib/qrcode");

const root = path.resolve(__dirname, "..");
const adminPassword = crypto.randomBytes(20).toString("hex");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d8a8a70000000049454e44ae426082", "hex");
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(4000, 7)]);

async function start(t, extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yiwu-events-"));
  const env = { ...process.env, NODE_ENV: "development", PORT: "0", HOST: "127.0.0.1", DATA_DIR: dir,
    SESSION_SECRET: crypto.randomBytes(32).toString("hex"), ADMIN_USER: "events-admin", ADMIN_PASS: adminPassword,
    SMS_MODE: "demo", COOKIE_SECURE: "0", TRUST_PROXY: "0", PUBLIC_URL: "https://ywai.example.com", ...(extraEnv || {}) };
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

/* 本机假 SMTP 服务器：记下登录信息、收件人和整封邮件 */
async function fakeSmtp(t) {
  const mails = [];
  const server = net.createServer(sock => {
    let buf = "";
    let inData = false;
    let mail = { rcpt: [], auth: "", data: "" };
    sock.write("220 fake.smtp ready\r\n");
    sock.on("data", chunk => {
      buf += chunk.toString("utf8");
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end < 0) return;
        mail.data = buf.slice(0, end);
        buf = buf.slice(end + 5);
        inData = false;
        mails.push(mail);
        mail = { rcpt: [], auth: mail.auth, data: "" };
        sock.write("250 queued\r\n");
      }
      let i;
      while (!inData && (i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (/^EHLO/i.test(line)) sock.write("250-fake.smtp\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (/^AUTH PLAIN /i.test(line)) { mail.auth = Buffer.from(line.slice(11), "base64").toString("utf8"); sock.write("235 ok\r\n"); }
        else if (/^MAIL FROM:/i.test(line)) { mail.from = line.slice(10); sock.write("250 ok\r\n"); }
        else if (/^RCPT TO:/i.test(line)) { mail.rcpt.push(line.slice(8)); sock.write("250 ok\r\n"); }
        else if (/^DATA/i.test(line)) { inData = true; sock.write("354 go\r\n"); }
        else if (/^QUIT/i.test(line)) { sock.end("221 bye\r\n"); }
        else sock.write("500 what\r\n");
      }
    });
    sock.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(r => server.close(r)));
  return { port: server.address().port, mails };
}

async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise(r => setTimeout(r, 50));
  }
  return null;
}

/* 取出 MIME 里某一段 base64 内容并解码 */
function mimePart(raw, contentType) {
  const at = raw.indexOf("Content-Type: " + contentType);
  if (at < 0) return null;
  const body = raw.slice(raw.indexOf("\r\n\r\n", at) + 4);
  return Buffer.from(body.slice(0, body.indexOf("\r\n--")).replace(/\r\n/g, ""), "base64");
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

  assert.deepEqual((await reg({ phone: "13900001111", name: "王老板", company: "三立注塑", project: "找中东物流", consent: true })).data, { ok: true, updated: false, mail: "" });
  assert.deepEqual((await reg({ phone: "139 0000 1111", name: "王总", consent: true })).data, { ok: true, updated: true, mail: "" });
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

test("events carry host, sponsor lists and invitation settings; the public QR points at PUBLIC_URL", async t => {
  const app = await start(t);
  const ev = await createEvent(app);
  assert.equal(ev.host, "义乌AI圈", "new events default to the platform as host");
  assert.deepEqual(ev.invite, { enabled: true, style: "crimson", message: "", greeting: "", signature: "", date: "" });

  const patch = body => app.request("PATCH", "/api/admin/events/" + ev.id, body, app.admin);
  assert.equal((await patch({ invite: { style: "gold-leaf" } })).status, 400);
  assert.equal((await patch({ invite: { message: "长".repeat(601) } })).status, 400);
  assert.equal((await patch({ invite: { message: "长".repeat(600) } })).status, 200, "a full letter fits");
  const saved = await patch({
    host: "义乌AI圈 × 青口直播基地",
    orgs: { sponsors: "甲物流、乙支付，甲物流", partners: ["青口直播基地", " ", "北下朱选品站"], supporters: "\n" },
    invite: { style: "ink", message: "诚邀您来现场。" }
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.event.orgs, [
    { label: "赞助方", names: ["甲物流", "乙支付"] },
    { label: "合作方", names: ["青口直播基地", "北下朱选品站"] }
  ], "the old { sponsors, partners, supporters } shape still works and empty groups are dropped");

  const pub = (await app.request("GET", "/api/events/" + ev.slug)).data.event;
  assert.equal(pub.host, "义乌AI圈 × 青口直播基地");
  assert.equal(pub.invite.style, "ink");
  assert.equal(pub.invite.message, "诚邀您来现场。");
  const expected = qrcode.encode("https://ywai.example.com/e/" + ev.slug, { ecl: "M" }).modules
    .map(r => r.map(d => (d ? "1" : "0")).join(""));
  assert.deepEqual(pub.qr, expected, "invitation and poster QR encode the public sign-up link");

  assert.equal((await patch({ invite: { enabled: false } })).status, 200);
  const off = (await app.request("GET", "/api/events/" + ev.slug)).data.event;
  assert.equal(off.invite, null);
  assert.deepEqual(off.qr, expected, "the share poster still gets its QR when invitations are off");
  assert.equal(off.host, "义乌AI圈 × 青口直播基地", "turning the invitation off keeps other settings");
});

test("long-poster content: end time, agenda, talks, notice, key visual and custom organizer roles", async t => {
  const app = await start(t);
  const ev = await createEvent(app);
  assert.deepEqual([ev.endAt, ev.agenda, ev.talks, ev.notice, ev.orgs], ["", [], [], "", []]);
  const patch = body => app.request("PATCH", "/api/admin/events/" + ev.id, body, app.admin);

  assert.equal((await patch({ endAt: "2026-12-20 17:00" })).status, 400, "end time uses the same local format");
  const early = await patch({ endAt: "2026-12-20T13:00" });
  assert.equal(early.status, 400);
  assert.equal(early.data.message, "结束时间要晚于开始时间");
  assert.equal((await patch({ startAt: "2026-12-20T18:00", endAt: "2026-12-20T17:00" })).status, 400, "checked against the new start time too");
  assert.equal((await patch({ agenda: "13:30 签到" })).status, 400);
  assert.equal((await patch({ agenda: Array.from({ length: 17 }, (_, i) => ({ time: String(i), item: "环节" + i })) })).status, 400);
  assert.equal((await patch({ talks: Array.from({ length: 13 }, (_, i) => ({ title: "议题" + i })) })).status, 400);
  assert.equal((await patch({ notice: "停".repeat(201) })).status, 400);
  assert.equal((await patch({ orgs: Array.from({ length: 9 }, (_, i) => ({ label: "单位" + i, names: "甲" })) })).status, 400);
  const audio = await app.request("POST", "/api/admin/uploads", { name: "bg.mp3", kind: "audio", data: MP3.toString("base64") }, app.admin);
  assert.equal((await patch({ visual: audio.data.upload.id })).status, 400, "key visual must be an image");

  const visual = await app.request("POST", "/api/admin/uploads", { name: "kv.png", kind: "image", data: PNG.toString("base64") }, app.admin);
  const saved = await patch({
    endAt: "2026-12-20T17:00",
    visual: visual.data.upload.id,
    agenda: [{ time: " 13:30-14:00 ", item: " 签到 " }, { time: "14:00", item: "" }, null, { item: "交流环节" }],
    talks: [{ title: "《AI 选品实战》", speaker: "张老师", role: "选品顾问" }, { title: " ", speaker: "无题目" }, { title: "跨境直播" }],
    notice: "  现场车位有限，建议公共交通。 ",
    orgs: [{ label: "指导单位", names: "义乌市示例协会" }, { label: "", names: ["甲物流", "乙支付"] }, { label: "协办单位", names: "" }]
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const e = saved.data.event;
  assert.deepEqual(e.agenda, [{ time: "13:30-14:00", item: "签到" }, { time: "", item: "交流环节" }]);
  assert.deepEqual(e.talks, [{ title: "AI 选品实战", speaker: "张老师", role: "选品顾问" }, { title: "跨境直播", speaker: "", role: "" }]);
  assert.equal(e.notice, "现场车位有限，建议公共交通。");
  assert.deepEqual(e.orgs, [{ label: "指导单位", names: ["义乌市示例协会"] }, { label: "支持单位", names: ["甲物流", "乙支付"] }]);
  assert.match(e.visualUrl, /^\/uploads\/[a-f0-9]{24}\.png$/);

  const pub = (await app.request("GET", "/api/events/" + ev.slug)).data.event;
  assert.equal(pub.endAt, "2026-12-20T17:00");
  assert.equal(pub.visualUrl, e.visualUrl);
  assert.deepEqual(pub.agenda, e.agenda);
  assert.deepEqual(pub.talks, e.talks);
  assert.equal(pub.notice, e.notice);
  assert.deepEqual(pub.orgs, e.orgs);
  assert.equal(pub.visual, undefined, "upload ids stay private");

  assert.equal((await patch({ invite: { style: "tech" } })).status, 200);
  assert.equal((await app.request("GET", "/api/events/" + ev.slug)).data.event.invite.style, "tech");

  /* 信件式邀请函：抬头、落款、落款日期；顶部 Logo、主视觉位置、报名咨询、底部标语 */
  assert.equal((await patch({ invite: { greeting: "各".repeat(21) } })).status, 400);
  assert.equal((await patch({ invite: { signature: "落".repeat(41) } })).status, 400);
  assert.equal((await patch({ invite: { date: "2026/11/27" } })).status, 400);
  assert.equal((await patch({ invite: { date: "2026-13-45" } })).status, 400);
  assert.equal((await patch({ visualAt: "left" })).status, 400);
  assert.equal((await patch({ contact: "1".repeat(41) })).status, 400);
  assert.equal((await patch({ slogan: "标".repeat(31) })).status, 400);
  assert.equal((await patch({ logos: "not-a-list" })).status, 400);
  assert.equal((await patch({ logos: [audio.data.upload.id] })).status, 400, "logos must be images");
  const logoUps = [];
  for (let i = 0; i < 7; i++) logoUps.push((await app.request("POST", "/api/admin/uploads", { name: "l" + i + ".png", kind: "image", data: PNG.toString("base64") }, app.admin)).data.upload.id);
  assert.equal((await patch({ logos: logoUps })).status, 400, "at most six logos");
  const letter = await patch({
    logos: [logoUps[0], logoUps[1], logoUps[0], ""],
    visualAt: "bottom",
    contact: " 13800001234（李女士） ",
    slogan: "库存品行业数字化出海新机遇",
    capacity: 200,
    invite: { greeting: "各位行业家人们", signature: "示例行业协会秘书处", date: "2026-11-27" }
  });
  assert.equal(letter.status, 200, JSON.stringify(letter.data));
  assert.deepEqual(letter.data.event.logos.map(l => l.id), [logoUps[0], logoUps[1]], "duplicates and blanks are dropped, order kept");
  const pubLetter = (await app.request("GET", "/api/events/" + ev.slug)).data.event;
  assert.equal(pubLetter.logoUrls.length, 2);
  assert.match(pubLetter.logoUrls[0], /^\/uploads\/[a-f0-9]{24}\.png$/);
  assert.equal(pubLetter.logos, undefined, "upload ids stay private");
  assert.equal(pubLetter.visualAt, "bottom");
  assert.equal(pubLetter.contact, "13800001234（李女士）");
  assert.equal(pubLetter.slogan, "库存品行业数字化出海新机遇");
  assert.equal(pubLetter.capacity, 200);
  assert.deepEqual([pubLetter.invite.greeting, pubLetter.invite.signature, pubLetter.invite.date], ["各位行业家人们", "示例行业协会秘书处", "2026-11-27"]);
  assert.equal(pubLetter.invite.style, "tech", "updating letter fields keeps the chosen style");

  /* 写了结束时间的活动，结束之后才算「往期」 */
  const running = await createEvent(app, { title: "正在进行", startAt: "2020-01-01T09:00", endAt: "2099-01-01T18:00" });
  const list = (await app.request("GET", "/api/events")).data;
  assert.ok(list.upcoming.some(x => x.slug === running.slug), "a long event that has not ended is still upcoming");
});

test("the public event list hides drafts and orders upcoming before past", async t => {
  const app = await start(t);
  const soon = await createEvent(app, { title: "下周对接会", startAt: "2099-01-10T14:00" });
  const later = await createEvent(app, { title: "明年开放日", startAt: "2099-06-01T09:00" });
  await createEvent(app, { title: "还在筹备", status: "draft" });
  const done = await createEvent(app, { title: "上次沙龙", startAt: "2020-05-01T14:00" });
  const closed = await createEvent(app, { title: "提前结束", startAt: "2099-02-01T14:00" });
  await app.request("PATCH", "/api/admin/events/" + closed.id, { status: "closed" }, app.admin);

  const list = await app.request("GET", "/api/events");
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.upcoming.map(e => e.slug), [soon.slug, later.slug]);
  assert.deepEqual(list.data.past.map(e => e.slug).sort(), [done.slug, closed.slug].sort());
  const sample = list.data.upcoming[0];
  assert.equal(sample.id, undefined);
  assert.equal(sample.leads, undefined, "registration counts stay private");
  assert.equal(sample.invite, undefined, "the list does not ship QR data");
});

test("partners: admin-only CRUD, validated links and logos, public list shows only visible entries", async t => {
  const app = await start(t);
  const admin = (method, url, body) => app.request(method, url, body, app.admin);
  assert.equal((await app.request("POST", "/api/admin/partners", { name: "未登录", kind: "sponsor" })).status, 401);
  assert.equal((await app.request("GET", "/api/admin/partners")).status, 401);

  assert.equal((await admin("POST", "/api/admin/partners", { name: "缺类型" })).status, 400);
  assert.equal((await admin("POST", "/api/admin/partners", { name: "坏链接", kind: "partner", url: "javascript:alert(1)" })).status, 400);
  const audio = await admin("POST", "/api/admin/uploads", { name: "bg.mp3", kind: "audio", data: MP3.toString("base64") });
  assert.equal((await admin("POST", "/api/admin/partners", { name: "音频当 Logo", kind: "partner", logo: audio.data.upload.id })).status, 400);

  const logo = await admin("POST", "/api/admin/uploads", { name: "logo.png", kind: "image", data: PNG.toString("base64") });
  const sponsor = await admin("POST", "/api/admin/partners", { name: "甲物流", kind: "sponsor", url: "example.com/about", logo: logo.data.upload.id, weight: 5 });
  assert.equal(sponsor.status, 200);
  assert.equal(sponsor.data.partner.url, "https://example.com/about");
  const hidden = await admin("POST", "/api/admin/partners", { name: "暂不公开", kind: "supporter", show: false });
  const top = await admin("POST", "/api/admin/partners", { name: "青口直播基地", kind: "partner", weight: 9 });
  assert.equal(top.status, 200);

  const pub = await app.request("GET", "/api/partners");
  assert.deepEqual(pub.data.partners.map(p => p.name), ["青口直播基地", "甲物流"], "sorted by weight, hidden ones left out");
  assert.deepEqual(Object.keys(pub.data.partners[1]).sort(), ["intro", "kind", "logoUrl", "name", "url"]);
  assert.match(pub.data.partners[1].logoUrl, /^\/uploads\/[a-f0-9]{24}\.png$/);

  assert.equal((await admin("PATCH", "/api/admin/partners/" + hidden.data.partner.id, { show: true })).status, 200);
  assert.equal((await app.request("GET", "/api/partners")).data.partners.length, 3);
  assert.equal((await admin("DELETE", "/api/admin/partners/" + sponsor.data.partner.id)).status, 200);
  assert.equal((await admin("DELETE", "/api/admin/partners/" + sponsor.data.partner.id)).status, 404);

  const auditLog = (await admin("GET", "/api/admin/audit")).data.items.map(i => i.action);
  for (const action of ["新增合作伙伴", "修改合作伙伴", "删除合作伙伴"]) assert.ok(auditLog.includes(action), action);
});

test("sign-up with an email sends the event invitation by mail; resends are deduplicated and audited", async t => {
  const smtp = await fakeSmtp(t);
  const app = await start(t, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), SMTP_SECURE: "none",
    SMTP_USER: "bot@example.com", SMTP_PASS: "app-code-123", SMTP_FROM: "义乌AI圈 <bot@example.com>" });
  const ev = await createEvent(app, { endAt: "2026-12-20T17:30", contact: "13800001234（李女士）",
    fields: { name: "required", email: "optional", company: "optional", project: "optional" } });
  assert.equal((await app.request("GET", "/api/admin/events", undefined, app.admin)).data.mailReady, true);
  assert.equal((await app.request("GET", "/api/events/" + ev.slug)).data.event.mailInvite, true);

  /* 后台生成的邀请函图片：换新图时旧文件被删掉 */
  const put = body => app.request("PUT", "/api/admin/events/" + ev.id + "/invite-image", body, app.admin);
  assert.equal((await app.request("PUT", "/api/admin/events/" + ev.id + "/invite-image", { data: PNG.toString("base64") })).status, 401);
  assert.equal((await put({ data: MP3.toString("base64") })).status, 415);
  const first = await put({ data: PNG.toString("base64") });
  assert.equal(first.status, 200);
  const firstFile = path.join(app.dir, first.data.event.inviteImageUrl);
  assert.ok(fs.existsSync(firstFile));
  const second = await put({ data: "data:image/png;base64," + PNG.toString("base64") });
  assert.notEqual(second.data.event.inviteImageUrl, first.data.event.inviteImageUrl);
  assert.ok(!fs.existsSync(firstFile), "the replaced invitation image is removed");

  const reg = body => app.request("POST", "/api/events/" + ev.slug + "/register", Object.assign({ consent: true }, body));
  const bad = await reg({ name: "陈总", phone: "13800138011", email: "not-an-email" });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.errors.email, "邮箱格式不正确");

  const ok = await reg({ name: "陈总", phone: "13800138011", email: "chen@example.com" });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.mail, "queued");
  const mail = await until(() => smtp.mails[0]);
  assert.ok(mail, "the invitation mail arrives");
  assert.deepEqual(mail.rcpt, ["<chen@example.com>"]);
  assert.equal(mail.from, "<bot@example.com>");
  assert.equal(mail.auth, "\u0000bot@example.com\u0000app-code-123");
  const subject = /^Subject: (.+(?:\r\n .+)*)/m.exec(mail.data)[1].split("\r\n ").map(w => Buffer.from(/=\?UTF-8\?B\?(.*)\?=/.exec(w)[1], "base64").toString("utf8")).join("");
  assert.equal(subject, "邀请函｜义乌AI圈春季选品对接会");
  const html = mimePart(mail.data, "text/html").toString("utf8");
  assert.match(html, /尊敬的陈总：/);
  assert.match(html, /2026年12月20日（周日）14:00-17:30/);
  assert.match(html, /13800001234（李女士）/);
  assert.match(html, /https:\/\/ywai\.example\.com\/e\//, "links use PUBLIC_URL");
  assert.match(html, /src="cid:invite-/);
  assert.deepEqual([...mimePart(mail.data, "image/png")], [...PNG], "the saved invitation image is attached inline");

  const lead = await until(async () => (await app.request("GET", "/api/admin/leads", undefined, app.admin)).data.leads.find(l => l.mail && l.mail.status === "sent"));
  assert.equal(lead.email, "chen@example.com");

  /* 同一个邮箱再提交不重发；换邮箱才发 */
  assert.equal((await reg({ name: "陈总", phone: "13800138011", email: "CHEN@example.com" })).data.mail, "");
  assert.equal((await reg({ name: "陈总", phone: "13800138011", email: "chen2@example.com" })).data.mail, "queued");
  assert.ok(await until(() => smtp.mails.length === 2));
  assert.deepEqual(smtp.mails[1].rcpt, ["<chen2@example.com>"]);

  /* 后台重发：要登录，会记日志 */
  const url = "/api/admin/leads/" + lead.id + "/mail";
  assert.equal((await app.request("POST", url)).status, 401);
  assert.equal((await app.request("POST", url, undefined, app.admin)).status, 200);
  assert.ok(await until(() => smtp.mails.length === 3));
  const auditLog = (await app.request("GET", "/api/admin/audit", undefined, app.admin)).data.items.map(i => i.action);
  for (const action of ["更新邮件邀请函", "重发邀请函"]) assert.ok(auditLog.includes(action), action);

  const csv = await (await fetch(app.base + "/api/admin/leads.csv?event=" + ev.id, { headers: { Cookie: app.admin } })).text();
  assert.match(csv, /"邮箱"/);
  assert.match(csv, /"chen2@example\.com"/);

  /* 关掉邀请函就不发 */
  await app.request("PATCH", "/api/admin/events/" + ev.id, { invite: { enabled: false } }, app.admin);
  assert.equal((await reg({ name: "王总", phone: "13800138012", email: "wang@example.com" })).data.mail, "");
  await new Promise(r => setTimeout(r, 300));
  assert.equal(smtp.mails.length, 3);
});

test("without SMTP nothing is mailed, and production refuses plaintext SMTP", async t => {
  const app = await start(t);
  const ev = await createEvent(app, { fields: { name: "required", email: "required", company: "optional", project: "optional" } });
  assert.equal((await app.request("GET", "/api/events/" + ev.slug)).data.event.mailInvite, false);
  const reg = await app.request("POST", "/api/events/" + ev.slug + "/register", { name: "陈总", phone: "13800138021", email: "chen@example.com", consent: true });
  assert.equal(reg.status, 200);
  assert.equal(reg.data.mail, "");
  assert.equal((await app.request("POST", "/api/events/" + ev.slug + "/register", { name: "陈总", phone: "13800138022", consent: true })).data.errors.email, "请填写这一项");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yiwu-smtp-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["server.js"], { cwd: root, windowsHide: true, env: {
    ...process.env, DATA_DIR: dir, PORT: "0", NODE_ENV: "production", SMS_MODE: "api", SMS_SEND_URL: "http://127.0.0.1:9/s", SMS_VERIFY_URL: "http://127.0.0.1:9/v",
    COOKIE_SECURE: "1", SESSION_SECRET: crypto.randomBytes(32).toString("hex"), ADMIN_USER: "admin", ADMIN_PASS: crypto.randomBytes(12).toString("hex"),
    SMTP_HOST: "127.0.0.1", SMTP_PORT: "2525", SMTP_SECURE: "none", SMTP_USER: "bot@example.com"
  }});
  let out = "";
  child.stdout.on("data", c => { out += c; });
  child.stderr.on("data", c => { out += c; });
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(out, /SMTP_SECURE=ssl or starttls/);
});
