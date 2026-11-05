# dsh-token-alltime

> 仓库、包名、插件 id 统一为 `dsh-token-alltime`。这个 npm 包名原叫 `dsh-token-total`，已被别人的同名项目占用（`GaoHu1997/dsh-token-total`），改名以免装错。

DSH（DeepSeek Harness）Web 插件：界面右缘常态只有一枚小箭头，鼠标移上去才滑出 `TOKEN` 小药丸，显示**历史（至昨日）+ 今日**的 token 总量，点击展开明细（历史 / 调用花费 / 今日使用 / 今日缓存命中率 / 账本 / 按模型 / 最近 15 个使用日柱状图）。药丸常态收起，只用 13px 宽的箭头占位；面板打开期间药丸保持展开，不随鼠标移开而缩回。药丸与模型的概数用 `m` / `k`（与千分位分组同一套十进制单位），精确值在悬浮提示里。面板左缘停在药丸左侧，不会盖住药丸；明细每 5 分钟刷新一次，打开面板时若缓存超过 30 秒会立刻补拉一次。

## 它解决什么问题

DSH 里能看到的 token 数字有三个口径，都各有缺口：

| 口径 | 覆盖 | 缺口 |
| --- | --- | --- |
| `dsh-usage` 账本（`$DSH_HOME/dsh-usage/usage-ledger.json`） | 从账本功能启用那天起 | 启用之前的调用一条都没有 |
| 会话日志（`$DSH_HOME/sessions/**/session.v*.jsonl.zstd` 里的 `assistant/message.data.usage`） | 本机留存的所有会话 | 被删除的会话、别的客户端/网页端、别的机器都没有 |
| **DeepSeek 平台账单**（platform.deepseek.com 用量页导出的 CSV） | **全部，权威** | 需要手动导出 |

本插件把三者接起来：**用平台 CSV 打一个基线，之后用实时账本持续累加**，所以数字既对得上账单，又会自己往上长，不需要反复导出。

```
总 token = 历史（至昨日 24:00） + 今日使用
```

按本地日历日切分：账单覆盖的日期用账单数，账单之后的日子用账本新增；导出当天账单只记到导出那一刻，剩下的用账本补齐。换日之后今天的数据自动并入历史，两行永远相加等于总数。

## 数据口径

- **平台账单**：`tools/build-data.mjs` 把你的 `amount-*.csv` / `cost-*.csv` 去重、按天按模型聚合后写进 `lib/data.json`（静态快照）。
- **历史（至昨日）**：`today` 之前的每一天 = 平台账单当天 token（`platformDays`）+ 导入之后账本在该天的新增；导出当天用"账单数 + 账本当天剩余"补齐。单位是 **token**（缓存读 + 未缓存输入 + 缓存写 + 输出 + 推理）。
- **今日使用**：账本里"今天"那一格（本地 0:00 分界）的 token 合计，随每次请求实时上涨。它和历史严格互补，两者相加就是总数。
- **按模型**：账单里的模型分布 + 账本按模型的增量，实时；各模型相加等于总数。
- **按天柱状图**：只保留最近 **15 个有使用记录的日历日**（零用量日自动跳过）。左端标签是这 15 天里最早那天的真实日期，右端是今天（今天没用就写最近一个使用日），每根柱子悬浮显示完整日期与当日用量。
- **调用 / 花费**：账单次数与金额 + 账本在新日期的增量，实时；导出当天的增量按当天 token 占比折算，金额四舍五入到分。
- **账本**：`usage-ledger.json` 覆盖的起止日期，每次刷新重读，随当天用量实时推进。
- **今日缓存命中率**：`缓存读 / (缓存读 + 未缓存输入)`，只算账本里"今天"那一格，不回溯历史（历史那部分要逐日重算，代价大且没人看）。今天还没调用时显示 `—`。
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
  "    - id: token-alltime",
  "      name: ""dsh-token-alltime"""
)

