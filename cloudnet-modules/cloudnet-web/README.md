# CloudNet-Web

适配本仓库 CloudNet 3.4.5 的中文运维控制台。React 页面、图标及字体随 `cloudnet-web.jar` 分发，
由 Web 模块的独立 HTTP 服务提供，运行时无需 Node.js、Nginx 或外部字体服务。

2026-10-16 交互修复已完成本地模拟浏览器检查及 Web / REST 构建；以 [检查记录](UI-CHECKS.md) 为准。
随后新增的目标数量功能已于 2026-10-16 完成 Target、REST、Web 编译打包，Web 的 TypeScript 检查与 Vite 构建通过。
本次复用了已有 Bridge 编译产物，未运行测试或游戏环境验证；构建详情见 [Target 说明](../cloudnet-target/README.md)。

## 功能

- CloudNet 账号登录、会话恢复及退出。
- 紧凑运行概览与一键大屏：CPU、内存、磁盘及网络趋势，玩家／内存／实例状态占比，任务与节点明细。
- 运行概览增加节点、任务在线人数折线图，每个对象一条曲线；支持时间范围、图例隐藏和 URL 恢复，汇总历史保留 24 小时。
- 任务与服务器合并为一个入口：任务分组默认展开，支持零实例任务、筛选汇总、折叠与 URL 恢复；实例展示玩家／容量、TPS、实际 CPU、进程内存及配置额度。
- 任务操作使用单行图标栏，停止确认窗提供普通停止和清零并停止；配置、监控、删除收纳到更多菜单。旧任务详情与列表链接继续可用。
- 任务主按钮提供“设置目标数量”；最低数量移入 More，目标启用时由目标联动控制。“清零并停止”同时清零已启用的目标数量。
- 服务工作台将实时控制台与玩家名单同屏展示，支持从任务或玩家直接定位后台。
- 服务器 TPS、CPU、进程内存、人数保留 24 小时历史；列表和顶部显示当前值与迷你折线，“监控”标签展示完整趋势。
- 节点实际 CPU／系统内存、各服务资源占比图；任务汇总资源与扩容参考，临时启动显示额度预估。
- 任务与分组管理：常用表单、高级 JSON、模板关联、最低运行数量及关联节点。
- 任务／实例名称搜索，任务、类型、节点与状态筛选；启动／停止／重启及更多实例操作。
- 停止按钮即时显示红色进度，同入口管理员共享停止状态；单实例及任务批量停止统一去重，超过 60 秒未确认时保留提示和禁用状态。本项需更新入口 Web＋REST。
- 操作完成后自动清理进度 URL，刷新不重复通知；独立操作结果保留各自明细。共用弹窗区分遮罩点击与拖选，临时启动收到结果后关闭，失败输入保留。检查记录见 [交互检查](UI-CHECKS.md)。
- 独立资源详情页，URL 保留筛选条件，支持收藏、刷新及前进后退。
- 按任务与指定节点临时启动多个实例；节点加入及移除。
- 服务与节点彩色控制台：实时订阅、清晰命令回显，以及普通／压缩历史日志文件分页回看。
- 全网在线玩家管理：搜索筛选、分页、详情抽屉，单人及跨页勾选批量转服、发送消息、踢出。
- 浅色／深色手动切换，首次默认浅色，刷新或退出登录后保留当前浏览器的选择。
- 操作结果和请求错误在右上角悬浮显示，不挤占页面；成功消息 6 秒后关闭，错误与部分未提交原因可手动关闭。
- 折线图提示保持在图表旁，以独立浮层显示时间、分钟平均值和峰值，避免表格与摘要卡片裁剪或干扰排版。

服务、节点及玩家每 5 秒共享刷新，资源与任务配置每 30 秒刷新，控制台使用实时订阅。功能语义、接口、权限、跨节点部署及后续验收场景见
[运维功能与接口](OPERATIONS.md)。本轮服务器历史与折线图仅完成代码和文档，未编译、打包、测试或运行验证；此前构建产物不包含本轮改动。

