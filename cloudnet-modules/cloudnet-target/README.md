# CloudNet-Target

独立的任务目标数量模块，依赖 CloudNet-Bridge。启用目标后联动 `minServiceCount`，
补服继续由核心负责；模块仅关闭超过目标的空服，无需 Smart。

## 配置

将以下字段合并到 `local/tasks/<任务名>.json`，保留任务的其他属性：

```json
{
  "minServiceCount": 2,
  "properties": {
    "targetServiceCount": 2
  }
}
```

- `targetServiceCount` 缺省或为 `-1`：停用目标功能，不改变当前最低数量。
- `targetServiceCount >= 0`：最低数量同步为目标；`0` 会逐步关闭全部空服。
- 停用不会恢复启用前的最低数量，而是保留最后值；之后可单独调整最低数量。
- 任务保存、模块启动和主节点每秒巡检会补齐联动值。直接编辑文件后使用 `tasks reload`。
- 任务维护期间，核心暂停补服，模块暂停缩容。

数量统计为整个集群的 `RUNNING` 实例数。核心沿用原有预备实例复用、节点选择和资源限制。
缩容只处理 Bridge 确认为已连接、已上线且在线人数为零的实例，缺少人数信息不视为空服。
从任务编号最大的空服开始，每个任务同时最多提交一次停止；实际停止、删除或重新准备后再处理下一台。
提交前重读任务和实例状态；停止通过现有 provider，沿用 `autoDeleteOnStop` 与静态文件规则。
停止结果未确认时保留等待状态，不继续关闭其他实例，应查看节点日志和实际服务状态。

## 部署与网页

构建入口为 `:cloudnet-modules:cloudnet-target:jar`，独立产物为 `cloudnet-target.jar`，不加入 Launcher 默认模块包。
将模块安装到所有节点的模块目录，并安装 Bridge。服务端需要 Bridge 上报在线人数。
更新所有节点 REST 以及入口 Web，刷新浏览器；本方案不使用 Smart 的自动数量规则。
新模块只扩展任务属性，复用已有持久化和集群同步，不修改核心、Driver 或通信协议。
卸载模块会停止缩容，核心仍按最后保存的最低数量补服。

网页任务操作中的“设置目标数量”支持 `-1` 至 `2147483647` 的整数。
原“设置最低数量”移入 More；启用目标时禁用，配置表单也显示联动提示。
“清零并停止”同时清零已启用的目标，并确认主节点已同步最低数量和目标状态后再提交停止。
此手动操作仍包含有玩家的实例；自动目标缩容只选择空服。

REST：`POST /api/v1/tasks/{name}/target-services`，请求 `{ "count": 2 }`，
权限 `cloudnet.http.v1.tasks.post`，返回 `202` 与操作 ID。
沿用 `/api/v1/task-operations/{id}` 查询，`action` 为 `target`，`targetSaved` 表示目标已保存，
不表示实例数量已经达到目标。关闭网页不影响模块调节。

## 实现依据

- [CloudNet v3.4 任务文档](https://cloudnetservice.eu/docs/3.4/components/tasks/)：任务属性扩展、最低数量与停止后删除规则。
- 本仓库 `CloudNetTick`、`ServiceTaskAddEvent`、`BridgeServiceProperty.IS_EMPTY`、服务 provider 及 REST `TaskOperations`。

2026-10-16 已使用 JDK 11 编译并打包 Target、REST、Web，Web 的 TypeScript 检查与 Vite 构建通过。
Bridge 的旧依赖仓库无法解析，构建复用了本地已有且本次未修改的 Bridge 编译产物。
未新增或执行测试，未进行游戏运行环境验证。
