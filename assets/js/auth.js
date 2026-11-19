/* ==========================================================================
   义乌AI圈 — auth engine (demo, client-side)
   Real flows, real validation, real session state — no backend.
   NOTE: hashing here is a demo stand-in, not production cryptography.
   ========================================================================== */
(function () {
  "use strict";

  var K = {
    session: "ywai.session.v1",
    users: "ywai.users.v1",
    otp: "ywai.otp.v1",
    guard: "ywai.guard.v1",
    posts: "ywai.posts.v1",
    likes: "ywai.likes.v1"
  };

  var store = {
    get: function (k, fb) {
      try {
        var raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : fb;
      } catch (e) {
        return fb;
      }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    },
    del: function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    }
  };

  /* ---------------- hashing (demo) ---------------- */
  function hash(str) {
    var h = 2166136261, s = "ywai::v1::" + str;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function uid() {
    return "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------------- session ---------------- */
  var TONES = ["", "avatar--red", "avatar--teal", "avatar--gold"];
  var listeners = [];

  function normalizeSession(s) {
    if (!s || !s.phone || !s.exp) return null;
    if (Date.now() > s.exp) {
      store.del(K.session);
      return null;
    }
    return s;
  }

  function getSession() {
    return normalizeSession(store.get(K.session, null));
  }

  function signIn(user, remember) {
    var ttl = remember ? 30 * 864e5 : 12 * 36e5;
    var session = {
      token: uid(),
      phone: user.phone,
      nickname: user.nickname,
      tone: user.tone || 0,
      at: Date.now(),
      exp: Date.now() + ttl,
      remember: !!remember
    };
    store.set(K.session, session);
    emit(session);
    return session;
  }

  function signOut() {
    store.del(K.session);
    emit(null);
  }

  function updateSession(patch) {
    var s = getSession();
    if (!s) return null;
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) s[k] = patch[k];
    store.set(K.session, s);
    emit(s);
    return s;
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (f) { return f !== fn; });
    };
  }

  function emit(session) {
    listeners.forEach(function (fn) {
      try { fn(session); } catch (e) {}
    });
    try {
      window.dispatchEvent(new CustomEvent("yw:auth", { detail: session }));
    } catch (e) {}
  }

  /* ---------------- users ---------------- */
  function getUsers() { return store.get(K.users, {}); }

  function findUser(phone) {
    var u = getUsers()[phone];
    return u || null;
  }

  function upsertUser(phone, patch) {
    var users = getUsers();
    var u = users[phone] || {
      phone: phone,
      nickname: "",
      tone: 0,
      createdAt: Date.now()
    };
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) u[k] = patch[k];
    if (typeof u.tone !== "number") u.tone = 0;
    users[phone] = u;
    store.set(K.users, users);
    return u;
  }

  function toneFor(phone) {
    var sum = 0;
    for (var i = 0; i < phone.length; i++) sum += phone.charCodeAt(i);
    return (sum % 3) + 1;
  }

  /* ---------------- validation ---------------- */
  var RE_PHONE = /^1[3-9]\d{9}$/;
  var RE_CODE = /^\d{6}$/;

  function validatePhone(v) {
    v = (v || "").replace(/\s|-/g, "");
    if (!v) return { ok: false, msg: "请输入手机号" };
    if (!/^\d+$/.test(v)) return { ok: false, msg: "手机号只能包含数字" };
    if (v.length !== 11) return { ok: false, msg: "手机号应为 11 位，当前 " + v.length + " 位" };
    if (!RE_PHONE.test(v)) return { ok: false, msg: "手机号格式不正确，请检查号段" };
    return { ok: true, value: v };
  }

  function validateNickname(v) {
    v = (v || "").trim();
    if (v.length < 2) return { ok: false, msg: "昵称至少 2 个字" };
    if (v.length > 14) return { ok: false, msg: "昵称最多 14 个字" };
    return { ok: true, value: v };
  }

  function passwordScore(v) {
    if (!v) return 0;
    var n = 0;
    if (v.length >= 8) n++;
    if (/[a-zA-Z]/.test(v) && /\d/.test(v)) n++;
    if (v.length >= 12) n++;
    if (/[^a-zA-Z0-9]/.test(v)) n++;
    return Math.min(n, 4);
  }

  function validatePassword(v, forRegister) {
    if (!v) return { ok: false, msg: "请输入密码" };
    if (forRegister) {
      if (v.length < 8) return { ok: false, msg: "密码至少 8 位" };
      if (!/[a-zA-Z]/.test(v) || !/\d/.test(v)) return { ok: false, msg: "密码需同时包含字母和数字" };
    }
    return { ok: true };
  }

  /* ---------------- guard / lockout ---------------- */
  function getGuard(phone) {
    var g = store.get(K.guard, {});
    return g[phone] || { code: 0, pw: 0, lockUntil: 0 };
  }

  function setGuard(phone, patch) {
    var g = store.get(K.guard, {});
    g[phone] = Object.assign({ code: 0, pw: 0, lockUntil: 0 }, g[phone] || {}, patch);
    store.set(K.guard, g);
  }

  function lockLeft(phone) {
    var g = getGuard(phone);
    return Math.max(0, g.lockUntil - Date.now());
  }

  /* ---------------- otp ---------------- */
  var OTP_TTL = 5 * 60 * 1000;
  var RESEND = 60 * 1000;

  /* ---------------- SMS adapter（demo / real API） ---------------- */
  var SMS = (window.YW_CONFIG && window.YW_CONFIG.sms) || {};
  var SMS_MODE = SMS.mode === "api" ? "api" : "demo";

  function postJSON(url, payload) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.text().then(function (txt) {
        var data = {};
        try { data = txt ? JSON.parse(txt) : {}; } catch (e) {}
        if (!r.ok) throw new Error(data.msg || "请求失败（" + r.status + "）");
        return data;
      });
    });
  }

  function requestCode(phone) {
    if (SMS_MODE === "api") {
      return postJSON(SMS.sendUrl || "/api/sms/send", { phone: phone })
        .then(function (data) {
          if (data && data.ok === false) return { ok: false, msg: data.msg || "验证码发送失败" };
          return { ok: true, real: true, exp: Number(data.expire) || 300 };
        })
        .catch(function (err) {
          return { ok: false, msg: err.message || "网络异常，请稍后再试" };
        });
    }
    return Promise.resolve(requestCodeDemo(phone));
  }

  function requestCodeDemo(phone) {
    var o = store.get(K.otp, {});
    var rec = o[phone];
    if (rec && Date.now() - rec.sentAt < RESEND) {
      return { ok: false, msg: "请求过于频繁，请 " + Math.ceil((RESEND - (Date.now() - rec.sentAt)) / 1000) + " 秒后再试" };
    }
    var code = String(Math.floor(100000 + Math.random() * 900000));
    o[phone] = { code: code, sentAt: Date.now(), exp: Date.now() + OTP_TTL };
    store.set(K.otp, o);
    return { ok: true, code: code, exp: OTP_TTL };
  }

  function verifyCode(phone, code) {
    if (SMS_MODE === "api") {
      return postJSON(SMS.verifyUrl || "/api/sms/verify", { phone: phone, code: code })
        .then(function (data) {
          if (data && data.ok === false) return { ok: false, msg: data.msg || "验证码不正确" };
          var o = store.get(K.otp, {});
          delete o[phone];
          store.set(K.otp, o);
          return { ok: true };
        })
        .catch(function (err) {
          return { ok: false, msg: err.message || "网络异常，请稍后再试" };
        });
    }
    return Promise.resolve(verifyCodeDemo(phone, code));
  }

  function verifyCodeDemo(phone, code) {
    var left = lockLeft(phone);
    if (left > 0) {
      return { ok: false, msg: "尝试次数过多，请 " + Math.ceil(left / 1000) + " 秒后再试", locked: true };
    }
    var o = store.get(K.otp, {});
    var rec = o[phone];
    if (!rec) return { ok: false, msg: "请先获取验证码" };
    if (Date.now() > rec.exp) {
      delete o[phone];
      store.set(K.otp, o);
      return { ok: false, msg: "验证码已过期，请重新获取" };
    }
    if (!RE_CODE.test(code)) return { ok: false, msg: "请输入 6 位数字验证码" };
    if (code !== rec.code) {
      var g = getGuard(phone);
      var fails = (g.code || 0) + 1;
      if (fails >= 5) {
        setGuard(phone, { code: 0, lockUntil: Date.now() + 60 * 1000 });
        return { ok: false, msg: "连续 5 次输入错误，已锁定 60 秒", locked: true };
      }
      setGuard(phone, { code: fails });
      return { ok: false, msg: "验证码不正确，还可尝试 " + (5 - fails) + " 次" };
    }
    delete o[phone];
    store.set(K.otp, o);
    setGuard(phone, { code: 0 });
    return { ok: true };
  }

  /* ---------------- password login ---------------- */
  function loginWithPassword(phone, pw, remember) {
    var left = lockLeft(phone);
    if (left > 0) {
      return { ok: false, msg: "账号已临时锁定，请 " + Math.ceil(left / 1000) + " 秒后再试", locked: true };
    }
    var user = findUser(phone);
    if (!user || !user.pw) {
      return { ok: false, msg: "该手机号尚未设置密码，请先用验证码登录" };
    }
    if (hash(pw) !== user.pw) {
      var g = getGuard(phone);
      var fails = (g.pw || 0) + 1;
      if (fails >= 5) {
        setGuard(phone, { pw: 0, lockUntil: Date.now() + 5 * 60 * 1000 });
        return { ok: false, msg: "连续 5 次密码错误，账号锁定 5 分钟", locked: true };
      }
      setGuard(phone, { pw: fails });
      return { ok: false, msg: "密码不正确，还可尝试 " + (5 - fails) + " 次" };
    }
    setGuard(phone, { pw: 0 });
    return { ok: true, user: user };
  }

  /* ---------------- toast ---------------- */
  function toast(msg, ms) {
    var stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    var el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(function () {
      el.classList.add("is-out");
      setTimeout(function () { el.remove(); }, 240);
    }, ms || 3200);
  }

  /* ---------------- modal ---------------- */
  var lastFocus = null;
  var openModalEl = null;

  function openModal(el) {
    if (!el) return;
    if (openModalEl) closeModal();
    lastFocus = document.activeElement;
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    openModalEl = el;
    document.body.style.overflow = "hidden";
    var focusable = el.querySelector("[data-autofocus]") ||
      el.querySelector(".otp__box, input:not([type='hidden']), select, textarea");
    if (focusable) setTimeout(function () { focusable.focus(); }, 60);
  }

  function closeModal(el) {
    var target = el || openModalEl;
    if (!target) return;
    target.classList.remove("is-open");
    target.setAttribute("aria-hidden", "true");
    if (openModalEl === target) openModalEl = null;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ---------------- otp widget ---------------- */
  function bindOtp(root, onComplete) {
    var wrap = root.querySelector("[data-otp]");
    if (!wrap || wrap.dataset.bound) return;
    wrap.dataset.bound = "1";
    var boxes = Array.prototype.slice.call(wrap.querySelectorAll(".otp__box"));

    function value() {
      return boxes.map(function (b) { return b.value; }).join("");
    }

    function fill(start, str) {
      var chars = str.replace(/\D/g, "").split("");
      chars.forEach(function (c, i) {
        var box = boxes[start + i];
        if (box) box.value = c;
      });
      var next = Math.min(start + chars.length, boxes.length - 1);
      boxes[next].focus();
      if (value().length === boxes.length) onComplete(value());
    }

    boxes.forEach(function (box, i) {
      box.addEventListener("input", function () {
        var v = box.value.replace(/\D/g, "");
        if (!v) { box.value = ""; return; }
        if (v.length > 1) { box.value = ""; fill(i, v); return; }
        box.value = v;
        if (i < boxes.length - 1) boxes[i + 1].focus();
        if (value().length === boxes.length) onComplete(value());
      });

      box.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !box.value && i > 0) {
          e.preventDefault();
          boxes[i - 1].value = "";
          boxes[i - 1].focus();
        } else if (e.key === "ArrowLeft" && i > 0) {
          e.preventDefault();
          boxes[i - 1].focus();
        } else if (e.key === "ArrowRight" && i < boxes.length - 1) {
          e.preventDefault();
          boxes[i + 1].focus();
        }
      });

      box.addEventListener("paste", function (e) {
        e.preventDefault();
        var t = (e.clipboardData || window.clipboardData).getData("text") || "";
        var digits = t.replace(/\D/g, "").slice(0, boxes.length);
        if (!digits) return;
        boxes.forEach(function (b) { b.value = ""; });
        fill(0, digits);
      });

      box.addEventListener("focus", function () {
        box.select && box.select();
      });
    });
  }

  function otpValue(root) {
    var wrap = root.querySelector("[data-otp]");
    if (!wrap) return "";
    return Array.prototype.slice.call(wrap.querySelectorAll(".otp__box"))
      .map(function (b) { return b.value; }).join("");
  }

  function clearOtp(root) {
    var wrap = root.querySelector("[data-otp]");
    if (!wrap) return;
    Array.prototype.slice.call(wrap.querySelectorAll(".otp__box")).forEach(function (b) { b.value = ""; });
    wrap.classList.remove("has-error");
    var first = wrap.querySelector(".otp__box");
    if (first) first.focus();
  }

  /* ---------------- countdown ---------------- */
  function startCountdown(btn, seconds, label) {
    if (!btn) return;
    if (btn.dataset.timer) clearInterval(Number(btn.dataset.timer));
    var end = Date.now() + seconds * 1000;
    btn.disabled = true;
    btn.textContent = "重新获取 " + seconds + "s";
    var t = setInterval(function () {
      var left = Math.ceil((end - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(t);
        btn.disabled = false;
        btn.textContent = label || "获取验证码";
        return;
      }
      btn.textContent = "重新获取 " + left + "s";
    }, 250);
    btn.dataset.timer = t;
  }

  /* ---------------- status helpers ---------------- */
  function setStatus(root, type, msg) {
    var el = root.querySelector("[data-status]");
    if (!el) return;
    if (!msg) {
      el.className = "auth-status";
      el.textContent = "";
      return;
    }
    el.className = "auth-status is-on is-" + (type || "info");
    el.innerHTML = '<span class="auth-status__icon">' +
      (type === "error" ? "!" : type === "ok" ? "✓" : "i") +
      "</span><span></span>";
    el.querySelector("span:last-child").textContent = msg;
  }

  function fieldError(root, name, msg) {
    var el = root.querySelector('[data-error="' + name + '"]');
    var input = root.querySelector('[data-field="' + name + '"]');
    if (el) {
      el.textContent = msg || "";
      el.classList.toggle("is-on", !!msg);
    }
    if (input) {
      input.classList.toggle("has-error", !!msg);
      var wrap = input.closest(".phone-field") || input.closest(".otp");
      if (wrap) wrap.classList.toggle("has-error", !!msg);
    }
  }

  function clearErrors(root) {
    Array.prototype.slice.call(root.querySelectorAll("[data-error]")).forEach(function (el) {
      el.textContent = "";
      el.classList.remove("is-on");
    });
    Array.prototype.slice.call(root.querySelectorAll(".has-error")).forEach(function (el) {
      el.classList.remove("has-error");
    });
    setStatus(root, "", "");
  }

  function shake(el) {
    if (!el) return;
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
    setTimeout(function () { el.classList.remove("shake"); }, 450);
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.classList.toggle("is-busy", on);
    btn.disabled = on;
  }

  /* ---------------- nav sync ---------------- */
  function maskPhone(p) {
    return p ? p.slice(0, 3) + "****" + p.slice(-4) : "";
  }

  function paintChrome(session) {
    var entries = document.querySelectorAll("[data-auth-entry]");
    var menus = document.querySelectorAll("[data-user-menu]");
    Array.prototype.forEach.call(entries, function (el) { el.hidden = !!session; });
    Array.prototype.forEach.call(menus, function (el) { el.hidden = !session; });
    if (session) {
      Array.prototype.forEach.call(document.querySelectorAll("[data-user-name]"), function (el) {
        el.textContent = session.nickname;
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-user-phone]"), function (el) {
        el.textContent = "+86 " + maskPhone(session.phone);
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-user-avatar]"), function (el) {
        el.textContent = (session.nickname || "义").slice(0, 1);
        el.className = "avatar avatar--sm" + (TONES[session.tone] ? " " + TONES[session.tone] : "");
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-my-home]"), function (el) {
        el.setAttribute("href", "profile.html?u=" + session.phone);
      });
    }
    document.documentElement.classList.toggle("is-authed", !!session);
  }

  function bindUserMenu() {
    document.addEventListener("click", function (e) {
      var toggle = e.target.closest("[data-user-toggle]");
      var menu = e.target.closest("[data-user-menu]");
      Array.prototype.forEach.call(document.querySelectorAll("[data-user-menu].is-open"), function (m) {
        if (!menu || m !== menu) {
          m.classList.remove("is-open");
          var b = m.querySelector("[data-user-toggle]");
          if (b) b.setAttribute("aria-expanded", "false");
        }
      });
      if (toggle) {
        e.preventDefault();
        var parent = toggle.closest("[data-user-menu]");
        var open = parent.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      }
      var logout = e.target.closest("[data-logout]");
      if (logout) {
        e.preventDefault();
        signOut();
        toast("已退出登录");
        setTimeout(function () { window.location.reload(); }, 300);
      }
    });
  }

  /* ---------------- gate modal ---------------- */
  var gateEl = null;
  var gateCallback = null;

  function buildGate() {
    if (document.getElementById("authGate")) {
      gateEl = document.getElementById("authGate");
      return;
    }
    var el = document.createElement("div");
    el.className = "modal";
    el.id = "authGate";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      '<div class="modal__veil" data-close></div>' +
      '<div class="modal__sheet" role="dialog" aria-modal="true" aria-labelledby="gateTitle">' +
      '<button class="modal__close" type="button" data-close aria-label="关闭">✕</button>' +
      '<div class="gate-head">' +
      '<span class="mono">Members only · 会员入口</span>' +
      '<h3 id="gateTitle">登录后继续</h3>' +
      '<p data-gate-reason>发布帖子需要先登录，义乌AI圈用手机号即可入场。</p>' +
      "</div>" +
      '<form class="gate-form" data-gate-form novalidate>' +
      '<div class="field">' +
      '<label class="label" for="gatePhone">手机号 <span>+86</span></label>' +
      '<div class="phone-field">' +
      '<span class="phone-field__pre">+86</span>' +
      '<input id="gatePhone" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" placeholder="11 位手机号" data-gate-phone data-field="phone">' +
      "</div>" +
      '<p class="field-error" data-error="phone"></p>' +
      "</div>" +
      '<div class="field">' +
      '<div class="label"><span>短信验证码</span>' +
      '<button class="otp-send" type="button" data-send-code>获取验证码</button></div>' +
      '<div class="otp" data-otp data-field="code">' +
      '<input class="otp__box" inputmode="numeric" maxlength="1" placeholder="·" aria-label="验证码第 1 位">' +
      '<input class="otp__box" inputmode="numeric" maxlength="1" placeholder="·" aria-label="验证码第 2 位">' +
      '<input class="otp__box" inputmode="numeric" maxlength="1" placeholder="·" aria-label="验证码第 3 位">' +
      '<input class="otp__box" inputmode="numeric" maxlength="1" placeholder="·" aria-label="验证码第 4 位">' +
      '<input class="otp__box" inputmode="numeric" maxlength="1" placeholder="·" aria-label="验证码第 5 位">' +
      '<input class="otp__box" inputmode="numeric" maxlength="1" placeholder="·" aria-label="验证码第 6 位">' +
      "</div>" +
      '<p class="field-error" data-error="code"></p>' +
      "</div>" +
      '<div class="auth-meta">' +
      '<label class="checkline"><input type="checkbox" data-gate-terms checked>' +
      '<span class="checkline__box"></span><span>我已阅读并同意<a href="legal.html#terms" target="_blank" rel="noopener">《用户协议》</a>与<a href="legal.html#privacy" target="_blank" rel="noopener">《隐私政策》</a></span></label>' +
      "</div>" +
      '<div class="auth-status" data-status role="alert"></div>' +
      '<button class="btn btn--red btn--block auth-submit" type="submit" data-submit>' +
      '<span class="spinner"></span><span class="label">登录 / 注册</span></button>' +
      "</form>" +
      '<div class="gate-foot"><span>' + (SMS_MODE === "api" ? "验证码 5 分钟内有效" : "Demo · 验证码会显示在提示条") + '</span>' +
      '<a href="login.html">完整登录页 →</a></div>' +
      "</div>";
    document.body.appendChild(el);
    gateEl = el;

    el.addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) closeModal(el);
    });

    var form = el.querySelector("[data-gate-form]");
    var phoneInput = el.querySelector("[data-gate-phone]");

    bindOtp(el, function () {
      submitGate();
    });

    el.querySelector("[data-send-code]").addEventListener("click", function () {
      var btn = this;
      var v = validatePhone(phoneInput.value);
      if (!v.ok) {
        fieldError(el, "phone", v.msg);
        shake(el.querySelector(".phone-field"));
        phoneInput.focus();
        return;
      }
      fieldError(el, "phone", "");
      btn.disabled = true;
      requestCode(v.value).then(function (r) {
        btn.disabled = false;
        if (!r.ok) {
          setStatus(el, "error", r.msg);
          return;
        }
        setStatus(el, "info", r.real
          ? "验证码已发送至 +86 " + maskPhone(v.value) + "，" + (r.exp || 5) + " 分钟内有效"
          : "验证码已发送至 +86 " + maskPhone(v.value) + "，演示码：" + r.code);
        if (!r.real) store.set("ywai.lastOtp", r.code);
        startCountdown(btn, 60, "重新获取");
        var first = el.querySelector(".otp__box");
        if (first) first.focus();
      });
    });

    phoneInput.addEventListener("input", function () {
      phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 11);
      fieldError(el, "phone", "");
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      submitGate();
    });

    function submitGate() {
      var v = validatePhone(phoneInput.value);
      if (!v.ok) {
        fieldError(el, "phone", v.msg);
        shake(el.querySelector(".phone-field"));
        return;
      }
      var code = otpValue(el);
      if (code.length !== 6) {
        fieldError(el, "code", "请输入完整的 6 位验证码");
        shake(el.querySelector(".otp"));
        return;
      }
      if (!el.querySelector("[data-gate-terms]").checked) {
        setStatus(el, "error", "请先勾选并同意《用户协议》与《隐私政策》");
        return;
      }
      clearErrors(el);
      var btn = el.querySelector("[data-submit]");
      busy(btn, true);
      verifyCode(v.value, code).then(function (r) {
        busy(btn, false);
        if (!r.ok) {
          fieldError(el, "code", r.msg);
          shake(el.querySelector(".otp"));
          clearOtp(el);
          return;
        }
        var user = findUser(v.value);
        if (!user) {
          user = upsertUser(v.value, {
            nickname: "义乌新朋友" + v.value.slice(-4),
            tone: toneFor(v.value)
          });
        }
        signIn(user, false);
        setStatus(el, "ok", "登录成功，欢迎回来，" + user.nickname);
        setTimeout(function () {
          closeModal(el);
          toast("已入场 · " + user.nickname);
          if (typeof gateCallback === "function") gateCallback(user);
          gateCallback = null;
        }, 520);
      });
    }
  }

  function openGate(reason, onSuccess) {
    buildGate();
    gateCallback = onSuccess || null;
    if (reason) {
      var p = gateEl.querySelector("[data-gate-reason]");
      if (p) p.textContent = reason;
    }
    gateEl.querySelector("[data-gate-phone]").value = "";
    clearOtp(gateEl);
    clearErrors(gateEl);
    openModal(gateEl);
  }

  /* ---------------- guards ---------------- */
  function requireAuth(reason, onSuccess) {
    var s = getSession();
    if (s) {
      if (typeof onSuccess === "function") onSuccess(s);
      return true;
    }
    openGate(reason, onSuccess);
    return false;
  }

  /* ---------------- init ---------------- */
  function init() {
    paintChrome(getSession());
    bindUserMenu();
    onChange(paintChrome);

    window.addEventListener("storage", function (e) {
      if (e.key === K.session) paintChrome(getSession());
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (openModalEl) closeModal();
    });

    // close any [data-close] inside modals
    document.addEventListener("click", function (e) {
      var closer = e.target.closest("[data-close]");
      if (closer) {
        var m = closer.closest(".modal");
        if (m) closeModal(m);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ---------------- export ---------------- */
  window.YW = window.YW || {};
  window.YW.auth = {
    getSession: getSession,
    signIn: signIn,
    signOut: signOut,
    updateSession: updateSession,
    findUser: findUser,
    upsertUser: upsertUser,
    toneFor: toneFor,
    hash: hash,
    validatePhone: validatePhone,
    validateNickname: validateNickname,
    validatePassword: validatePassword,
    passwordScore: passwordScore,
    requestCode: requestCode,
    verifyCode: verifyCode,
    smsMode: SMS_MODE,
    loginWithPassword: loginWithPassword,
    lockLeft: lockLeft,
    requireAuth: requireAuth,
    openGate: openGate,
    onChange: onChange
  };

  window.YW.ui = {
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    bindOtp: bindOtp,
    otpValue: otpValue,
    clearOtp: clearOtp,
    startCountdown: startCountdown,
    setStatus: setStatus,
    fieldError: fieldError,
    clearErrors: clearErrors,
    shake: shake,
    busy: busy,
    maskPhone: maskPhone,
    store: store,
    keys: K
  };
})();
