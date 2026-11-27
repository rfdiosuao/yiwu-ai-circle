"use strict";

// This is the wire contract for the admin editor. Unknown fields are rejected,
// including credentials/prototype keys, before any document can reach disk.
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = max => value => typeof value === "string" && value.length <= max;
const number = (max = 1e12) => value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const integer = (max = 1e9) => value => Number.isSafeInteger(value) && value >= 0 && value <= max;
const bool = value => typeof value === "boolean";
const choice = (...items) => value => items.includes(value);
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
const date = value => value === "" || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const array = (validator, max) => value => Array.isArray(value) && value.length <= max && value.every(validator);
function record(fields, optional = []) {
  return value => object(value) && Object.keys(value).every(key => own(fields, key)) &&
    Object.entries(fields).every(([key, validate]) => !own(value, key) ? optional.includes(key) : validate(value[key]));
}
function rows(validate, max = 10000) {
  return value => array(validate, max)(value) && new Set(value.map(row => row.id)).size === value.length;
}
const short = text(200), long = text(8000), id = identifier;
const meta = record({ version: choice(1), revision: integer(Number.MAX_SAFE_INTEGER - 1), createdAt: integer(Number.MAX_SAFE_INTEGER), updatedAt: integer(Number.MAX_SAFE_INTEGER), demo: bool }, ["revision", "createdAt", "updatedAt", "demo"]);
const validMerchant = record({ id, name: short, stall: short, zone: id, zoneName: short, owner: short, phone: short, wechat: short, tags: array(short, 30), intro: long, level: choice("normal", "gold", "diamond"), minOrder: short, leadTime: short, hours: short, license: short, certExpire: date, verified: bool, status: choice("approved", "pending", "rejected"), rejectReason: long, featured: bool, weight: integer(999), views: integer(), leads: integer(), joined: date, updated: date, fromApplication: value => value === "" || id(value) }, ["fromApplication"]);
const validate = record({
  meta,
  stats: record({ revenue: array(number(), 366), signups: array(integer(), 366), visits: array(integer(), 366) }),
  plans: rows(record({ id, name: short, price: number(), unit: short, active: bool, tone: choice("mute", "red", "ink", "teal"), desc: long, features: array(short, 100) }), 100),
  users: array(() => false, 0),
  orders: rows(record({ id, userId: id, userName: short, plan: id, amount: number(), method: choice("alipay", "wechat", "bank", "manual"), status: choice("paid", "pending", "refund"), createdAt: date })),
  merchants: rows(validMerchant),
  products: rows(record({ id, name: short, cat: id, platform: short, price: number(), unit: short, billing: choice("monthly", "yearly", "per-unit", "free"), trial: integer(90), commission: number(100), delivery: short, langs: short, vendor: short, desc: long, badge: short, status: choice("on", "off"), featured: bool, sales: integer(), revenue: number(), weight: integer(999), updated: date })),
  dicts: record({ zones: array(record({ v: id, t: short }), 100), cats: array(record({ v: id, t: short }), 100) }),
  articles: rows(record({ id, title: short, type: short, source: short, status: choice("draft", "published"), pinned: bool, date, summary: long, body: long })),
  posts: array(() => false, 0),
  settings: record({ siteName: short, tagline: short, description: long, ticker: array(short, 100),
    toggles: record({ register: bool, inviteOnly: bool, comment: bool, showPrice: bool, merchantApply: bool, maintenance: bool }),
    pay: record({ alipay: short, wechat: short, bank: short, trialDays: integer(365), autoRenew: bool }),
    admin: record({ name: short }) })
});

function validAdminDoc(doc) {
  if (!validate(doc)) return false;
  if (!doc.plans.length || !doc.dicts.zones.length || !doc.dicts.cats.length) return false;
  const plans = new Set(doc.plans.map(row => row.id));
  return doc.orders.every(row => plans.has(row.plan)) &&
    Buffer.byteLength(JSON.stringify(doc), "utf8") <= 8 * 1024 * 1024;
}
module.exports = { validAdminDoc, validMerchant };