# 3. 让它在插件列表里可单独开关（可选，但推荐）
#    package.json: dependencies 加 "dsh-token-alltime": "file:<本仓库绝对路径>"
#                  dsh.profile.bundles 追加 "dsh-token-alltime"
```

改完**完全退出 DSH 再打开**（刷新窗口不会加载服务端插件）。之后右缘出现一枚小箭头（鼠标移上去展开为药丸）即成功；插件列表里也能看到并可单独开关。

> `cordis.patch.yml` 是**源文件**，`cordis.yml` 是每次启动生成的——只改后者会在重启时被覆盖。

## 出问题先跑自检

```powershell
npm run doctor        # 只读，不改任何文件
```

逐条给出 PASS / WARN / FAIL 和可直接粘贴的修复命令，查四件事：

1. **profile 里的 `file:` 依赖是否还指着真实目录**。那一行长这样：`"dsh-token-alltime": "file:D:/Coding/dsh-token-alltime-upload"`。这个目录一旦改名、移动或删除，**pnpm 会拒绝该 profile 的所有后续操作**（装、卸、升级全失败），因为它在动手前先解析全部直接依赖。要给目录改名，先改这一行。
2. **是否还在 `dsh.profile.bundles` 里**（不在就不会挂载）。
3. **已安装副本是否与源码一致**。pnpm 对 `file:` 依赖是**复制**而不是软链，改了源码必须重新同步，否则界面上跑的仍是旧代码。
4. **`lib/data.json` 两侧是否一致**。只更新了源码那份、没同步到已安装副本时，卡片显示 0。

## 崩溃安全边界

这个插件不允许自己的代码成为 DSH 崩溃的原因，所有入口都不向外抛异常：

- 主机侧路由：客户端提前断开、写响应失败、`lib/data.json` 损坏或字段形状不对，一律收敛成 403 / 500 或零值文档，异常不出 `handler`；`req`/`res` 的 `error` 事件被就地吞掉（HTTP 流上未处理的 `error` 事件会直接带走宿主进程，不是 500 而是进程退出）。
- `apply`：宿主没给 `webServer` 就静默待命，不抛。
- 浏览器侧 `apply` / `paint` / `poll` 全部包在 try/catch 里：`document.body` 缺失、接口文档缺 `models`/`days`、fetch 失败、主机返回非对象，都只影响卡片本身，不会打断外壳的启动过程。
- 这些路径在 `tests/` 里都有断言：已结束的响应对象、写响应抛异常的 socket、坏 `data.json`、缺字段的文档、没有 `body` 的 DOM。

## 导入 / 刷新平台历史

1. 打开 <https://platform.deepseek.com/usage>，按时间窗口导出 CSV（会得到 `amount-*.csv` 与 `cost-*.csv` 两份）。
2. 解压到一个目录，然后：

```bash
node tools/build-data.mjs <解压目录>
# 也可以直接给多个 csv / 目录，重叠窗口会自动去重
```

3. 把新生成的 `lib/data.json` 覆盖到已安装的包目录（`...\node_modules\dsh-token-alltime\lib\data.json`），刷新界面即可。

`lib/data.json` 含你的真实账单数据，已加进 `.gitignore`，不要提交。仓库里只有零值模板 `lib/data.example.json`。

**全新安装（还没有 `lib/data.json`）时，接口与药丸一律返回 0**：`imported: false`、`total: 0`、`history: 0`、`calls: 0`、`costCny: 0`、`sinceExport: 0`、`models: []`、`days: []`、`ledger: null`、`today.hitRate: null`，面板只提示去导入。本机 `dsh-usage` 账本的历史不会被算进来，导入自己的 CSV 之后才开始显示数字。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/dsh-token-alltime/overview` | 全量统计文档（仅回环地址可读，非回环返回 403） |

返回字段：`total`、`history`、`calls`、`costCny`、`today.{day,tokens,calls,hitRate}`、`sinceExport`、`imported`、`range`、`models[{model,tokens}]`、`days[{day,tokens}]`、`platform.{range,tokens,calls,costCny,days,models}`（账单快照）、`ledger.{from,to,tokens,calls}`、`baseline.{tokens,calls,generatedAt}`。
未导入时上述数值全部为 `0`，`models` / `days` 为 `[]`，`ledger` 与 `today.hitRate` 为 `null`。
环境变量 `DSH_TOKEN_ALLTIME_DATA` 可以让主机侧去读别处的 `data.json`（测试用）。

## 限制

- 基线是**导出时刻**的快照。导出当天账单只记到那一刻，插件用账本把当天剩余的部分补上，所以不会双计；但平台窗口若晚于账本快照，理论上有几分钟的重叠，量级可忽略。
- 账单覆盖不到的日子（导出之后）只有账本里的 DSH 用量，网页端 / 其它客户端的用量要等下次导出才会补进来。
- 只统计 `provider/model` 前缀为 `deepseek` 的 token 行；其它供应商需要改 `tools/build-data.mjs` 的过滤条件。
- `/api/dsh-token-alltime/overview` 不含任何凭据，但仍是个人用量数据，所以只对回环开放。

## 卸载

删掉已安装目录，并从 `cordis.patch.yml`（以及 `package.json` 的 `dependencies` / `dsh.profile.bundles`）里去掉对应条目，然后重启 DSH。

## 开发

```bash
npm test                      # 离线测试：挂载路由 + bundle 契约 + 收起/悬停状态机
node tools/pack-release.mjs   # 产出 release/*.tgz、源码 zip 与 SHA256SUMS
```

## 发版

1. 在本机跑 `node tools/pack-release.mjs`（Windows 自带 bsdtar 即可；Linux 的 GNU tar 不支持 `-a` 写 zip，需改用 bsdtar），把 `release/` 提交上来。
2. 打 tag 推送：`git tag v1.0.0 && git push origin v1.0.0`。`.github/workflows/publish.yml` 会跑 smoke、校验 tag 与 `package.json` 版本一致，然后把 `release/` 里的产物挂到 GitHub Release。

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
