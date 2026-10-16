# 玩家管理

玩家页位于 `/#/players`，只展示 Bridge 已同步到入口节点的全网在线玩家，不查询历史玩家数据库。
转服、消息和踢出复用 `IPlayerManager` / `PlayerExecutor` 的现有通信，不修改核心或代理插件。

## 页面与操作

- 按玩家名称／UUID 搜索，按当前服务器、接入代理和当前服务器所属节点筛选；每页 50 人，每 5 秒刷新。
- 搜索、筛选、页码及打开的玩家抽屉保存到 URL；点击玩家姓名打开右侧详情抽屉。
- 抽屉展示完整 UUID、当前服务、代理、任务、节点及已有首次／最近登录时间；服务、代理、任务和节点可跳转现有详情页。
- 勾选支持跨页保留，表头全选当前页可操作玩家；修改搜索或筛选条件时清空选择。
- 刷新不自动加入新的勾选对象；已离线或当前无法通过代理操作的玩家取消选择并显示提示。
- 单人和批量操作共用弹窗，显示人数及可滚动的完整名单；收到结果后自动关闭弹窗，页面保留提交数量及可展开的未提交原因。HTTP 失败时保留输入。
- 服务工作台复用同一份玩家名单和操作组件；“后台”入口携带玩家 UUID，便于定位玩家后继续输入命令。
- 转服只允许选择运行中的 Minecraft 服务，支持按服务名、任务或节点搜索，不提供代理作为转服目标。
- 消息原文直接传给现有 `sendChatMessage`，保留原有消息格式；踢出原因为空时使用现有命令默认值 `no reason given`。
- 未通过代理登录的玩家可查看，但无法勾选或执行上述操作，页面说明原因。

Bridge 的操作接口没有代理执行成功回执。“已提交”只表示请求已发送，不表示已转服、已送达或已踢出。
提交后立即重新读取列表，并继续每 5 秒刷新；实际所在服务器和在线状态以 Bridge 更新为准。
页面不会自动重试操作；提交结果与后续读取的实际连接状态分别展示。

## 接口

以下接口仅由 Web 模块的独立 HTTP 服务提供，默认端口 2813；不增加到原有 REST 监听端口。
复用同源 `/api/v1` 会话保护、Cookie 及 REST 权限检查。

### 查询在线玩家

`GET /api/v1/players`

权限：`cloudnet.http.v1.players.get`。

返回数组，筛选、排序和分页由前端完成：

```json
[
  {
    "uniqueId": "玩家 UUID",
    "name": "Steve",
    "server": {
      "uniqueId": "服务 UUID",
      "name": "Lobby-1",
      "taskName": "Lobby",
      "nodeUniqueId": "Node-1"
    },
    "proxy": {
      "uniqueId": "代理 UUID",
      "name": "Proxy-1",
      "taskName": "Proxy",
      "nodeUniqueId": "Node-2"
    },
    "firstLoginTimeMillis": 1700000000000,
    "lastLoginTimeMillis": 1700001000000
  }
]
```

`server` 在尚未连接 Minecraft 服务时为 null；`proxy` 在没有通过代理登录时为 null。
节点筛选按 `server.nodeUniqueId`，不是代理节点。此接口不返回玩家 IP 或历史记录列表。

### 提交单人／批量操作

`POST /api/v1/players/actions/{action}`

权限：`cloudnet.http.v1.players.operation.post`。
`action` 为 `connect`、`message`、`kick`；Content-Type 为 `application/json`。
单人操作传一个 UUID，批量操作传明确选中的 UUID 列表，不使用全网广播执行器。

```json
{
  "playerIds": ["玩家 UUID"],
  "targetServiceId": "目标服务 UUID"
}
```

- `connect`：传 `targetServiceId`，使用服务 UUID 定位，再调用既有按服务名称连接的方法。
- `message`：传非空 `message`。
- `kick`：可传 `reason`，留空使用上述默认值。

返回示例：

```json
{
  "results": [
    {"uniqueId": "玩家 UUID", "name": "Steve", "status": "submitted"},
    {"uniqueId": "另一个玩家 UUID", "name": null, "status": "not_submitted", "reason": "玩家已离线"}
  ]
}
```

每人提交前重新读取在线状态，并确认通过代理登录；转服时再次确认目标仍在运行且属于 Minecraft 服务。
已在目标服的玩家返回 `not_submitted`，原因为“已在目标服务器”，不会重复发送连接请求。
部分失败不阻止其他玩家提交，逐人结果整体返回 HTTP 200；无效请求、未知操作、空消息或无效目标返回 HTTP 400。
无登录会话／权限沿用 REST 的响应处理，Bridge 玩家管理不可用时返回 HTTP 503。

## 依赖与部署

Web 模块增加编译依赖及模块依赖 `CloudNet-Bridge 1.2`，入口节点必须安装并启动该模块。
没有 Bridge 时 Web 模块不能按依赖正常启动。现有玩家管理需要代理及相关服务正常接入 Bridge。

本功能只需更新入口节点的 `cloudnet-web.jar`，现有 REST、Bridge、核心和代理插件无需因本功能更新。
如果从更早的 Web／REST 部署升级，之前运维功能所需的版本配套要求仍以 README 为准。
已有 `*` 权限覆盖新增接口；需要单独补权时，在 CloudNet 节点控制台执行：

```text
perms user webadmin add permission cloudnet.http.v1.players.get 1
perms user webadmin add permission cloudnet.http.v1.players.operation.post 1
```

转服选择器复用 `/api/v1/services`，还需要原有 `cloudnet.http.v1.services.get` 查询权限。
这里直接调用玩家 executor，不依赖控制台命令接口，也不额外要求 `cloudnet.command.players`。

## 后续验收场景

已完成 Web／REST 编译打包，未运行测试套件；本地模拟数据用于浏览器样式与交互检查，真实 Bridge 操作仍需部署验收。

- 全网不同节点／代理的玩家各显示一次；当前服务器、代理及节点含义正确，无玩家时显示空状态。
- 搜索、三项筛选、50 人分页、URL 恢复和右侧抽屉正常；浅深色及移动端保持可用。
- 翻页保留 UUID 勾选，表头全选只作用于当前页；修改筛选清空选择，刷新不新增选择，离线后提示取消。
- 单人及批量转服、发送消息、踢出调用原有 executor；确认后关闭弹窗，页面可展开未提交原因。
- 未经代理登录、提交前离线、目标已停止、玩家已在目标服及部分失败均正确反馈。
- 提交不直接标记执行成功、不乐观修改玩家所在服或在线状态；后续通过 Bridge 数据刷新展示实际变化。
- 无读取权限、无操作权限、无服务查询权限、会话失效及 Bridge 停止时显示相应错误。

参考：[CloudNet 3.4 玩家管理](https://cloudnetservice.eu/docs/3.4/commands/players/)。
