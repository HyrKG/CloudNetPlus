import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRightLeft, ChevronLeft, ChevronRight, MessageSquare, Search, Terminal, Users, UserX } from 'lucide-react';
import { api } from './api';
import { Button, Dialog, EmptyState, Message, PageHeading } from './components';
import { serviceName } from './format';
import type { OnlinePlayer, PlayerAction, PlayerServiceReference, ServiceSnapshot } from './types';
import { resourceUrl, useData, useNotice, useOperation, useServiceOperations } from './workspace';

import { playersFor } from './fleet';

const pageSize = 50;
const actionLabels: Record<PlayerAction, string> = { connect: '转服', message: '发送消息', kick: '踢出' };
const actionIcons = { connect: ArrowRightLeft, message: MessageSquare, kick: UserX };
const noServices = async (_signal: AbortSignal): Promise<ServiceSnapshot[]> => [];
const loginTime = (value: number) => value > 0 ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';

function PlayerActions({ disabled = false, compact = false, onAction }:
  { disabled?: boolean; compact?: boolean; onAction: (action: PlayerAction) => void }) {
  return <div className="heading-actions player-actions">{(Object.keys(actionLabels) as PlayerAction[]).map(action => {
    const Icon = actionIcons[action];
    return <Button key={action} className={compact ? 'button-small' : ''} disabled={disabled}
      onClick={() => onAction(action)}>{!compact && <Icon size={15} />}{actionLabels[action]}</Button>;
  })}</div>;
}

function ServiceLink({ service }: { service: PlayerServiceReference | null }) {
  return service ? <Link to={resourceUrl('services', service.uniqueId)}>{service.name}</Link> : <>—</>;
}

