# 运维功能与接口

本说明对应仓库的 CloudNet 3.4.5 实现。交付源码，不代表已编译或完成运行验收。

## 页面

- `/#/`：在线玩家、实例、节点摘要，以及任务运行表和节点资源表。
- 概览资源趋势下方为节点／任务在线人数折线图，`playerRange=15m|1h|6h|24h` 控制时间范围（默认 1h）；重复参数 `hiddenPlayerNode`、`hiddenPlayerTask` 保存隐藏曲线，与资源趋势的节点筛选独立。
- `/#/services`：统一任务与服务器入口；任务默认展开，下方展示实例。零实例任务仍可启动、配置；配置已删除的实例保留分组，不提供任务操作。
- `/#/tasks/<名称>`：任务运行与实例；`/monitor` 查看监控，`/configuration` 编辑配置。旧 `/#/tasks` 列表地址跳转服务器页，保留全部查询参数。
- `/#/groups`：配置分组；`/<名称>/configuration` 编辑配置。
- `/#/services?create=1`、`/#/groups?create=1`：创建任务或分组，旧 `/#/tasks?create=1` 仍可使用。
- `/#/nodes`：集群节点；`/<节点>/services|tasks|console` 查看实例、任务和控制台。
- `/#/services/<UUID>` 默认显示控制台与在线玩家，`/<UUID>/info|configuration` 查看实例信息或配置。原 `/console` 链接继续可用。
- `/#/console?type=node&id=Node-1`：统一控制台；`type=service` 时 id 使用实例 UUID。
- `/#/players`：在线玩家列表、右侧详情抽屉及单人／批量操作，见 [玩家管理](PLAYERS.md)。

服务器页的 `q`、`node`、`kind`、`task`、`state`、`sort`、重复参数 `collapsed` 和分组列表的 `q` 保存到 URL。
搜索匹配任务及实例名称，任务名匹配时保留满足其他条件的实例。实例条件启用后隐藏无匹配实例的任务。
任务汇总展示匹配实例的玩家／容量、进程内存、CPU 逻辑核，筛选时标注“筛选范围”；最低数量始终表示整个集群。
完整任务或仅按节点划分的实例集合显示对应历史；部分实例被筛掉时隐藏该组迷你图，更多菜单仍可进入完整任务监控。
任务历史按显示的任务批量查询，实例历史只查询展开分组。概览、节点任务表保留原有上下文。

任务操作采用单行操作栏：Hash 图标与“设置最低数量”文字、停止图标、更多。更多菜单首项为临时启动，其后为详情、监控、配置和删除任务；页面顶部保留全局临时启动。
停止确认窗不受列表筛选影响，列出整个任务的运行实例、节点、人数和停止后删除行为；底部单行提供“取消／普通停止／清零并停止”。
普通停止保留最低数量，可能自动补开；清零并停止沿用最低数量保存及主节点同步确认。提交期间共同禁用，接受后台任务后关闭窗口，进度和结果继续使用悬浮提示；请求失败保留确认窗。
入口合并本身仅修改 Web 前端；后续停止反馈修复需要入口同时更新 Web＋REST，见下文。2026-10-16 已完成本地模拟浏览器检查及构建，最新交付状态见 [检查记录](UI-CHECKS.md)，下文早期阶段记录保留供参考。
工作台使用 `view=console|players` 定位后台或玩家区域；`player` 保留玩家 UUID，`playerSearch`、`playerPage` 保留内嵌名单状态。
桌面控制台与玩家独立滚动，窄屏切换查看；从玩家列表进入后台会保留玩家定位。
资源名称与 ID 经过 URL 编码，详情可收藏、刷新及前进后退。

## 共享停止进度

点击实例停止后，按钮与状态立即显示红色“停止中”；HTTP 返回后继续等待最新服务状态确认。
列表、任务及节点实例表、实例详情使用同一展示逻辑；同入口其他管理员和刷新后的页面通过原有 5 秒轮询获取状态。
任务普通停止／清零并停止复用相同提交方法，仅在逐台实际提交时登记，重复提交的实例跳过。实例停止、启动、重启在等待期间禁用，其他实例不受影响。

