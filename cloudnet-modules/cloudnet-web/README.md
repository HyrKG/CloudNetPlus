# CloudNet-Web

适配本仓库 CloudNet 3.4.5 的中文运维控制台。React 页面、图标及字体随 `cloudnet-web.jar` 分发，
由 Web 模块的独立 HTTP 服务提供，运行时无需 Node.js、Nginx 或外部字体服务。

## 功能

- CloudNet 账号登录、会话恢复及退出。
- 集群概览、节点 CPU 与内存、服务生命周期分布。
- 服务名称搜索、节点与状态筛选、启动／停止／重启。
- 实例详情与缓存日志。状态每 5 秒刷新，打开详情时日志每 2 秒刷新。

内存显示：节点快照的内存字段按 MiB 读取；服务进程堆内存由字节转换为 MiB／GiB。
CPU 字段沿用 CloudNet 的百分比值。没有快照或指标不可用时显示 `—`。

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

1. 在目标节点安装同次构建的 `cloudnet-rest.jar`（模块名 `CloudNet-REST`，模块版本 `1.0`）。
2. 将构建的 `cloudnet-web.jar` 放入该节点的 `modules` 目录；从旧版升级时，需要同时替换这两个 JAR。
3. 重启节点。
4. 在节点本机访问 `http://127.0.0.1:2813/`，使用有 REST 权限的 CloudNet 账号登录。

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

### 账号权限

按现有 CloudNet 权限管理方式，为使用控制台的账号配置所需权限：

| 权限 | 功能 |
| --- | --- |
| `cloudnet.http.v1.status.get` | 状态与概览 |
| `cloudnet.http.v1.cluster.get` | 节点查询 |
| `cloudnet.http.v1.services.get` | 服务列表与详情 |
| `cloudnet.http.v1.services.operation.get` | 启停重启及读取缓存日志 |

概览需要前三项权限。操作及日志接口在当前 REST 中共用最后一项权限，控制台沿用这一行为。
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
- 回退：停止节点，恢复对应版本的 Web 和 REST 模块，重新启动。
- 卸载：停止节点，移除 `cloudnet-web.jar`，重新启动；REST 模块可继续保留。

运行中的 Web 模块被停止时，会关闭其独立 HTTP 服务并清理该服务中的处理器。
本模块不新增数据库、独立会话或数据迁移。

## 交付状态与后续验收

交付源码、配置及依赖锁文件。安装用 JAR 由上述 Gradle 命令生成；打包不包含节点运行或浏览器验收。

后续可按以下场景验收：

- 模块加载后独立端口的 `/`、JS、CSS 和字体可访问，未知资源返回 404，停止模块后关闭该端口。
- 正确密码、错误密码、会话失效、退出、资源权限不足分别展示对应状态。
- 节点和服务数据、内存单位、CPU、生命周期与 REST 返回内容一致。
- 搜索和筛选生效，点击节点可查看该节点的服务，服务详情可打开和关闭。
- 启停重启后重新读取服务状态，请求期间禁用操作按钮。
- 状态和日志按约定周期更新，切换页面、关闭详情及退出时取消对应请求与轮询。
- 移动端导航可折叠，指标卡单列，服务表格可横向滚动，字体无外部网络依赖。
