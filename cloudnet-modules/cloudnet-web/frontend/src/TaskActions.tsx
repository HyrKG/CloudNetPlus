import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ellipsis, Hash, Square } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { api, ApiError, errorMessage } from './api';
import { Button, Dialog, EmptyState, Message, MoreMenu, useNotice, useNotifications } from './components';
import { serviceName } from './format';
import { useFleet } from './fleet';
import { LaunchServices } from './operations';
import type { Configuration } from './types';
import { Confirm, resourceUrl, useData, useOperation } from './workspace';

export function TaskActions({ task, compact = false, onDeleted }: { task: Configuration; compact?: boolean; onDeleted?: () => void }) {
  const [action, setAction] = useState<'launch' | 'minimum' | 'stop' | 'delete' | null>(null);
  const [count, setCount] = useState('0');
  const [, setParams] = useSearchParams();
  const fleet = useFleet();
  const operation = useOperation();
  useEffect(operation.clearError, [action, operation.clearError]);
  const running = (fleet.index.tasks.get(task.name) ?? []).filter(service => service.lifeCycle === 'RUNNING');
  const close = () => { if (!operation.busy) setAction(null); };
  function submit(clearMinimum = false) {
    void operation.run(signal => action === 'minimum' ? api.setTaskMinimum(task.name, Number(count), signal)
      : api.stopTask(task.name, clearMinimum, signal), result => {
      setAction(null);
      setParams(previous => { const next = new URLSearchParams(previous); next.set('operation', result.id); return next; });
    }, '');
  }
  return <><div className={`task-actions ${compact ? 'task-actions-compact' : ''}`}>
    {([
      ['minimum', '设置最低数量', Hash], ['stop', '停止任务', Square],
    ] as const).map(([value, label, Icon]) => <Button key={value} className={compact ? `button-small ${value === 'stop' ? 'icon-button' : ''}` : ''}
      title={`${label} · ${task.name}`} aria-label={`${label} · ${task.name}`} onClick={() => {
        setCount(String(task.minServiceCount ?? 0)); setAction(value);
      }}><Icon size={15} />{(value === 'minimum' || !compact) && label}</Button>)}
    <MoreMenu label={`更多任务操作 · ${task.name}`} icon={<Ellipsis size={16} />}>
        <button onClick={() => setAction('launch')}>临时启动</button>
        <Link to={resourceUrl('tasks', task.name)}>任务详情</Link>
        <Link to={`${resourceUrl('tasks', task.name)}/monitor`}>监控</Link>
        <Link to={`${resourceUrl('tasks', task.name)}/configuration`}>配置</Link>
        <button className="error-text" onClick={() => setAction('delete')}>删除任务</button>
    </MoreMenu>
  </div>
    {action === 'launch' && <LaunchServices task={task.name} onClose={close} onCreated={fleet.services.refresh} />}
    {action === 'delete' && <Confirm title={`删除任务 ${task.name}`} busy={operation.busy} error={operation.error} onCancel={close}
      onConfirm={() => void operation.run(signal => api.deleteConfiguration('tasks', task.name, signal), () => {
        setAction(null); fleet.tasks.refresh(); onDeleted?.();
      })}>确认删除 {task.name} 的永久配置？现有实例沿用 CloudNet 的处理方式。</Confirm>}
    {(action === 'minimum' || action === 'stop') && <Dialog title={`${action === 'minimum' ? '设置最低运行数量' : '停止任务'} · ${task.name}`} onClose={close}>
      <form className="detail-body" onSubmit={event => { event.preventDefault(); if (action === 'minimum') submit(); }}><Message>{operation.error}</Message>
        {action === 'minimum' ? <><label className="task-minimum-field">最低运行数量<input type="number" min={0} max={2147483647} step={1} required
          data-dialog-focus value={count} disabled={operation.busy} onChange={event => setCount(event.target.value)} /></label>
          <p className="field-hint">仅修改最低数量。提高后由核心补开；降低不会主动关闭实例。</p></>
          : <><p className="field-hint">操作整个任务，不受列表筛选限制。集群最低数量：{task.minServiceCount ?? 0}。</p>
            <p className="field-hint">普通停止保留最低数量，核心可能自动补开。清零并停止先保存最低数量 0，确认主节点已同步后再停止；已进入启动流程的实例可能继续启动，不会循环追停。</p>
            <p className="field-hint">包含有玩家的实例。停止后按实例配置自动删除；保留型实例不额外删除。执行时重新读取并固定本批运行实例。</p>
            <Message>{fleet.services.error || fleet.players.error}</Message>
            <div className="table-scroll"><table className="service-table compact-table"><thead><tr><th>实例</th><th>节点</th><th>在线玩家</th><th>停止后</th></tr></thead>
              <tbody>{running.map(service => <tr key={service.configuration.serviceId.uniqueId}><td>{serviceName(service)}</td>
                <td>{service.configuration.serviceId.nodeUniqueId}</td><td>{fleet.playerCount([service]) ?? '—'}</td>
                <td>{service.configuration.autoDeleteOnStop ? '自动删除' : '保留'}</td></tr>)}</tbody></table></div>
            {!running.length && <EmptyState loading={fleet.services.loading} title="当前没有运行实例" />}
            <p className="field-hint">当前 {running.length} 台，在线 {fleet.playerCount(running) ?? '—'} 人。</p></>}
        <div className="form-actions task-confirm-actions"><Button data-dialog-focus={action === 'stop' || undefined} onClick={close} disabled={operation.busy}>取消</Button>
          {action === 'minimum' ? <Button type="submit" variant="primary" busy={operation.busy}
            disabled={count === '' || !Number.isInteger(Number(count)) || Number(count) < 0 || Number(count) > 2147483647}>确认保存</Button>
            : <>{[false, true].map(clear => <Button key={String(clear)} variant={clear ? 'primary' : 'secondary'}
              disabled={operation.busy || !fleet.services.data || Boolean(fleet.services.error)} onClick={() => submit(clear)}>
              {clear ? '清零并停止' : '普通停止'}</Button>)}</>}</div>
      </form>
    </Dialog>}
  </>;
}