export function PlayersPage({ service }: { service?: ServiceSnapshot }) {
  const poll = useData(api.players);
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionNotice, setSelectionNotice] = useState('');
  const [action, setAction] = useState<{ kind: PlayerAction; players: OnlinePlayer[] } | null>(null);
  const selectPage = useRef<HTMLInputElement>(null);
  const located = useRef('');
  const highlightedRow = useRef<HTMLTableRowElement>(null);
  const scrolledPlayer = useRef('');
  const searchKey = service ? 'playerSearch' : 'q';
  const pageKey = service ? 'playerPage' : 'page';
  const q = params.get(searchKey) || '';
  const server = params.get('server') || '';
  const proxy = params.get('proxy') || '';
  const node = params.get('node') || '';
  const playerId = params.get('player');
  const filterKey = JSON.stringify([q, server, proxy, node]);
  const players = service ? playersFor(poll.data ?? [], [service]) : poll.data ?? [];
  const filtered = players.filter(player => {
    const search = q.trim().toLowerCase();
    return (!search || player.name.toLowerCase().includes(search) || player.uniqueId.toLowerCase().includes(search))
      && (!server || player.server?.uniqueId === server) && (!proxy || player.proxy?.uniqueId === proxy)
      && (!node || player.server?.nodeUniqueId === node);
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) || a.uniqueId.localeCompare(b.uniqueId));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const requestedPage = Number(params.get(pageKey) || 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(pageCount, requestedPage) : 1;
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selectable = visible.filter(player => player.proxy);
  const allSelected = selectable.length > 0 && selectable.every(player => selected.has(player.uniqueId));
  const selectedPlayers = players.filter(player => selected.has(player.uniqueId));
  const openedPlayer = players.find(player => player.uniqueId === playerId);
  const servers = new Map(players.flatMap(player => player.server ? [[player.server.uniqueId, player.server] as const] : []));
  const proxies = new Map(players.flatMap(player => player.proxy ? [[player.proxy.uniqueId, player.proxy] as const] : []));
  const nodes = Array.from(new Set(players.flatMap(player => player.server?.nodeUniqueId ? [player.server.nodeUniqueId] : []))).sort();

  useEffect(() => { setSelected(new Set()); setSelectionNotice(''); }, [filterKey]);
  useEffect(() => {
    if (!poll.data) return;
    const current = new Map(players.map(player => [player.uniqueId, player]));
    const offline = Array.from(selected).filter(id => !current.has(id));
    const unsupported = Array.from(selected).filter(id => current.has(id) && !current.get(id)!.proxy);
    if (offline.length || unsupported.length) {
      setSelected(previous => new Set(Array.from(previous).filter(id => current.get(id)?.proxy)));
      setSelectionNotice([offline.length ? `${offline.length} 名玩家已离线或离开当前服务器` : '',
        unsupported.length ? `${unsupported.length} 名玩家当前未通过代理登录` : ''].filter(Boolean).join('，') + '，已取消选择。');
    }
  }, [poll.data, selected]);
  useEffect(() => {
    if (selectPage.current) selectPage.current.indeterminate = !allSelected && selectable.some(player => selected.has(player.uniqueId));
  }, [allSelected, selectable, selected]);
  useEffect(() => {
    if (!poll.data) return;
    if (params.has(pageKey) && String(page) !== params.get(pageKey)) {
      setParams(previous => { const next = new URLSearchParams(previous); next.set(pageKey, String(page)); return next; }, { replace: true });
    }
  }, [poll.data, page, params, setParams]);
  useEffect(() => {
    if (!service || !playerId || !poll.data || located.current === playerId) return;
    const index = filtered.findIndex(player => player.uniqueId === playerId);
    if (index < 0) return;
    located.current = playerId;
    if (!params.has(pageKey)) setParams(previous => {
      const next = new URLSearchParams(previous); next.set(pageKey, String(Math.floor(index / pageSize) + 1)); return next;
    }, { replace: true });
  }, [playerId, poll.data, service, params, pageKey, setParams, filtered]);
  useEffect(() => {
    const row = highlightedRow.current;
    if (!service || !playerId || scrolledPlayer.current === playerId || !row?.offsetParent) return;
    const container = row.closest('.table-scroll');
    if (container) {
      container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - 40;
      scrolledPlayer.current = playerId;
    }
  }, [playerId, page, poll.data, service, params]);

  function filter(key: string, value: string) {
    setSelected(new Set()); setSelectionNotice('');
    setParams(previous => {
      const next = new URLSearchParams(previous);
      value ? next.set(key, value) : next.delete(key); next.delete(pageKey); return next;
    }, { replace: true });
  }
  function toggle(id: string, checked: boolean) {
    setSelected(previous => { const next = new Set(previous); checked ? next.add(id) : next.delete(id); return next; });
  }
  function openPlayer(id: string | null) {
    setParams(previous => { const next = new URLSearchParams(previous); id ? next.set('player', id) : next.delete('player');
      if (service && id) next.set('playerDetail', '1'); else next.delete('playerDetail'); return next; });
  }
  function turnPage(value: number) {
    setParams(previous => { const next = new URLSearchParams(previous); next.set(pageKey, String(value)); return next; });
  }

  return <div className={service ? "embedded-players" : "players-page"}>{!service && <PageHeading title="玩家管理" actions={<span className="count-badge"><Users size={14} /> {poll.data ? players.length : '—'} 人在线</span>} />}
    <Message>{poll.error}</Message><Message kind="info">{selectionNotice}</Message>
    <section className="panel"><div className="service-filters player-filters"><label className="search-field"><Search size={16} />
      <input type="search" aria-label="搜索玩家名称或 UUID" placeholder="搜索玩家名称或 UUID" value={q} onChange={event => filter(searchKey, event.target.value)} /></label>
      {!service && <div className="filter-selects"><select aria-label="当前服务器" value={server} onChange={event => filter('server', event.target.value)}>
        <option value="">全部服务器</option>{server && !servers.has(server) && <option value={server}>{server}</option>}
        {Array.from(servers.values()).sort((a, b) => a.name.localeCompare(b.name)).map(service => <option key={service.uniqueId} value={service.uniqueId}>{service.name}</option>)}</select>
        <select aria-label="接入代理" value={proxy} onChange={event => filter('proxy', event.target.value)}><option value="">全部代理</option>
          {proxy && !proxies.has(proxy) && <option value={proxy}>{proxy}</option>}
          {Array.from(proxies.values()).sort((a, b) => a.name.localeCompare(b.name)).map(service => <option key={service.uniqueId} value={service.uniqueId}>{service.name}</option>)}</select>
        <select aria-label="服务器所属节点" value={node} onChange={event => filter('node', event.target.value)}><option value="">全部节点</option>
          {node && !nodes.includes(node) && <option value={node}>{node}</option>}{nodes.map(id => <option key={id}>{id}</option>)}</select></div>}
    </div>
      {selected.size > 0 && <div className="player-selection"><span>已选 <strong>{selectedPlayers.length}</strong> 人（跨页保留）</span>
        <Button variant="ghost" className="button-small" onClick={() => setSelected(new Set())}>取消选择</Button>
        <PlayerActions disabled={!selectedPlayers.length || Boolean(poll.error)} compact onAction={kind => setAction({ kind, players: selectedPlayers })} /></div>}
      {poll.loading ? <EmptyState loading /> : visible.length ? <div className="table-scroll"><table className="service-table player-table"><thead><tr>
        <th className="player-checkbox"><input ref={selectPage} type="checkbox" aria-label="全选当前页可操作玩家" disabled={!selectable.length}
          checked={allSelected} onChange={event => {
            const checked = event.target.checked;
            setSelected(previous => { const next = new Set(previous); selectable.forEach(player => checked ? next.add(player.uniqueId) : next.delete(player.uniqueId)); return next; });
          }} /></th><th>玩家</th>{!service && <><th>当前服务器 / 任务</th><th>接入代理</th><th>服务器节点</th></>}<th className="align-right">操作</th>
      </tr></thead><tbody>{visible.map(player => <tr key={player.uniqueId} ref={playerId === player.uniqueId ? highlightedRow : undefined} className={playerId === player.uniqueId ? "player-highlight" : undefined}>
        <td className="player-checkbox"><input type="checkbox" aria-label={`选择 ${player.name}`} disabled={!player.proxy} title={player.proxy ? undefined : '未通过代理登录，无法执行玩家操作'}
          checked={selected.has(player.uniqueId)} onChange={event => toggle(player.uniqueId, event.target.checked)} /></td>
        <td><button className="service-name player-name" onClick={() => openPlayer(player.uniqueId)}><span><strong>{player.name}</strong>
          {!service && <small className="mono" title={player.uniqueId}>{player.uniqueId.slice(0, 8)}…</small>}</span></button></td>
        <>{!service && <><td><ServiceLink service={player.server} />{player.server && <Link className="cell-secondary" to={resourceUrl('tasks', player.server.taskName)}>{player.server.taskName}</Link>}</td><td>{player.proxy ? <ServiceLink service={player.proxy} /> : <span className="text-secondary">未通过代理登录</span>}</td>
        <td>{player.server?.nodeUniqueId ? <Link to={resourceUrl('nodes', player.server.nodeUniqueId)}>{player.server.nodeUniqueId}</Link> : '—'}</td></>}</>
        <td><div className="table-actions">{!service && player.server && <Link className="button button-small button-secondary" to={`${resourceUrl('services', player.server.uniqueId)}?view=console&player=${player.uniqueId}`}><Terminal size={13} />后台</Link>}<PlayerActions compact disabled={!player.proxy || Boolean(poll.error)} onAction={kind => setAction({ kind, players: [player] })} /></div></td>
      </tr>)}</tbody></table></div> : <EmptyState title={poll.error && !poll.data ? '玩家数据暂不可用' : players.length ? '没有匹配的在线玩家' : '暂无在线玩家'} />}
      <div className="table-footer player-pagination"><span>匹配 {filtered.length} / {players.length} 人 · 每页 {pageSize} 人</span><div>
        <Button className="button-small" aria-label="上一页" disabled={page <= 1} onClick={() => turnPage(page - 1)}><ChevronLeft size={14} /></Button>
        <span>{page} / {pageCount}</span><Button className="button-small" aria-label="下一页" disabled={page >= pageCount} onClick={() => turnPage(page + 1)}><ChevronRight size={14} /></Button>
      </div></div></section>
    {playerId && (!service || params.get('playerDetail') === '1') && <Dialog title={openedPlayer?.name || '玩家详情'} placement="right" onClose={() => openPlayer(null)}>
      <div className="detail-body"><Message>{poll.error}</Message>{openedPlayer ? <>
        <div className="player-online"><span className="status-dot" />在线</div>
        <dl className="detail-fields player-fields"><div><dt>玩家名称</dt><dd>{openedPlayer.name}</dd></div><div><dt>UUID</dt><dd>{openedPlayer.uniqueId}</dd></div>
          <div><dt>当前服务器</dt><dd><ServiceLink service={openedPlayer.server} /></dd></div>
          <div><dt>服务器所属任务</dt><dd>{openedPlayer.server ? <Link to={resourceUrl('tasks', openedPlayer.server.taskName)}>{openedPlayer.server.taskName}</Link> : '—'}</dd></div>
          <div><dt>接入代理</dt><dd><ServiceLink service={openedPlayer.proxy} /></dd></div>
          <div><dt>服务器所属节点</dt><dd>{openedPlayer.server?.nodeUniqueId ? <Link to={resourceUrl('nodes', openedPlayer.server.nodeUniqueId)}>{openedPlayer.server.nodeUniqueId}</Link> : '—'}</dd></div>
          <div><dt>首次登录</dt><dd>{loginTime(openedPlayer.firstLoginTimeMillis)}</dd></div><div><dt>最近登录</dt><dd>{loginTime(openedPlayer.lastLoginTimeMillis)}</dd></div></dl>
        {!openedPlayer.proxy && <p className="field-hint">该玩家未通过代理登录，无法转服、发送消息或踢出。</p>}
        <PlayerActions disabled={!openedPlayer.proxy || Boolean(poll.error)} onAction={kind => setAction({ kind, players: [openedPlayer] })} />
        {openedPlayer.server && <Link className="button button-secondary" to={`${resourceUrl('services', openedPlayer.server.uniqueId)}?view=console&player=${openedPlayer.uniqueId}`}>进入所在服务器后台</Link>}
      </> : <EmptyState loading={poll.loading} title={poll.error ? '玩家数据暂不可用' : '玩家已离线或不存在'} description={playerId} />}</div>
    </Dialog>}
    {action && <PlayerActionDialog key={action.kind + action.players.map(player => player.uniqueId).join(',')}
      action={action.kind} players={action.players} onClose={() => setAction(null)} onSubmitted={poll.refresh} />}
  </div>;
}

