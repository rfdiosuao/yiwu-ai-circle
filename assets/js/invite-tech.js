/* ==========================================================================
   义乌AI圈 · 科技蓝长图（邀请函样式 tech，也用作「活动长图海报」）
   深蓝底、光带、发光立体标题，按内容自动排成一张 1080 宽的长图：
     Logo 与城市标识 → 系列名 / 年份 → 大标题 → 主题标语 → 主视觉 → 引言或邀请信 → 组织单位
     → 活动信息 → 流程安排 → 议题 → 报名方式（席位、二维码、咨询电话）→ 温馨提示 → Logo
     →（实景照片铺底 + 底部标语）
   没填的板块不画。主视觉用后台上传的图，没有就用代码画的光效舞台。
   比经典邀请函多用到的数据：poster（true = 不带信的海报）、greeting（通用抬头）、signature、signDate、
   intro、agenda、talks、notice、deadlineText、visualUrl、visualAt（top / bottom）、logoUrls、capacity、
   contact、slogan。注册为 YWInvite.styles.tech。
   信件版（访客专属 / 通用邀请函）在标题下多一段：「邀请函」大字 → 抬头 → 正文 → 落款。
   ========================================================================== */
(function () {
  "use strict";

  var Y = window.YWInvite;
  if (!Y || !Y.util) return;
  var U = Y.util;
  var SANS = U.SANS;
  var SERIF = U.SERIF;
  var font = U.font;

  var W = 1080;
  var CX = W / 2;
  var PL = 64;
  var PR = W - 64;
  var PW = PR - PL;
  var IL = PL + 46;
  var IR = PR - 46;
  var IW = IR - IL;
  /* 1080 × 15000 ≈ 1600 万像素，在 iOS Safari 的画布面积上限以内 */
  var MAX_H = 15000;

  var C = {
    cyan: "#62d6ff",
    text: "#ffffff",
    body: "#dbe6ff",
    sub: "#aebfee",
    dim: "#8396cf",
    amber: "#ffb35c"
  };

  /* ---------------- 小工具 ---------------- */
  function rgba(rgb, a) { return "rgba(" + rgb + ", " + a + ")"; }

  function mix(a, b, t) {
    return "rgb(" + a.map(function (v, i) { return Math.round(v + (b[i] - v) * t); }).join(", ") + ")";
  }

  /* 按字拆开排字间距，但英文和数字连在一起（「AI」不拆成「A I」） */
  function glyphs(text) {
    return String(text).match(/[A-Za-z0-9.]+|[\s\S]/g) || [];
  }

  function textWidth(ctx, text, gap) {
    var chars = glyphs(text);
    return chars.reduce(function (s, c) { return s + ctx.measureText(c).width; }, 0) + gap * Math.max(0, chars.length - 1);
  }

  /* 中文换行后最后一行只剩一两个字时，收窄宽度让各行长短接近（像 CSS 的 text-wrap: balance） */
  function balancedWrap(ctx, text, maxW, maxLines) {
    var lines = U.wrap(ctx, text, maxW);
    if (lines.length < 2 || (maxLines && lines.length > maxLines)) return U.wrap(ctx, text, maxW, maxLines);
    var lo = maxW * 0.5;
    var hi = maxW;
    for (var i = 0; i < 12; i++) {
      var mid = (lo + hi) / 2;
      if (U.wrap(ctx, text, mid).length > lines.length) lo = mid;
      else hi = mid;
    }
    return U.wrap(ctx, text, Math.ceil(hi) + 1);
  }

  /* 逐字排，带字间距；stroke 为 true 时描边 */
  function spacedText(ctx, text, x, y, gap, align, stroke) {
    var chars = glyphs(text);
    var total = textWidth(ctx, text, gap);
    var cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
    var keep = ctx.textAlign;
    ctx.textAlign = "left";
    chars.forEach(function (c) {
      if (stroke) ctx.strokeText(c, cx, y);
      else ctx.fillText(c, cx, y);
      cx += ctx.measureText(c).width + gap;
    });
    ctx.textAlign = keep;
    return total;
  }

  function hline(ctx, x0, x1, y, rgb, a, w) {
    var g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, rgba(rgb, 0));
    g.addColorStop(0.5, rgba(rgb, a));
    g.addColorStop(1, rgba(rgb, 0));
    ctx.save();
    ctx.strokeStyle = g;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.restore();
  }

  function glow(ctx, x, y, r, rgb, a) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(rgb, a));
    g.addColorStop(0.5, rgba(rgb, a * 0.35));
    g.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function bez(t, a, b, c, d) {
    var u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  }

  function sparkle(ctx, x, y, s, a) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var g = ctx.createRadialGradient(x, y, 0, x, y, s * 1.6);
    g.addColorStop(0, "rgba(220, 240, 255, " + a + ")");
    g.addColorStop(1, "rgba(120, 190, 255, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, s * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(235, 248, 255, " + a + ")";
    ctx.beginPath();
    ctx.moveTo(x, y - s * 2); ctx.lineTo(x + s * 0.14, y); ctx.lineTo(x, y + s * 2); ctx.lineTo(x - s * 0.14, y); ctx.closePath();
    ctx.moveTo(x - s * 2, y); ctx.lineTo(x, y - s * 0.14); ctx.lineTo(x + s * 2, y); ctx.lineTo(x, y + s * 0.14); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* ---------------- 背景：深蓝渐变、紫蓝光晕、星点、顶部光束 ---------------- */
  function background(ctx, H, rand) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#030620");
    g.addColorStop(Math.min(0.3, 900 / H), "#0a1a63");
    g.addColorStop(0.5, "#081555");
    g.addColorStop(0.8, "#0a175a");
    g.addColorStop(1, "#040925");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    glow(ctx, CX, 460, 860, "50, 110, 255", 0.55);
    glow(ctx, -60, H * 0.3, 760, "120, 60, 235", 0.3);
    glow(ctx, W + 60, H * 0.52, 760, "60, 100, 255", 0.32);
    glow(ctx, 120, H * 0.78, 700, "120, 60, 235", 0.24);
    glow(ctx, CX, H + 120, 900, "40, 130, 255", 0.4);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var b = 0; b < 5; b++) {
      var bx = 150 + b * 195 + rand() * 50;
      var lean = (bx - CX) * 0.5;
      var bg = ctx.createLinearGradient(0, 0, 0, 980);
      bg.addColorStop(0, "rgba(90, 160, 255, 0.11)");
      bg.addColorStop(1, "rgba(90, 160, 255, 0)");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(bx - 24, 0);
      ctx.lineTo(bx + 24, 0);
      ctx.lineTo(bx + lean + 90, 980);
      ctx.lineTo(bx + lean - 30, 980);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    var n = Math.round(H / 8);
    for (var i = 0; i < n; i++) {
      var x = rand() * W;
      var y = rand() * H;
      var r = Math.pow(rand(), 3) * 2.2 + 0.4;
      ctx.fillStyle = "rgba(200, 225, 255, " + (0.12 + rand() * 0.55).toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    /* 闪光只放在标题区和左右边距里，不压在文字面板上 */
    for (var k = 0; k < 5; k++) sparkle(ctx, 60 + rand() * (W - 120), 160 + rand() * 440, 5 + rand() * 9, (0.5 + rand() * 0.4).toFixed(2));
    for (k = 0; k < Math.round(H / 500); k++) {
      var side = rand() < 0.5 ? 10 + rand() * 40 : W - 50 + rand() * 40;
      sparkle(ctx, side, 600 + rand() * (H - 600), 4 + rand() * 7, (0.4 + rand() * 0.4).toFixed(2));
    }

    var v = ctx.createLinearGradient(0, 0, W, 0);
    v.addColorStop(0, "rgba(2, 4, 20, 0.5)");
    v.addColorStop(0.12, "rgba(2, 4, 20, 0)");
    v.addColorStop(0.88, "rgba(2, 4, 20, 0)");
    v.addColorStop(1, "rgba(2, 4, 20, 0.5)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------------- 标题 ---------------- */

  /* 「义乌AI圈 · 春季选品对接会」拆成系列名（顶部飘带）和大标题 */
  function splitTitle(t) {
    var m = String(t || "").match(/^(.{2,16}?)\s*[·•｜|—:：]\s*(.{2,})$/);
    return m ? [m[1].trim(), m[2].trim()] : null;
  }

  /* 一行放得下就一行（字号不小于 minSingle），否则拆成长短接近的两行 */
  function titleFit(ctx, text, maxSize, minSingle) {
    var maxW = 930;
    var size;
    var gap;
    for (size = maxSize || 156; size >= (minSingle || 96); size -= 4) {
      ctx.font = font(900, size, SANS);
      gap = Math.round(size * 0.04);
      if (textWidth(ctx, text, gap) + size * 0.3 <= maxW) return { lines: [text], size: size, gap: gap };
    }
    for (size = 124; size >= 64; size -= 4) {
      ctx.font = font(900, size, SANS);
      gap = Math.round(size * 0.04);
      var lines = balancedWrap(ctx, text, (maxW - size * 0.3) / 1.06);
      if (lines.length <= 2) return { lines: lines, size: size, gap: gap };
    }
    ctx.font = font(900, 64, SANS);
    return { lines: U.wrap(ctx, text, maxW - 40, 2), size: 64, gap: 2 };
  }

  /* 立体发光大字：斜体、往右下挤出厚度、蓝色描边外发光、白到冰蓝的镀铬字面 */
  function artText(ctx, text, x, y, size, gap) {
    ctx.save();
    ctx.font = font(900, size, SANS);
    ctx.textBaseline = "alphabetic";
    ctx.translate(x, y);
    ctx.transform(1, 0, -0.18, 1, 0, 0);
    var depth = Math.max(4, Math.round(size * 0.075));
    for (var i = depth; i >= 1; i--) {
      ctx.fillStyle = mix([5, 14, 66], [44, 100, 255], 1 - i / depth);
      spacedText(ctx, text, i * 0.55, i, gap, "center");
    }
    ctx.shadowColor = "rgba(60, 150, 255, 0.95)";
    ctx.shadowBlur = size * 0.3;
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, size * 0.06);
    ctx.strokeStyle = "#2a66ff";
    spacedText(ctx, text, 0, 0, gap, "center", true);
    ctx.shadowBlur = 0;
    var face = ctx.createLinearGradient(0, -size * 0.82, 0, size * 0.06);
    face.addColorStop(0, "#ffffff");
    face.addColorStop(0.46, "#eaf6ff");
    face.addColorStop(0.56, "#9fd0ff");
    face.addColorStop(1, "#f3faff");
    ctx.fillStyle = face;
    spacedText(ctx, text, 0, 0, gap, "center");
    ctx.restore();
  }

  /* 顶部系列名飘带：两头斜切的蓝色条 + 两侧渐隐细线 */
  function ribbonLabel(ctx, text, size, y) {
    ctx.save();
    ctx.font = font(700, size, SANS);
    var tw = textWidth(ctx, text, 6);
    var w = tw + 120;
    var h = size + 28;
    var x = CX - w / 2;
    [-1, 1].forEach(function (dir) {
      var x0 = dir < 0 ? x - 10 : x + w + 10;
      var x1 = x0 + dir * 190;
      var lg = ctx.createLinearGradient(x0, 0, x1, 0);
      lg.addColorStop(0, "rgba(98, 214, 255, 0.9)");
      lg.addColorStop(1, "rgba(98, 214, 255, 0)");
      ctx.strokeStyle = lg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.fillStyle = C.cyan;
      U.diamond(ctx, x0 + dir * 4, y, 5);
    });
    ctx.beginPath();
    ctx.moveTo(x + 22, y - h / 2);
    ctx.lineTo(x + w, y - h / 2);
    ctx.lineTo(x + w - 22, y + h / 2);
    ctx.lineTo(x, y + h / 2);
    ctx.closePath();
    var fg = ctx.createLinearGradient(x, 0, x + w, 0);
    fg.addColorStop(0, "#173fc9");
    fg.addColorStop(0.5, "#3f86ff");
    fg.addColorStop(1, "#173fc9");
    ctx.fillStyle = fg;
    ctx.shadowColor = "rgba(60, 140, 255, 0.8)";
    ctx.shadowBlur = 24;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(170, 225, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    spacedText(ctx, text, CX, y + 2, 6, "center");
    ctx.restore();
  }

  /* 副标题：橙色胶囊，最多两行；返回底部 y */
  function subtitlePill(ctx, text, y, dry) {
    ctx.font = font(700, 34, SANS);
    var lines = balancedWrap(ctx, text, 800, 2);
    var tw = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; }));
    var lh = 48;
    var w = tw + 90;
    var h = lines.length * lh + 26;
    if (dry) return y + h;
    var x = CX - w / 2;
    ctx.save();
    U.roundRect(ctx, x, y, w, h, Math.min(h / 2, 34));
    var g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#ff6a2a");
    g.addColorStop(0.5, "#ff9c3e");
    g.addColorStop(1, "#ff6a2a");
    ctx.fillStyle = g;
    ctx.shadowColor = "rgba(255, 130, 50, 0.7)";
    ctx.shadowBlur = 26;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 225, 180, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach(function (l, i) { ctx.fillText(l, CX, y + 13 + lh / 2 + i * lh + 1); });
    ctx.restore();
    return y + h;
  }

  /* ---------------- 主视觉 ---------------- */

  /* 图片四周一圈的平均亮度（0–1）；读不了像素时当作亮图 */
  function edgeLuma(o, w, h) {
    try {
      var b = Math.max(2, Math.round(Math.min(w, h) * 0.06));
      var sum = 0;
      var n = 0;
      [[0, 0, w, b], [0, h - b, w, b], [0, b, b, h - 2 * b], [w - b, b, b, h - 2 * b]].forEach(function (r) {
        if (r[2] <= 0 || r[3] <= 0) return;
        var p = o.getImageData(r[0], r[1], r[2], r[3]).data;
        for (var i = 0; i < p.length; i += 16) {
          sum += (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255 * (p[i + 3] / 255);
          n++;
        }
      });
      return n ? sum / n : 1;
    } catch (e) { return 1; }
  }

  /*
   * 后台上传的主视觉：完整放进框里，四周柔和地融进底色。
   * 深色底的图（科技插画大多如此）用「滤色」叠上去，黑底消失、只留亮的部分；浅色图和照片正常叠加。
   */
  function visualImage(ctx, img, top, h) {
    var s = Math.min((W - 60) / img.width, h / img.height);
    var dw = Math.max(1, Math.round(img.width * s));
    var dh = Math.max(1, Math.round(img.height * s));
    var off = document.createElement("canvas");
    off.width = dw;
    off.height = dh;
    var o = off.getContext("2d");
    o.drawImage(img, 0, 0, dw, dh);
    var darkEdges = edgeLuma(o, dw, dh) < 0.28;
    o.globalCompositeOperation = "destination-in";
    o.translate(dw / 2, dh / 2);
    o.scale(dw / dh, 1);
    var m = o.createRadialGradient(0, 0, dh * 0.28, 0, 0, dh * 0.53);
    m.addColorStop(0, "rgba(0, 0, 0, 1)");
    m.addColorStop(1, "rgba(0, 0, 0, 0)");
    o.fillStyle = m;
    o.fillRect(-dh, -dh, dh * 2, dh * 2);
    glow(ctx, CX, top + h / 2, Math.max(dw, dh) * 0.55, "60, 130, 255", 0.35);
    ctx.save();
    if (darkEdges) ctx.globalCompositeOperation = "screen";
    ctx.drawImage(off, CX - dw / 2, top + (h - dh) / 2);
    ctx.restore();
  }

  /* 悬浮的数据屏：柱状图 / 环形图 / 折线 */
  function screen(ctx, cx, cy, w, h, shear, rand, kind) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.transform(1, shear, 0, 1, 0, 0);
    var x = -w / 2;
    var y = -h / 2;
    var i;
    ctx.shadowColor = "rgba(70, 160, 255, 0.85)";
    ctx.shadowBlur = 40;
    U.roundRect(ctx, x, y, w, h, 14);
    var fg = ctx.createLinearGradient(0, y, 0, y + h);
    fg.addColorStop(0, "rgba(70, 150, 255, 0.42)");
    fg.addColorStop(1, "rgba(30, 70, 220, 0.18)");
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(150, 220, 255, 0.85)";
    ctx.stroke();
    ctx.fillStyle = "rgba(160, 225, 255, 0.6)";
    U.roundRect(ctx, x + 16, y + 14, w * 0.32, 8, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(160, 225, 255, 0.25)";
    U.roundRect(ctx, x + 16 + w * 0.36, y + 14, w * 0.18, 8, 4);
    ctx.fill();

    if (kind === "bars") {
      var n = 7;
      var bw = (w - 44) / n;
      for (i = 0; i < n; i++) {
        var bh = (0.22 + rand() * 0.6) * (h - 72);
        var bx = x + 22 + i * bw;
        var by = y + h - 18 - bh;
        var bg = ctx.createLinearGradient(0, by, 0, y + h - 18);
        bg.addColorStop(0, "rgba(130, 235, 255, 0.95)");
        bg.addColorStop(1, "rgba(60, 110, 255, 0.25)");
        ctx.fillStyle = bg;
        ctx.fillRect(bx, by, bw * 0.56, bh);
      }
      ctx.strokeStyle = "rgba(255, 175, 90, 0.95)";
      ctx.lineWidth = 3;
      ctx.shadowColor = "rgba(255, 150, 60, 0.9)";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        var px = x + 22 + i * bw + bw * 0.28;
        var py = y + h - 46 - (0.15 + (i / n) * 0.55 + rand() * 0.12) * (h - 90);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.stroke();
    } else if (kind === "donut") {
      var r = Math.min(w, h) * 0.28;
      var dx = x + w * 0.3;
      var dy = y + h * 0.6;
      var a0 = -Math.PI / 2;
      ctx.lineWidth = 11;
      [[0.42, "rgba(130, 235, 255, 0.95)"], [0.26, "rgba(255, 175, 90, 0.95)"], [0.3, "rgba(100, 140, 255, 0.85)"]].forEach(function (sg) {
        ctx.strokeStyle = sg[1];
        ctx.beginPath();
        ctx.arc(dx, dy, r, a0, a0 + sg[0] * Math.PI * 2);
        ctx.stroke();
        a0 += sg[0] * Math.PI * 2 + 0.07;
      });
      for (i = 0; i < 3; i++) {
        ctx.fillStyle = "rgba(170, 225, 255, " + (0.6 - i * 0.15) + ")";
        U.roundRect(ctx, x + w * 0.6, y + h * 0.42 + i * 20, w * 0.28, 7, 3);
        ctx.fill();
      }
    } else {
      for (i = 0; i < 3; i++) {
        ctx.fillStyle = "rgba(170, 225, 255, " + (0.6 - i * 0.15) + ")";
        U.roundRect(ctx, x + 16, y + 38 + i * 18, w * (0.7 - i * 0.15), 7, 3);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(130, 235, 255, 0.95)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (i = 0; i <= 10; i++) {
        var lx = x + 16 + i * (w - 32) / 10;
        var ly = y + h - 22 - rand() * h * 0.3;
        if (i) ctx.lineTo(lx, ly); else ctx.moveTo(lx, ly);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function cube(ctx, x, y, s, a) {
    var h = s * 0.5;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(170, 235, 255, 0.95)";
    ctx.shadowColor = "rgba(90, 190, 255, 0.9)";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(x, y - h); ctx.lineTo(x + s, y); ctx.lineTo(x, y + h); ctx.lineTo(x - s, y); ctx.closePath();
    ctx.fillStyle = "rgba(130, 210, 255, 0.5)";
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s, y); ctx.lineTo(x - s, y + s); ctx.lineTo(x, y + s + h); ctx.lineTo(x, y + h); ctx.closePath();
    ctx.fillStyle = "rgba(50, 110, 255, 0.5)";
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + s, y); ctx.lineTo(x + s, y + s); ctx.lineTo(x, y + s + h); ctx.lineTo(x, y + h); ctx.closePath();
    ctx.fillStyle = "rgba(30, 70, 200, 0.6)";
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /* 没有主视觉时：透视网格地面 + 发光底座 + 光柱 + 悬浮数据屏和方块 */
  function stage(ctx, top, h, rand) {
    var cy = top + h * 0.8;
    var hz = top + h * 0.56;
    var i;
    ctx.save();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, hz, W, top + h - hz + 40);
    ctx.clip();
    var gg = ctx.createLinearGradient(0, hz, 0, top + h + 40);
    gg.addColorStop(0, "rgba(80, 150, 255, 0)");
    gg.addColorStop(0.5, "rgba(80, 150, 255, 0.34)");
    gg.addColorStop(1, "rgba(80, 150, 255, 0)");
    ctx.strokeStyle = gg;
    ctx.lineWidth = 1.2;
    for (i = -14; i <= 14; i++) {
      ctx.beginPath();
      ctx.moveTo(CX, hz - 260);
      ctx.lineTo(CX + i * 120, top + h + 300);
      ctx.stroke();
    }
    for (i = 1; i <= 9; i++) {
      var yy = hz + Math.pow(i / 9, 1.8) * (top + h + 40 - hz);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(CX, top + h * 0.5);
    ctx.rotate(-0.1);
    ctx.setLineDash([3, 12]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(120, 200, 255, 0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 470, 150, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.globalCompositeOperation = "lighter";
    var pg = ctx.createLinearGradient(0, cy, 0, top);
    pg.addColorStop(0, "rgba(120, 200, 255, 0.34)");
    pg.addColorStop(1, "rgba(120, 200, 255, 0)");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.moveTo(CX - 150, cy);
    ctx.lineTo(CX + 150, cy);
    ctx.lineTo(CX + 50, top);
    ctx.lineTo(CX - 50, top);
    ctx.closePath();
    ctx.fill();

    [[430, 0.22, 2, [6, 10]], [350, 0.55, 3, null], [265, 0.32, 2, [2, 8]], [185, 0.85, 4, null], [105, 0.6, 2, null]].forEach(function (r) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(CX, cy, r[0], r[0] * 0.24, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(110, 210, 255, " + r[1] + ")";
      ctx.lineWidth = r[2];
      if (r[3]) ctx.setLineDash(r[3]);
      ctx.shadowColor = "rgba(90, 190, 255, 0.9)";
      ctx.shadowBlur = 16;
      ctx.stroke();
      ctx.restore();
    });
    ctx.save();
    ctx.translate(CX, cy);
    ctx.scale(1, 0.24);
    var dg = ctx.createRadialGradient(0, 0, 0, 0, 0, 220);
    dg.addColorStop(0, "rgba(170, 235, 255, 0.6)");
    dg.addColorStop(0.4, "rgba(80, 160, 255, 0.25)");
    dg.addColorStop(1, "rgba(60, 120, 255, 0)");
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.arc(0, 0, 220, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    for (i = 0; i < 46; i++) {
      var px = CX + (rand() - 0.5) * 300 * (0.4 + rand());
      var py = top + 40 + rand() * (cy - top - 40);
      ctx.fillStyle = "rgba(180, 230, 255, " + (0.2 + rand() * 0.6).toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(px, py, 1 + rand() * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    screen(ctx, CX - 300, top + h * 0.56, 214, 136, 0.12, rand, "donut");
    screen(ctx, CX + 304, top + h * 0.3, 224, 142, -0.12, rand, "lines");
    screen(ctx, CX, top + h * 0.38, 400, 236, -0.06, rand, "bars");
    cube(ctx, CX, cy - 66, 42, 0.95);
    cube(ctx, CX - 210, top + h * 0.14, 16, 0.8);
    cube(ctx, CX + 190, top + h * 0.64, 20, 0.85);
    cube(ctx, CX - 430, top + h * 0.3, 12, 0.7);
    cube(ctx, CX + 440, top + h * 0.6, 14, 0.7);
    ctx.restore();
  }

  /* ---------------- 版块 ---------------- */

  /* 板块标题：两头切角的发光底板 + 两侧渐隐线和斜杠 */
  function sectionTitle(ctx, text, y, dry) {
    var cy = y + 52;
    if (dry) return y + 132;
    ctx.save();
    ctx.font = font(900, 56, SANS);
    var tw = textWidth(ctx, text, 10);
    var bw = tw + 170;
    var bh = 84;
    var bx = CX - bw / 2;
    var by = cy - bh / 2;
    ctx.beginPath();
    ctx.moveTo(bx + 34, by);
    ctx.lineTo(bx + bw - 34, by);
    ctx.lineTo(bx + bw, cy);
    ctx.lineTo(bx + bw - 34, by + bh);
    ctx.lineTo(bx + 34, by + bh);
    ctx.lineTo(bx, cy);
    ctx.closePath();
    var fg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    fg.addColorStop(0, "rgba(40, 90, 255, 0.06)");
    fg.addColorStop(0.5, "rgba(50, 110, 255, 0.5)");
    fg.addColorStop(1, "rgba(40, 90, 255, 0.06)");
    ctx.fillStyle = fg;
    ctx.fill();
    var sg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    sg.addColorStop(0, "rgba(98, 214, 255, 0.2)");
    sg.addColorStop(0.5, "rgba(180, 238, 255, 0.95)");
    sg.addColorStop(1, "rgba(98, 214, 255, 0.2)");
    ctx.strokeStyle = sg;
    ctx.lineWidth = 2;
    ctx.stroke();

    [-1, 1].forEach(function (dir) {
      var x0 = dir < 0 ? bx - 12 : bx + bw + 12;
      for (var i = 0; i < 3; i++) {
        var sx = x0 + dir * i * 17;
        ctx.fillStyle = i === 0 ? "rgba(255, 175, 90, 0.95)" : "rgba(98, 214, 255, " + (0.85 - i * 0.25) + ")";
        ctx.beginPath();
        ctx.moveTo(sx - dir * 4, cy + 12);
        ctx.lineTo(sx + dir * 4, cy + 12);
        ctx.lineTo(sx + dir * 12, cy - 12);
        ctx.lineTo(sx + dir * 4, cy - 12);
        ctx.closePath();
        ctx.fill();
      }
      var l0 = x0 + dir * 62;
      var l1 = dir < 0 ? PL - 20 : PR + 20;
      var lg = ctx.createLinearGradient(l0, 0, l1, 0);
      lg.addColorStop(0, "rgba(98, 214, 255, 0.9)");
      lg.addColorStop(1, "rgba(98, 214, 255, 0)");
      ctx.strokeStyle = lg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(l0, cy);
      ctx.lineTo(l1, cy);
      ctx.stroke();
    });

    ctx.translate(CX, cy + 20);
    ctx.transform(1, 0, -0.16, 1, 0, 0);
    ctx.shadowColor = "rgba(80, 170, 255, 0.95)";
    ctx.shadowBlur = 18;
    var tg = ctx.createLinearGradient(0, -46, 0, 6);
    tg.addColorStop(0, "#ffffff");
    tg.addColorStop(1, "#a9d8ff");
    ctx.fillStyle = tg;
    ctx.textBaseline = "alphabetic";
    spacedText(ctx, text, 0, 0, 10, "center");
    ctx.restore();
    return y + 132;
  }

  /* 玻璃面板：半透明蓝底、顶边高光、四角发光折角 */
  function panel(ctx, x, y, w, h) {
    ctx.save();
    U.roundRect(ctx, x, y, w, h, 22);
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "rgba(34, 70, 200, 0.42)");
    g.addColorStop(1, "rgba(18, 36, 130, 0.3)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(120, 175, 255, 0.45)";
    ctx.stroke();
    hline(ctx, x + 40, x + w - 40, y + 1, "190, 235, 255", 0.9, 2);
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(98, 214, 255, 0.9)";
    ctx.shadowBlur = 10;
    var o = 6;
    var L = 30;
    [[x - o, y - o, 1, 1], [x + w + o, y - o, -1, 1], [x - o, y + h + o, 1, -1], [x + w + o, y + h + o, -1, -1]].forEach(function (c) {
      ctx.beginPath();
      ctx.moveTo(c[0], c[1] + c[3] * L);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(c[0] + c[2] * L, c[1]);
      ctx.stroke();
    });
    ctx.restore();
  }

  /* 光带分隔：几条橙、金、青、紫的曲线交织，中间一颗耀斑 */
  function lightRibbon(ctx, y, dry, dir) {
    if (dry) return y + 170;
    var base = y + 60;
    ctx.save();
    if (dir < 0) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.globalCompositeOperation = "lighter";
    [
      ["60, 110, 255", 10, 0.3, 8],
      ["255, 140, 60", 3.2, 0.95, 0],
      ["255, 205, 130", 1.4, 0.9, -12],
      ["98, 214, 255", 2.4, 0.85, 16],
      ["150, 110, 255", 1.2, 0.7, 30],
      ["255, 120, 60", 1, 0.6, -26]
    ].forEach(function (s) {
      var g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, rgba(s[0], 0));
      g.addColorStop(0.25, rgba(s[0], s[2]));
      g.addColorStop(0.72, rgba(s[0], s[2]));
      g.addColorStop(1, rgba(s[0], 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = s[1];
      ctx.shadowColor = rgba(s[0], Math.min(1, s[2] + 0.1));
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(-60, base + 70 + s[3]);
      ctx.bezierCurveTo(260, base + 110 + s[3] * 1.4, 560, base - 30 + s[3] * 0.6, W + 60, base + 10 + s[3] * 0.4);
      ctx.stroke();
    });
    ctx.shadowBlur = 0;
    var t = 0.56;
    var fx = bez(t, -60, 260, 560, W + 60);
    var fy = bez(t, base + 70, base + 110, base - 30, base + 10);
    var fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 150);
    fg.addColorStop(0, "rgba(255, 245, 225, 0.95)");
    fg.addColorStop(0.12, "rgba(255, 190, 110, 0.6)");
    fg.addColorStop(0.4, "rgba(255, 130, 60, 0.18)");
    fg.addColorStop(1, "rgba(255, 120, 60, 0)");
    ctx.fillStyle = fg;
    ctx.fillRect(fx - 150, fy - 150, 300, 300);
    var sg = ctx.createLinearGradient(fx - 340, 0, fx + 340, 0);
    sg.addColorStop(0, "rgba(255, 200, 140, 0)");
    sg.addColorStop(0.5, "rgba(255, 240, 220, 0.85)");
    sg.addColorStop(1, "rgba(255, 200, 140, 0)");
    ctx.fillStyle = sg;
    ctx.fillRect(fx - 340, fy - 1.5, 680, 3);
    ctx.restore();
    return y + 170;
  }

  /* 尊敬的 某某（只在专属邀请函上） */
  function greeting(ctx, d, y, dry) {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    y += 40;
    ctx.font = font(400, 38, SANS);
    ctx.fillStyle = C.sub;
    spacedText(ctx, "尊敬的", CX, y, 12, "center");
    y += 116;
    var who = d.name || d.company || "嘉宾";
    var fit = U.fitLine(ctx, who, IW, 100, 56, 800, SANS);
    ctx.save();
    ctx.font = font(800, fit.size, SANS);
    ctx.shadowColor = "rgba(80, 170, 255, 0.9)";
    ctx.shadowBlur = 30;
    var g = ctx.createLinearGradient(0, y - fit.size, 0, y + 8);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.6, "#e4f3ff");
    g.addColorStop(1, "#9fd2ff");
    ctx.fillStyle = g;
    ctx.fillText(fit.text, CX, y);
    var nw = ctx.measureText(fit.text).width;
    ctx.restore();
    y += 38;
    if (!dry) {
      var half = Math.min(IW / 2, nw / 2 + 90);
      hline(ctx, CX - half, CX + half, y, "98, 214, 255", 0.95, 2.5);
      ctx.fillStyle = C.amber;
      U.diamond(ctx, CX, y, 6);
    }
    if (d.name && d.company) {
      y += 60;
      var co = U.fitLine(ctx, d.company, IW, 32, 24, 400, SANS);
      ctx.font = font(400, co.size, SANS);
      ctx.fillStyle = C.sub;
      ctx.textAlign = "center";
      ctx.fillText(co.text, CX, y);
    }
    return y + 50;
  }

  /* 引言：大引号 + 正文（首行空两格）+ 一句强调 */
  function quote(ctx, text, tail, y, dry) {
    var paras = String(text).split("\n").map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return "　　" + p; }).join("\n");
    ctx.font = font(400, 34, SANS);
    var lines = U.wrap(ctx, paras, IW - 20, 10);
    if (!dry) {
      ctx.save();
      ctx.font = font(900, 150, SERIF);
      var qg = ctx.createLinearGradient(0, y, 0, y + 110);
      qg.addColorStop(0, "rgba(130, 215, 255, 0.95)");
      qg.addColorStop(1, "rgba(60, 110, 255, 0.55)");
      ctx.fillStyle = qg;
      ctx.textAlign = "left";
      ctx.fillText("“", PL - 6, y + 112);
      ctx.restore();
    }
    y += 84;
    ctx.font = font(400, 34, SANS);
    ctx.fillStyle = C.body;
    ctx.textAlign = "left";
    lines.forEach(function (l) {
      ctx.fillText(l, IL + 10, y);
      y += 58;
    });
    if (tail) {
      y += 20;
      ctx.textAlign = "center";
      ctx.font = font(700, 34, SANS);
      ctx.fillStyle = C.cyan;
      ctx.fillText(tail, CX, y);
      y += 24;
    }
    if (!dry) {
      ctx.save();
      ctx.font = font(900, 150, SERIF);
      var qg2 = ctx.createLinearGradient(0, y - 10, 0, y + 110);
      qg2.addColorStop(0, "rgba(130, 215, 255, 0.95)");
      qg2.addColorStop(1, "rgba(60, 110, 255, 0.55)");
      ctx.fillStyle = qg2;
      ctx.textAlign = "right";
      ctx.fillText("”", PR + 6, y + 104);
      ctx.restore();
    }
    return y + 90;
  }

  /* 组织单位：「指导单位：」后面每个单位一行 */
  function orgSection(ctx, rows, y, dry) {
    ctx.font = font(700, 32, SANS);
    var labW = Math.min(260, Math.max.apply(null, rows.map(function (r) { return ctx.measureText(r[0] + "：").width; })));
    var nx = IL + labW + 6;
    var lh = 50;
    var gap = 20;
    ctx.font = font(500, 32, SANS);
    var blocks = rows.map(function (r) {
      var out = [];
      r[1].forEach(function (n) { out = out.concat(U.wrap(ctx, n, IR - nx, 2)); });
      return out;
    });
    var content = blocks.reduce(function (s, b) { return s + b.length * lh; }, 0) + (rows.length - 1) * gap;
    var h = content + 66;
    if (!dry) panel(ctx, PL, y, PW, h);
    var ry = y + 72;
    ctx.textAlign = "left";
    rows.forEach(function (r, i) {
      var lab = U.fitLine(ctx, r[0] + "：", labW, 32, 22, 700, SANS);
      ctx.font = font(700, lab.size, SANS);
      ctx.fillStyle = C.cyan;
      ctx.fillText(lab.text, IL, ry);
      ctx.font = font(500, 32, SANS);
      ctx.fillStyle = C.text;
      blocks[i].forEach(function (l, j) { ctx.fillText(l, nx, ry + j * lh); });
      ry += blocks[i].length * lh + gap;
    });
    return y + h;
  }

  function icon(ctx, kind, x, y) {
    ctx.save();
    ctx.strokeStyle = C.cyan;
    ctx.fillStyle = C.cyan;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(98, 214, 255, 0.8)";
    ctx.shadowBlur = 8;
    if (kind === "phone") {
      U.roundRect(ctx, x - 10, y - 16, 20, 32, 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 3, y + 10);
      ctx.lineTo(x + 3, y + 10);
      ctx.stroke();
    } else if (kind === "clock") {
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x, y);
      ctx.lineTo(x + 6, y + 4);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y - 4, 11, Math.PI * 0.8, Math.PI * 2.2);
      ctx.lineTo(x, y + 16);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - 4, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* 活动信息：时间、地点，前面带图标 */
  function infoSection(ctx, rows, y, dry) {
    var lx = IL + 46;
    ctx.font = font(700, 32, SANS);
    var labW = Math.max.apply(null, rows.map(function (r) { return ctx.measureText(r[1]).width; }));
    var vx = lx + labW + 4;
    var lh = 50;
    var gap = 20;
    ctx.font = font(500, 32, SANS);
    var blocks = rows.map(function (r) { return U.wrap(ctx, r[2], IR - vx, 3); });
    var content = blocks.reduce(function (s, b) { return s + b.length * lh; }, 0) + (rows.length - 1) * gap;
    var h = content + 66;
    if (!dry) panel(ctx, PL, y, PW, h);
    var ry = y + 72;
    ctx.textAlign = "left";
    rows.forEach(function (r, i) {
      if (!dry) icon(ctx, r[0], IL + 14, ry - 11);
      ctx.font = font(700, 32, SANS);
      ctx.fillStyle = C.cyan;
      ctx.fillText(r[1], lx, ry);
      ctx.font = font(500, 32, SANS);
      ctx.fillStyle = C.text;
      blocks[i].forEach(function (l, j) { ctx.fillText(l, vx, ry + j * lh); });
      ry += blocks[i].length * lh + gap;
    });
    return y + h;
  }

  /* 流程安排：时间一列、环节一列，中间琥珀色菱形，行间虚线 */
  function agendaSection(ctx, rows, y, dry) {
    var hasTime = rows.some(function (r) { return r.time; });
    ctx.font = font(700, 31, SANS);
    var tw = hasTime ? Math.min(300, Math.max.apply(null, rows.map(function (r) { return ctx.measureText(r.time).width; }))) : 0;
    var ix = hasTime ? IL + tw + 62 : IL + 36;
    var lh = 48;
    var gap = 28;
    ctx.font = font(500, 31, SANS);
    var blocks = rows.map(function (r) { return U.wrap(ctx, r.item, IR - ix, 3); });
    var content = blocks.reduce(function (s, b) { return s + b.length * lh; }, 0) + (rows.length - 1) * gap;
    var h = content + 66;
    if (!dry) panel(ctx, PL, y, PW, h);
    var ry = y + 72;
    ctx.textAlign = "left";
    rows.forEach(function (r, i) {
      if (hasTime && r.time) {
        var t = U.fitLine(ctx, r.time, tw, 31, 22, 700, SANS);
        ctx.font = font(700, t.size, SANS);
        ctx.fillStyle = C.cyan;
        ctx.fillText(t.text, IL, ry);
      }
      if (!dry) {
        ctx.fillStyle = C.amber;
        U.diamond(ctx, ix - 30, ry - 11, 6);
      }
      ctx.font = font(500, 31, SANS);
      ctx.fillStyle = C.text;
      blocks[i].forEach(function (l, j) { ctx.fillText(l, ix, ry + j * lh); });
      var last = ry + (blocks[i].length - 1) * lh;
      if (!dry && i < rows.length - 1) {
        ctx.save();
        ctx.setLineDash([4, 8]);
        ctx.strokeStyle = "rgba(130, 185, 255, 0.3)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(IL, last + 26);
        ctx.lineTo(IR, last + 26);
        ctx.stroke();
        ctx.restore();
      }
      ry = last + lh + gap;
    });
    return y + h;
  }

  /* 活动详情：每个议题一张卡，橙色渐变标题条「01 | 《题目》」，下面是分享人 */
  function talksSection(ctx, talks, y, dry) {
    talks.forEach(function (t, i) {
      var num = String(i + 1).padStart(2, "0");
      ctx.font = font(900, 40, SANS);
      var nw = ctx.measureText(num).width;
      var tx = PL + 34 + nw + 40;
      ctx.font = font(800, 35, SANS);
      var tl = U.wrap(ctx, "《" + t.title + "》", PR - 30 - tx, 3);
      var barH = tl.length * 50 + 44;
      var who = [t.speaker, t.role].filter(Boolean);
      ctx.font = font(400, 28, SANS);
      var wl = who.length ? U.wrap(ctx, "分享人：" + who.join("  |  "), PW - 68, 2) : [];
      var bodyH = wl.length ? wl.length * 44 + 34 : 0;

      if (!dry) {
        ctx.save();
        if (bodyH) {
          U.roundRect(ctx, PL, y + barH - 18, PW, bodyH + 18, 16);
          ctx.fillStyle = "rgba(26, 52, 170, 0.4)";
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = "rgba(120, 175, 255, 0.35)";
          ctx.stroke();
        }
        U.roundRect(ctx, PL, y, PW, barH, 16);
        var g = ctx.createLinearGradient(PL, 0, PR, 0);
        g.addColorStop(0, "#ff6d2a");
        g.addColorStop(0.36, "#ff9a45");
        g.addColorStop(0.7, "rgba(170, 110, 255, 0.55)");
        g.addColorStop(1, "rgba(70, 110, 255, 0.3)");
        ctx.fillStyle = g;
        ctx.shadowColor = "rgba(255, 120, 50, 0.45)";
        ctx.shadowBlur = 20;
        ctx.fill();
        ctx.shadowBlur = 0;
        hline(ctx, PL + 10, PL + PW * 0.7, y + 1.5, "255, 236, 210", 0.9, 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fillRect(PL + 34 + nw + 17, y + 25, 3, 36);
        ctx.restore();
      }
      var by = y + 22 + 36;
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      ctx.font = font(900, 40, SANS);
      ctx.fillText(num, PL + 34, by + 2);
      ctx.font = font(800, 35, SANS);
      tl.forEach(function (l, j) { ctx.fillText(l, tx, by + j * 50); });
      if (wl.length) {
        ctx.font = font(400, 28, SANS);
        ctx.fillStyle = C.sub;
        wl.forEach(function (l, j) { ctx.fillText(l, PL + 34, y + barH + 46 + j * 44); });
      }
      y += barH + bodyH + 30;
    });
    return y;
  }

  function chevrons(ctx, x, y) {
    ctx.save();
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(98, 214, 255, 0.9)";
    ctx.shadowBlur = 10;
    for (var i = 0; i < 3; i++) {
      ctx.strokeStyle = "rgba(98, 214, 255, " + (0.3 + i * 0.32) + ")";
      ctx.beginPath();
      ctx.moveTo(x - 26, y + i * 22);
      ctx.lineTo(x, y + i * 22 + 18);
      ctx.lineTo(x + 26, y + i * 22);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 二维码：白底圆角块，外面一圈扫描框折角 */
  function qrBlock(ctx, rows, x, y, size) {
    ctx.save();
    var o = 22;
    var L = 56;
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(98, 214, 255, 0.95)";
    ctx.shadowBlur = 16;
    [[x - o, y - o, 1, 1], [x + size + o, y - o, -1, 1], [x - o, y + size + o, 1, -1], [x + size + o, y + size + o, -1, -1]].forEach(function (c) {
      ctx.beginPath();
      ctx.moveTo(c[0], c[1] + c[3] * L);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(c[0] + c[2] * L, c[1]);
      ctx.stroke();
    });
    ctx.shadowColor = "rgba(80, 170, 255, 0.8)";
    ctx.shadowBlur = 40;
    U.roundRect(ctx, x, y, size, size, 22);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.shadowBlur = 0;
    if (rows && rows.length) {
      var n = rows.length;
      var m = Math.floor((size - 40) / n);
      var q = m * n;
      var ox = x + Math.round((size - q) / 2);
      var oy = y + Math.round((size - q) / 2);
      ctx.fillStyle = "#0a1446";
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) if (rows[r].charAt(c) === "1") ctx.fillRect(ox + c * m, oy + r * m, m, m);
      }
    }
    ctx.restore();
  }

  function signup(ctx, d, y, dry) {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (d.capacity > 0) {
      y += 72;
      if (!dry) {
        ctx.save();
        ctx.font = font(900, 68, SANS);
        ctx.shadowColor = "rgba(80, 170, 255, 0.95)";
        ctx.shadowBlur = 22;
        var cg = ctx.createLinearGradient(0, y - 60, 0, y + 6);
        cg.addColorStop(0, "#ffffff");
        cg.addColorStop(1, "#a9d8ff");
        ctx.fillStyle = cg;
        spacedText(ctx, "席位有限", CX, y, 16, "center");
        ctx.restore();
      }
      y += 58;
      ctx.font = font(500, 32, SANS);
      ctx.fillStyle = C.body;
      ctx.fillText("会议总人数限定 " + d.capacity + " 人，额满即止", CX, y);
      y += 40;
    }
    y += 34;
    ctx.font = font(600, 34, SANS);
    ctx.fillStyle = C.text;
    ctx.fillText("请识别下方二维码进行报名", CX, y);
    if (d.deadlineText) {
      y += 54;
      ctx.font = font(400, 28, SANS);
      ctx.fillStyle = C.sub;
      ctx.fillText("报名截止时间：" + d.deadlineText, CX, y);
    }
    y += 44;
    if (!dry) chevrons(ctx, CX, y);
    y += 110;
    var qs = 340;
    if (!dry) qrBlock(ctx, d.qr, CX - qs / 2, y, qs);
    y += qs + 76;
    ctx.font = font(400, 26, SANS);
    ctx.fillStyle = C.dim;
    ctx.fillText(d.poster ? "长按识别二维码 · 转发给同行一起来" : "长按识别二维码 · 邀请同行一起来", CX, y);
    if (d.contact) {
      y += 70;
      ctx.font = font(600, 32, SANS);
      var label = "报名咨询：" + d.contact;
      var fit = U.fitLine(ctx, label, IW - 50, 32, 24, 600, SANS);
      ctx.font = font(600, fit.size, SANS);
      var tw = ctx.measureText(fit.text).width;
      var x0 = CX - (tw + 44) / 2;
      if (!dry) icon(ctx, "phone", x0 + 12, y - 11);
      ctx.textAlign = "left";
      ctx.fillStyle = C.text;
      ctx.fillText(fit.text, x0 + 44, y);
      ctx.textAlign = "center";
    }
    return y + 20;
  }

  /* 温馨提示：面板顶上压一个渐变小标签 */
  function noticeSection(ctx, text, y, dry) {
    ctx.font = font(400, 30, SANS);
    var lines = balancedWrap(ctx, text, IW, 8);
    var lh = 50;
    var h = lines.length * lh + 96;
    if (!dry) {
      panel(ctx, PL, y, PW, h);
      ctx.save();
      ctx.font = font(800, 32, SANS);
      var tw = textWidth(ctx, "温馨提示", 8) + 84;
      U.roundRect(ctx, CX - tw / 2, y - 30, tw, 60, 30);
      var g = ctx.createLinearGradient(CX - tw / 2, 0, CX + tw / 2, 0);
      g.addColorStop(0, "#2a5cf0");
      g.addColorStop(1, "#4fc3ff");
      ctx.fillStyle = g;
      ctx.shadowColor = "rgba(80, 170, 255, 0.85)";
      ctx.shadowBlur = 22;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(220, 245, 255, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      spacedText(ctx, "温馨提示", CX, y + 1, 8, "center");
      ctx.restore();
    }
    ctx.font = font(400, 30, SANS);
    ctx.fillStyle = C.body;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    lines.forEach(function (l, i) { ctx.fillText(l, CX, y + 72 + i * lh); });
    return y + h;
  }

  /* 落款：右对齐的落款单位 + 日期（后台没填落款时写「主办方  敬邀」，没填日期用生成当天） */
  function signature(ctx, d, y) {
    var today = new Date();
    var date = d.signDate || (today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日");
    var text = d.signature || (String(d.host || "义乌AI圈") + "  敬邀");
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    var sig = U.fitLine(ctx, text, IW, 36, 26, 700, SANS);
    ctx.save();
    ctx.font = font(700, sig.size, SANS);
    ctx.shadowColor = "rgba(80, 170, 255, 0.8)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(sig.text, IR, y + 36);
    ctx.restore();
    ctx.font = font(400, 30, SANS);
    ctx.fillStyle = C.sub;
    ctx.fillText(date, IR, y + 88);
    return y + 110;
  }

  /* ---------------- 信件式邀请函 ---------------- */

  /* 「邀请函」三个大字，两侧发光细线 */
  function letterTitle(ctx, y, dry) {
    var size = 168;
    y += size;
    if (!dry) {
      artText(ctx, "邀请函", CX, y, size, 26);
      hline(ctx, PL, CX - 300, y - size * 0.36, "98, 214, 255", 0.9, 2);
      hline(ctx, CX + 300, PR, y - size * 0.36, "98, 214, 255", 0.9, 2);
      ctx.fillStyle = C.amber;
      U.diamond(ctx, CX - 300, y - size * 0.36, 6);
      U.diamond(ctx, CX + 300, y - size * 0.36, 6);
    }
    return y + 60;
  }

  /* 通用抬头：「各位行业家人们：」左对齐，像信的开头 */
  function salutation(ctx, text, y) {
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    var t = String(text).replace(/[：:，,]+$/, "") + "：";
    var fit = U.fitLine(ctx, t, IW, 42, 30, 800, SANS);
    ctx.save();
    ctx.font = font(800, fit.size, SANS);
    ctx.shadowColor = "rgba(80, 170, 255, 0.7)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(fit.text, IL - 10, y + 42);
    ctx.restore();
    return y + 84;
  }

  /* 两端对齐画一行：多出来的宽度平均分到字间；行尾和每段最后一行照常左对齐 */
  function justifyLine(ctx, line, x, y, width) {
    var chars = glyphs(line);
    var natural = textWidth(ctx, line, 0);
    var gap = chars.length > 1 ? (width - natural) / (chars.length - 1) : 0;
    if (gap <= 0 || gap > 14) { ctx.fillText(line, x, y); return; }
    spacedText(ctx, line, x, y, gap, "left");
  }

  /* 信的正文：每段首行空两格，两端对齐 */
  function letterBody(ctx, text, y) {
    ctx.font = font(400, 34, SANS);
    ctx.fillStyle = C.body;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    var width = IW + 20;
    var x = IL - 10;
    String(text).split(/\n+/).map(function (p) { return p.trim(); }).filter(Boolean).forEach(function (p, pi) {
      var lines = U.wrap(ctx, "　　" + p, width);
      if (pi) y += 14;
      lines.forEach(function (l, i) {
        y += 60;
        if (i < lines.length - 1) justifyLine(ctx, l, x, y, width);
        else ctx.fillText(l, x, y);
      });
    });
    return y + 40;
  }

  /* ---------------- 顶部：主办协办 Logo + 城市标识 ---------------- */
  function topBar(ctx, logos, dry) {
    var top = 52;
    var r = 52;
    if (!dry) {
      logos.forEach(function (img, i) {
        var cx = PL + r + i * (r * 2 + 34);
        var cy = top + r;
        if (cx + r > PR - 230) return;
        ctx.save();
        ctx.shadowColor = "rgba(120, 200, 255, 0.7)";
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.clip();
        var s = Math.min((r * 2) / img.width, (r * 2) / img.height);
        var dw = img.width * s;
        var dh = img.height * s;
        ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(200, 235, 255, 0.75)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        if (i < logos.length - 1) {
          var lx = cx + r + 17;
          var lg = ctx.createLinearGradient(0, cy - r, 0, cy + r);
          lg.addColorStop(0, "rgba(180, 225, 255, 0)");
          lg.addColorStop(0.5, "rgba(180, 225, 255, 0.7)");
          lg.addColorStop(1, "rgba(180, 225, 255, 0)");
          ctx.strokeStyle = lg;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(lx, cy - r + 8);
          ctx.lineTo(lx, cy + r - 8);
          ctx.stroke();
        }
      });
      /* 右上角城市标识 */
      ctx.save();
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(235, 245, 255, 0.92)";
      ctx.font = font(600, 22, SANS);
      spacedText(ctx, "CHINA", PR, top + 22, 5, "right");
      spacedText(ctx, "YIWU", PR, top + 50, 5, "right");
      ctx.font = font(800, 40, SANS);
      ctx.shadowColor = "rgba(80, 170, 255, 0.8)";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#ffffff";
      ctx.fillText("义乌", PR, top + 96);
      ctx.shadowBlur = 0;
      ctx.font = font(500, 21, SANS);
      ctx.fillStyle = "rgba(200, 225, 255, 0.85)";
      spacedText(ctx, "让世界更近", PR, top + 126, 3, "right");
      ctx.restore();
    }
    return top + r * 2 + 40;
  }

  /* 主题标语：两头切角的发光框，两侧箭头和渐隐线；太长时退回橙色胶囊 */
  function hexRibbon(ctx, text, y, dry) {
    var size = 46;
    ctx.font = font(800, size, SANS);
    var tw = textWidth(ctx, text, 6);
    while (tw > 640 && size > 34) {
      size -= 2;
      ctx.font = font(800, size, SANS);
      tw = textWidth(ctx, text, 6);
    }
    if (tw > 640) return subtitlePill(ctx, text, y, dry);
    var h = size + 44;
    var w = tw + 120;
    var x = CX - w / 2;
    var cy = y + h / 2;
    if (dry) return y + h;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + 30, y);
    ctx.lineTo(x + w - 30, y);
    ctx.lineTo(x + w, cy);
    ctx.lineTo(x + w - 30, y + h);
    ctx.lineTo(x + 30, y + h);
    ctx.lineTo(x, cy);
    ctx.closePath();
    var fg = ctx.createLinearGradient(0, y, 0, y + h);
    fg.addColorStop(0, "rgba(40, 100, 255, 0.55)");
    fg.addColorStop(1, "rgba(14, 40, 150, 0.55)");
    ctx.fillStyle = fg;
    ctx.shadowColor = "rgba(70, 160, 255, 0.9)";
    ctx.shadowBlur = 26;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    var sg = ctx.createLinearGradient(x, 0, x + w, 0);
    sg.addColorStop(0, "rgba(98, 214, 255, 0.95)");
    sg.addColorStop(0.5, "rgba(210, 245, 255, 1)");
    sg.addColorStop(1, "rgba(98, 214, 255, 0.95)");
    ctx.strokeStyle = sg;
    ctx.stroke();
    [-1, 1].forEach(function (dir) {
      var ex = dir < 0 ? x - 16 : x + w + 16;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (var i = 0; i < 2; i++) {
        var ax = ex + dir * i * 22;
        ctx.strokeStyle = "rgba(98, 214, 255, " + (0.95 - i * 0.4) + ")";
        ctx.beginPath();
        ctx.moveTo(ax + dir * 12, cy - 14);
        ctx.lineTo(ax, cy);
        ctx.lineTo(ax + dir * 12, cy + 14);
        ctx.stroke();
      }
      var l0 = ex + dir * 58;
      var l1 = dir < 0 ? PL - 20 : PR + 20;
      var lg = ctx.createLinearGradient(l0, 0, l1, 0);
      lg.addColorStop(0, "rgba(98, 214, 255, 0.85)");
      lg.addColorStop(1, "rgba(98, 214, 255, 0)");
      ctx.strokeStyle = lg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(l0, cy);
      ctx.lineTo(l1, cy);
      ctx.stroke();
    });
    ctx.fillStyle = "#ffffff";
    ctx.font = font(800, size, SANS);
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(120, 200, 255, 0.9)";
    ctx.shadowBlur = 12;
    spacedText(ctx, text, CX, cy + 2, 6, "center");
    ctx.restore();
    return y + h;
  }

  /* 核心议题（没有分享人时）：六边形编号 + 题目 + 右侧箭头，一行一条 */
  function hexBadge(ctx, cx, cy, r) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 6 + i * Math.PI / 3;
      var px = cx + Math.cos(a) * r;
      var py = cy + Math.sin(a) * r;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  function topicsSection(ctx, talks, y, dry) {
    var tx = PL + 128;
    talks.forEach(function (t, i) {
      ctx.font = font(700, 34, SANS);
      var lines = U.wrap(ctx, t.title, PR - 76 - tx, 2);
      var h = Math.max(96, lines.length * 48 + 46);
      var cy = y + h / 2;
      if (!dry) {
        ctx.save();
        U.roundRect(ctx, PL + 30, y, PW - 30, h, h / 2 > 48 ? 30 : h / 2);
        var g = ctx.createLinearGradient(PL, 0, PR, 0);
        g.addColorStop(0, "rgba(40, 100, 255, 0.55)");
        g.addColorStop(1, "rgba(20, 50, 170, 0.32)");
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 2;
        var sg = ctx.createLinearGradient(PL, 0, PR, 0);
        sg.addColorStop(0, "rgba(140, 220, 255, 0.95)");
        sg.addColorStop(1, "rgba(98, 160, 255, 0.4)");
        ctx.strokeStyle = sg;
        ctx.shadowColor = "rgba(70, 160, 255, 0.7)";
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;
        hexBadge(ctx, PL + 52, cy, 50);
        var hg = ctx.createLinearGradient(0, cy - 50, 0, cy + 50);
        hg.addColorStop(0, "#2f7bff");
        hg.addColorStop(1, "#0f2fb0");
        ctx.fillStyle = hg;
        ctx.shadowColor = "rgba(98, 214, 255, 0.9)";
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(190, 240, 255, 0.95)";
        ctx.stroke();
        ctx.strokeStyle = C.cyan;
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(PR - 46, cy - 13);
        ctx.lineTo(PR - 32, cy);
        ctx.lineTo(PR - 46, cy + 13);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = font(900, 34, SANS);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(i + 1).padStart(2, "0"), PL + 52, cy + 1);
      ctx.restore();
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = font(700, 34, SANS);
      ctx.fillStyle = "#ffffff";
      var ly = cy - (lines.length - 1) * 24 + 12;
      lines.forEach(function (l, j) { ctx.fillText(l, tx, ly + j * 48); });
      y += h + 24;
    });
    return y;
  }

  /* ---------------- 底部：实景照片铺满宽度、往上渐隐，标语压在照片上 ---------------- */
  function bottomPhotoHeight(img) {
    return img ? Math.round(W * img.height / img.width) : 0;
  }

  function bottomPhoto(ctx, img, y) {
    var h = bottomPhotoHeight(img);
    var off = document.createElement("canvas");
    off.width = W;
    off.height = h;
    var o = off.getContext("2d");
    o.imageSmoothingQuality = "high";
    o.drawImage(img, 0, 0, W, h);
    o.globalCompositeOperation = "destination-in";
    var m = o.createLinearGradient(0, 0, 0, h);
    m.addColorStop(0, "rgba(0, 0, 0, 0)");
    m.addColorStop(0.32, "rgba(0, 0, 0, 1)");
    m.addColorStop(0.74, "rgba(0, 0, 0, 1)");
    m.addColorStop(1, "rgba(0, 0, 0, 0)");
    o.fillStyle = m;
    o.fillRect(0, 0, W, h);
    ctx.drawImage(off, 0, y);
    return y + h;
  }

  function sloganLine(ctx, text, y) {
    ctx.save();
    ctx.font = font(500, 30, SANS);
    ctx.fillStyle = "rgba(235, 245, 255, 0.95)";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0, 0, 30, 0.8)";
    ctx.shadowBlur = 8;
    var tw = spacedText(ctx, text, CX, y, 8, "center");
    ctx.shadowBlur = 0;
    hline(ctx, CX - tw / 2 - 110, CX - tw / 2 - 24, y - 10, "220, 240, 255", 0.9, 2);
    hline(ctx, CX + tw / 2 + 24, CX + tw / 2 + 110, y - 10, "220, 240, 255", 0.9, 2);
    ctx.restore();
  }

  /* ---------------- 整体排版：从上往下，返回内容底部的 y ---------------- */
  function layout(ctx, d, A, dry, rand) {
    var letter = !d.poster;
    var parts = splitTitle(d.title);
    var title = parts ? parts[1] : String(d.title || "");
    var bottom = Boolean(A.visual) && d.visualAt === "bottom";
    var tf;
    ctx.textBaseline = "alphabetic";

    var y = topBar(ctx, A.logos, dry);

    if (parts && glyphs(parts[0]).length <= 10) {
      /* 「2026 义乌 · 某某大会」：前半句做第一行大字，后半句做主标题 */
      var kf = titleFit(ctx, parts[0], 140, 90);
      y += Math.round(kf.size * 0.86);
      if (!dry) artText(ctx, kf.lines[0], CX, y, kf.size, kf.gap);
      y += Math.round(kf.size * 0.3);
      tf = titleFit(ctx, title, 112, 68);
    } else {
      var kicker = parts ? parts[0] : String(d.host || "义乌AI圈");
      var kfit = U.fitLine(ctx, kicker, 640, 38, 26, 700, SANS);
      if (!dry) ribbonLabel(ctx, kfit.text, kfit.size, y + 20);
      y += 80;
      tf = titleFit(ctx, title);
    }
    y += Math.round(tf.size * 0.98);
    tf.lines.forEach(function (l, i) {
      if (!dry) artText(ctx, l, CX, y, tf.size, tf.gap);
      if (i < tf.lines.length - 1) y += Math.round(tf.size * 1.16);
    });
    y += Math.round(tf.size * 0.22) + 40;

    if (d.subtitle) y = hexRibbon(ctx, d.subtitle, y, dry) + 20;

    /* 主视觉放顶部（插画或默认光效）；实景照片放底部时，这里不画 */
    if (!bottom) {
      var heroH = 600;
      if (!dry) {
        if (A.visual) visualImage(ctx, A.visual, y, heroH);
        else stage(ctx, y, heroH, rand);
      }
      y += heroH + 16;
    } else {
      y += 30;
    }

    if (letter) {
      y = letterTitle(ctx, y, dry);
      if (d.greeting) y = salutation(ctx, d.greeting, y);
      else y = greeting(ctx, d, y, dry) + 10;
      y = letterBody(ctx, d.message || Y.defaultMessage(d), y);
      y = signature(ctx, d, y) + 80;
    } else {
      var tail = d.qr && d.qr.length ? "欢迎扫描底部二维码报名" : "";
      y = quote(ctx, d.intro || Y.defaultMessage(d), tail, y, dry);
    }

    var groups = (Array.isArray(d.orgs) ? d.orgs : []).filter(function (g) { return g && g.names && g.names.length; });
    var orgRows = [];
    if (d.host && !groups.some(function (g) { return /主办/.test(g.label); })) orgRows.push(["主办单位", [String(d.host)]]);
    groups.forEach(function (g) { orgRows.push([g.label, g.names]); });
    if (orgRows.length) {
      y = sectionTitle(ctx, "组织单位", y, dry);
      y = orgSection(ctx, orgRows, y, dry) + 76;
    }

    var info = [];
    if (d.timeText) info.push(["clock", "活动时间：", d.timeText]);
    if (d.place) info.push(["pin", "活动地点：", d.place]);
    if (info.length) {
      y = sectionTitle(ctx, "活动信息", y, dry);
      y = infoSection(ctx, info, y, dry) + 76;
    }

    var agenda = Array.isArray(d.agenda) ? d.agenda.filter(function (r) { return r && r.item; }) : [];
    if (agenda.length) {
      y = sectionTitle(ctx, "流程安排", y, dry);
      y = agendaSection(ctx, agenda, y, dry) + 40;
    }

    var talks = Array.isArray(d.talks) ? d.talks.filter(function (t) { return t && t.title; }) : [];
    if (talks.length) {
      /* 有分享人的画成议题卡片；只有题目的画成「核心议题」列表 */
      var withSpeakers = talks.some(function (t) { return t.speaker || t.role; });
      y = lightRibbon(ctx, y, dry, 1);
      y = sectionTitle(ctx, withSpeakers ? "活动详情" : "核心议题", y, dry);
      y = (withSpeakers ? talksSection(ctx, talks, y, dry) : topicsSection(ctx, talks, y + 6, dry)) + 20;
    }

    if (d.qr && d.qr.length) {
      y = lightRibbon(ctx, y, dry, -1);
      y = sectionTitle(ctx, "报名方式", y, dry);
      y = signup(ctx, d, y, dry) + 70;
    }

    if (d.notice) y = noticeSection(ctx, d.notice, y + 30, dry) + 70;

    if (A.logo) {
      var lh = 64;
      var lw = Math.round(A.logo.width * lh / A.logo.height);
      if (!dry) {
        hline(ctx, PL, PR, y, "120, 175, 255", 0.5, 1.5);
        ctx.drawImage(A.logo, CX - lw / 2, y + 44, lw, lh);
      }
      y += 44 + lh;
    }

    if (bottom) {
      var top = y + 10;
      y = dry ? top + bottomPhotoHeight(A.visual) : bottomPhoto(ctx, A.visual, top);
      /* 标语放在照片下方的深色带里，不压住照片里的招牌 */
      if (d.slogan) {
        y += 40;
        if (!dry) sloganLine(ctx, d.slogan, y);
      }
      return y + 70;
    }
    if (d.slogan) {
      y += 90;
      if (!dry) sloganLine(ctx, d.slogan, y);
    }
    return y + 80;
  }

  function renderTech(d) {
    var logoUrls = (Array.isArray(d.logoUrls) ? d.logoUrls : []).slice(0, 6);
    return Promise.all([U.loadImage(d.logoUrl), U.loadImage(d.visualUrl)].concat(logoUrls.map(U.loadImage))).then(function (imgs) {
      var A = { logo: imgs[0], visual: imgs[1], logos: imgs.slice(2).filter(Boolean) };
      var probe = document.createElement("canvas");
      probe.width = W;
      probe.height = 4;
      var H = Math.min(MAX_H, Math.max(1920, Math.ceil(layout(probe.getContext("2d"), d, A, true, U.rng(1)))));
      var c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      var ctx = c.getContext("2d");
      var seed = U.hash((d.title || "") + "|" + (d.name || ""));
      background(ctx, H, U.rng(seed));
      layout(ctx, d, A, false, U.rng(seed + 1));
      return c;
    });
  }

  Y.styles.tech = renderTech;
})();