服务列表及单实例读取保留原快照字段，附加可选 `webOperation: {operation: "stop", status: "pending" | "unconfirmed", submittedAt, reason}`。
`submittedAt` 为 Unix 毫秒；不修改核心 `lifeCycle`，不公开提交者。沿用原有服务读取与操作权限，旧 GET 停止接口也参与去重。
重复停止或停止期间启动／重启返回 409；明确未提交的错误解除标记，提交超时或结果不明保留未确认记录。
超过 60 秒未确认时显示红色“停止未确认”，原因通过状态与按钮提示展示；保留后台与已有强制终止／删除入口，不自动重试。
轮询失败保留已有数据并使用悬浮提示。节点离线不作为停止完成依据；确认停止、重新就绪或删除后移除记录。
本地实例优先读取节点持有的实际快照，远端读取集群缓存；读取、状态合并及记录清理统一处理，不在早于缓存更新的停止事件中清除记录。
同 UUID 已运行进程的有效 PID 变化也可确认重新启动，新 UUID 不继承停止记录。接口不会用旧缓存把已删除的本地实例重新显示为运行中。
停止提交响应附加 `pending`：明确未提交为 `false`；已提交、重复停止或结果不明为 `true`，前端据此区分解除加载与继续等待。

记录只保存在入口 REST 内存，复用已有任务操作清理周期；模块停止时释放，重启后不恢复或重发。
本功能只覆盖通过同一入口 REST 提交的停止，不同步其他入口或控制台直接发起的停止请求。
部署更新入口 **Web＋REST**，其他节点、Bridge 和核心无需更新；不修改核心停止及自动删除逻辑。
后续验收覆盖多管理员并发、快速连点、刷新和切页、批量停止、自动删除、提交失败、节点离线及 60 秒未确认；本轮不编译或运行测试。

## 配置与运行语义

`minServiceCount` 是整个集群的任务最低运行数量，不是每节点数量；`associatedNodes` 是允许调度的节点列表，
空列表表示全部节点。降低最低数量不会主动缩容，维护模式沿用现有调度逻辑。

常用表单与高级 JSON 共用完整配置草稿。保存调用原有任务／分组 provider，保留原配置的已有字段和 properties。
轮询只更新服务器数据，不覆盖正在编辑的草稿。取消离开编辑页，丢弃本次未保存修改。
模板选择列出入口节点的本地模板；其他存储的关联及 includes、deployments、properties 可通过 JSON 编辑。
此版本不管理模板文件，不修改运行中实例的启动配置。

临时启动只根据永久任务创建实例；指定节点会覆盖本次实例的调度选择，不改永久任务。
返回成功表示实例已创建并提交启动，实际生命周期由实例列表与详情重新读取。
批量创建允许部分成功，失败项显示原因；重试会创建新实例，不会回滚已创建的实例。

## HTTP 接口

接口均位于入口节点同源 `/api/v1`，复用原有 Cookie 会话。
任务和分组的查询、保存、删除，以及 `/local_templates` 继续使用既有接口。
原有实例 GET 操作入口继续兼容；网页使用新的 POST 入口。

