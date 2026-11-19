/* ==========================================================================
   义乌AI圈 — 商家认证（爱猹收支付）
   ========================================================================== */
(function () {
  "use strict";

  var PRICE_FALLBACK = "99";
  var CACHE_KEY = "ywai.cert.app.v1";

  var state = {
    price: PRICE_FALLBACK,
    smsMode: "demo",
    configured: false,
    user: null,
    application: null,
    purchase: null,
    access: null,
    resynced: false
  };

  var steps = Array.prototype.slice.call(document.querySelectorAll("[data-step]"));
  var dots = Array.prototype.slice.call(document.querySelectorAll("[data-step-dot]"));
  var order = ["auth", "apply", "pay", "done"];

  /* ------------------------------------------------------------- 基础工具 */

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function api(pathname, options) {
    options = options || {};
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 20000) : null;
    return fetch(pathname, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, data: data || {} };
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      return { status: 0, data: { ok: false, error: "network", message: err && err.name === "AbortError" ? "请求超时，请重试" : "网络异常，请稍后再试" } };
    });
  }

  function toast(msg) {
    if (window.YW && window.YW.ui && window.YW.ui.toast) window.YW.ui.toast(msg);
  }

  function setError(name, msg) {
    var el = document.querySelector('[data-err="' + name + '"]');
    if (el) {
      el.textContent = msg || "";
      el.classList.toggle("is-on", Boolean(msg));
    }
  }

  function clearErrors(form) {
    Array.prototype.forEach.call(form.querySelectorAll(".field-error"), function (el) {
      el.textContent = "";
      el.classList.remove("is-on");
    });
    Array.prototype.forEach.call(form.querySelectorAll(".has-error"), function (el) {
      el.classList.remove("has-error");
    });
  }

  function markError(input, name, msg) {
    setError(name, msg);
    if (input) input.classList.add("has-error");
  }

  function showStep(name) {
    steps.forEach(function (el) {
      el.hidden = el.dataset.step !== name;
    });
    var idx = order.indexOf(name);
    dots.forEach(function (el, i) {
      var k = order.indexOf(el.dataset.stepDot);
      el.classList.toggle("is-on", k === idx);
      el.classList.toggle("is-done", k < idx);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function money(v) {
    return "¥" + v;
  }

  /* --------------------------------------------------------------- 会话 */

  function checkSession() {
    return api("/api/auth/session").then(function (r) {
      if (r.status === 200 && r.data.ok) {
        state.user = r.data.user;
        syncHeader();
        return loadStatus();
      }
      showStep("auth");
      prefillPhone();
      return null;
    });
  }

  function prefillPhone() {
    var input = $("#cPhone");
    if (!input || input.value) return;
    try {
      var session = window.YW && window.YW.auth && window.YW.auth.getSession();
      if (session && session.phone) input.value = session.phone;
    } catch (e) { /* 忽略 */ }
  }

  function syncHeader() {
    if (!state.user) return;
    setText("[data-done-no]", certNo(state.user.userId));
  }

  function certNo(userId) {
    return "YWA-" + String(userId || "").replace(/^u_/, "").slice(-8).toUpperCase();
  }

  function setText(sel, value) {
    Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
      el.textContent = value;
    });
  }

  /* ----------------------------------------------------------- 状态查询 */

  function loadStatus() {
    return api("/api/cert/status").then(function (r) {
      if (r.status === 401) {
        state.user = null;
        showStep("auth");
        prefillPhone();
        return;
      }
      if (!r.data.ok) {
        toast(r.data.message || "认证服务暂不可用");
        if (r.data.error === "payment_not_configured") {
          fillApplyDraft();
          showStep("apply");
        }
        return;
      }

      state.access = r.data.access;
      state.application = r.data.application;
      state.purchase = r.data.purchase;
      state.price = r.data.price || state.price;
      state.user = r.data.user || state.user;

      paintPrice();

      if (state.access === "granted") {
        fillDone();
        showStep("done");
        return;
      }

      var cached = readCache();
      if (!state.application && cached && state.user && cached.userId === state.user.userId && !state.resynced) {
        state.resynced = true;
        api("/api/cert/apply", { method: "POST", body: cached }).then(function (res) {
          if (res.data.ok) {
            state.application = res.data.application;
            route();
          } else {
            route();
          }
        });
        return;
      }

      route();
    });
  }

  function route() {
    if (state.application) {
      fillPay();
      showStep("pay");
    } else {
      fillApplyDraft();
      showStep("apply");
    }
  }

  function paintPrice() {
    setText("[data-pay-price]", money(state.price));
    setText("[data-pay-amount]", money(state.price));
    var submit = $("[data-apply-submit]");
    if (submit) submit.innerHTML = '提交并去支付 ' + money(state.price) + ' <span class="arrow">→</span>';
  }

  /* ------------------------------------------------------------- 步骤一 */

  function bindAuth() {
    var form = $("[data-auth-form]");
    if (!form) return;
    var sendBtn = $("[data-send-code]");
    var hint = $("[data-auth-hint]");

    if (sendBtn) {
      sendBtn.addEventListener("click", function () {
        var phone = ($("#cPhone").value || "").trim();
        if (!/^1[3-9]\d{9}$/.test(phone)) {
          markError($("#cPhone"), "phone", "请输入有效的 11 位手机号");
          return;
        }
        sendBtn.disabled = true;
        api("/api/auth/send", { method: "POST", body: { phone: phone } }).then(function (r) {
          if (r.data.ok) {
            if (r.data.demoCode) {
              if (hint) hint.textContent = "演示模式：验证码为 " + r.data.demoCode;
              toast("演示验证码 " + r.data.demoCode + "，正式上线后改为短信下发");
            } else {
              if (hint) hint.textContent = "验证码已发送，5 分钟内有效";
              toast("验证码已发送");
            }
            countdown(sendBtn);
          } else {
            sendBtn.disabled = false;
            toast(r.data.message || "验证码发送失败");
          }
        });
      });
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      clearErrors(form);
      var phone = ($("#cPhone").value || "").trim();
      var code = ($("#cCode").value || "").trim();

      if (!/^1[3-9]\d{9}$/.test(phone)) {
        markError($("#cPhone"), "phone", "请输入有效的 11 位手机号");
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        markError($("#cCode"), "code", "请输入 6 位数字验证码");
        return;
      }

      var btn = $("[data-auth-submit]");
      btn.disabled = true;
      api("/api/auth/session", { method: "POST", body: { phone: phone, code: code } }).then(function (r) {
        btn.disabled = false;
        if (!r.data.ok) {
          markError($("#cCode"), "code", r.data.message || "验证失败");
          return;
        }
        state.user = r.data.user;
        syncHeader();
        loadStatus();
      });
    });
  }

  function countdown(btn) {
    var left = 60;
    btn.disabled = true;
    btn.textContent = left + "s 后重发";
    var timer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = "重新获取";
        return;
      }
      btn.textContent = left + "s 后重发";
    }, 1000);
  }

  /* ------------------------------------------------------------- 步骤二 */

  function fillApplyDraft() {
    var app = state.application || readCache();
    if (!app) return;
    if (state.user && app.userId && app.userId !== state.user.userId) return;
    setValue("#cShop", app.shopName);
    setValue("#cZone", app.zone);
    setValue("#cStall", app.stallNo);
    setValue("#cContact", app.contactName);
    setValue("#cWechat", app.wechat);
    setValue("#cIntro", app.intro);
  }

  function setValue(sel, value) {
    var el = $(sel);
    if (el && value) el.value = value;
  }

  function bindApply() {
    var form = $("[data-apply-form]");
    if (!form) return;

    var back = $("[data-back-auth]");
    if (back) back.addEventListener("click", function () { showStep("auth"); });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      clearErrors(form);

      var payload = {
        shopName: ($("#cShop").value || "").trim(),
        zone: $("#cZone").value || "",
        stallNo: ($("#cStall").value || "").trim(),
        contactName: ($("#cContact").value || "").trim(),
        wechat: ($("#cWechat").value || "").trim(),
        intro: ($("#cIntro").value || "").trim()
      };

      if (payload.shopName.length < 2 || payload.shopName.length > 40) {
        markError($("#cShop"), "shopName", "商家名称需 2–40 字");
        return;
      }
      if (!payload.zone) {
        markError($("#cZone"), "zone", "请选择所在区域");
        return;
      }
      if (!payload.stallNo || payload.stallNo.length > 24) {
        markError($("#cStall"), "stallNo", "请填写铺位号");
        return;
      }
      if (payload.contactName.length < 2 || payload.contactName.length > 20) {
        markError($("#cContact"), "contactName", "请填写联系人姓名");
        return;
      }
      if (!/^[A-Za-z0-9_-]{4,32}$/.test(payload.wechat)) {
        markError($("#cWechat"), "wechat", "微信号需 4–32 位字母、数字、下划线或减号");
        return;
      }
      if (payload.intro.length > 200) {
        markError($("#cIntro"), "intro", "简介最多 200 字");
        return;
      }
      var agree = $("[data-agree]");
      if (!agree || !agree.checked) {
        setError("agree", "请先同意用户协议与社区公约");
        return;
      }

      var btn = $("[data-apply-submit]");
      btn.disabled = true;
      api("/api/cert/apply", { method: "POST", body: payload }).then(function (r) {
        btn.disabled = false;
        if (!r.data.ok) {
          if (r.status === 401) {
            showStep("auth");
            toast("请重新确认手机号");
            return;
          }
          toast(r.data.message || "提交失败，请检查资料");
          return;
        }
        state.application = r.data.application;
        writeCache(r.data.application);
        fillPay();
        showStep("pay");
        loadStatus();
      });
    });
  }

  /* ------------------------------------------------------------- 步骤三 */

  function fillPay() {
    var app = state.application;
    if (app) {
      setText("[data-pay-shop]", app.shopName);
      setText("[data-pay-stall]", (app.zone || "") + " " + (app.stallNo || ""));
    }
    paintPrice();

    var box = $("[data-qr-box]");
    var img = $("[data-qr-img]");
    var link = $("[data-pay-link]");
    var hint = $("[data-pay-hint]");

    if (state.purchase && state.purchase.url) {
      if (link) {
        link.href = state.purchase.url;
        link.removeAttribute("aria-disabled");
      }
      if (box && img && state.purchase.qrCodeUrl) {
        img.src = state.purchase.qrCodeUrl;
        box.hidden = false;
      }
      if (hint) hint.textContent = "支付页与二维码由爱猹收提供。链接有效期较短，过期请点下方按钮重新获取。";
    } else {
      if (link) link.setAttribute("aria-disabled", "true");
      if (box) box.hidden = true;
      if (hint) {
        hint.textContent = state.access === "unavailable"
          ? "该商品当前暂不可购买，请联系运营处理。"
          : "支付入口获取中，请点「我已支付，刷新状态」重试。";
      }
    }
  }

  function bindPay() {
    var refresh = $("[data-refresh]");
    if (refresh) {
      refresh.addEventListener("click", function () {
        refresh.disabled = true;
        toast("正在查询支付结果…");
        loadStatus().then(function () {
          refresh.disabled = false;
          if (state.access !== "granted") {
            toast("还没查到支付记录，支付完成后通常几秒内到账");
          }
        });
      });
    }
    var edit = $("[data-edit-apply]");
    if (edit) {
      edit.addEventListener("click", function () {
        fillApplyDraft();
        showStep("apply");
      });
    }
    var link = $("[data-pay-link]");
    if (link) {
      link.addEventListener("click", function (ev) {
        if (link.getAttribute("aria-disabled") === "true" || !link.href || link.href.indexOf("#") >= 0) {
          ev.preventDefault();
          toast("支付入口尚未就绪，请点「我已支付，刷新状态」重新获取");
        }
      });
    }
  }

  /* ------------------------------------------------------------- 步骤四 */

  function fillDone() {
    var app = state.application || readCache() || {};
    setText("[data-done-shop]", app.shopName ? app.shopName + " 已通过认证" : "你的档口已通过认证");
    setText("[data-done-zone]", app.zone || "—");
    setText("[data-done-stall]", app.stallNo || "—");
    setText("[data-done-no]", certNo(state.user && state.user.userId));
  }

  /* --------------------------------------------------------------- 缓存 */

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function writeCache(app) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(app));
    } catch (e) { /* 忽略 */ }
  }

  /* --------------------------------------------------------------- 启动 */

  function boot() {
    api("/api/cert/config").then(function (r) {
      if (r.data && r.data.ok) {
        state.price = r.data.price || state.price;
        state.smsMode = r.data.smsMode || state.smsMode;
        state.configured = Boolean(r.data.configured);
        paintPrice();
        var hint = $("[data-auth-hint]");
        if (hint && state.smsMode === "demo") hint.textContent = "演示模式：验证码固定为 123456";
      }
      bindAuth();
      bindApply();
      bindPay();
      checkSession();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