function PlayerActionDialog({ action, players, onClose, onSubmitted }:
  { action: PlayerAction; players: OnlinePlayer[]; onClose: () => void; onSubmitted: () => void }) {
  const services = useData(action === 'connect' ? api.services : noServices);
  const operation = useOperation();
  const [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState('');
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const notify = useNotice();
  const { pending } = useServiceOperations();
  const targets = (services.data ?? []).filter(service => service.lifeCycle === 'RUNNING'
    && !service.webOperation && pending[service.configuration.serviceId.uniqueId]?.operation !== 'stop'
    && ['MINECRAFT_SERVER', 'GLOWSTONE', 'NUKKIT', 'GO_MINT'].includes(service.configuration.serviceId.environment))
    .sort((a, b) => serviceName(a).localeCompare(serviceName(b), 'zh-CN', { numeric: true }));
  const target = targets.find(service => service.configuration.serviceId.uniqueId === targetId);
  const matches = targets.filter(service => `${serviceName(service)} ${service.configuration.serviceId.taskName} ${service.configuration.serviceId.nodeUniqueId}`
    .toLowerCase().includes(search.trim().toLowerCase()));
  const canSubmit = action === 'connect' ? Boolean(target) && !services.error : action === 'message' ? Boolean(message.trim()) : true;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    void operation.run(signal => api.playerAction(action, { playerIds: players.map(player => player.uniqueId),
      ...(action === 'connect' ? { targetServiceId: targetId } : action === 'message' ? { message } : { reason }) }, signal),
    value => {
      const submitted = value.results.filter(item => item.status === 'submitted').length;
      notify(`${actionLabels[action]}：已提交 ${submitted} 人 · 未提交 ${value.results.length - submitted} 人`,
        value.results.filter(item => item.status !== 'submitted').map(item => `${item.name || item.uniqueId}：${item.reason || '未提交'}`));
      onSubmitted(); onClose();
    }, '');
  }
  return <Dialog title={`${actionLabels[action]} · ${players.length} 名玩家`} onClose={() => { if (!operation.busy) onClose(); }}>
    <form className="detail-body player-action-form" onSubmit={submit}>
      <fieldset className="configuration-fields" disabled={operation.busy}>
        <div className="player-recipient-list" aria-label="操作玩家名单">{players.map(player => <div key={player.uniqueId}>
          <strong>{player.name}</strong><span>{player.server?.name || '尚未连接服务器'}</span><small className="mono">{player.uniqueId}</small>
        </div>)}</div>
        {action === 'connect' ? <><label className="search-field player-target-search"><Search size={16} />
          <input type="search" aria-label="搜索目标服务器" placeholder="搜索服务器、任务或节点" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <Message>{services.error}</Message><div className="player-targets" role="radiogroup" aria-label="目标服务器">
            {services.loading ? <EmptyState loading /> : matches.length ? matches.map(service => {
              const id = service.configuration.serviceId;
              const current = players.length === 1 && players[0].server?.uniqueId === id.uniqueId;
              return <label key={id.uniqueId}><input type="radio" name="targetService" value={id.uniqueId} checked={targetId === id.uniqueId}
                disabled={current} onChange={() => setTargetId(id.uniqueId)} /><span><strong>{serviceName(service)}{current && '（当前服务器）'}</strong>
                  <small>{id.taskName} · {id.nodeUniqueId}</small></span></label>;
            }) : <EmptyState title={services.error ? '目标服务器暂不可用' : '没有匹配的运行中服务器'} />}</div>
          <p className="player-operation-summary">转移 {players.length} 名玩家至 <strong>{target ? serviceName(target) : '请选择服务器'}</strong></p>
          {targetId && !target && <Message>所选目标已停止或不可用，请重新选择。</Message>}</>
          : <div className="form-grid"><label className="field-wide">{action === 'message' ? '发送内容' : '踢出原因（可选）'}
            <textarea rows={4} required={action === 'message'} value={action === 'message' ? message : reason}
              placeholder={action === 'message' ? '输入发送给玩家的消息' : '留空使用现有默认原因'}
              onChange={event => action === 'message' ? setMessage(event.target.value) : setReason(event.target.value)} /></label></div>}
      </fieldset>
      <Message>{operation.error}</Message>
      <div className="form-actions"><Button onClick={onClose} disabled={operation.busy}>取消</Button>
        <Button type="submit" variant="primary" busy={operation.busy} disabled={!canSubmit}>确认{actionLabels[action]}</Button></div>
    </form></Dialog>;
}
