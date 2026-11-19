"use strict";

/**
 * 义乌AI圈 — 轻量 JSON 文件存储
 * 无外部依赖：整库常驻内存，变更后合并写盘（临时文件 + rename，保证原子性）。
 * 适合单实例部署；量级上来后可平滑换成 SQLite / Postgres，接口保持不变。
 */

const fs = require("node:fs");
const path = require("node:path");

const EMPTY = function () {
  return {
    meta: { version: 1, createdAt: Date.now() },
    users: {},        // userId -> { id, phone, nickname, tone, pwHash, createdAt, updatedAt }
    profiles: {},     // userId -> 个人主页资料
    posts: [],        // 圈友发帖，新的在前
    reactions: {},    // postId -> { likes: [userId], marks: [userId] }
    comments: {},     // postId -> [{ id, uid, name, text, at }]
    applications: {}, // userId -> 商家认证申请
    admin: null       // 运营后台整库文档
  };
};

function createStore(dir) {
  const file = path.join(dir, "db.json");
  fs.mkdirSync(dir, { recursive: true });

  let data = EMPTY();
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      data = Object.assign(EMPTY(), parsed);
    } catch (err) {
      const broken = file + ".broken-" + Date.now();
      fs.copyFileSync(file, broken);
      console.error("[store] db.json 解析失败，已备份到 " + broken + "，以空库启动");
    }
  }

  let timer = null;
  let writing = false;
  let pending = false;

  function flushSync() {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  function flush() {
    timer = null;
    if (writing) {
      pending = true;
      return;
    }
    writing = true;
    const tmp = file + ".tmp";
    fs.writeFile(tmp, JSON.stringify(data), function (err) {
      if (err) {
        writing = false;
        console.error("[store] 写盘失败：", err.message);
        return;
      }
      fs.rename(tmp, file, function (err2) {
        writing = false;
        if (err2) console.error("[store] 写盘失败：", err2.message);
        if (pending) {
          pending = false;
          schedule();
        }
      });
    });
  }

  function schedule() {
    if (!timer) timer = setTimeout(flush, 150);
  }

  return {
    file: file,
    get data() { return data; },
    save: schedule,
    flushSync: function () {
      if (timer) clearTimeout(timer);
      timer = null;
      flushSync();
    }
  };
}

module.exports = { createStore };
