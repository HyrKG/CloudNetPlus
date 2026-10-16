# 资源指标与扩容参考

## 数据来源

各节点 REST 使用 OSHI 6.8.3，每 30 秒采集本机资源并缓存；入口通过现有 ChannelMessage 查询各节点缓存。
单个节点未连接、未安装新版 REST 或采集失败，不阻断其他节点返回。模块停止时释放采集任务和监听器。
服务、节点、玩家在前端共享每 5 秒轮询，资源与任务配置每 30 秒刷新；各接口错误独立展示，编辑草稿不会被轮询覆盖。

| 指标 | 口径 |
| --- | --- |
| 节点 CPU | 整机逻辑 CPU 总容量为 100%，相邻采样间的使用率 |
| 服务 CPU | 进程相邻采样 CPU 时间，除以节点逻辑 CPU 数；与节点 CPU 使用相同分母 |
| 任务 CPU | 各实例 CPU 百分比 × 所属节点逻辑 CPU 数 ÷ 100，合计已用逻辑核 |
| 系统内存 | 总内存、可用内存，以及两者之差；单位字节 |
| 进程内存 | Linux RSS；Windows 为 OSHI 提供的私有工作集；单位字节 |
| JVM 堆 | 沿用实例 ProcessSnapshot 的堆已用和堆上限，与进程驻留内存分别展示 |
| 运行配置额度 | RUNNING 实例配置的 maxHeapMemorySize 之和，单位 MiB，非真实内存占用 |
| 预留额度 | 全部实例的配置内存之和，单位 MiB，不再从运行额度中重复扣除 |
| 配置上限 | 节点 maxMemory，单位 MiB，非机器物理总内存 |
| 玩家 | 服务器按当前连接统计，代理按接入统计；全网、任务及节点汇总按 UUID 去重 |
| TPS | Paper 公开 API 返回的最近 1／5／15 分钟 TPS，显示两位小数；不按任务求和或平均 |
| 磁盘 IO | OSHI 返回磁盘设备的累计读／写字节差值，除以实际采样间隔，再按节点求和；B/s |
| 网络 IO | 非本地网卡累计接收／发送字节差值，除以实际采样间隔，再按节点求和；B/s，包含节点间通信 |

Linux 进程 RSS 包含共享页面，多个进程之和不等于系统已用内存。节点的两张环形图只表示已采样服务之间的相对占比，
各自展示前六项及“其他”，同一服务颜色一致；整机用量另用使用条显示。完整服务明细在下方表格。

首次采样没有 CPU 差值时返回 `-1`；未获得指标、采集失败或采样超过 90 秒时显示 `—` 和原因，
过期数据注明原采样时间。不以未知值代替零，不用过期指标给出扩容结论。

## Paper 1.12.2 TPS

游戏实例中的 Bridge 通过 Paper 的公开 `Server.getTPS()` 读取最近 1／5／15 分钟 TPS。
保持现有 Spigot 编译依赖，运行时缓存方法句柄；不访问 NMS，不增加插件或依赖。
读取发生在现有服务快照生成流程，Bukkit 现有周期任务约每 30 秒发布一次快照，不依赖玩家进出或 MOTD 变化。
周期任务随插件停止而取消；游戏严重卡顿时 Bukkit 调度也可能延迟，页面按快照时间判断是否过期。

现有 `GET /api/v1/services` 和 `GET /api/v1/services/{uuid}` 的 `properties` 增加三个可选数字字段：

```json
{
  "TPS-1m": 20.0,
  "TPS-5m": 19.85,
  "TPS-15m": 19.92
}
```

沿用 `cloudnet.http.v1.services.get` 权限，无需新增接口或 REST 改动，也不使用 OSHI 的指标接口。
字段与已有 GoMint 的 `TPS` 分开；接口不支持、读取失败或数值无效时省略相应字段，不保留上次 TPS。
服务器列表（含任务、节点内实例）在玩家数旁显示 1 分钟 TPS；服务器详情顶部显示三组数值。
直接显示采集值，不裁剪为 20；真实零值显示 `0.00`。
服务未运行、尚未上报或不支持时显示 `—`；有 TPS 的快照超过 90 秒未更新时显示 `—`，提示“数据已过期”及快照时间。
TPS 历史由下述服务器监控保存，不增加 MSPT、告警、排序或任务 TPS 汇总。

