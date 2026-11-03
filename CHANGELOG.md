# Changelog

## 0.1.1 — 2026-11-02

界面调整（接口新增一个字段，向后兼容）。

- 面板不再压住药丸：展开时按药丸实测宽度把面板右边缘让到药丸左侧 12px，窗口缩放时重算。
- 「平台历史」行去掉括号里的日期段（上方小字仍写着区间的起始日），避免和「账本覆盖」重复成区间。
- 「此后新增（实时账本）」改为「**今日使用**」，数值换成账本里今天那一格的 token（实时上涨），不再带 `+` 前缀；总量仍用基线增量计算，只是不再单列。
- 「调用 / 花费」改为与「平台历史」同级顶格（原来带全角空格当缩进子行）；下面的模型行改用 `.k.ind` 类缩进一级，左缘严格一致。
- 主机侧：`overview` 新增 `today: { day, tokens, calls }`；未导入时 `today.tokens = 0`。
- 测试：冒烟测试新增「今日使用只读当天账本格」的断言。

## 0.1.0 — 2026-11-02

首个公开版本。

- 包名：`dsh-token-total` → `dsh-token-alltime`（原名在 npm 上已被他人占用），插件 id 仍是 `token-total`，接口前缀同步改为 `/api/dsh-token-alltime`。
- 主机侧：新增 `GET /api/dsh-token-alltime/overview`（仅回环可读），返回平台基线 + 实时账本增量合并后的全量统计。
- 主机侧：`lib/data.json` 缺失（或未导入）时接口一律返回 **0**：`imported:false`、`total:0`、`sinceExport:0`、`ledger:null`、`cacheHitRate:null`，不会把本机 `dsh-usage` 账本的历史算进去，等用户导入自己的账单。
- 浏览器侧：右缘 `Σ TOKEN` 药丸 + 展开面板（总计、平台历史、导出后新增、账本覆盖、缓存命中率、按模型、按活跃日柱状图），60 秒自刷新，Esc 关闭。
- 工具：`tools/build-data.mjs` 导入平台导出的 `amount-*.csv` / `cost-*.csv`（自动去重、按天按模型聚合、记录账本基线）。
- 工具：`tools/pack-release.mjs` 产出 tgz + 源码 zip + SHA256SUMS。
- 测试：`tests/smoke.mjs` 离线校验路由与客户端 bundle 契约。
