# Changelog

## 0.1.0 — 2026-11-02

首个公开版本。

- 主机侧：新增 `GET /api/dsh-token-total/overview`（仅回环可读），返回平台基线 + 实时账本增量合并后的全量统计。
- 主机侧：`lib/data.json` 缺失（或未导入）时接口一律返回 **0**：`imported:false`、`total:0`、`sinceExport:0`、`ledger:null`、`cacheHitRate:null`，不会把本机 `dsh-usage` 账本的历史算进去，等用户导入自己的账单。
- 浏览器侧：右缘 `Σ TOKEN` 药丸 + 展开面板（总计、平台历史、导出后新增、账本覆盖、缓存命中率、按模型、按活跃日柱状图），60 秒自刷新，Esc 关闭。
- 工具：`tools/build-data.mjs` 导入平台导出的 `amount-*.csv` / `cost-*.csv`（自动去重、按天按模型聚合、记录账本基线）。
- 工具：`tools/pack-release.mjs` 产出 tgz + 源码 zip + SHA256SUMS。
- 测试：`tests/smoke.mjs` 离线校验路由与客户端 bundle 契约。
