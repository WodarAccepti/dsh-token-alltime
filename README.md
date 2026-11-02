# dsh-token-total

DSH（DeepSeek Harness）Web 插件：在界面右缘挂一枚 `Σ TOKEN` 小药丸，显示**从第一次调用 API 至今的累计 token 总量**，点击展开明细（平台历史 / 导出后新增 / 缓存命中率 / 按模型 / 按活跃日柱状图）。

## 它解决什么问题

DSH 里能看到的 token 数字有三个口径，都各有缺口：

| 口径 | 覆盖 | 缺口 |
| --- | --- | --- |
| `dsh-usage` 账本（`$DSH_HOME/dsh-usage/usage-ledger.json`） | 从账本功能启用那天起 | 启用之前的调用一条都没有 |
| 会话日志（`$DSH_HOME/sessions/**/session.v*.jsonl.zstd` 里的 `assistant/message.data.usage`） | 本机留存的所有会话 | 被删除的会话、别的客户端/网页端、别的机器都没有 |
| **DeepSeek 平台账单**（platform.deepseek.com 用量页导出的 CSV） | **全部，权威** | 需要手动导出 |

本插件把三者接起来：**用平台 CSV 打一个基线，之后用实时账本持续累加**，所以数字既对得上账单，又会自己往上长，不需要反复导出。

```
总 token = 平台历史 token（导入时） + max(0, 当前账本 token − 导入时账本 token)
```

## 数据口径

- **平台历史**：`tools/build-data.mjs` 把你的 `amount-*.csv` / `cost-*.csv` 去重、按天按模型聚合后写进 `lib/data.json`。
- **此后新增（实时账本）**：主机侧每次请求现读 `usage-ledger.json`，减去导入时记下的基线。单位就是 **token**（未缓存输入 + 缓存读 + 缓存写 + 输出）。
- **缓存命中率**：`缓存读 / (缓存读 + 未缓存输入)`，平台部分与账本部分一起算。
- `model` 为空的行是工具检索等非 token 计费（`tool-search`），只累进 `otherCostCny`，不进 token。

## 安装

包本体装进 DSH 共享插件目录，再登记进你要用的 profile。

```powershell
# 1. 放包（web profile 与 desktop profile 共用这一份）
\$dst = "\$env:USERPROFILE\.dsh\profiles\node_modules\dsh-token-total"
New-Item -ItemType Directory -Force -Path \$dst | Out-Null
Copy-Item -Path ".\*" -Destination \$dst -Recurse -Force

# 2. 登记为 profile 插件（desktop 换成 web/其它 profile 名）
\$prof = "\$env:USERPROFILE\.dsh\profiles\desktop"
Add-Content -Path "\$prof\cordis.patch.yml" -Value @(
  "# dsh-token-total: all-time token total",
  "- insert:",
  "    - id: token-total",
  "      name: ""dsh-token-total"""
)

# 3. 让它在插件列表里可单独开关（可选，但推荐）
#    package.json: dependencies 加 "dsh-token-total": "file:<本仓库绝对路径>"
#                  dsh.profile.bundles 追加 "dsh-token-total"
```

改完**完全退出 DSH 再打开**（刷新窗口不会加载服务端插件）。之后右缘出现药丸即成功；插件列表里也能看到并可单独开关。

> `cordis.patch.yml` 是**源文件**，`cordis.yml` 是每次启动生成的——只改后者会在重启时被覆盖。

## 导入 / 刷新平台历史

1. 打开 <https://platform.deepseek.com/usage>，按时间窗口导出 CSV（会得到 `amount-*.csv` 与 `cost-*.csv` 两份）。
2. 解压到一个目录，然后：

```bash
node tools/build-data.mjs <解压目录>
# 也可以直接给多个 csv / 目录，重叠窗口会自动去重
```

3. 把新生成的 `lib/data.json` 覆盖到已安装的包目录（`...\node_modules\dsh-token-total\lib\data.json`），刷新界面即可。

`lib/data.json` 含你的真实账单数据，已加进 `.gitignore`，不要提交。仓库里只有零值模板 `lib/data.example.json`。

**全新安装（还没有 `lib/data.json`）时，接口与药丸一律返回 0**：`imported: false`、`total: 0`、`sinceExport: 0`、`ledger: null`、`cacheHitRate: null`，面板只提示去导入。本机 `dsh-usage` 账本的历史不会被算进来，导入自己的 CSV 之后才开始显示数字。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/dsh-token-total/overview` | 全量统计文档（仅回环地址可读，非回环返回 403） |

返回字段：`total`、`sinceExport`、`imported`、`cacheHitRate`、`platform.{range,tokens,calls,costCny,days,models}`、`ledger.{from,to,tokens,days,models}`、`baseline`。
未导入时上述数值全部为 `0`，`ledger` 与 `cacheHitRate` 为 `null`。

## 限制

- 基线是**导出时刻**的快照。导出到导入之间若又产生调用，这部分会计入"此后新增"，不会双计；但如果平台导出的覆盖窗口晚于你导入的账本快照，理论上有几分钟的重叠，量级可忽略。
- 只统计 `provider/model` 前缀为 `deepseek` 的 token 行；其它供应商需要改 `tools/build-data.mjs` 的过滤条件。
- `/api/dsh-token-total/overview` 不含任何凭据，但仍是个人用量数据，所以只对回环开放。

## 卸载

删掉已安装目录，并从 `cordis.patch.yml`（以及 `package.json` 的 `dependencies` / `dsh.profile.bundles`）里去掉对应条目，然后重启 DSH。

## 开发

```bash
node tests/smoke.mjs          # 离线冒烟测试：挂载路由 + 校验客户端 bundle 契约
node tools/pack-release.mjs   # 产出 release/*.tgz、源码 zip 与 SHA256SUMS
```

结构：

```
lib/index.js     主机侧：唯一的回环 JSON 路由，读平台基线 + 账本
lib/client.js    浏览器侧：纯 DOM + Shadow DOM，无需打包器与 React
lib/data.json    你的平台基线（gitignored）
tools/           CSV 导入与打包
tests/smoke.mjs  离线测试
```

## License

MIT