玩家页的接口、操作语义及权限见 [玩家管理](PLAYERS.md)。Web 模块现在同时依赖入口节点的
`CloudNet-REST 1.0` 与 `CloudNet-Bridge 1.2`。资源采集及历史日志升级需要入口更新 Web＋REST、其余节点更新 REST。
目标数量功能需各节点安装独立 [CloudNet-Target 模块](../cloudnet-target/README.md) 与 Bridge、更新 REST，入口更新 Web。
目标为 `-1` 时停用，为 `0` 时逐步关闭空服；停用保留最后的最低数量，维护期间暂停自动调节。
Paper 1.12.2 TPS 需要运行游戏实例的节点另行更新 Bridge 并重启对应实例；入口更新 Web。
仅接入实时 TPS 无需更新 REST、核心或代理，三组 TPS 的字段与更新步骤见 [TPS 接入说明](METRICS.md#paper-1122-tps)。
本轮服务器历史需要入口更新 Web＋REST，其他被管理节点更新 REST；已部署 TPS Bridge 时不必再次更新 Bridge。
节点／任务人数趋势同样需要入口更新 Web＋REST、其他节点更新 REST，无需因人数趋势更新 Bridge。
汇总历史从升级后开始积累，保存至 `modules/CloudNet-REST/metrics/players/`，升级时保留此目录。
人数口径、接口及后续验收见 [在线人数汇总历史](METRICS.md#节点与任务在线人数历史)。本轮人数趋势未编译、打包、测试或运行验证。

实际资源由各节点 OSHI 采集，配置额度与真实用量分别展示。CPU 以整机为 100%，内存显示 MiB／GiB；
采集不可用或过期时显示 `—` 和原因。指标口径、接口及扩容边界见 [资源指标](METRICS.md)。
节点分钟历史保存在 `modules/CloudNet-REST/metrics/`，服务器历史位于其 `services/<实例 UUID>/` 子目录，
均查询最近 24 小时；升级时保留这些数据目录。展示与接口见 [服务器历史监控](METRICS.md#服务器历史监控)。已有日志保留策略不变。

## 页面主题

登录页右上角和后台顶部刷新按钮前提供主题切换按钮：月亮切换至深色，太阳切换至浅色。
首次默认浅色，不跟随系统设置。主题偏好通过
[localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) 保存为
`cloudnet-web-theme=light|dark`，仅作用于当前浏览器及站点，不增加账号配置或接口。
刷新、重新打开页面及退出登录均保留选择，清除站点存储后恢复默认浅色。

页面在首屏显示前应用保存的主题；切换时同步更新根元素的 `data-theme`、
[color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme) 和浏览器栏的 `theme-color`。
所有页面、表单、状态提示及服务详情共用主题变量，日志面板始终使用深色背景。
主题切换不重新挂载业务页面，不修改登录、筛选、弹窗、日志和轮询状态。

此功能只涉及前端，发布时重新构建并替换 `cloudnet-web.jar` 即可；无需再次更新核心、驱动或 REST 模块。
深色模式已通过 Web 模块构建（包含 TypeScript 检查及 Vite 打包），未进行运行时验收。

## 从源码打包

构建环境：项目原有 JDK／Gradle 环境，以及 Node.js 22.12+、npm；`node` 和 `npm` 必须在 PATH 中。
Java 模块保持 Java 8 源码及字节码兼容，沿用仓库的 Gradle Wrapper 7.3.2。

在仓库根目录执行：

```powershell
.\gradlew.bat :cloudnet-modules:cloudnet-web:jar
```

Linux／macOS：

```sh
./gradlew :cloudnet-modules:cloudnet-web:jar
```

Gradle 自动串联 `installFrontend` → `buildFrontend` → `processResources` → `jar`：

1. 用 `npm ci` 根据 `frontend/package-lock.json` 安装依赖。
2. 用 TypeScript 检查源码类型并由 Vite 构建到模块的 `build/web`。
3. 将页面资源放到 JAR 的 `web/` 目录。

构建任务声明输入输出，输入不变时由 Gradle 跳过相应任务；任何步骤失败都会终止后续打包。
执行仓库整体构建也会构建此模块，因此整体构建机器同样需要 Node.js／npm。

产物位置：

```text
cloudnet-modules/cloudnet-web/build/libs/cloudnet-web.jar
```

## 安装

1. 在目标节点安装配套 `cloudnet-rest.jar`（模块名 `CloudNet-REST`，版本 `1.0`），并安装现有 `CloudNet-Bridge 1.2`。
2. 将构建的 `cloudnet-web.jar` 放入该节点的 `modules` 目录；从旧版升级时，需要同时替换这两个 JAR。
3. 重启节点。
4. 在节点本机访问 `http://127.0.0.1:2813/`，使用有 REST 权限的 CloudNet 账号登录。

实时管理其他节点时，在这些节点安装同次构建的新版 `cloudnet-rest.jar`，并同步使用账号与权限；
Web 模块只需安装在入口节点。反向代理需透传 Host、Origin 及 WebSocket Upgrade。

Web 模块独立监听端口，页面直接挂载 `/`，API 在同一端口的 `/api/v1` 提供，复用现有 REST 处理器及会话。
节点原有 HTTP 监听配置 `httpListeners` 保持原样，Web 模块不再向原有端口注册页面。
模块停止时关闭其独立 HTTP 服务。Web 模块不自动下载 REST 模块，模块依赖由 CloudNet 加载器处理。

首次启动自动生成 `modules/CloudNet-Web/config.json`：

```json
{
  "host": "127.0.0.1",
  "port": 2813
}
```

修改该配置后重启节点生效。需要其他电脑访问时，将 `host` 改为 `0.0.0.0`，然后访问 `http://节点IP:2813/`。

登录复用 CloudNet 权限系统中的账号密码。用户名和密码经现有 Basic 登录接口换取 Cookie 会话，
密码不写入本地存储；前端不维护独立用户、令牌或权限系统。

### 保持登录

浏览器保存 `CloudNet-REST_V1-Session` Cookie，连续 30 天未访问接口才过期；
已认证的接口请求会重新签发凭证，并将有效期顺延 30 天。刷新页面、重开普通浏览器窗口或重启节点后，
前端继续通过现有状态接口恢复登录，不需要保存密码。

会话实现位于 CloudNet 核心，由原有 REST 服务与 Web 模块共用。
凭证使用 [java-jwt](https://github.com/auth0/java-jwt) 的 HS256 签名，包含用户 UUID、签发时间、过期时间及签发者，
不包含密码或权限；每次请求仍读取现有账号和权限。
Cookie 设置 `Path=/`、`HttpOnly` 和 `Max-Age=2592000`（秒），符合
[Set-Cookie 定义](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)。
页面及静态资源请求不会将请求 Cookie 自动写回响应。

首次加载 REST 处理器时，核心生成 256 位随机密钥并保存到节点工作目录的 `local/http-session.json`：

```json
{
  "signingKey": "自动生成的 Base64 密钥"
}
```

后续启动读取同一文件，不保存会话列表或新增数据库表。保留该文件并随节点数据一起备份；
删除、更换密钥或清除浏览器 Cookie 后，需要重新登录。密钥文件损坏时不会自动覆盖生成新密钥。
首次从旧会话实现升级需要重新登录一次；默认仅支持同一节点的会话恢复。

退出会用 `Max-Age=0` 清除当前浏览器的 Cookie。已经复制出去的凭证不会立即撤销，
仍可在有效期内使用；更换签名密钥会使该节点此前签发的凭证全部失效。

### 持久登录所需的核心升级

**仅替换 `cloudnet-web.jar` 或 `cloudnet-rest.jar` 不会更新核心会话实现。**
需要同时部署本次源码对应的核心、驱动及依赖清单。以下为打包命令，本说明不代表已执行打包：

```powershell
.\gradlew.bat :cloudnet:jar :cloudnet-driver:jar
```

停止节点后，将以下文件替换到实际启用的 `launcher/versions/<版本>/` 目录，保留 `local/`：

| 构建产物 | 目标文件 |
| --- | --- |
| `cloudnet/build/libs/cloudnet.jar` | `cloudnet.jar` |
| `cloudnet/build/libs/cloudnet.cnl` | `cloudnet.cnl` |
| `cloudnet-driver/build/libs/driver.jar` | `driver.jar` |
| `cloudnet-driver/build/libs/driver.cnl` | `driver.cnl` |

保留已适配的 Web 与 REST 模块。启动器会根据更新的 CNL 清单安装 `java-jwt` 及其运行依赖，
因此不能遗漏清单。使用本仓库定制版本时，`launcher.cnl` 中保持以下设置，避免启动时覆盖定制文件：

```text
var cloudnet.launcher.dev-mode false
var cloudnet.auto-update false
var cloudnet.snapshots.use-snapshots false
```

重新启动节点后登录一次，后续重启复用该 Cookie 和密钥文件。回退核心时需同时恢复对应的驱动和 CNL 清单，
并重新登录；无需删除密钥文件。

### 账号权限

按现有 CloudNet 权限管理方式，为使用控制台的账号配置所需权限：

| 权限 | 功能 |
| --- | --- |
| `cloudnet.http.v1.status.get` | 状态与概览 |
| `cloudnet.http.v1.cluster.get` | 节点查询 |
| `cloudnet.http.v1.services.get` | 服务列表与详情 |
| `cloudnet.http.v1.metrics.get` | 整机与实例实际资源 |
| `cloudnet.http.v1.tasks.get` | 任务运行汇总 |
| `cloudnet.http.v1.players.get` | 在线玩家与实例人数 |
| `cloudnet.http.v1.services.operation.get` | 服务实时日志、缓存日志及兼容的旧 GET 操作 |
| `cloudnet.http.v1.services.operation.post` | 网页实例操作与服务命令 |

概览需要状态、节点、服务、资源、任务和玩家读取权限；已有 `*` 覆盖新增权限。其他操作权限见 [完整权限表](OPERATIONS.md#权限)。
REST 返回 403 时页面展示缺少的权限；会话失效时返回登录页。
停止服务时，如果该实例启用了 `autoDeleteOnStop`，实例可能随后从列表中移除，沿用 CloudNet 本身的行为。

## 前端开发

在 `cloudnet-modules/cloudnet-web/frontend` 目录执行：

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

打开 Vite 输出的根地址（通常为 `http://localhost:5173/`）。
Vite 将 `/api` 转发到 `.env.local` 中的 `CLOUDNET_API_TARGET`，默认 `http://127.0.0.1:2813`。
该变量仅用于开发代理；安装后的页面直接请求同源 API，不需要另外配置接口地址。

仅构建前端可执行 `npm run build`，产物写入 `../build/web`。正式模块构建由 Gradle 自动完成这些步骤。
字体通过 Fontsource 包导入，图标由 Lucide React 提供，均由 Vite 打包为本地资源。

## 更新、回退与卸载

- 更新：停止节点，替换同次构建的 `cloudnet-web.jar` 和 `cloudnet-rest.jar`，重新启动。
- 本次持久登录涉及核心更新，首次升级还需按上文同步替换核心、驱动及 CNL 清单；保留 `local/http-session.json`。
- 回退：停止节点，恢复对应版本的 Web 和 REST 模块，重新启动。
- 卸载：停止节点，移除 `cloudnet-web.jar`，重新启动；REST 模块可继续保留。

运行中的 Web 模块被停止时，会关闭其独立 HTTP 服务并清理该服务中的处理器。
本模块不新增数据库、独立会话或数据迁移。

## 交付状态与后续验收

交付源码、配置及依赖锁文件。安装用 JAR 由上述 Gradle 命令生成；打包不包含节点运行或浏览器验收。

后续可按以下场景验收：

- 登录页和后台均可切换浅色／深色；切换后刷新、重开浏览器或退出登录仍保留选择，首次访问默认浅色。
- 深色首屏无闪白，页面、表格、输入框、状态提示、原生控件及详情弹窗配色一致，日志维持深色。
- 服务详情打开或设置筛选条件后切换主题，弹窗、筛选与日志继续保留；移动端切换入口始终可见。
- 模块加载后独立端口的 `/`、JS、CSS 和字体可访问，未知资源返回 404，停止模块后关闭该端口。
- 正确密码、错误密码、会话失效、退出、资源权限不足分别展示对应状态。
- 登录后刷新、重开浏览器及重启节点能恢复登录；接口请求将 Cookie 有效期顺延 30 天。
- 过期、篡改凭证或删除用户后拒绝访问，权限变更继续生效；退出后刷新页面不能恢复登录。
- 页面及静态资源响应不覆盖登录 Cookie；登录、续期和退出响应只包含一个同名 Cookie。
- 节点和服务数据、内存单位、CPU、生命周期与 REST 返回内容一致。
- 搜索和筛选生效，点击节点可查看该节点的服务，服务详情可打开和关闭。
- 启停重启后重新读取服务状态，请求期间禁用操作按钮。
- 状态按约定周期更新，控制台实时推送日志；切换页面、对象及退出时取消请求、轮询与订阅。
- 移动端导航可折叠，指标卡单列，服务表格可横向滚动，字体无外部网络依赖。

## 运维扩展降频收尾

本轮只调整 Web／REST／TPS Bridge 扩展：资源采样与刷新 30 秒，服务／节点／玩家状态读取 5 秒，历史读取 60 秒，指标过期阈值 90 秒。
入口更新 Web＋REST，各被管理节点更新 REST；Paper 节点更新 Bridge 并重启对应游戏实例。保留配置及 REST 的 `metrics/` 目录，更新后刷新网页。
历史日志沿用原有直接读取与游标分页方案；实时控制台保留接收确认和积压上限，Web／REST 需要配套部署。
本节不替代前述持久登录的核心部署说明。详见 [指标口径](METRICS.md#采样降频与隔离) 和 [日志限制](OPERATIONS.md#本轮性能收尾)。
本轮未执行编译、打包、测试或运行验证。


## 服务器容量与任务运行管理

服务器和任务人数增加“在线／容量”；任务表增加最低数量、人数／进程内存／CPU 迷你折线及任务监控页。
任务管理和详情提供临时启动、设置数量、停止、清零并停止。后台批次最多同时 2 批、排队 8 批，页面关闭后继续处理，
结果保留 10 分钟；已提交与实际停止状态分别展示。详见 [操作接口与权限](OPERATIONS.md#任务数量与批量停止) 和 [任务历史口径](METRICS.md#服务器容量与任务资源历史)。

本功能更新入口 Web＋REST、其他节点 REST（含调度主节点），无需再次更新 Bridge。保留 REST 历史目录。
本节不替代既有持久登录核心升级和前一轮 Bridge 降频的部署说明。本轮仅修改代码及文档，未编译、打包、测试或运行验证。
