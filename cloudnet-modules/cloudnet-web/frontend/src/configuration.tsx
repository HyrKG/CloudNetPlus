import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Code2, Plus, Save, Search } from 'lucide-react';
import { api } from './api';
import { taskTargetLabel } from './format';
import { Button, EmptyState, Message, PageHeading, Panel } from './components';
import { ServiceTable } from './services';
import type { Configuration, ServiceTemplate } from './types';
import { Confirm, Feedback, resourceUrl, Tabs, useData, useOperation } from './workspace';
import { TaskActions } from './TaskActions';
import { TaskMonitor } from './TaskHistory';
import { CapacityTable, FleetErrors, ServiceSummary, useFleet } from './fleet';

export const environments = ['MINECRAFT_SERVER', 'GLOWSTONE', 'NUKKIT', 'GO_MINT', 'BUNGEECORD', 'VELOCITY', 'WATERDOG', 'WATERDOG_PE'];
export const templateName = (template: ServiceTemplate) => `${template.storage}:${template.prefix}/${template.name}`;
const titleOf = (kind: 'tasks' | 'groups') => kind === 'tasks' ? '任务' : '分组';
const loaderOf = (kind: 'tasks' | 'groups') => kind === 'tasks' ? api.tasks : api.groups;

export function ConfigurationsPage() {
  const kind = 'groups';
  const poll = useData(api.groups);
  const [params, setParams] = useSearchParams();
  const search = params.get('q') || '';
  const label = titleOf(kind);
  const configs = (poll.data ?? []).filter(config => config.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (params.get('create') === '1') return <ConfigurationPage kind={kind} creating />;
  return <><PageHeading title={`${label}管理`} actions={<Link className="button button-primary" to={`/${kind}?create=1`}>
    <Plus size={16} />创建{label}</Link>} />
    <Message>{poll.error}</Message>
    <section className="panel"><div className="service-filters"><label className="search-field"><Search size={16} />
      <input type="search" placeholder={`搜索${label}名称`} aria-label={`搜索${label}`} value={search}
        onChange={event => setParams(previous => { const next = new URLSearchParams(previous);
          event.target.value ? next.set('q', event.target.value) : next.delete('q'); return next; }, { replace: true })} /></label></div>
      {poll.loading ? <EmptyState loading /> : configs.length ? <div className="table-scroll"><table className="service-table"><thead><tr>
        <th>{label}名称</th><th>适用环境</th><th>模板</th><th className="align-right">操作</th></tr></thead><tbody>
        {configs.map(config => <tr key={config.name}><td><Link className="resource-name" to={resourceUrl(kind, config.name)}>{config.name}</Link></td>
          <td>{config.targetEnvironments?.join('、') || '全部环境'}</td><td>{config.templates?.length ?? 0}</td>
          <td><div className="table-actions"><Link className="button button-ghost button-small" to={`${resourceUrl(kind, config.name)}/configuration`}>配置</Link></div></td></tr>)}
      </tbody></table></div> : <EmptyState title={`暂无${search ? '匹配的' : ''}${label}`} />}
    </section>
  </>;
}

export function ConfigurationPage({ kind, creating = false }: { kind: 'tasks' | 'groups'; creating?: boolean }) {
  const fleet = useFleet();
  const { name = '', tab = '' } = useParams();
  const [params] = useSearchParams();
  const query = params.size ? `?${params}` : '';
  const poll = useData(loaderOf(kind));
  const services = useData(api.services);
  const navigate = useNavigate();
  const operation = useOperation();
  const [confirm, setConfirm] = useState(false);
  const config = poll.data?.find(item => item.name === name);
  const base = resourceUrl(kind, name);
  const label = titleOf(kind);
  const list = kind === 'tasks' ? '/services' : '/groups';
  const returnParams = new URLSearchParams(params); returnParams.delete('create');
  if (creating) return <><PageHeading title={`创建${label}`} />
    <ConfigurationEditor key={`${kind}/new`} kind={kind} names={poll.data?.map(item => item.name) ?? []}
      onSaved={value => { poll.refresh(); navigate(`${resourceUrl(kind, value.name)}/configuration`); }}
      onCancel={() => navigate(`${list}${returnParams.size ? `?${returnParams}` : ''}`)} /></>;
  if (!config) return <><PageHeading title={name} /><Message>{poll.error}</Message>
    <EmptyState loading={poll.loading} title={`${label}不存在`} /></>;
  const taskServices = services.data?.filter(service => service.configuration.serviceId.taskName === name) ?? [];
  return <><PageHeading title={name} actions={<div className="heading-actions">
    {kind === 'tasks' ? <TaskActions task={config} compact onDeleted={() => navigate(list)} />
      : <Button onClick={() => setConfirm(true)}>删除{label}</Button>}</div>}><Link to={list}>{kind === 'tasks' ? '服务器' : '分组管理'}</Link></PageHeading>
    <Tabs items={[{ to: `${base}${query}`, label: kind === 'tasks' ? '运行与实例' : '概况', end: true },
      ...(kind === 'tasks' ? [{ to: `${base}/monitor${query}`, label: '监控' }] : []),
      { to: `${base}/configuration${query}`, label: '配置' }]} />
    <Message>{poll.error}</Message><Feedback operation={operation} />
    {tab === 'configuration' ? <ConfigurationEditor key={`${kind}/${name}`} kind={kind} original={config}
      names={poll.data?.map(item => item.name) ?? []} onSaved={() => poll.refresh()} onCancel={() => navigate(base)} />
      : kind === 'tasks' && tab === 'monitor' ? <TaskMonitor task={name} />
      : kind === 'tasks' ? <><FleetErrors sources={[services, fleet.players, fleet.metrics]} /><ServiceSummary services={taskServices} />
        <div className="resource-context"><span>{config.maintenance ? '维护中' : '正常'}</span>
          <span>目标数量：{taskTargetLabel(config)}</span>
          <span>最低数量：{config.minServiceCount ?? 0}</span><span>可调度：{config.associatedNodes?.join('、') || '全部节点'}</span></div><Panel title="任务实例">
        {taskServices.length ? <ServiceTable services={taskServices} onSelect={id => navigate(resourceUrl('services', id))} />
          : <EmptyState loading={services.loading} title="暂无实例" />}</Panel><CapacityTable task={config} /></>
      : <Panel title={`${label}概况`}><dl className="detail-fields resource-fields">
        <div><dt>名称</dt><dd>{config.name}</dd></div>
        <div><dt>适用环境</dt><dd>{config.targetEnvironments?.join('、') || '全部环境'}</dd></div>
        <div className="field-wide"><dt>关联模板</dt><dd>{config.templates?.map(templateName).join('、') || '无'}</dd></div>
      </dl></Panel>}
    {confirm && <Confirm title={`删除${label} ${name}`} busy={operation.busy} error={operation.error}
      onCancel={() => setConfirm(false)} onConfirm={() => void operation.run(signal => api.deleteConfiguration(kind, name, signal),
        () => { poll.refresh(); navigate(list); })}>确认删除{name}？此操作删除永久配置，现有实例沿用 CloudNet 的处理方式。</Confirm>}
  </>;
}

function defaults(kind: 'tasks' | 'groups'): Configuration {
  const base = { name: '', templates: [], includes: [], deployments: [], properties: {} };
  return kind === 'groups' ? { ...base, jvmOptions: [], processParameters: [], targetEnvironments: [] }
    : { ...base, runtime: 'jvm', javaCommand: null, maintenance: false, staticServices: false, autoDeleteOnStop: true,
      disableIpRewrite: false, minServiceCount: 0, startPort: 44955, associatedNodes: [], groups: [], deletedFilesAfterStop: [],
      processConfiguration: { environment: 'MINECRAFT_SERVER', maxHeapMemorySize: 512, jvmOptions: [], processParameters: [] } };
}

export function LinesField({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  return <label>{label}<textarea rows={3} value={value.join('\n')} placeholder="每行一项"
    onChange={event => onChange(event.target.value.split('\n'))}
    onBlur={() => onChange(value.filter(item => item.trim().length > 0))} /></label>;
}

export function Choices({ label, options, value, onChange, hint }:
  { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void; hint?: string }) {
  const choices = Array.from(new Set([...options, ...value]));
  return <fieldset className="choice-field"><legend>{label}</legend>{hint && <p className="field-hint">{hint}</p>}
    <div className="choice-grid">{choices.map(item => <label key={item}><input type="checkbox" checked={value.includes(item)}
      onChange={event => onChange(event.target.checked ? [...value, item] : value.filter(entry => entry !== item))} />{item}</label>)}
      {!choices.length && <span className="text-secondary">暂无可选项</span>}</div></fieldset>;
}

function ConfigurationEditor({ kind, original, names, onSaved, onCancel }:
  { kind: 'tasks' | 'groups'; original?: Configuration; names: string[]; onSaved: (value: Configuration) => void; onCancel: () => void }) {
  const [raw, setRaw] = useState(() => JSON.stringify(original ?? defaults(kind), null, 2));
  const [advanced, setAdvanced] = useState(false);
  const nodes = useData(api.nodes, 30000);
  const groups = useData(api.groups, 30000);
  const templates = useData(api.templates, 30000);
  const operation = useOperation();
  const parsed = useMemo(() => {
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是 JSON 对象。');
      const config = value as Configuration;
      for (const field of ['templates', 'includes', 'deployments', 'jvmOptions', 'processParameters', 'targetEnvironments', 'associatedNodes', 'groups']) {
        if (config[field] != null && !Array.isArray(config[field])) throw new Error(`${field} 必须是数组。`);
      }
      if (config.name != null && typeof config.name !== 'string') throw new Error('name 必须是字符串。');
      if (config.processConfiguration != null && (typeof config.processConfiguration !== 'object' || Array.isArray(config.processConfiguration))) {
        throw new Error('processConfiguration 必须是对象。');
      }
      return { draft: config, error: '' };
    } catch (cause) { return { draft: null, error: cause instanceof Error ? cause.message : 'JSON 格式错误' }; }
  }, [raw]);
  const draft = parsed.draft;
  const target = draft?.properties?.targetServiceCount ?? -1;
  const nameError = draft && original && draft.name !== original.name ? '已有资源名称不可修改。'
    : draft && !original && names.some(name => name.toLowerCase() === String(draft.name).toLowerCase()) ? '名称已存在。' : '';
  function update(patch: Partial<Configuration>) { if (draft) setRaw(JSON.stringify({ ...draft, ...patch }, null, 2)); }
  function process(patch: Partial<NonNullable<Configuration['processConfiguration']>>) {
    if (draft) update({ processConfiguration: { ...defaults('tasks').processConfiguration!, ...draft.processConfiguration, ...patch } });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || nameError) return;
    void operation.run(signal => api.saveConfiguration(kind, draft, signal), () => onSaved(draft), '配置已保存。');
  }
  const options = Array.from(new Map([...(templates.data ?? []), ...(draft?.templates ?? [])].map(template => [templateName(template), template])).values());
  return <form className="configuration-form" onSubmit={save}>
    <div className="editor-toolbar"><strong>{titleOf(kind)}配置</strong>
      <Button onClick={() => setAdvanced(value => !value)} disabled={!advanced ? false : !draft}><Code2 size={15} />
        {advanced ? '返回表单' : '高级 JSON'}</Button></div>
    <Feedback operation={operation} /><Message>{parsed.error || nameError}</Message>
    <fieldset disabled={operation.busy} className="configuration-fields">
      {advanced ? <label>完整配置<textarea className="json-editor" value={raw} spellCheck={false}
        onChange={event => setRaw(event.target.value)} rows={24} /></label> : draft && <>
        <Panel title="基本设置"><div className="form-grid">
          <label>名称<input required value={draft.name ?? ''} readOnly={Boolean(original)} onChange={event => update({ name: event.target.value })} /></label>
          {kind === 'tasks' && <><label>运行环境<select value={draft.processConfiguration?.environment ?? 'MINECRAFT_SERVER'}
            onChange={event => process({ environment: event.target.value })}>{environments.map(environment =>
              <option key={environment}>{environment}</option>)}</select></label>
            <label>最低运行数量<input type="number" min={0} step={1} required disabled={target >= 0}
              value={target >= 0 ? target : draft.minServiceCount ?? 0}
              onChange={event => update({ minServiceCount: Number(event.target.value) })} />
              {target >= 0 && <span className="field-hint">由目标数量 {target} 控制；请通过任务操作修改或停用目标。</span>}</label>
            <label>最大堆内存（MiB）<input type="number" min={1} step={1} required value={draft.processConfiguration?.maxHeapMemorySize ?? 512}
              onChange={event => process({ maxHeapMemorySize: Number(event.target.value) })} /></label>
            <label>起始端口<input type="number" min={1} max={65535} step={1} required value={draft.startPort ?? 44955}
              onChange={event => update({ startPort: Number(event.target.value) })} /></label>
            <label>运行时<input value={draft.runtime ?? ''} onChange={event => update({ runtime: event.target.value })} /></label>
            <label className="field-wide">Java 命令<input value={draft.javaCommand ?? ''} placeholder="留空使用节点默认值"
              onChange={event => update({ javaCommand: event.target.value || null })} /></label>
            <div className="checkbox-options field-wide">{([
              ['maintenance', '维护模式'], ['staticServices', '静态实例'], ['autoDeleteOnStop', '停止后自动删除'],
            ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(draft[key])}
              onChange={event => update({ [key]: event.target.checked })} />{label}</label>)}</div></>}
        </div></Panel>
        <Panel title={kind === 'tasks' ? '节点与分组' : '适用范围'}><div className="form-grid">
          {kind === 'tasks' ? <><Message>{nodes.error || groups.error}</Message>
            <Choices label="关联节点" options={nodes.data?.map(entry => entry.node.uniqueId) ?? []} value={draft.associatedNodes ?? []}
              onChange={associatedNodes => update({ associatedNodes })} hint="不选择表示全部节点；这是允许调度范围，不是每节点数量。" />
            <Choices label="配置分组" options={groups.data?.map(group => group.name) ?? []} value={draft.groups ?? []}
              onChange={value => update({ groups: value })} /></>
            : <Choices label="适用环境" options={environments} value={draft.targetEnvironments ?? []}
              onChange={targetEnvironments => update({ targetEnvironments })} hint="不选择表示全部环境。" />}
        </div></Panel>
        <Panel title="启动参数"><div className="form-grid">
          <LinesField label="JVM 参数" value={kind === 'tasks' ? draft.processConfiguration?.jvmOptions ?? [] : draft.jvmOptions ?? []}
            onChange={jvmOptions => kind === 'tasks' ? process({ jvmOptions }) : update({ jvmOptions })} />
          <LinesField label="进程参数" value={kind === 'tasks' ? draft.processConfiguration?.processParameters ?? [] : draft.processParameters ?? []}
            onChange={processParameters => kind === 'tasks' ? process({ processParameters }) : update({ processParameters })} />
        </div></Panel>
        <Panel title="关联模板"><div className="form-grid"><Message>{templates.error}</Message>
          <Choices label="模板" options={options.map(templateName)} value={draft.templates?.map(templateName) ?? []}
            onChange={selected => update({ templates: selected.map(name => options.find(template => templateName(template) === name)!) })} />
        </div></Panel>
      </>}
    </fieldset>
    <div className="form-actions sticky-actions"><Button onClick={onCancel} disabled={operation.busy}>取消</Button>
      <Button type="submit" variant="primary" busy={operation.busy} disabled={!draft || Boolean(nameError)}><Save size={15} />保存配置</Button></div>
  </form>;
}
