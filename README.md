# dsh-token-alltime

> 仓库名是 `dsh-token-total`，包名/模块名是 `dsh-token-alltime`：`dsh-token-total` 这个 npm 包名已被别人的同名项目占用（`GaoHu1997/dsh-token-total`），改名以免装错。

DSH（DeepSeek Harness）Web 插件：在界面右缘挂一枚 `Σ TOKEN` 小药丸，显示**从第一次调用 API 至今的累计 token 总量**，点击展开明细（平台历史 / 调用花费 / 今日使用 / 账本覆盖 / 缓存命中率 / 按模型 / 按活跃日柱状图）。面板左缘停在药丸左侧，不会盖住药丸。

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
- **今日使用**：账本里"今天"那一格（按本地日历日）的 token 合计，随每次请求实时上涨。它**不参与总量计算**，只是当天进度的读数；今天若正好是导入日，导出时刻之前的部分已经在平台历史里，两行会有重叠（总量不重复计）。
- **基线增量**：主机侧每次请求现读 `usage-ledger.json`，减去导入时记下的基线——**总 token 用的是这个值**（`sinceExport`），面板不再单列。单位就是 **token**（未缓存输入 + 缓存读 + 缓存写 + 输出）。
- **缓存命中率**：`缓存读 / (缓存读 + 未缓存输入)`，平台部分与账本部分一起算。
- `model` 为空的行是工具检索等非 token 计费（`tool-search`），只累进 `otherCostCny`，不进 token。

## 安装

包本体装进 DSH 共享插件目录，再登记进你要用的 profile。

```powershell
# 1. 放包（web profile 与 desktop profile 共用这一份）
\$dst = "\$env:USERPROFILE\.dsh\profiles\node_modules\dsh-token-alltime"
New-Item -ItemType Directory -Force -Path \$dst | Out-Null
Copy-Item -Path ".\*" -Destination \$dst -Recurse -Force

# 2. 登记为 profile 插件（desktop 换成 web/其它 profile 名）
\$prof = "\$env:USERPROFILE\.dsh\profiles\desktop"
Add-Content -Path "\$prof\cordis.patch.yml" -Value @(
  "# dsh-token-alltime: all-time token total",
  "- insert:",
  "    - id: token-total",
  "      name: ""dsh-token-alltime"""
)

# 3. 让它在插件列表里可单独开关（可选，但推荐）
#    package.json: dependencies 加 "dsh-token-alltime": "file:<本仓库绝对路径>"
#                  dsh.profile.bundles 追加 "dsh-token-alltime"
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

3. 把新生成的 `lib/data.json` 覆盖到已安装的包目录（`...\node_modules\dsh-token-alltime\lib\data.json`），刷新界面即可。

`lib/data.json` 含你的真实账单数据，已加进 `.gitignore`，不要提交。仓库里只有零值模板 `lib/data.example.json`。

**全新安装（还没有 `lib/data.json`）时，接口与药丸一律返回 0**：`imported: false`、`total: 0`、`sinceExport: 0`、`ledger: null`、`cacheHitRate: null`，面板只提示去导入。本机 `dsh-usage` 账本的历史不会被算进来，导入自己的 CSV 之后才开始显示数字。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/dsh-token-alltime/overview` | 全量统计文档（仅回环地址可读，非回环返回 403） |

返回字段：`total`、`sinceExport`、`today.{day,tokens,calls}`、`imported`、`cacheHitRate`、`platform.{range,tokens,calls,costCny,days,models}`、`ledger.{from,to,tokens,days,models}`、`baseline`。
未导入时上述数值全部为 `0`，`ledger` 与 `cacheHitRate` 为 `null`。

## 限制

- 基线是**导出时刻**的快照。导出到导入之间若又产生调用，这部分会计入增量（总 token），不会双计；"今日使用"那一行则会把它和平台历史里同一天的部分同时显示出来；但如果平台导出的覆盖窗口晚于你导入的账本快照，理论上有几分钟的重叠，量级可忽略。
- 只统计 `provider/model` 前缀为 `deepseek` 的 token 行；其它供应商需要改 `tools/build-data.mjs` 的过滤条件。
- `/api/dsh-token-alltime/overview` 不含任何凭据，但仍是个人用量数据，所以只对回环开放。

## 卸载

删掉已安装目录，并从 `cordis.patch.yml`（以及 `package.json` 的 `dependencies` / `dsh.profile.bundles`）里去掉对应条目，然后重启 DSH。

## 开发

```bash
node tests/smoke.mjs          # 离线冒烟测试：挂载路由 + 校验客户端 bundle 契约
node tools/pack-release.mjs   # 产出 release/*.tgz、源码 zip 与 SHA256SUMS
```

## 发版

1. 在本机跑 `node tools/pack-release.mjs`（Windows 自带 bsdtar 即可；Linux 的 GNU tar 不支持 `-a` 写 zip，需改用 bsdtar），把 `release/` 提交上来。
2. 打 tag 推送：`git tag v0.1.0 && git push origin v0.1.0`。`.github/workflows/publish.yml` 会跑 smoke、校验 tag 与 `package.json` 版本一致，然后把 `release/` 里的产物挂到 GitHub Release。

**关于 npm**：本项目默认不上 npm，只用 GitHub Release 分发 tgz（装插件按上面「安装」走本地目录或解压 tgz 到插件目录）。`dsh-token-alltime` 这个名字目前在 npm 上是空闲的；哪天要发布，先在仓库 Secrets 里加 `NPM_TOKEN`，再把 `npm publish --access public` 步骤加回 `publish.yml` 即可。

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