| 方法与路径 | 请求 | 返回／行为 |
| --- | --- | --- |
| `GET /metrics` | 无 | `{"nodes":[...]}`；各节点缓存的整机和实例资源指标，详见 [资源指标](METRICS.md) |
| `GET /metrics/history` | `node` 可选；`range=15m/1h/6h/24h`，默认 1h | 节点分钟平均值、峰值及采集设备；保留最近 24 小时 |
| `GET /metrics/services/history` | 必填可重复的 `service=<UUID>`；`range=15m/1h/6h/24h`，默认 1h | 按节点与实例 UUID 返回 TPS、CPU、进程内存、人数的分钟平均值、峰值及有效样本数；保留 24 小时 |
| `GET /metrics/players/history` | `range=15m/1h/6h/24h`，默认 1h | 各节点游戏服总人数及按任务组织的本地人数贡献历史；前端逐分钟汇总任务平均人数，不相加峰值 |
| `GET /console/{type}/{id}/logs` | 无 | `files`：文件标识、相对名称、字节大小和修改时间，按时间倒序 |
| `GET /console/{type}/{id}/logs/{fileId}` | 可选 `cursor` | `lines`、`nextCursor`、`startLine`、`endLine`；默认末尾 500 行 |
| `POST /tasks/{name}/services` | JSON：`{"count":2,"nodeUniqueId":"Node-1"}`；nodeUniqueId 可为 null | `{"results":[{"success":true,"service":{...}},{"success":false,"reason":"..."}]}` |
| `POST /services/{uuid}/{operation}` | 无 | `{"success":true}`；operation 为 start、stop、restart、kill、delete、includeTemplates、includeInclusions、deployResources |
| `POST /services/{uuid}/command` | UTF-8 文本命令 | `{"success":true}`；服务必须正在运行，仅表示已发送 |
| `POST /cluster` | JSON：`{"nodeUniqueId":"Node-2","host":"192.168.1.20","port":1410}` | 以当前用户执行 `cluster add` |
| `DELETE /cluster/{node}` | 无 | 以当前用户执行 `cluster remove` |
| `POST /cluster/{node}/command` | UTF-8 文本命令 | `{"success":true,"receivedMessages":["..."]}` |
| `GET /console/{type}/{id}` | 普通 HTTP | 检查登录与读取权限，返回 `{"success":true}` |
| `GET /console/{type}/{id}` | WebSocket Upgrade | type 为 node 或 service，id 为节点 ID 或实例 UUID |

节点命令返回的 receivedMessages 是提交时已产生的输出；后续异步输出进入节点日志，并通过控制台继续推送。
命令由原有权限发送者判断权限；不会切换为拥有全部权限的 ConsoleCommandSender。

## WebSocket 消息

浏览器使用同源 `ws`／`wss` 建连，握手检查会话、读取权限与 Origin／Host。
反向代理须透传 Host、Origin 和 WebSocket Upgrade；Vite 开发代理已开启 ws，保留原 Host。

服务端消息：

```json
{"type":"snapshot","streamId":"日志流 UUID","firstSequence":1,"sequence":64,"lines":["cached line"]}
{"type":"line","sequence":65,"line":"new line"}
{"type":"state","state":"connected"}
{"type":"error","code":4404,"message":"服务已删除"}
```

序号在所属节点的日志流中递增，快照及其后的增量在同一个订阅中交接。
客户端按序号处理，不按文本去重，连续相同日志均保留。同一日志流重连只追加未接收的缓存；流已重建时重新载入。
断线期间超出后端缓存的部分明确提示到历史文件回看，命令不会重发。
初始缓存使用节点最近 128 条及服务 `maxServiceConsoleLogCacheSize`（默认 64），扩展缓存上限为 1,024 条／4 MiB，先到为准。
前端通过 xterm.js 保留 10,000 行实时滚动缓冲；向上滚动后，新输出与命令回显均不主动跳到底部。

控制台提供“实时／历史”切换。历史模式停止实时订阅，复用控制台读取权限及跨节点通信，入口与目标均检查权限。
节点日志读取 `local/logs`；服务读取其工作目录 `logs`、`.wrapper/logs` 与根目录的 `.log`、`.log.N`、`.log.gz` 文件。
服务端枚举允许的文件标识，拒绝范围外文件。压缩文件流式解压，逐页返回最多 500 行，不将整份文件载入内存。
界面默认显示最新文件末尾一页，可读取更早一页或返回最新；搜索与复制只作用于当前页。历史模式只读，返回实时后恢复命令输入。
文件轮转或截断返回 409，文件或服务删除返回 404，权限不足返回 403，节点不可达／读取失败返回 503；界面保留说明及刷新入口。
不生成日志归档、不改变现有保留策略；临时实例工作目录删除后，其文件历史不再可用。
ANSI 颜色原样显示，节点复用已有彩色格式化器；无颜色的警告／错误按等级高亮，已从磁盘日志移除的原始颜色无法恢复。

浏览器每 15 秒发送文本 `ping` 续订，源节点回复 state。失联订阅在 60 秒后清理，
会话和权限在续订时检查，源节点也定期检查用户读取权限。
切换对象、离开控制台和退出会关闭连接；模块停止清理监听器、订阅和定时任务。

关闭码：4401 为会话／入口权限失效，4403 为源节点读取权限失效，4404 为资源不存在，
4503 为目标不支持新版 REST，4500 为节点或控制台连接中断。普通中断自动重连；不可用状态提供手动重连。
输入的命令不会自动重发。

