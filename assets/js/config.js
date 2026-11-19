/* ==========================================================================
   义乌AI圈 · 前台配置
   接真实短信：把 sms.mode 改成 "api"，并填好后端地址。
   安全提醒：AccessKey / Secret 只能放在后端，绝不能写进这个文件。
   ========================================================================== */
window.YW_CONFIG = {
  sms: {
    // "demo"：本地演示，验证码显示在提示条；"api"：调用后端发真实验证码
    mode: "demo",

    // POST { phone: "13800138000" } -> { ok: true, expire: 300 }
    // 失败返回 { ok: false, msg: "错误提示" }
    sendUrl: "/api/sms/send",

    // POST { phone: "13800138000", code: "123456" } -> { ok: true }
    // 失败返回 { ok: false, msg: "验证码不正确" }
    verifyUrl: "/api/sms/verify"
  },

  logistics: {
    // "demo"：每 60 秒模拟舱位与运价波动；"api"：从货代/物流接口取真实数据
    mode: "demo",

    // GET /api/logistics/live ->
    // { ok: true, space: 92, rate: 18.6, updatedAt: "2026-11-17T01:00:00+08:00", source: "货代系统" }
    endpoint: "/api/logistics/live",
    refreshSeconds: 60
  }
};
