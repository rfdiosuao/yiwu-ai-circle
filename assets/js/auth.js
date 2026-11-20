/* ==========================================================================
   义乌AI圈 — auth engine
   会话由服务端 HttpOnly Cookie 承载；localStorage 只缓存展示用的昵称等信息，
   启动时向 /api/auth/session 校准。验证码、密码、锁定都在服务端完成。
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

  /* ---------------- server api ---------------- */
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.text().then(function (txt) {
        var data = {};
        try { data = txt ? JSON.parse(txt) : {}; } catch (e) {}
        data.status = r.status;
        if (!r.ok && data.ok === undefined) data.ok = false;
        return data;
      });
    }, function () {
      return { ok: false, status: 0, msg: "网络异常，请检查网络后重试" };
    });
  }

  /* ---------------- hashing (legacy, unused) ---------------- */
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
    var ttl = remember === false ? 12 * 36e5 : 30 * 864e5;
    var session = {
      token: uid(),
      userId: user.userId || "",
      phone: user.mobile || user.phone,
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
    lastUser = null;
    api("POST", "/api/auth/logout");
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

  /* ---------------- users（服务端） ---------------- */
  var lastUser = null; // 最近一次服务端返回的用户（验证码 / 密码登录后）

  function toLocalUser(u) {
    if (!u) return null;
    return {
      userId: u.userId,
      phone: u.mobile || u.phone,
      mobile: u.mobile || u.phone,
      nickname: u.nickname,
      tone: u.tone || 1,
      hasPassword: !!u.hasPassword
    };
  }

  /* 登录流程里用：验证通过且已完成注册的用户返回对象，新用户返回 null（需要先设置昵称）。 */
  function findUser(phone) {
    if (lastUser && lastUser.phone === phone && !lastUser.isNew) return lastUser;
    var s = getSession();
    if (s && s.phone === phone) return s;
    return null;
  }

  /* 更新当前登录用户的昵称 / 头像色 / 密码，返回 Promise<{ok, user, msg}> */
  function saveMe(patch) {
    var body = {};
    if (patch.nickname !== undefined) body.nickname = patch.nickname;
    if (patch.tone !== undefined) body.tone = patch.tone;
    if (patch.password) body.password = patch.password;
    return api("PATCH", "/api/auth/me", body).then(function (r) {
      if (!r.ok) return { ok: false, msg: r.msg || "保存失败，请重试" };
      lastUser = toLocalUser(r.user);
      if (getSession()) updateSession({ nickname: lastUser.nickname, tone: lastUser.tone });
      return { ok: true, user: lastUser };
    });
  }

  /* 兼容旧调用：同步返回合并后的用户，同时异步写到服务端。 */
  function upsertUser(phone, patch) {
    var base = lastUser && lastUser.phone === phone ? lastUser : { phone: phone, mobile: phone, tone: 1 };
    var u = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) u[k] = base[k];
    for (var j in patch) if (Object.prototype.hasOwnProperty.call(patch, j) && j !== "pw" && j !== "password") u[j] = patch[j];
    u.isNew = false;
    lastUser = u;
    saveMe(patch);
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

  /* ---------------- SMS / 登录（服务端完成） ---------------- */
  var SMS = (window.YW_CONFIG && window.YW_CONFIG.sms) || {};
  var SMS_MODE = SMS.mode === "api" ? "api" : "demo";

  function requestCode(phone) {
    return api("POST", "/api/auth/send", { phone: phone }).then(function (r) {
      if (!r.ok) return { ok: false, msg: r.msg || "验证码发送失败" };
      if (r.demoCode) return { ok: true, code: r.demoCode, exp: 5 * 60 * 1000 };
      return { ok: true, real: true, exp: Math.round((Number(r.expire) || 300) / 60) };
    });
  }

  function verifyCode(phone, code, remember) {
    if (!RE_CODE.test(code)) return Promise.resolve({ ok: false, msg: "请输入 6 位数字验证码" });
    return api("POST", "/api/auth/session", { phone: phone, code: code, remember: remember !== false }).then(function (r) {
      if (!r.ok) return { ok: false, msg: r.msg || "验证码不正确", locked: r.error === "locked" };
      lastUser = toLocalUser(r.user);
      lastUser.isNew = !!r.isNew;
      return { ok: true, user: lastUser, isNew: !!r.isNew };
    });
  }

  function loginWithPassword(phone, pw, remember) {
    return api("POST", "/api/auth/password", { phone: phone, password: pw, remember: remember !== false }).then(function (r) {
      if (!r.ok) return { ok: false, msg: r.msg || "登录失败", locked: r.error === "locked" };
      lastUser = toLocalUser(r.user);
      return { ok: true, user: lastUser };
    });
  }

  /* 启动时用服务端会话校准本地缓存 */
  function syncSession() {
    return api("GET", "/api/auth/session").then(function (r) {
      var cached = getSession();
      if (r.ok && r.user) {
        var u = toLocalUser(r.user);
        if (!cached || cached.phone !== u.phone || cached.nickname !== u.nickname || cached.tone !== u.tone || cached.userId !== u.userId) {
          signIn(u, cached ? cached.remember : true);
        }
        return getSession();
      }
      if (r.status === 401 && cached) {
        store.del(K.session);
        emit(null);
      }
      return r.status === 401 ? null : cached;
    });
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
        el.setAttribute("href", "profile.html");
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
        var user = r.user;
        if (r.isNew) user = upsertUser(v.value, { nickname: user.nickname, tone: user.tone });
        signIn(user, true);
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
    syncSession();
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
    saveMe: saveMe,
    syncSession: syncSession,
    api: api,
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