## 权限

沿用现有 `cloudnet.http.v1.<资源>.<HTTP 方法小写>` 权限命名。

| 权限 | 用途 |
| --- | --- |
| `cloudnet.http.v1.status.get` | 概览与会话恢复 |
| `cloudnet.http.v1.cluster.get` | 节点查询 |
| `cloudnet.http.v1.services.get` | 实例查询 |
| `cloudnet.http.v1.metrics.get` | 当前资源采样及 24 小时节点／服务器／人数汇总历史 |
| `cloudnet.http.v1.tasks.get/post/delete` | 分别授予任务查询、保存、删除 |
| `cloudnet.http.v1.groups.get/post/delete` | 分别授予分组查询、保存、删除 |
| `cloudnet.http.v1.lt.list.get` | 本地模板选择 |
| `cloudnet.http.v1.tasks.services.post` | 临时批量创建并启动 |
| `cloudnet.http.v1.services.operation.get` | 服务实时／历史日志与旧 GET 操作 |
| `cloudnet.http.v1.services.operation.post` | 网页实例操作与服务命令 |
| `cloudnet.http.v1.console.node.get` | 节点实时／历史日志 |
| `cloudnet.http.v1.cluster.post` | 节点加入及指定节点命令 |
| `cloudnet.http.v1.cluster.delete` | 节点移除 |
| `cloudnet.http.v1.players.get` | 全网在线玩家查询 |
| `cloudnet.http.v1.players.operation.post` | 玩家转服、发送消息、踢出，单人和批量共用 |
| `cloudnet.command.cluster` | 加入、移除节点所需的原有命令权限 |

表格中的 `get/post/delete` 是三项独立权限的简写，不是可直接授予的权限字符串。
节点控制台的每条命令还需要对应的原有 CloudNet 命令权限。
跨节点命令与订阅会在目标节点读取当前账号和权限，因此各节点需要有相同账号及相应授权。

## 部署及后续验收

入口节点安装同次构建的 `cloudnet-web.jar`、`cloudnet-rest.jar`；其他被管理节点安装新版 `cloudnet-rest.jar`。
跨节点转发使用现有集群 ChannelMessage，不增加公网端口或浏览器跨域请求。
本次功能不修改核心、驱动、调度规则或序列化协议；已有账号与任务数据沿用。
旧部署是否仍需更新持久会话核心，参见 README 的“持久登录所需的核心升级”。

入口节点还需安装已有 `CloudNet-Bridge 1.2`。玩家接口只在 Web 监听端口提供，详见 [玩家接口与部署](PLAYERS.md)。
本次工作台的真实资源采集需要更新各节点 REST；OSHI、JNA 等依赖由模块加载器下载，详见 [资源指标](METRICS.md)。