仅更新 TPS 功能时：入口更新 Web，运行 Paper 实例的节点更新并加载新版 Bridge，再重启对应游戏实例。
现有 `CloudServicePreStartEvent` 注入流程会将新版 `cloudnet-bridge.jar` 放入实例插件目录。
无需因 TPS 更新 REST、核心或代理；若此前分组、资源趋势及历史日志版本尚未部署，仍按对应功能要求更新 REST。

本次只修改代码和文档，未编译、打包、测试或运行验证。后续验收：三组数值与 Paper 对应；无玩家活动时持续更新；
全局／任务／节点／详情展示一致；旧 Bridge、非 Paper、停止实例和过期快照显示缺失状态；浅深主题和手机布局可用，
轮询不打断控制台输入或日志回看。

接口依据：[Paper 1.12.2 Server.getTPS()](https://jd.papermc.io/paper/1.12.2/org/bukkit/Server.html#getTPS--)。

## 概览与历史趋势

概览提供普通工作台与“大屏”切换，大屏隐藏导航并放大图表，退出按钮或 Esc 返回。时间范围、节点、隐藏曲线保存在 URL。
节点 CPU 和内存分别显示分钟曲线；磁盘读／写、网络收／发分别使用实线／虚线。同一节点在四张图中保持同色。
CPU 摘要按有效节点逻辑核数加权，内存与配置额度按有效节点求和，均显示覆盖节点数。
玩家分布只统计当前服务器所属任务，按 UUID 去重；代理接入不重复计入。进程内存分布与整机物理用量分开展示。

`GET /api/v1/metrics` 新增 `memoryPercent`、`diskReadBytesPerSecond`、`diskWriteBytesPerSecond`、
`networkReceiveBytesPerSecond`、`networkSendBytesPerSecond`、`diskDevices`、`networkInterfaces` 及对应 IO 不可用原因。
新增设备或计数器重置后的首个区间返回 -1，不计算负速率。设备 IO 失败不影响 CPU／内存采样；页面注明实际统计设备。
网卡使用 OSHI `getNetworkIFs(false)`，排除回环／无硬件地址的本地接口；汇总为设备口径，不代表公网带宽。

`GET /api/v1/metrics/history?range=1h&node=Node-1` 沿用 `cloudnet.http.v1.metrics.get`。
`node` 省略时读取全网；`range` 支持 `15m`、`1h`、`6h`、`24h`，默认 `1h`。
返回 `generatedAt` 和 `nodes`，每个节点包含 `points`；每个点为：

```json
{
  "time": 1780000020000,
  "values": {
    "cpuPercent": {"average": 25.1, "peak": 34.2, "samples": 2},
    "diskReadBytesPerSecond": {"average": 1048576, "peak": 2097152, "samples": 2}
  },
  "devices": {"diskDevices": ["disk0"], "networkInterfaces": ["eth0"]}
}
```

节点每 30 秒采样，只将节点 CPU、内存及 IO 聚合为分钟平均值／峰值／有效样本数，不保存实例快照。
每分钟写入 REST 数据目录 `metrics/<小时起点毫秒>.json`，模块正常停止时保存当前分钟，恢复时继续同一分钟的汇总。
查询仅返回最近 24 小时，整小时过期文件自动清理；小时边界文件可能包含不足一小时的额外数据，但不会返回范围外采样。
运行中的当前分钟会返回已有采样；骤停最多丢失尚未刷盘的当前分钟。保存失败通过 `historyReason` 说明。
前端每分钟读取历史，时间轴补空白而不补零。未采集到的字段省略，完全没有有效采样的分钟不产生点。

## 服务器历史监控

全局、任务、节点内的服务器列表及工作台顶部均显示“当前值＋最近 15 分钟迷你折线”。
当前人数保留进入玩家列表的入口，点击折线进入 `#/services/{uuid}/monitor?range=15m`。
详情新增“监控”标签，默认最近 1 小时，可选择 15 分钟、1 小时、6 小时、24 小时；
时间范围与隐藏的 TPS 曲线保存在 URL。监控页桌面两列、手机单列；默认工作台仍显示控制台与玩家。
原有概览和节点占比图保留，任务分组不汇总 TPS。

各节点 REST 复用现有 30 秒采集任务，为本机运行中的实例记录：

| 历史字段 | 来源与单位 |
| --- | --- |
| `TPS-1m`、`TPS-5m`、`TPS-15m` | Bridge 快照中的 Paper 滚动 TPS，保留采集值，不裁剪至 20；非瞬时 TPS |
| `cpuPercent` | 现有 OSHI 进程 CPU，以所属机器全部逻辑核合计为 100% |
| `residentMemoryBytes` | 现有进程驻留内存，字节；与 JVM 堆、配置额度分别展示 |
| `Online-Count` | Bridge 实例快照中的在线人数，游戏服为本服人数，代理为接入人数 |

TPS 与人数只采纳未超过 90 秒的运行实例快照；CPU、内存按各自实际采样结果记录。
某项缺失、不支持、数值无效或过期，不阻止其他有效指标保存；真实零值正常记录。
历史按分钟保存 `average`、`peak`、`samples`，显示分钟平均值，悬浮查看峰值和时间。
没有有效采样的分钟留空，折线不跨空白连接。当前分钟包含已采集的有效样本。
TPS 完整图显示三条固定颜色曲线，可通过图例切换；列表和顶部缩略图只显示 1 分钟 TPS。
人数曲线明确标为“分钟平均在线人数”，允许小数；当前人数仍由现有玩家接口提供整数，
玩家名单、单人／批量操作及统计去重方式不变。两者是不同时间和来源的读数。

历史保存在 `modules/CloudNet-REST/metrics/services/<实例 UUID>/<小时起点毫秒>.json`，
沿用节点历史的分钟落盘、停止刷盘、启动恢复及 24 小时清理机制；骤停可能丢失当前未落盘分钟。
普通服务重启沿用 UUID，保留历史；删除重建产生新 UUID，即使名称相同也不会拼接历史。
停止或删除实例的历史文件继续按保留期限清理，不增加已删除实例的浏览页面。
文件读取、保存或清理失败通过 `historyReason` 展示；没有升级前的实例历史可供补录。

### 批量历史接口

`GET /api/v1/metrics/services/history?service=<UUID>&service=<UUID>&range=1h`

- `service` 必填，可重复指定；未提供或 UUID 无效返回 400。
- `range` 支持 `15m`、`1h`、`6h`、`24h`，默认 `1h`，查询不超过最近 24 小时。
- 权限为 `cloudnet.http.v1.metrics.get`，原有 `*` 覆盖；Cookie 会话与远端权限检查继续沿用。
- 返回 `generatedAt`、`from`、`to`、`step: 60000` 和 `nodes`。
- 每个节点返回 `nodeUniqueId`、`status`、可选 `reason`／`historyReason` 及 `services`。
  `services` 以该节点已有历史的所请求实例 UUID 为键，各项含 `points` 和可选 `historyReason`；
  每个点的 `time`、`values[field].average/peak/samples` 结构与节点历史相同。
- 单个节点不可达、没有权限或未更新 REST 时单独返回原因，其他节点仍返回有效结果。

前端按展示实例批量读取，每批最多 64 个 UUID 以控制 URL 长度；分组共用结果，折叠组不查询或绘图。
服务状态、玩家和 TPS 快照每 5 秒读取，资源每 30 秒读取，历史每分钟刷新；同一详情内监控页选择 15 分钟时复用顶部历史请求。
复用现有 [Recharts Line](https://recharts.github.io/en-US/api/Line/) 绘制节点、服务器及迷你折线，不增加前端依赖。

### 更新与后续验收

入口更新 Web＋REST，其他被管理节点更新 REST；保留整个 `modules/CloudNet-REST/metrics/` 数据目录。
本轮将 TPS 定期上报也降至 30 秒，运行 Paper 的节点需要更新 Bridge 并重启游戏实例；此前版本的快照字段保持兼容。
不需要更新核心或增加监控插件。本轮服务器历史仅修改代码和文档，未编译、打包、测试或运行验证。

后续验收：三处指标和人数入口、时间范围与图例恢复、零值与缺失断点、无玩家活动时上报、
同 UUID 重启恢复与同名新 UUID 隔离、24 小时清理、远端失败与权限不足、批量查询和分组折叠、
浅深主题与窄屏布局、轮询不打断控制台输入及日志回看。

## 节点与任务在线人数历史

运行概览的资源趋势下方提供两张折线图，普通模式、大屏和手机共用：

- 节点在线人数：每个节点一条线，只合计 `isMinecraftServer()` 的运行实例人数，不叠加代理，纯代理节点为 0。
- 任务在线人数：每个任务一条线，合计所有节点上该任务的全部实例人数；代理任务表示接入人数。
- 共用独立时间范围 `playerRange=15m|1h|6h|24h`，默认 1h；`hiddenPlayerNode`、`hiddenPlayerTask` 为可重复的隐藏图例参数，不受资源趋势的 `node` 筛选影响。
- 曲线是分钟平均人数，保留一位小数；节点提示包含平均值及总人数峰值，任务提示只有平均值。图例颜色在轮询时保持稳定。

每个节点在现有 30 秒采样中，先合计当次本地总人数，再复用 `MetricsHistory` 保存分钟 `average`、`peak`、`samples`。
人数采集不依赖 OSHI 成功；只采纳 RUNNING 且快照不超过 90 秒的有效非负 `Online-Count`。
某实例字段缺失、无效或过期，会跳过该次对应任务汇总；如果是游戏服，同时跳过该次节点汇总。
已知没有运行实例的节点或当前已配置任务记录真实 0；不能根据缺失字段推断为 0。
同一任务的实例删除重建不会删除汇总历史。任务删除后不再补零，尚在运行的实例仍贡献到其原任务；旧历史保留到过期。

数据目录：

```text
modules/CloudNet-REST/metrics/players/node/<小时起点毫秒>.json
modules/CloudNet-REST/metrics/players/tasks/<任务名 UTF-8 小写十六进制编码>/<小时起点毫秒>.json
```

复用现有按分钟落盘、正常停止刷盘、启动恢复和 24 小时过期清理；升级保留整个目录。
编码复用现有 Guava BaseEncoding，避免任务名称直接成为路径或在 Windows 上产生大小写路径冲突，不增加依赖。
新汇总只从升级后积累，不回填以前的实例历史；骤停可能丢失尚未落盘的当前分钟。

### 人数历史接口

`GET /api/v1/metrics/players/history?range=1h`

- 时间范围与其他历史接口一致，权限仍是 `cloudnet.http.v1.metrics.get`；使用 Cookie 会话，远端通过现有 ChannelMessage 再次检查权限。
- 顶层返回 `generatedAt`、`from`、`to`、`step: 60000` 及 `nodes`。
- 各节点返回 `nodeUniqueId`、`status`、`sampledAt`、节点汇总 `points` 和按任务名组织的 `tasks`；每个任务包含 `points` 和可选 `historyReason`。
- 点结构为 `{time, values: {"Online-Count": {average, peak, samples}}}`；无有效样本的分钟省略。节点返回的任务值仅为本地贡献。
- `reason` 表示连接、权限或版本不可用；`historyReason` 表示文件恢复、保存或清理问题；`samplingReason` 表示最近人数采样缺失、过期或失败。`sampledAt` 只表示汇总执行时间，不保证所有汇总均有效。
- 未升级 REST 的节点独立返回不可用原因，不妨碍其他节点返回历史。

前端每分钟只请求一次，两张图共享响应。按各返回节点同一分钟的有效贡献相加得到任务平均人数；
缺少任一节点的任务贡献时保留断点，并说明数据不完整。当前已配置任务在无本地实例的节点记录 0，
因此只有有依据的零参与合计。历史按当前集群节点集合查询，新增节点尚无历史、节点不可达或节点任务配置不同步时，
对应任务分钟可能无法形成完整合计；不将缺失节点忽略后显示为总人数。
不同节点的采样时刻并不完全同步，任务曲线表示各节点分钟平均值之和，不代表同一瞬间人数。
各节点峰值可能发生在不同时间，因此不相加展示跨节点任务峰值。
缺失分钟使用现有 [Recharts Line 的 connectNulls=false](https://recharts.github.io/en-US/api/Line/) 保留断点。
请求错误显示右上角悬浮消息，图内保留采样缺失和覆盖说明。

### 更新与后续验收

入口更新 Web＋REST，其余被管理节点更新 REST；本功能无需更新 Bridge、核心或代理。
本轮仅修改代码与文档，不执行编译、打包、测试或运行验证。
后续验收覆盖：跨节点任务求和、代理排除与代理任务、真实零值、过期快照、缺失节点、实例删除重建、
重启恢复、已删除任务过期清理，以及浅深主题、手机、大屏、长图例、URL 恢复和悬浮提示排版。

## 接口与权限

`GET /api/v1/metrics`，权限 `cloudnet.http.v1.metrics.get`，复用 Cookie 会话；入口和远端均检查当前账号权限。
已有 `*` 覆盖此权限。单独补权：

```text
perms user webadmin add permission cloudnet.http.v1.metrics.get 1
```

返回结构：

```json
{
  "nodes": [{
    "nodeUniqueId": "Node-1",
    "status": "available",
    "sampledAt": 1780000000000,
    "logicalCpuCount": 16,
    "cpuPercent": 25.0,
    "totalMemoryBytes": 68719476736,
    "availableMemoryBytes": 45097156608,
    "usedMemoryBytes": 23622320128,
    "runningConfiguredMemoryMb": 32768,
    "reservedMemoryMb": 36864,
    "maxMemoryMb": 49152,
    "maxCpuPercent": 90,
    "services": {
      "实例 UUID": {"pid": 1234, "cpuPercent": 2.5, "residentMemoryBytes": 2147483648}
    }
  }]
}
```

不可用节点返回 `nodeUniqueId`、`status: "unavailable"`、`reason`、`sampledAt: 0`，不附零值资源。
实例采样失败时，其指标为 `-1` 并附 `reason`；进程刚启动时内存仍可用，CPU 需下一次采样。
原 REST 的节点／实例字段含义不变，接口结构也见 REST 模块的 `openapi/v1-openapi.yml`。

## 扩容计算

任务详情按可调度节点列出本任务实例、玩家、内存和已用 CPU 核，同时展示机器余量及配置额度。
任务关联节点为空表示全部节点；临时启动明确指定节点时，按该节点显示本次预估。计算沿用 `DefaultCloudService.checkEnoughResources` 的启动限制：

```text
当前 CPU < 节点启动阈值
运行实例配置额度 + 新实例配置额度 < 节点配置上限
最多可新增 = max(0, ceil((配置上限 - 运行配置额度) / 单实例配置内存) - 1)
```

例如运行配置 32 GiB、上限 48 GiB、单实例 4 GiB，最多新增 3 台；第 4 台恰好达到上限，不能通过严格小于的启动检查。
CPU 达到阈值时显示 0；指标缺失或过期时显示 `—`。

临时启动随任务、节点、数量变化显示新增配置和启动后额度。自动调度时，每行是假设全部实例进入该节点的参考，
最终仍由现有创建工厂逐台选点并启动。物理可用内存和 CPU 单独供判断，这个数字不保证实际承载能力，
也不改变任务最低数量、调度或核心启动规则。

## 部署与检查范围

节点资源采集、IO 及历史趋势需要入口更新 Web＋REST，其余被管理节点更新 REST；核心、驱动和代理无需因资源采集升级。
TPS 还需运行 Paper 实例的节点更新 Bridge 并重启游戏实例，更新步骤见上方 TPS 章节。
REST 的 module.json 声明 OSHI 6.8.3、JNA／JNA Platform 5.17.0、SLF4J API 2.0.17，模块加载器负责安装依赖。
Java 源码和依赖保持 Java 8 兼容，宿主为直接运行的 Linux／Windows。

本轮新增 IO、历史曲线、大屏及图表颜色改动未编译、打包或运行验证。真实 PID／IO 采集、跨节点查询、
历史恢复、权限不足及 Bridge／控制台指令效果需后续验收。升级时保留 `modules/CloudNet-REST/metrics/` 及已有日志目录。

参考：[OSHI 6.8.3 OSProcess](https://github.com/oshi/oshi/blob/oshi-parent-6.8.3/oshi-core/src/main/java/oshi/software/os/OSProcess.java)、
[Recharts PieChart](https://recharts.github.io/en-US/api/PieChart/)。
IO 接口：[OSHI HWDiskStore](https://raw.githubusercontent.com/oshi/oshi/oshi-parent-6.8.3/oshi-core/src/main/java/oshi/hardware/HWDiskStore.java)、
[OSHI 网卡范围](https://raw.githubusercontent.com/oshi/oshi/oshi-parent-6.8.3/oshi-core/src/main/java/oshi/hardware/HardwareAbstractionLayer.java)。

## 采样降频与隔离

本轮 REST 固定延迟 30 秒采样，Bridge 的新增定期快照上报为 30 秒；玩家进出及原有 MOTD 变更上报保持原行为。
资源及 TPS／人数快照的有效期统一为 90 秒，核心节点心跳和在线判定保持原值。
一分钟通常约 2 个有效样本，`samples` 返回实际数量；`peak` 仅为采样中的最大值，不能反映两次采样之间的瞬时峰值。
CPU、IO 表示实际采样间隔内的平均负载／速率，降频会降低对短时尖峰的分辨率。

历史恢复、分钟落盘、文件清理及停止刷盘由 REST 专用采样线程完成；HTTP 和跨节点历史查询只读内存。
文件写入不持有查询锁。停止时取消采样，最多等待 5 秒；剩余刷盘由原工作线程结束时完成，避免并发写文件。
采样异常保留下一轮重试，不修改核心调度、服务启动或心跳协议。图表时间选择、图例、历史时间轴和刷新常量共用；
玩家归属、任务、节点资源在共享数据层建立索引，四项实例迷你图复用同一份分钟数据。

本轮仅完成代码和文档，未编译、打包、测试或运行验证。


## 服务器容量与任务资源历史

服务器人数显示“当前在线／上限”，在线人数仍读取玩家接口，上限读取已有 Bridge 快照的 `Max-Players`。
任务在线人数按玩家 UUID 去重，上限只合计当前运行实例；任一上限缺失、非负整数校验失败或快照超过 90 秒时，整个上限显示 `—`。
明确没有运行实例的任务显示 `0/0`，读取服务列表失败时不推断零容量。代理任务使用接入人数及各代理上报的容量。
`Max-Players` 是实例上报容量，不是去重玩家数或可扩容实例数。来源见 [Paper getMaxPlayers](https://jd.papermc.io/paper/1.12.2/org/bukkit/Server.html#getMaxPlayers--)。

任务、概览和节点内任务表显示最低数量及人数、进程内存、CPU 的当前值与最近 15 分钟迷你折线。
点击迷你图进入任务“监控”页并预选 15 分钟；直接打开默认 1 小时，可选 15 分钟、1／6／24 小时。
节点内入口携带 `node`，仅显示该节点贡献，可切回全部节点。时间范围写入 URL。

沿用 `metrics/players/tasks/<任务名 UTF-8 小写十六进制>/<小时毫秒>.json`，同一份任务历史增加：

| 字段 | 口径 |
| --- | --- |
| `Online-Count` | 本节点该任务运行实例的快照人数合计，代理按接入人数；分钟平均允许小数 |
| `residentMemoryBytes` | 本节点该任务运行实例的实际进程内存合计，单位字节 |
| `cpuCores` | 各进程整机 CPU 百分比 × 当次逻辑 CPU 数 ÷ 100，再求和，单位逻辑核 |

每 30 秒先按节点、任务汇总，再保存分钟 `average / peak / samples`，保留 24 小时。
某个指标缺失时只跳过该指标；已知没有运行实例的已配置任务记录真实 0。
人数沿用 90 秒快照有效期，进程资源来自当次采集。旧文件继续可读，新资源字段从升级后积累；实例删除重建不切断任务历史。
跨节点曲线仅在各必要节点均有该分钟有效贡献时合计平均值，不相加本地峰值。
单节点图可以显示该节点的分钟峰值；集群图只显示平均值。缺失节点、旧 REST 或无有效样本保留断点。

`GET /api/v1/metrics/tasks/history?task=Game&task=Lobby&range=1h&node=Node-1`
批量返回 `nodes / generatedAt / from / to / step`，每个节点含 `nodeUniqueId / status / reason / tasks`。
`tasks` 以任务名称为键，值含 `points` 和可选 `historyReason`；各点的 `values` 使用上述三个字段。
`task` 必填且可重复，`node` 可省略，`range` 默认 `1h`。沿用 `cloudnet.http.v1.metrics.get`，跨节点再次检查权限。
前端按当前任务表批量查询并每分钟更新，三个迷你图共享响应；已有在线人数趋势共用任务历史汇总方法。
原 `/metrics/players/history` 仍仅返回人数字段。

本功能入口更新 Web＋REST，其他节点更新 REST，不需要再次更新已有 TPS Bridge；保留 `metrics/` 目录。
本轮仅修改代码和文档，未执行编译、打包、测试或运行验证。
