"use strict";

/**
 * 合作伙伴（赞助方 / 合作方 / 支持方）
 *
 * - 运营在后台维护名单：名称、类型、Logo（走活动模块的上传）、官网链接、排序、是否在首页展示。
 * - 首页底部两排左右滚动：赞助方一排，合作方和支持方一排。
 * - 名单只存公开信息，前台接口不返回内部字段。
 */

const crypto = require("node:crypto");

const KINDS = ["sponsor", "partner", "supporter"];
const KIND_LABEL = { sponsor: "赞助方", partner: "合作方", supporter: "支持方" };

function cleanUrl(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : "https://" + s); } catch (e) { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const out = u.toString();
  return out.length > 200 ? null : out;
}

module.exports = function installPartners(ctx) {
  const { route, db, store, sendJSON, fail, withBody, isAdmin, audit, str, uploadUrl } = ctx;

  if (!db().partners || typeof db().partners !== "object") {
    db().partners = {};
    store.save();
  }
  const all = function () { return db().partners; };

  function sorted() {
    const map = all();
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return (b.weight || 0) - (a.weight || 0) || a.createdAt - b.createdAt; });
  }

  function adminPartner(p) {
    return Object.assign({}, p, { logoUrl: uploadUrl(p.logo), kindLabel: KIND_LABEL[p.kind] });
  }

  /* 校验并合并后台提交的字段；返回错误文案或空字符串 */
  function apply(p, body, isNew) {
    if (isNew || body.name !== undefined) {
      const name = str(body.name, 40);
      if (!name || name.length > 30) return "名称 1–30 个字";
      p.name = name;
    }
    if (isNew || body.kind !== undefined) {
      if (KINDS.indexOf(body.kind) < 0) return "请选择类型：赞助方、合作方或支持方";
      p.kind = body.kind;
    }
    if (body.logo !== undefined) {
      const id = str(body.logo, 40);
      const up = id && db().uploads && db().uploads[id];
      if (id && !up) return "Logo 文件不存在，请重新上传";
      if (up && up.kind !== "image") return "Logo 需要是图片";
      p.logo = id;
    }
    if (body.url !== undefined) {
      const url = cleanUrl(body.url);
      if (url === null) return "链接需要是 http:// 或 https:// 开头的网址";
      p.url = url;
    }
    if (body.intro !== undefined) p.intro = str(body.intro, 60);
    if (body.weight !== undefined) {
      const w = Number(body.weight);
      if (!Number.isInteger(w) || w < 0 || w > 999) return "排序需为 0–999 的整数，越大越靠前";
      p.weight = w;
    }
    if (body.show !== undefined) p.show = body.show !== false;
    p.updatedAt = Date.now();
    return "";
  }

  route("GET", "/api/partners", function (req, res) {
    const list = sorted().filter(function (p) { return p.show !== false; }).map(function (p) {
      return { name: p.name, kind: p.kind, logoUrl: uploadUrl(p.logo), url: p.url || "", intro: p.intro || "" };
    });
    sendJSON(res, 200, { ok: true, partners: list });
  });

  route("GET", "/api/admin/partners", function (req, res) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    sendJSON(res, 200, { ok: true, partners: sorted().map(adminPartner) });
  });

  route("POST", "/api/admin/partners", async function (req, res) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const body = await withBody(req, res);
    if (!body) return;
    if (Object.keys(all()).length >= 300) return fail(res, 409, "too_many", "合作伙伴最多 300 个");
    const p = { id: "pt_" + crypto.randomBytes(5).toString("hex"), name: "", kind: "partner", logo: "", url: "", intro: "", weight: 0, show: true, createdAt: Date.now(), updatedAt: Date.now() };
    const err = apply(p, body, true);
    if (err) return fail(res, 400, "invalid", err);
    all()[p.id] = p;
    store.save();
    audit(req, "新增合作伙伴", KIND_LABEL[p.kind] + " " + p.name);
    sendJSON(res, 200, { ok: true, partner: adminPartner(p) });
  });

  route("PATCH", /^\/api\/admin\/partners\/(pt_[a-f0-9]{10})$/, async function (req, res, m) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const cur = all()[m[1]];
    if (!cur) return fail(res, 404, "not_found", "合作伙伴不存在");
    const body = await withBody(req, res);
    if (!body) return;
    const next = Object.assign({}, cur);
    const err = apply(next, body, false);
    if (err) return fail(res, 400, "invalid", err);
    all()[cur.id] = next;
    store.save();
    audit(req, "修改合作伙伴", KIND_LABEL[next.kind] + " " + next.name + (cur.show !== next.show ? (next.show ? "：首页展示" : "：首页隐藏") : ""));
    sendJSON(res, 200, { ok: true, partner: adminPartner(next) });
  });

  route("DELETE", /^\/api\/admin\/partners\/(pt_[a-f0-9]{10})$/, function (req, res, m) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const cur = all()[m[1]];
    if (!cur) return fail(res, 404, "not_found", "合作伙伴不存在");
    delete all()[cur.id];
    store.save();
    audit(req, "删除合作伙伴", KIND_LABEL[cur.kind] + " " + cur.name);
    sendJSON(res, 200, { ok: true });
  });
};