Paper 1.12.2 TPS 复用服务快照 `properties` 中的 `TPS-1m`、`TPS-5m`、`TPS-15m`，沿用实例查询权限。
全局、任务、节点内实例列表显示 1 分钟 TPS，服务详情显示 1／5／15 分钟；快照超过 90 秒时隐藏旧值并提示时间。
仅部署 TPS 时，入口更新 Web，运行 Paper 实例的节点更新并加载新版 Bridge，然后重启游戏实例；无需因 TPS 更新 REST、核心或代理。
字段和缺失值口径见 [TPS 接入说明](METRICS.md#paper-1122-tps)。TPS 改动未编译、打包、测试或运行验证。

服务器列表（全局、任务、节点）及工作台顶部增加当前值与 15 分钟迷你折线，当前人数仍可进入玩家名单。
“监控”标签提供四项完整曲线与时间范围，默认工作台继续显示后台和玩家。
服务器历史每 30 秒采样、按分钟聚合，独立于浏览器运行；按实例 UUID 保存，不拼接同名重建实例。
本轮需要入口更新 Web＋REST、其他节点更新 REST；Paper 节点更新 Bridge 并重启实例，使定期上报降为 30 秒。
升级保留 `modules/CloudNet-REST/metrics/`，文件、接口及指标口径见 [服务器历史监控](METRICS.md#服务器历史监控)。
本轮历史监控未编译、打包、测试或运行验证；后续验收包括三处展示、重启恢复、零值与缺失、
UUID 隔离、过期清理、远端失败／权限不足、浅深主题及移动端、轮询不打断原有操作。

本轮分组、大屏、趋势及历史日志改动未编译、打包或运行验证，之前的构建与模拟检查不覆盖这些新增内容。后续验收场景：

- 表单和 JSON 往返编辑，保存后保留高级配置，轮询不覆盖草稿；创建、删除和权限不足正确反馈。
- 最低数量与关联节点语义正确；临时指定节点启动支持部分成功，永久配置保持原值。
- 实例常用操作和更多操作调用对应 provider；删除、强制终止、节点移除显示确认对象。
- 本地与远程服务／节点控制台持续推送，重复文本日志不丢失，上滚暂停跟随，搜索、复制和清空可用。
- 命令沿用账号权限，节点异步输出继续显示；断线重连不重发命令，缺少模块显示不可用。
- 切换对象、离开控制台、退出、模块停止后释放订阅；服务删除、权限撤销和会话失效正确处理。
- 详情深链接、搜索及筛选刷新后保留；桌面和手机的浅深色布局、表单、菜单与控制台可用。
- 分组筛选与汇总排序、单组和全部折叠、浏览器返回恢复；大屏退出及 Esc 返回。
- 24 小时历史恢复、缺失采样断点、IO 计数重置、过期清理；同图分类不同色且轮询不换色。
- 本地／远程普通与压缩日志分页，重复文本保留，文件轮转／删除／权限不足提示，以及命令回显对比度。

## 参考实现资料

- [Expo 设置导航](https://expo.dev/changelog/settings-navigation-refresh)
- [React Router HashRouter](https://reactrouter.com/api/declarative-routers/HashRouter)
- [xterm.js 插件](https://xtermjs.org/docs/guides/using-addons/)
- [CloudNet 任务概念](https://cloudnetservice.eu/de/docs/next/components/tasks/)：外部文档为 v3.5，具体行为以本仓库 v3.4.5 源码为准。

## 本轮性能收尾

实时转发使用专用单工作线程，有界队列最多 1,024 帧／4 MiB，不在日志事件回调中执行网络发送。
每条 WebSocket 消息增加独立 `delivery` 编号；浏览器在 xterm 完成写入后发送 `ack:<delivery>`，状态帧直接确认。
确认逐帧释放缓冲，不与日志 `sequence` 混用；未确认帧、初始化缓冲分别限制为 1,024 帧／4 MiB。
积压或转发失败关闭连接，关闭码 `4504`；页面显示原因并提供手动重连，避免反复自动重连加剧负载。
Web 与 REST 应配套更新，旧网页不会发送确认，达到缓冲上限时会断开；更新后刷新浏览器。
原有 15 秒心跳及命令提交方式保持不变，关闭页面、退出及模块停止会释放缓冲和订阅。

历史日志沿用原有直接读取方案：文件列表及分页接口直接返回结果，默认读取末尾 500 行，通过游标向前翻页。
普通与压缩日志均流式读取；跨节点读取沿用原有 ChannelMessage 查询，不再维护异步读取任务、结果轮询或分页位置索引。

本轮更新入口 Web＋REST，各被管理节点 REST；运行 Paper 的节点还需更新 Bridge 并重启游戏实例。
保留配置、`metrics/` 历史目录和既有日志。这里不修改核心会话功能；先前持久登录改动的部署要求仍见 README。
本轮未编译、打包、测试或运行验证。

实现依据：[Java 8 有界线程池](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ThreadPoolExecutor.html)、
[固定延迟调度](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ScheduledExecutorService.html)、
[xterm.js 接收确认](https://xtermjs.org/docs/guides/flowcontrol/)。


## 任务数量与批量停止

任务管理列表和任务详情提供：

- **临时启动**：复用已有创建弹窗，预选任务，不修改最低数量。
- **设置数量**：只修改 `minServiceCount`；增加后由核心补开，降低不主动停止实例。
- **停止**：包含有玩家的运行实例，保留最低数量，核心可能自动补开。
- **清零并停止**：先保存最低数量 0，确认负责调度的主节点已同步，再逐台提交停止。

停止确认展示任务、实例、节点、在线人数及停止后是否自动删除。后台执行时重新读取运行实例并固定本批名单，
提交每台前再次检查状态；已停止或删除标记 `skipped`。停止调用现有 provider，沿用 `autoDeleteOnStop`，不强制删除保留型实例。
数量修改在执行时读取最新完整任务，只改变最低数量，保留扩展属性、模板等配置。
保存被拒绝、主节点身份变化或同步未确认时，不继续停止；同步确认最长等待约 5 秒，远端查询单次最长 3 秒。
清零不取消核心此前已开始的启动流程，也不追停新实例；部分停止失败不回滚已保存的 0。

| 接口（前缀 `/api/v1`） | 请求及权限 |
| --- | --- |
| `POST /tasks/{name}/minimum-services` | `{ "count": 2 }`；非负整数；`cloudnet.http.v1.tasks.post` |
| `POST /tasks/{name}/stop` | `{ "clearMinimum": false }`；`cloudnet.http.v1.services.operation.post`；true 时还需 `cloudnet.http.v1.tasks.post` |
| `GET /task-operations/{id}` | 仅提交用户读取，且仍需持有原操作权限 |
| `GET /metrics/tasks/history` | 任务资源历史；`cloudnet.http.v1.metrics.get` |

写入返回 HTTP `202` 与 `{ "id": "…" }`。查询返回 `task / action / status / count / minimumSaved / total / results / reason / completedAt`。
`status` 为 `queued / saving / stopping / completed`；`completed` 仅表示本批处理结束，并不表示实例均已关闭。
逐实例结果含 `id / name / node / status / reason`，状态为 `submitted / skipped / not_submitted`。
`minimumSaved` 表示配置已保存；即使后续同步确认或停止失败也不自动回滚。
停止沿用 provider 的异步方法，单台等待提交确认最长 5 秒；超时以 `not_submitted` 返回“未确认，可能已执行”，不会自动重发，应查看实际服务状态。
提交和执行前检查权限，数量同步确认在远端再次检查；用户失去权限后不继续提交剩余操作。

任务 ID 写入 URL 的 `operation`，每秒读取进度；页面切换不取消已跟踪批次。完成后停止轮询、刷新任务与实例，并用 replace 清除该参数，保留其他筛选。
结果留在当前会话的右上角提示中，可展开未提交原因、打开逐实例结果及仍在运行名单；刷新不重播，独立操作不互相覆盖。
失效或无权访问的记录提示一次并清除参数；临时网络错误保留参数以便恢复。关闭网页不会取消服务器上的批次，未完成时返回含任务 ID 的 URL 可继续查看。
返回结果后需读取实际生命周期，不将“已提交”称为“已关闭”。

后台使用独立的 [Java 有界线程池](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ThreadPoolExecutor.html)：2 个工作线程、8 个排队位置，逐批顺序提交实例。
同一入口节点、同一任务的未完成操作返回 `409`，满载返回 `503`，不转交 HTTP 请求线程执行。
完成记录仅保存在入口内存，10 分钟过期、最多 32 批；过期、不同用户或入口重启后返回 `404`。
模块停止会清空排队任务并中断工作线程，不重放剩余操作；已提交核心的生命周期操作继续由核心处理。
这些限制作用于本入口，不对其他入口或原有命令做全局锁定，不修改核心调度。

### 本功能更新与后续验收

入口节点更新同次构建的 Web＋REST，其余节点更新 REST，调度主节点也必须更新 REST 以确认清零同步。
无需因本功能更新 Bridge、核心或代理；已有其他功能的核心／Bridge 更新要求仍见 README。
保留任务配置及 REST 的 `metrics/` 目录，节点重新启动后刷新网页。新资源历史从升级后积累，旧人数历史保留。

本轮未编译、打包、测试或运行验证。后续验收包括：人数上限未知／过期／零值与代理任务；
三处任务表、节点范围和监控 URL；跨节点资源合计、实例重建、旧历史和断点；提高／降低最低数量；
普通停止自动补开、清零同步失败不停止、自动删除及保留型实例；部分失败、权限不足、重复提交、满载、
关页后执行、模块重启不重放；浅深主题、移动布局及悬浮提示。
