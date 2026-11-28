/* ==========================================================================
   义乌AI圈 — login page controller
   ========================================================================== */
(function () {
  "use strict";

  var A = window.YW.auth;
  var U = window.YW.ui;
  var sheet = document.querySelector(".auth__sheet");
  if (!sheet) return;

  var steps = {};
  Array.prototype.forEach.call(sheet.querySelectorAll(".auth-step"), function (el) {
    steps[el.dataset.step] = el;
  });

  var tabs = sheet.querySelector(".auth__tabs");
  var extras = sheet.querySelectorAll(".auth-div, .socials, .auth-legal, .demo-hint");

  if (A.smsMode === "api") {
    Array.prototype.forEach.call(document.querySelectorAll(".demo-hint"), function (el) { el.remove(); });
  }

  /* 还没开通短信（服务端 SMS_MODE=off）：收起登录表单，告诉访客活动报名不用登录 */
  fetch("/api/site", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (d) {
    if (!d || !d.settings || d.settings.login !== false) return;
    var closed = sheet.querySelector("[data-login-closed]");
    if (!closed) return;
    closed.hidden = false;
    if (tabs) tabs.hidden = true;
    Array.prototype.forEach.call(sheet.querySelectorAll(".auth-step, .auth-div, .socials, .demo-hint, .auth-legal, .auth__desc"), function (el) { el.hidden = true; });
  }).catch(function () {});

  var pending = null;

  var params = new URLSearchParams(window.location.search);
  var rawRedirect = params.get("redirect") || "index.html";
  var safeRedirect = /^[\w\-.]+\.html(\?[\w\-.=&%]+)?(#[\w-]+)?$/.test(rawRedirect) ? rawRedirect : "index.html";

  function show(step) {
    Object.keys(steps).forEach(function (k) {
      steps[k].classList.toggle("is-on", k === step);
    });
    var isSub = step === "profile" || step === "done";
    if (tabs) tabs.style.display = isSub ? "none" : "flex";
    Array.prototype.forEach.call(extras, function (el) {
      el.style.display = isSub ? "none" : "";
    });
    Array.prototype.forEach.call(sheet.querySelectorAll(".auth__tab"), function (t) {
      t.setAttribute("aria-selected", "false");
    });
    var active = sheet.querySelector('.auth__tab[data-tab="' + step + '"]');
    if (active) active.setAttribute("aria-selected", "true");
    if (step === "otp" || step === "pw") {
      var t = sheet.querySelector('.auth__tab[data-tab="' + step + '"]');
      if (t) t.setAttribute("aria-selected", "true");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------- tabs ---------------- */
  Array.prototype.forEach.call(sheet.querySelectorAll(".auth__tab"), function (tab) {
    tab.addEventListener("click", function () {
      var id = tab.dataset.tab;
      show(id);
      var step = steps[id];
      U.clearErrors(step);
      var input = step.querySelector("input");
      if (input) input.focus();
    });
  });

  /* ---------------- shared phone behaviour ---------------- */
  function wirePhone(form) {
    var input = form.querySelector("[data-phone]");
    var clear = form.querySelector("[data-clear-phone]");
    if (!input) return;

    var last = U.store.get("ywai.lastPhone", "");
    if (last && !input.value) input.value = last;

    input.addEventListener("input", function () {
      input.value = input.value.replace(/\D/g, "").slice(0, 11);
      if (clear) clear.classList.toggle("is-on", input.value.length > 0);
      U.fieldError(form, "phone", "");
    });

    if (clear) {
      clear.classList.toggle("is-on", input.value.length > 0);
      clear.addEventListener("click", function () {
        input.value = "";
        clear.classList.remove("is-on");
        input.focus();
      });
    }
  }

  /* ---------------- OTP step ---------------- */
  var otpForm = steps.otp;
  wirePhone(otpForm);
  U.bindOtp(otpForm, function () {
    submitOtp();
  });

  var sendBtn = otpForm.querySelector("[data-send-code]");
  var otpPhone = otpForm.querySelector("[data-phone]");

  sendBtn.addEventListener("click", function () {
    var v = A.validatePhone(otpPhone.value);
    if (!v.ok) {
      U.fieldError(otpForm, "phone", v.msg);
      U.shake(otpPhone.closest(".phone-field"));
      otpPhone.focus();
      return;
    }
    U.fieldError(otpForm, "phone", "");
    sendBtn.disabled = true;
    A.requestCode(v.value).then(function (r) {
      sendBtn.disabled = false;
      if (!r.ok) {
        U.setStatus(otpForm, "error", r.msg);
        return;
      }
      U.store.set("ywai.lastPhone", v.value);
      U.setStatus(otpForm, "info", r.real
        ? "验证码已发送至 +86 " + U.maskPhone(v.value) + " · " + (r.exp || 5) + " 分钟内有效"
        : "验证码已下发至 +86 " + U.maskPhone(v.value) + " · 演示码 " + r.code);
      U.startCountdown(sendBtn, 60, "获取验证码");
      var first = otpForm.querySelector(".otp__box");
      if (first) first.focus();
    });
  });

  function submitOtp() {
    if (otpForm.dataset.locked === "1") return;
    var v = A.validatePhone(otpPhone.value);
    if (!v.ok) {
      U.fieldError(otpForm, "phone", v.msg);
      U.shake(otpPhone.closest(".phone-field"));
      return;
    }
    var code = U.otpValue(otpForm);
    if (code.length !== 6) {
      U.fieldError(otpForm, "code", "请输入完整的 6 位验证码");
      U.shake(otpForm.querySelector(".otp"));
      return;
    }
    var terms = otpForm.querySelector("[data-terms]");
    if (terms && !terms.checked) {
      U.setStatus(otpForm, "error", "请先阅读并同意《用户协议》与《隐私政策》");
      otpForm.querySelector(".auth-meta").classList.add("shake");
      setTimeout(function () { otpForm.querySelector(".auth-meta").classList.remove("shake"); }, 450);
      return;
    }

    var btn = otpForm.querySelector("[data-submit]");
    U.clearErrors(otpForm);
    U.busy(btn, true);
    otpForm.dataset.locked = "1";

    A.verifyCode(v.value, code).then(function (r) {
      U.busy(btn, false);
      otpForm.dataset.locked = "0";
      if (!r.ok) {
        U.fieldError(otpForm, "code", r.msg);
        U.shake(otpForm.querySelector(".otp"));
        U.clearOtp(otpForm);
        return;
      }
      U.store.set("ywai.lastPhone", v.value);
      var user = A.findUser(v.value);
      if (user) {
        finish(user, true);
      } else {
        startProfile(v.value);
      }
    });
  }

  otpForm.addEventListener("submit", function (e) {
    e.preventDefault();
    submitOtp();
  });

  /* ---------------- password step ---------------- */
  var pwForm = steps.pw;
  wirePhone(pwForm);

  var pwInput = pwForm.querySelector("[data-password]");
  var caps = pwForm.querySelector("[data-caps]");

  Array.prototype.forEach.call(sheet.querySelectorAll("[data-pw-toggle]"), function (toggle) {
    toggle.addEventListener("click", function () {
      var wrap = toggle.closest(".pw-wrap");
      var input = wrap ? wrap.querySelector("input") : null;
      if (!input) return;
      var visible = input.type === "text";
      input.type = visible ? "password" : "text";
      toggle.textContent = visible ? "显示" : "隐藏";
      input.focus();
    });
  });

  if (pwInput) {
    pwInput.addEventListener("keyup", function (e) {
      if (!caps) return;
      caps.classList.toggle("is-on", e.getModifierState && e.getModifierState("CapsLock"));
    });
    pwInput.addEventListener("blur", function () {
      if (caps) caps.classList.remove("is-on");
    });
    pwInput.addEventListener("input", function () {
      U.fieldError(pwForm, "password", "");
    });
  }

  var forgot = pwForm.querySelector("[data-forgot]");
  if (forgot) {
    forgot.addEventListener("click", function () {
      show("otp");
      U.setStatus(steps.otp, "info", "忘记密码？用短信验证码登录后可重设密码。");
      var input = steps.otp.querySelector("[data-phone]");
      var pwPhone = pwForm.querySelector("[data-phone]");
      if (input && pwPhone && pwPhone.value) input.value = pwPhone.value;
    });
  }

  pwForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (pwForm.dataset.locked === "1") return;
    var v = A.validatePhone(pwForm.querySelector("[data-phone]").value);
    if (!v.ok) {
      U.fieldError(pwForm, "phone", v.msg);
      U.shake(pwForm.querySelector(".phone-field"));
      return;
    }
    var pv = A.validatePassword(pwInput.value, false);
    if (!pv.ok) {
      U.fieldError(pwForm, "password", pv.msg);
      U.shake(pwInput.closest(".pw-wrap") || pwInput);
      return;
    }
    var remember = pwForm.querySelector("[data-remember]");
    var btn = pwForm.querySelector("[data-submit]");
    U.clearErrors(pwForm);
    U.busy(btn, true);
    pwForm.dataset.locked = "1";

    A.loginWithPassword(v.value, pwInput.value, remember ? remember.checked : true).then(function (r) {
      U.busy(btn, false);
      pwForm.dataset.locked = "0";
      if (!r.ok) {
        U.setStatus(pwForm, "error", r.msg);
        U.fieldError(pwForm, "password", r.locked ? "" : "账号或密码不正确");
        U.shake(pwInput.closest(".pw-wrap") || pwInput);
        pwInput.select();
        return;
      }
      U.store.set("ywai.lastPhone", v.value);
      finish(r.user, remember ? remember.checked : true);
    });
  });

  /* ---------------- profile step (new account) ---------------- */
  var profileForm = steps.profile;
  var nickInput = profileForm.querySelector("[data-nickname]");
  var newPw = profileForm.querySelector("[data-new-password]");
  var strength = profileForm.querySelector("[data-strength]");

  function paintStrength(score) {
    if (!strength) return;
    strength.dataset.level = String(score);
    var labels = ["未设置", "偏弱", "一般", "较强", "很强"];
    var label = strength.querySelector("[data-strength-label]");
    if (label) label.textContent = labels[score] || "";
  }

  if (newPw) {
    newPw.addEventListener("input", function () {
      paintStrength(A.passwordScore(newPw.value));
      U.fieldError(profileForm, "newPassword", "");
    });
    paintStrength(A.passwordScore(newPw.value));
  }

  if (nickInput) {
    nickInput.addEventListener("input", function () {
      U.fieldError(profileForm, "nickname", "");
    });
  }

  function startProfile(phone) {
    pending = { phone: phone };
    U.clearErrors(profileForm);
    var status = profileForm.querySelector("[data-status]");
    if (status) {
      status.className = "auth-status is-on is-ok";
      status.innerHTML = '<span class="auth-status__icon">✓</span><span>手机号 +86 ' +
        U.maskPhone(phone) + " 验证通过，设置昵称即可完成注册。</span>";
    }
    var hint = profileForm.querySelector("[data-nick-phone]");
    if (hint) hint.textContent = "+86 " + U.maskPhone(phone);
    show("profile");
    setTimeout(function () { if (nickInput) nickInput.focus(); }, 120);
  }

  profileForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!pending) return;
    var nv = A.validateNickname(nickInput.value);
    if (!nv.ok) {
      U.fieldError(profileForm, "nickname", nv.msg);
      U.shake(nickInput);
      return;
    }
    var pw = newPw ? newPw.value : "";
    if (pw) {
      var pv = A.validatePassword(pw, true);
      if (!pv.ok) {
        U.fieldError(profileForm, "newPassword", pv.msg);
        U.shake(newPw);
        return;
      }
    }
    var btn = profileForm.querySelector("[data-submit]") || profileForm.querySelector("button[type='submit']");
    U.busy(btn, true);
    A.saveMe({ nickname: nv.value, tone: A.toneFor(pending.phone), password: pw }).then(function (r) {
      U.busy(btn, false);
      if (!r.ok) {
        U.setStatus(profileForm, "error", r.msg);
        return;
      }
      finish(r.user, true);
    });
  });

  /* ---------------- done ---------------- */
  function finish(user, remember) {
    A.signIn(user, remember);
    var name = steps.done.querySelector("[data-done-name]");
    var phone = steps.done.querySelector("[data-done-phone]");
    var go = steps.done.querySelector("[data-done-go]");
    if (name) name.textContent = user.nickname;
    if (phone) phone.textContent = "+86 " + U.maskPhone(user.phone);
    if (go) go.setAttribute("href", safeRedirect);
    show("done");
    U.toast("已入场 · " + user.nickname);
  }

  var another = steps.done.querySelector("[data-done-another]");
  if (another) {
    another.addEventListener("click", function () {
      A.signOut();
      pending = null;
      show("otp");
      U.clearOtp(otpForm);
      U.clearErrors(otpForm);
    });
  }

  /* ---------------- social buttons ---------------- */
  Array.prototype.forEach.call(sheet.querySelectorAll("[data-social]"), function (btn) {
    btn.addEventListener("click", function () {
      U.toast("演示环境：" + btn.dataset.social + "扫码登录尚未接入，请使用手机号入场。");
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-demo]"), function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      U.toast(el.dataset.demo);
    });
  });

  /* ---------------- boot ---------------- */
  var session = A.getSession();
  if (session) {
    var user = A.findUser(session.phone) || session;
    var name = steps.done.querySelector("[data-done-name]");
    var phone = steps.done.querySelector("[data-done-phone]");
    var go = steps.done.querySelector("[data-done-go]");
    if (name) name.textContent = session.nickname;
    if (phone) phone.textContent = "+86 " + U.maskPhone(session.phone);
    if (go) go.setAttribute("href", safeRedirect);
    show("done");
  } else {
    show("otp");
    var target = document.querySelector('[data-step="otp"] [data-phone]');
    if (target) setTimeout(function () { target.focus(); }, 260);
  }

  A.onChange(function () {});
})();