export function TaskOperationStatus() {
  const [params] = useSearchParams();
  const id = params.get('operation');
  const [ids, setIds] = useState<string[]>(() => id ? [id] : []);
  useEffect(() => { if (id) setIds(previous => previous.includes(id) ? previous : [...previous, id]); }, [id]);
  const forget = useCallback((id: string) => setIds(previous => previous.filter(value => value !== id)), []);
  return <>{ids.map(id => <OperationProgress key={id} id={id} onDismiss={forget} />)}</>;
}

function OperationProgress({ id, onDismiss }: { id: string; onDismiss: (id: string) => void }) {
  const [details, setDetails] = useState(false);
  const [terminalError, setTerminalError] = useState('');
  const finished = useRef(false);
  const notify = useNotice();
  const { show, remove } = useNotifications();
  const noticeId = `task:${id}`;
  const [, setParams] = useSearchParams();
  const loader = useCallback(async (signal: AbortSignal) => {
    try { return await api.taskOperation(id, signal); }
    catch (cause) {
      if (!signal.aborted && cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) {
        setTerminalError(errorMessage(cause));
        return null;
      }
      throw cause;
    }
  }, [id]);
  const poll = useData(loader, 1000, !finished.current && !terminalError);
  const fleet = useFleet();
  const job = poll.data;
  const complete = job?.status === 'completed';
  const refreshServices = fleet.services.refresh;
  const refreshTasks = fleet.tasks.refresh;
  useEffect(() => {
    if ((complete || terminalError) && !finished.current) {
      finished.current = true;
      setParams(previous => {
        if (previous.get('operation') !== id) return previous;
        const next = new URLSearchParams(previous); next.delete('operation'); return next;
      }, { replace: true });
      if (complete) { refreshServices(); refreshTasks(); }
      else { notify(terminalError, [], 'error'); onDismiss(id); }
    }
  }, [id, complete, terminalError, refreshServices, refreshTasks, setParams, notify, onDismiss]);
  useEffect(() => () => remove(noticeId), [noticeId, remove]);
  const summary = useMemo(() => {
    if (!job) return null;
    const failures = job.results.filter(result => result.status === 'not_submitted');
    const submitted = job.results.filter(result => result.status === 'submitted').length;
    const skipped = job.results.filter(result => result.status === 'skipped').length;
    const pending = job.status === 'queued' ? '排队中' : job.status === 'saving' ? '保存并确认最低数量' : `正在提交停止 ${job.results.length}/${job.total}`;
    if (job.status === 'completed' && job.action === 'minimum' && job.minimumSaved && !job.reason) return `${job.task} · 最低数量已保存为 ${job.count}`;
    return <><strong>{job.task} · {job.status !== 'completed' ? pending : job.action === 'minimum'
      ? job.minimumSaved ? `最低数量已保存为 ${job.count}` : '数量未保存' : `本批处理结束：已提交 ${submitted}，跳过 ${skipped}，未提交 ${failures.length}`}</strong>
      {job.reason && <p>{job.reason}</p>}
      {job.action === 'clear-stop' && job.minimumSaved && <p>最低数量已保存为 0。</p>}
      {failures.length > 0 && <details><summary>查看未提交原因（{failures.length}）</summary><ul>{failures.map(result =>
        <li key={result.id}>{result.name} · {result.node}：{result.reason}</li>)}</ul></details>}
      <Button variant="ghost" className="button-small" onClick={() => setDetails(true)}>查看进度与实际状态</Button></>;
  }, [job]);
  useEffect(() => {
    if (job && summary) show({ id: noticeId, text: summary, version: JSON.stringify(job),
      kind: job.reason ? 'error' : complete && !job.results.some(result => result.status === 'not_submitted') ? 'success' : 'info',
      onDismiss: complete ? () => onDismiss(id) : undefined });
  }, [job, summary, noticeId, complete, show, onDismiss, id]);
  const remaining = (fleet.index.tasks.get(job?.task ?? '') ?? []).filter(service => service.lifeCycle === 'RUNNING');
  return <><Message>{poll.error}</Message>
    {details && <Dialog title={`${job?.task ?? ''} · 操作进度`} onClose={() => setDetails(false)}><div className="detail-body">
      <p className="field-hint">关闭网页不会取消后台任务。已提交不代表实例已关闭；结果最多保留 10 分钟，模块重启后不重放。</p>
      {job?.reason && <p className="error-text">{job.reason}</p>}
      <div className="table-scroll"><table className="service-table compact-table"><thead><tr><th>实例</th><th>节点</th><th>提交结果</th><th>说明</th></tr></thead><tbody>
        {job?.results.map(result => <tr key={result.id}><td>{result.name}</td><td>{result.node}</td>
          <td>{{ submitted: '已提交', skipped: '跳过', not_submitted: '未提交' }[result.status]}</td><td>{result.reason}</td></tr>)}
      </tbody></table></div>
      {complete && job?.action !== 'minimum' && <><h3>仍在运行 · {fleet.services.error ? '读取失败' : remaining.length}</h3>
        <Message>{fleet.services.error}</Message><div className="inline-links">{remaining.map(service => <Link key={service.configuration.serviceId.uniqueId}
          to={resourceUrl('services', service.configuration.serviceId.uniqueId)} onClick={() => setDetails(false)}>{serviceName(service)}</Link>)}</div>
        <p className="field-hint">按当前服务状态持续刷新，可能包含正在停止或刚启动的实例；不会自动追停。</p></>}
      <div className="form-actions"><Button onClick={() => setDetails(false)}>收起</Button>{complete && <Button onClick={() => onDismiss(id)}>关闭记录</Button>}</div>
    </div></Dialog>}
  </>;
}
