/* ==========================================================================
   义乌AI圈 · 专属邀请函
   报名成功后按访客的称呼在浏览器里画一张邀请函（1080 宽的 JPG），
   可以长按保存、发给朋友或朋友圈。底部二维码指向报名页，扫码的人也能报名。

   window.YWInvite.render(data) → Promise<HTMLCanvasElement>
   data: { style, name, company, title, subtitle, timeText, place, host,
           orgs: { sponsors, partners, supporters }, message, qr: ["0101…"], posterUrl, logoUrl }
   ========================================================================== */
(function () {
  "use strict";

  var W = 1080;
  var L = 132;
  var R = W - 132;
  var CX = W / 2;
  var CW = R - L;

  var SERIF = '"Songti SC", "STSong", "Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", serif';
  var SANS = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", sans-serif';
  var KAI = '"Kaiti SC", "STKaiti", "KaiTi", "楷体", ' + SERIF;

  var THEMES = {
    /* 鸿运朱金：正红底、鎏金字，喜庆隆重 */
    crimson: {
      bg: ["#b8261b", "#8f140d", "#560705"],
      base: "#560705",
      glow: "rgba(255, 196, 112, 0.34)",
      ray: "rgba(255, 214, 140, 0.10)",
      gold: "#efcb7c",
      text: "#fff2d8",
      sub: "rgba(255, 234, 202, 0.78)",
      panel: "rgba(255, 214, 150, 0.08)",
      panelLine: "rgba(239, 203, 124, 0.55)",
      pattern: "rgba(244, 204, 124, 0.30)",
      spark: "255, 226, 160",
      seal: { fill: "", line: "#f2cf80", text: "#f2cf80" },
      textShadow: "rgba(255, 196, 96, 0.45)"
    },
    /* 墨金典藏：墨黑底、金线、朱红印章，沉稳高级 */
    ink: {
      bg: ["#2e281d", "#17140f", "#090807"],
      base: "#090807",
      glow: "rgba(222, 176, 92, 0.26)",
      ray: "rgba(232, 196, 120, 0.07)",
      gold: "#e3bf72",
      text: "#f7efdd",
      sub: "rgba(247, 239, 221, 0.72)",
      panel: "rgba(232, 196, 120, 0.06)",
      panelLine: "rgba(227, 191, 114, 0.45)",
      pattern: "rgba(227, 191, 114, 0.22)",
      spark: "240, 210, 140",
      seal: { fill: "#c3361c", line: "#c3361c", text: "#fff1dc" },
      textShadow: "rgba(222, 176, 92, 0.35)"
    }
  };
  THEMES.poster = THEMES.ink;

  /* ---------------- 工具 ---------------- */
  function rng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  /* Logo 转成烫金双色：白色部分变亮金，红色部分变深金，红底上也看得清 */
  function goldLogo(img, h) {
    var w = Math.round(img.width * h / img.height);
    var c = document.createElement("canvas");
    c.width = w * 2;
    c.height = h * 2;
    var x = c.getContext("2d");
    x.drawImage(img, 0, 0, c.width, c.height);
    try {
      var data = x.getImageData(0, 0, c.width, c.height);
      var p = data.data;
      var dark = [176, 120, 40];
      var light = [255, 241, 196];
      for (var i = 0; i < p.length; i += 4) {
        if (!p[i + 3]) continue;
        var lum = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
        var k = Math.max(0, Math.min(1, (lum - 0.25) / 0.7));
        p[i] = dark[0] + (light[0] - dark[0]) * k;
        p[i + 1] = dark[1] + (light[1] - dark[1]) * k;
        p[i + 2] = dark[2] + (light[2] - dark[2]) * k;
      }
      x.putImageData(data, 0, 0);
    } catch (e) { /* 读不了像素就用原图 */ }
    return { canvas: c, w: w, h: h };
  }

  function font(weight, size, family) { return weight + " " + size + "px " + family; }

  /* 鎏金：竖向多段渐变，像烫金在光下的反光 */
  function goldFill(ctx, y0, y1) {
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, "#fff7dc");
    g.addColorStop(0.28, "#f5d487");
    g.addColorStop(0.5, "#c8923a");
    g.addColorStop(0.68, "#f8dd96");
    g.addColorStop(1, "#ad7726");
    return g;
  }

  function goldLine(ctx, x0, x1, alpha) {
    var g = ctx.createLinearGradient(x0, 0, x1, 0);
    var a = alpha == null ? 1 : alpha;
    g.addColorStop(0, "rgba(239, 203, 124, 0)");
    g.addColorStop(0.5, "rgba(250, 222, 150, " + a + ")");
    g.addColorStop(1, "rgba(239, 203, 124, 0)");
    return g;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function diamond(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s, y);
    ctx.closePath();
    ctx.fill();
  }

  /* 字间距：canvas 的 letterSpacing 兼容性不够，逐字画 */
  function spaced(ctx, text, x, y, gap, align) {
    var chars = Array.from(text);
    var widths = chars.map(function (c) { return ctx.measureText(c).width; });
    var total = widths.reduce(function (a, b) { return a + b; }, 0) + gap * Math.max(0, chars.length - 1);
    var cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
    var keep = ctx.textAlign;
    ctx.textAlign = "left";
    chars.forEach(function (c, i) { ctx.fillText(c, cx, y); cx += widths[i] + gap; });
    ctx.textAlign = keep;
    return total;
  }

  /* 中文按字折行，英文单词不拆；标点不放行首（挂在上一行末尾） */
  var NO_START = "，。、！？：；）》」』”’…·,.!?:;)%";
  function wrap(ctx, text, maxW, maxLines) {
    var out = [];
    String(text).split("\n").forEach(function (para) {
      var tokens = para.match(/[A-Za-z0-9][A-Za-z0-9@#&+._\-\/:'%]*|\s+|[\s\S]/g) || [""];
      var line = "";
      tokens.forEach(function (t) {
        if (ctx.measureText(t).width > maxW && t.length > 1) {
          Array.from(t).forEach(function (ch) { push(ch); });
          return;
        }
        push(t);
      });
      out.push(line);

      function push(t) {
        var test = line + t;
        if (line && ctx.measureText(test).width > maxW) {
          if (NO_START.indexOf(t) >= 0) { line = test; return; }
          out.push(line.replace(/\s+$/, ""));
          line = t.replace(/^\s+/, "");
        } else {
          line = test;
        }
      }
    });
    if (maxLines && out.length > maxLines) {
      out = out.slice(0, maxLines);
      var last = out[maxLines - 1];
      while (last && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
      out[maxLines - 1] = last + "…";
    }
    return out;
  }

  /* 名单按「整个名称」换行，不把一个单位名拆到两行；单个名称本身太长时才逐字折 */
  function wrapItems(ctx, items, sep, maxW, maxLines) {
    var lines = [];
    var line = "";
    items.forEach(function (it) {
      var test = line ? line + sep + it : it;
      if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = it; }
      else line = test;
    });
    if (line) lines.push(line);
    var out = [];
    lines.forEach(function (l) { out = out.concat(ctx.measureText(l).width > maxW ? wrap(ctx, l, maxW) : [l]); });
    if (maxLines && out.length > maxLines) {
      out = out.slice(0, maxLines);
      var last = out[maxLines - 1];
      while (last && ctx.measureText(last + " 等").width > maxW) last = last.slice(0, -1);
      out[maxLines - 1] = last + " 等";
    }
    return out;
  }

  /* 一行放不下时先缩字号，到最小字号还放不下就截断 */
  function fitLine(ctx, text, maxW, size, min, weight, family) {
    var s = size;
    ctx.font = font(weight, s, family);
    while (s > min && ctx.measureText(text).width > maxW) {
      s -= 2;
      ctx.font = font(weight, s, family);
    }
    var t = text;
    if (ctx.measureText(t).width > maxW) {
      while (t && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
      t += "…";
    }
    return { text: t, size: s };
  }

  var CN = "〇一二三四五六七八九";
  function cnNum(n) {
    if (n <= 10) return n === 10 ? "十" : CN.charAt(n);
    if (n < 20) return "十" + CN.charAt(n - 10);
    return CN.charAt(Math.floor(n / 10)) + "十" + (n % 10 ? CN.charAt(n % 10) : "");
  }
  function cnDate(d) {
    var y = String(d.getFullYear()).split("").map(function (c) { return CN.charAt(Number(c)); }).join("");
    return y + "年" + cnNum(d.getMonth() + 1) + "月" + cnNum(d.getDate()) + "日";
  }

  function defaultMessage(d) {
    var sub = String(d.subtitle || "").trim().replace(/[。．.！!，,；;、\s]+$/, "");
    return "诚挚邀请您莅临「" + d.title + "」。" + (sub ? sub + "。" : "") +
      "届时与义乌同行共聚一堂，共话 AI 时代的生意新机会，敬请拨冗光临。";
  }

  /* ---------------- 背景 ---------------- */
  function background(ctx, t, H, poster, seed) {
    var bg = ctx.createRadialGradient(CX, 360, 40, CX, 360, Math.max(H, 1600) * 0.95);
    bg.addColorStop(0, t.bg[0]);
    bg.addColorStop(0.45, t.bg[1]);
    bg.addColorStop(1, t.bg[2]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var glowY = 380;
    if (poster) {
      /* 海报铺在上半部分（按宽度铺满，从顶部裁），往下渐隐进底色 */
      var PH = 820;
      var scale = Math.max(W / poster.width, PH / poster.height);
      var dw = poster.width * scale;
      var dh = poster.height * scale;
      ctx.drawImage(poster, (W - dw) / 2, 0, dw, dh);
      var fade = ctx.createLinearGradient(0, PH * 0.3, 0, PH);
      fade.addColorStop(0, "rgba(9, 8, 7, 0)");
      fade.addColorStop(1, t.base);
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, W, PH + 2);
      ctx.fillStyle = t.base;
      ctx.fillRect(0, PH, W, H - PH);
      var top = ctx.createLinearGradient(0, 0, 0, 180);
      top.addColorStop(0, "rgba(0, 0, 0, 0.45)");
      top.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = top;
      ctx.fillRect(0, 0, W, 180);
      glowY = 860;
    }

    /* 顶部光晕 + 放射光芒 */
    var glow = ctx.createRadialGradient(CX, glowY, 0, CX, glowY, 560);
    glow.addColorStop(0, t.glow);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    var rayFill = ctx.createRadialGradient(CX, glowY, 0, CX, glowY, 980);
    rayFill.addColorStop(0, t.ray);
    rayFill.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = rayFill;
    for (var i = 0; i < 18; i++) {
      var a0 = (i / 18) * Math.PI * 2;
      var a1 = a0 + Math.PI / 36;
      ctx.beginPath();
      ctx.moveTo(CX, glowY);
      ctx.lineTo(CX + Math.cos(a0) * 1400, glowY + Math.sin(a0) * 1400);
      ctx.lineTo(CX + Math.cos(a1) * 1400, glowY + Math.sin(a1) * 1400);
      ctx.closePath();
      ctx.fill();
    }

    /* 底部青海波纹，往上渐隐 */
    var band = 460;
    var off = document.createElement("canvas");
    off.width = W;
    off.height = band;
    var o = off.getContext("2d");
    var r = 58;
    o.lineWidth = 2;
    for (var row = 0; row * (r / 2) < band + r; row++) {
      var yy = row * (r / 2);
      for (var x = (row % 2 ? r : 0) - r; x < W + r; x += r * 2) {
        o.beginPath();
        o.arc(x, yy, r, Math.PI, 0);
        o.closePath();
        o.fillStyle = t.base;
        o.fill();
        o.strokeStyle = t.pattern;
        [r - 4, r * 0.74, r * 0.5, r * 0.26].forEach(function (rr) {
          o.beginPath();
          o.arc(x, yy, rr, Math.PI, 0);
          o.stroke();
        });
      }
    }
    o.globalCompositeOperation = "destination-in";
    var mask = o.createLinearGradient(0, 0, 0, band);
    mask.addColorStop(0, "rgba(0, 0, 0, 0)");
    mask.addColorStop(0.55, "rgba(0, 0, 0, 0.55)");
    mask.addColorStop(1, "rgba(0, 0, 0, 0.9)");
    o.fillStyle = mask;
    o.fillRect(0, 0, W, band);
    ctx.drawImage(off, 0, H - band);

    /* 金粉：集中在光晕附近 */
    var rand = rng(seed);
    for (var k = 0; k < 90; k++) {
      var ang = rand() * Math.PI * 2;
      var dist = Math.pow(rand(), 0.7) * 620;
      var sx = CX + Math.cos(ang) * dist * 1.2;
      var sy = glowY + Math.sin(ang) * dist * 0.9;
      var sr = rand() * 2.6 + 0.6;
      ctx.fillStyle = "rgba(" + t.spark + ", " + (0.25 + rand() * 0.6).toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
    for (var s = 0; s < 9; s++) {
      var px = 150 + rand() * (W - 300);
      var py = glowY - 300 + rand() * 520;
      star(ctx, px, py, 8 + rand() * 12, "rgba(" + t.spark + ", " + (0.55 + rand() * 0.4).toFixed(2) + ")");
    }

    /* 四周压暗，视线集中到中间 */
    var vig = ctx.createRadialGradient(CX, H / 2, Math.min(W, H) * 0.35, CX, H / 2, Math.max(W, H) * 0.75);
    vig.addColorStop(0, "rgba(0, 0, 0, 0)");
    vig.addColorStop(1, "rgba(0, 0, 0, 0.38)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  function star(ctx, x, y, s, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = s * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x, y, x + s * 0.32, y);
    ctx.quadraticCurveTo(x, y, x, y + s);
    ctx.quadraticCurveTo(x, y, x - s * 0.32, y);
    ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.moveTo(x - s * 0.7, y);
    ctx.quadraticCurveTo(x, y, x, y - s * 0.22);
    ctx.quadraticCurveTo(x, y, x + s * 0.7, y);
    ctx.quadraticCurveTo(x, y, x, y + s * 0.22);
    ctx.quadraticCurveTo(x, y, x - s * 0.7, y);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------- 金框与回纹角花 ---------------- */
  function frame(ctx, t, H) {
    var gold = goldFill(ctx, 0, H);
    ctx.save();
    ctx.strokeStyle = "rgba(239, 203, 124, 0.55)";
    ctx.lineWidth = 2;
    ctx.strokeRect(30, 30, W - 60, H - 60);
    ctx.strokeStyle = gold;
    ctx.lineWidth = 5;
    ctx.strokeRect(46, 46, W - 92, H - 92);
    ctx.strokeStyle = "rgba(239, 203, 124, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(60, 60, W - 120, H - 120);

    [[46, 46, 1, 1], [W - 46, 46, -1, 1], [46, H - 46, 1, -1], [W - 46, H - 46, -1, -1]].forEach(function (c) {
      ctx.save();
      ctx.translate(c[0], c[1]);
      ctx.scale(c[2], c[3]);
      ctx.fillStyle = t.base;
      ctx.fillRect(-8, -8, 30, 30);
      ctx.strokeStyle = gold;
      ctx.lineCap = "square";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, 120); ctx.lineTo(0, 0); ctx.lineTo(120, 0);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(26, 86); ctx.lineTo(26, 26); ctx.lineTo(86, 26);
      ctx.moveTo(26, 60); ctx.lineTo(44, 60); ctx.lineTo(44, 44); ctx.lineTo(60, 44); ctx.lineTo(60, 26);
      ctx.stroke();
      ctx.fillStyle = gold;
      diamond(ctx, 0, 0, 11);
      ctx.restore();
    });

    [[CX, 46], [CX, H - 46]].forEach(function (p) {
      ctx.fillStyle = t.base;
      ctx.fillRect(p[0] - 34, p[1] - 6, 68, 12);
      ctx.fillStyle = gold;
      diamond(ctx, p[0], p[1], 14);
      diamond(ctx, p[0] - 26, p[1], 5);
      diamond(ctx, p[0] + 26, p[1], 5);
    });
    ctx.restore();
  }

  function divider(ctx, y, half) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = goldLine(ctx, CX - half, CX - 24);
    ctx.beginPath(); ctx.moveTo(CX - half, y); ctx.lineTo(CX - 26, y); ctx.stroke();
    ctx.strokeStyle = goldLine(ctx, CX + 24, CX + half);
    ctx.beginPath(); ctx.moveTo(CX + 26, y); ctx.lineTo(CX + half, y); ctx.stroke();
    ctx.fillStyle = goldFill(ctx, y - 12, y + 12);
    diamond(ctx, CX, y, 10);
    ctx.fillStyle = "rgba(239, 203, 124, 0.8)";
    diamond(ctx, CX - 20, y, 4);
    diamond(ctx, CX + 20, y, 4);
    ctx.restore();
  }

  function seal(ctx, t, cx, cy, s) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.14);
    ctx.globalAlpha = 0.9;
    roundRect(ctx, -s / 2, -s / 2, s, s, 12);
    if (t.seal.fill) { ctx.fillStyle = t.seal.fill; ctx.fill(); }
    ctx.lineWidth = 5;
    ctx.strokeStyle = t.seal.line;
    ctx.stroke();
    roundRect(ctx, -s / 2 + 10, -s / 2 + 10, s - 20, s - 20, 6);
    ctx.lineWidth = 2;
    ctx.strokeStyle = t.seal.fill ? "rgba(255, 241, 220, 0.75)" : t.seal.line;
    ctx.stroke();
    ctx.fillStyle = t.seal.text;
    ctx.font = font(700, Math.round(s * 0.32), KAI);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    /* 印文从右往左竖读：诚邀 / 嘉宾 */
    ctx.fillText("诚", s * 0.19, -s * 0.18);
    ctx.fillText("邀", s * 0.19, s * 0.2);
    ctx.fillText("嘉", -s * 0.19, -s * 0.18);
    ctx.fillText("宾", -s * 0.19, s * 0.2);
    ctx.restore();
  }

  function drawQr(ctx, rows, x, y, size) {
    roundRect(ctx, x - 8, y - 8, size + 16, size + 16, 26);
    ctx.lineWidth = 3;
    ctx.strokeStyle = goldFill(ctx, y, y + size);
    ctx.stroke();
    roundRect(ctx, x, y, size, size, 20);
    ctx.fillStyle = "#fffaf0";
    ctx.fill();
    if (!rows || !rows.length) return;
    var n = rows.length;
    var m = Math.floor((size - 36) / n);
    var q = m * n;
    var ox = x + Math.round((size - q) / 2);
    var oy = y + Math.round((size - q) / 2);
    ctx.fillStyle = "#17150f";
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) if (rows[r].charAt(c) === "1") ctx.fillRect(ox + c * m, oy + r * m, m, m);
    }
  }

  /* ---------------- 正文：从上往下排，返回内容底部的 y ---------------- */
  function content(ctx, d, t, logo, poster) {
    var y;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";

    if (poster) {
      y = 720;
    } else {
      y = 150;
      if (logo) {
        ctx.drawImage(logo.canvas, CX - logo.w / 2, y, logo.w, logo.h);
        y += logo.h;
      }
      y += 96;
    }

    ctx.font = font(600, 26, SANS);
    ctx.fillStyle = t.gold;
    spaced(ctx, "INVITATION", CX, y, 16, "center");
    y += 166;

    ctx.save();
    ctx.font = font(900, 156, SERIF);
    ctx.shadowColor = t.textShadow;
    ctx.shadowBlur = 36;
    ctx.fillStyle = goldFill(ctx, y - 136, y + 12);
    spaced(ctx, "邀请函", CX, y, 40, "center");
    ctx.restore();
    y += 64;
    divider(ctx, y, 250);
    y += 104;

    ctx.font = font(400, 38, SERIF);
    ctx.fillStyle = t.sub;
    spaced(ctx, "尊敬的", CX, y, 12, "center");
    y += 116;

    var who = d.name || d.company || "嘉宾";
    var fit = fitLine(ctx, who, CW - 120, 96, 54, 700, KAI);
    ctx.save();
    ctx.font = font(700, fit.size, KAI);
    ctx.shadowColor = t.textShadow;
    ctx.shadowBlur = 26;
    ctx.fillStyle = goldFill(ctx, y - fit.size, y + 10);
    ctx.fillText(fit.text, CX, y);
    var nw = ctx.measureText(fit.text).width;
    ctx.restore();
    y += 38;
    var half = Math.min(CW / 2, nw / 2 + 70);
    ctx.lineWidth = 2;
    ctx.strokeStyle = goldLine(ctx, CX - half, CX + half);
    ctx.beginPath(); ctx.moveTo(CX - half, y); ctx.lineTo(CX + half, y); ctx.stroke();
    ctx.fillStyle = t.gold;
    diamond(ctx, CX - half - 6, y, 5);
    diamond(ctx, CX + half + 6, y, 5);

    if (d.name && d.company) {
      y += 60;
      var co = fitLine(ctx, d.company, CW - 80, 32, 26, 400, SANS);
      ctx.font = font(400, co.size, SANS);
      ctx.fillStyle = t.sub;
      spaced(ctx, co.text, CX, y, 4, "center");
    }
    y += 100;

    /* 邀请语：每段首行空两格 */
    ctx.textAlign = "left";
    ctx.font = font(400, 40, SERIF);
    ctx.fillStyle = t.text;
    var msg = String(d.message || defaultMessage(d)).split("\n").map(function (p) { return p.trim(); })
      .filter(Boolean).map(function (p) { return "　　" + p; }).join("\n");
    wrap(ctx, msg, CW, 9).forEach(function (line) {
      ctx.fillText(line, L, y);
      y += 72;
    });
    y += 26;

    /* 时间地点 */
    var rows = [];
    if (d.message) rows.push(["活动", d.title]);
    if (d.timeText) rows.push(["时间", d.timeText]);
    if (d.place) rows.push(["地点", d.place]);
    if (rows.length) {
      var labelW = 150;
      ctx.font = font(500, 36, SANS);
      var wrapped = rows.map(function (r) { return wrap(ctx, r[1], CW - labelW - 60, 3); });
      var lineH = 56;
      var boxH = 44 + wrapped.reduce(function (s, w) { return s + w.length * lineH; }, 0) + (rows.length - 1) * 22 + 26;
      roundRect(ctx, L - 14, y, CW + 28, boxH, 20);
      ctx.fillStyle = t.panel;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = t.panelLine;
      ctx.stroke();
      var ry = y + 44 + 34;
      rows.forEach(function (r, i) {
        ctx.font = font(600, 30, SANS);
        ctx.fillStyle = t.gold;
        spaced(ctx, r[0], L + 22, ry, 14, "left");
        ctx.font = font(500, 36, SANS);
        ctx.fillStyle = t.text;
        wrapped[i].forEach(function (line, j) { ctx.fillText(line, L + 22 + labelW, ry + j * lineH); });
        ry += wrapped[i].length * lineH + 22;
      });
      y += boxH + 64;
    }

    /* 赞助 / 合作 / 支持 */
    var orgs = d.orgs || {};
    var orgRows = [["赞助", orgs.sponsors], ["合作", orgs.partners], ["支持", orgs.supporters]]
      .filter(function (r) { return r[1] && r[1].length; });
    if (orgRows.length) {
      ctx.textAlign = "center";
      ctx.font = font(600, 26, SANS);
      ctx.fillStyle = t.gold;
      spaced(ctx, "联合呈现", CX, y, 14, "center");
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = goldLine(ctx, L, CX - 90, 0.8);
      ctx.beginPath(); ctx.moveTo(L + 40, y - 9); ctx.lineTo(CX - 96, y - 9); ctx.stroke();
      ctx.strokeStyle = goldLine(ctx, CX + 90, R, 0.8);
      ctx.beginPath(); ctx.moveTo(CX + 96, y - 9); ctx.lineTo(R - 40, y - 9); ctx.stroke();
      y += 66;
      ctx.textAlign = "left";
      orgRows.forEach(function (r) {
        ctx.font = font(600, 28, SANS);
        ctx.fillStyle = t.gold;
        ctx.fillText(r[0] + "方", L + 22, y);
        ctx.font = font(500, 32, SANS);
        ctx.fillStyle = t.text;
        var lines = wrapItems(ctx, r[1], "  ·  ", CW - 170, 3);
        lines.forEach(function (line, j) { ctx.fillText(line, L + 150, y + j * 50); });
        y += lines.length * 50 + 18;
      });
      y += 40;
    }

    /* 落款 + 印章 */
    y += 20;
    var host = String(d.host || "义乌AI圈");
    ctx.textAlign = "right";
    var sigR = R - 138;
    var sig = fitLine(ctx, host + "  敬邀", sigR - L - 40, 44, 30, 700, SERIF);
    ctx.font = font(700, sig.size, SERIF);
    ctx.fillStyle = goldFill(ctx, y - sig.size, y + 8);
    ctx.fillText(sig.text, sigR, y);
    ctx.font = font(400, 30, SERIF);
    ctx.fillStyle = t.sub;
    ctx.fillText(cnDate(new Date()), sigR, y + 58);
    seal(ctx, t, R - 44, y + 8, 116);
    y += 150;

    /* 二维码 */
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = goldLine(ctx, L, R, 0.7);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
    y += 64;
    var qs = 236;
    drawQr(ctx, d.qr, L + 10, y, qs);
    var tx = L + 10 + qs + 56;
    ctx.textAlign = "left";
    ctx.font = font(800, 46, SERIF);
    ctx.fillStyle = goldFill(ctx, y + 40, y + 96);
    ctx.fillText("扫码报名", tx, y + 92);
    ctx.font = font(400, 30, SANS);
    ctx.fillStyle = t.sub;
    ctx.fillText("长按识别二维码", tx, y + 148);
    ctx.fillText("邀请同行一起来", tx, y + 194);
    y += qs + 120;
    return y;
  }

  function render(d) {
    var t = THEMES[d.style] || THEMES.crimson;
    return Promise.all([
      d.style === "poster" ? null : loadImage(d.logoUrl),
      d.style === "poster" ? loadImage(d.posterUrl) : null
    ]).then(function (imgs) {
      var logo = imgs[0] ? goldLogo(imgs[0], 64) : null;
      var poster = imgs[1];
      if (d.style === "poster" && !poster) {
        /* 没有海报或海报加载失败：退回墨金样式，并补上 Logo */
        return render(Object.assign({}, d, { style: "ink" }));
      }
      var probe = document.createElement("canvas");
      probe.width = W;
      probe.height = 4;
      var H = Math.max(1680, Math.ceil(content(probe.getContext("2d"), d, t, logo, poster)));
      var c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      var ctx = c.getContext("2d");
      background(ctx, t, H, poster, hash((d.name || "") + "|" + (d.title || "")));
      frame(ctx, t, H);
      content(ctx, d, t, logo, poster);
      return c;
    });
  }

  window.YWInvite = { render: render, defaultMessage: defaultMessage };
})();
