import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { ArrowDown, Copy, RefreshCw, Search, Send, Trash2 } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { api, errorMessage, isUnauthorized } from './api';
import { Button, Message } from './components';
import type { ConsoleFrame, ConsoleType, ConsoleLogFile, ConsoleLogPage } from './types';
import { useNotice, useOperation, useWorkspace } from './workspace';

export function Console({ type, id, running = true, focusCommand = false }: { type: ConsoleType; id: string; running?: boolean; focusCommand?: boolean }) {
  const { onUnauthorized } = useWorkspace();
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const searchAddon = useRef<SearchAddon | null>(null);
  const archiveHost = useRef<HTMLDivElement>(null);
  const archiveTerminal = useRef<Terminal | null>(null);
  const archiveSearch = useRef<SearchAddon | null>(null);
  const [mode, setMode] = useState<'live' | 'history'>('live');
  const [files, setFiles] = useState<ConsoleLogFile[]>([]);
  const [file, setFile] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState<ConsoleLogPage | null>(null);
  const [fileRevision, setFileRevision] = useState(0);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const displayedFile = useRef('');
  const stream = useRef({ key: '', id: '', sequence: -1 });
  const following = useRef(true);
  const [follow, setFollow] = useState(true);
  const [status, setStatus] = useState('正在连接');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [command, setCommand] = useState('');
  const notify = useNotice();
  const history = useRef<string[]>([]);
  const historyIndex = useRef(0);
  const draft = useRef('');
  const operation = useOperation();
  const input = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  useEffect(() => { focused.current = false; }, [type, id, focusCommand, mode]);
  useEffect(() => {
    if (mode !== 'live' || !focusCommand || !connected || !running || focused.current) return;
    focused.current = true;
    const active = document.activeElement;
    if (!document.querySelector('dialog[open]') && (!active?.matches('input, textarea, select, [contenteditable="true"]') || active === input.current)) {
      input.current?.focus({ preventScroll: true });
    }
  }, [focusCommand, connected, running, mode]);

  function colored(line: string) {
    if (line.includes('\x1b[')) return line + '\x1b[0m';
    if (/^.{0,100}\b(ERROR|SEVERE|FATAL)\b/i.test(line)) return `\x1b[91m${line}\x1b[0m`;
    if (/^.{0,100}\b(WARN|WARNING)\b/i.test(line)) return `\x1b[93m${line}\x1b[0m`;
    return line;
  }

  function writeLive(text: string, complete?: () => void) {
    const followBeforeWrite = following.current;
    terminal.current?.write(text, () => { if (followBeforeWrite && following.current) terminal.current?.scrollToBottom(); complete?.(); });
  }

  const activeTerminal = () => mode === 'live' ? terminal.current : archiveTerminal.current;
  const activeSearch = () => mode === 'live' ? searchAddon.current : archiveSearch.current;

  useEffect(() => {
    const options = { scrollback: 10000, disableStdin: true, convertEol: true,
      fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.45,
      theme: { background: '#171717', foreground: '#eeeeef', selectionBackground: '#41516b',
        black: '#767680', red: '#ef6b73', green: '#77cb91', yellow: '#e8c56a', blue: '#7baaf7', magenta: '#c59aef', cyan: '#65c9d1', white: '#dedee4',
        brightBlack: '#a5a5b0', brightRed: '#ff8d96', brightGreen: '#9be6ae', brightYellow: '#ffe199', brightBlue: '#a5c5ff', brightMagenta: '#ddbcff', brightCyan: '#9be7ed', brightWhite: '#ffffff' } };
    const term = new Terminal(options);
    const fit = new FitAddon();
    const finder = new SearchAddon();
    term.loadAddon(fit); term.loadAddon(finder); term.open(host.current!); if (host.current?.clientWidth) fit.fit();
    terminal.current = term; searchAddon.current = finder;
    const scroll = term.onScroll(() => {
      const buffer = term.buffer.active;
      const atBottom = buffer.viewportY >= buffer.baseY;
      following.current = atBottom; setFollow(atBottom);
    });
    const observer = new ResizeObserver(() => { if (host.current?.clientWidth) fit.fit(); });
    observer.observe(host.current!);
    const archived = new Terminal(options);
    const archivedFit = new FitAddon();
    const archivedFinder = new SearchAddon();
    archived.loadAddon(archivedFit); archived.loadAddon(archivedFinder); archived.open(archiveHost.current!);
    archiveTerminal.current = archived; archiveSearch.current = archivedFinder;
    const archiveObserver = new ResizeObserver(() => { if (archiveHost.current?.clientWidth) archivedFit.fit(); });
    archiveObserver.observe(archiveHost.current!);
    return () => { observer.disconnect(); archiveObserver.disconnect(); scroll.dispose(); term.dispose(); archived.dispose();
      terminal.current = null; searchAddon.current = null; archiveTerminal.current = null; archiveSearch.current = null; };
  }, []);

  useEffect(() => {
    if (mode !== 'history') return;
    const controller = new AbortController();
    setLoadingFiles(true); setError('');
    api.consoleFiles(type, id, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setFiles(result.files);
      setFile(previous => result.files.some(item => item.id === previous) ? previous : result.files[0]?.id ?? '');
      setCursor(null);
    }).catch(cause => { if (!controller.signal.aborted) { if (isUnauthorized(cause)) onUnauthorized(); else setError(errorMessage(cause)); } })
      .finally(() => { if (!controller.signal.aborted) setLoadingFiles(false); });
    return () => controller.abort();
  }, [mode, type, id, fileRevision, onUnauthorized]);

  useEffect(() => {
    if (mode !== 'history') return;
    if (!file) { archiveTerminal.current?.reset(); setPage(null); return; }
    const controller = new AbortController();
    setLoadingPage(true); setError('');
    const key = `${type}/${id}/${file}`;
    if (displayedFile.current !== key) { archiveTerminal.current?.reset(); setPage(null); displayedFile.current = key; }
    api.consoleHistory(type, id, file, cursor, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setPage(result);
      const term = archiveTerminal.current;
      term?.reset();
      term?.write(result.lines.map(colored).join('\r\n') + (result.lines.length ? '\r\n' : ''), () => { if (!controller.signal.aborted) term.scrollToTop(); });
    }).catch(cause => { if (!controller.signal.aborted) { if (isUnauthorized(cause)) onUnauthorized(); else setError(errorMessage(cause)); } })
      .finally(() => { if (!controller.signal.aborted) setLoadingPage(false); });
    return () => controller.abort();
  }, [mode, type, id, file, cursor, fileRevision, onUnauthorized]);

  useEffect(() => {
    if (mode !== 'live') { setConnected(false); return; }
    let stopped = false;
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let sequence = -1;
    const accessRequest = new AbortController();
    let lastFrame = Date.now();
    let retry = 1000;
    setError('');
    const key = `${type}/${id}`;
    if (stream.current.key !== key) {
      setCommand(''); history.current = []; historyIndex.current = 0;
      stream.current = { key, id: '', sequence: -1 };
    }
    const term = terminal.current!;
    async function connect() {
      if (stopped) return;
      setStatus('正在连接'); setConnected(false);
      try { await api.consoleAccess(type, id, accessRequest.signal); }
      catch (cause) {
        if (stopped) return;
        if (isUnauthorized(cause)) { onUnauthorized(); return; }
        setStatus('连接不可用'); setError(errorMessage(cause));
        return;
      }
      if (stopped) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/console/${type}/${encodeURIComponent(id)}`);
      socket.onopen = () => {
        lastFrame = Date.now();
        heartbeat = setInterval(() => {
          if (Date.now() - lastFrame > 45000) socket?.close();
          else if (socket?.readyState === WebSocket.OPEN) socket.send('ping');
        }, 15000);
      };
      socket.onmessage = event => {
        if (stopped) return;
        const frame = JSON.parse(event.data) as ConsoleFrame & { delivery?: number };
        const connection = socket;
        const acknowledge = () => {
          if (!stopped && frame.delivery !== undefined && connection?.readyState === WebSocket.OPEN) connection.send(`ack:${frame.delivery}`);
        };
        lastFrame = Date.now();
        if (frame.type === 'snapshot') {
          sequence = frame.sequence; retry = 1000;
          const continuing = Boolean(frame.streamId) && stream.current.id === frame.streamId;
          const first = frame.firstSequence ?? frame.sequence - frame.lines.length + 1;
          if (!continuing) { term.reset(); following.current = true; setFollow(true); }
          else if (first > stream.current.sequence + 1) writeLive('\x1b[93m[连接期间部分日志已超出缓存，可在历史文件中回看]\x1b[0m\r\n');
          const lines = continuing ? frame.lines.filter((_, index) => first + index > stream.current.sequence) : frame.lines;
          if (lines.length) writeLive(lines.map(colored).join('\r\n') + '\r\n', acknowledge);
          else acknowledge();
          stream.current = { key, id: frame.streamId ?? '', sequence: frame.sequence };
          setStatus('实时连接'); setConnected(true); setError('');
        } else if (frame.type === 'line' && frame.sequence > sequence) {
          sequence = frame.sequence; stream.current.sequence = sequence; writeLive(colored(frame.line) + '\r\n', acknowledge);
        } else if (frame.type === 'error') {
          setError(frame.message); setConnected(false);
          if (frame.code === 4401) onUnauthorized();
          acknowledge();
        } else acknowledge();
      };
      socket.onclose = async event => {
        clearInterval(heartbeat);
        if (stopped) return;
        setConnected(false);
        if ([4401, 4403, 4404, 4503, 4504].includes(event.code)) {
          setStatus('连接不可用'); setError(event.reason || '控制台不可用');
          if (event.code === 4401) onUnauthorized();
          return;
        }
        // Browser WebSocket APIs hide HTTP handshake errors; use HTTP to distinguish expired sessions.
        const request = new AbortController();
        try { await api.status(request.signal); }
        catch (cause) {
          if (stopped) return;
          if (isUnauthorized(cause)) { onUnauthorized(); return; }
        }
        if (stopped) return;
        setStatus('连接断开，正在重连');
        reconnect = setTimeout(() => void connect(), retry); retry = Math.min(retry * 2, 10000);
      };
    }
    void connect();
    return () => { stopped = true; accessRequest.abort(); clearTimeout(reconnect); clearInterval(heartbeat); socket?.close(); };
  }, [type, id, revision, onUnauthorized, mode]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = command.trim();
    if (!value || !connected || !running) return;
    void operation.run(signal => api.command(type, id, value, signal), result => {
      history.current.push(value); historyIndex.current = history.current.length; draft.current = '';
      setCommand('');
      writeLive(`\x1b[0;1;96m[已发送] › ${value}\x1b[0m\r\n`);
      if (type === 'service') result.receivedMessages?.forEach(line => writeLive(colored(line) + '\r\n'));
    }, type === 'service' ? '命令已发送，执行结果见后台日志。' : '命令已提交。');
  }

  async function copy() {
    const term = activeTerminal()!;
    try {
      const text = term.getSelection() || Array.from({ length: term.buffer.active.length }, (_, index) =>
        term.buffer.active.getLine(index)?.translateToString(true) ?? '').join('\n');
      await navigator.clipboard.writeText(text); notify('已复制日志。');
    } catch (cause) { setError(errorMessage(cause)); }
  }

  return <section className="console-panel" aria-label={`${type === 'node' ? '节点' : '服务'}控制台`}>
    <header className="console-toolbar"><div className="console-mode" role="group" aria-label="控制台模式">
      <Button variant="ghost" aria-pressed={mode === 'live'} onClick={() => { setError(''); setMode('live'); }}>实时</Button>
      <Button variant="ghost" aria-pressed={mode === 'history'} onClick={() => { setError(''); setMode('history'); }}>历史</Button>
      <span><span className={`status-dot ${connected ? '' : 'dot-muted'}`} />{mode === 'live' ? status : '历史文件 · 只读'}</span></div>
      <div className="console-tools"><label className="console-search"><Search size={14} />
        <input aria-label="搜索日志" placeholder="搜索日志" value={search} onChange={event => setSearch(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') activeSearch()?.findNext(search); }} /></label>
        <Button variant="ghost" onClick={() => activeSearch()?.findNext(search)}>查找</Button>
        <Button variant="ghost" onClick={() => void copy()} title="复制选中内容或全部日志"><Copy size={15} />复制</Button>
        <Button variant="ghost" onClick={() => activeTerminal()?.reset()}><Trash2 size={15} />清空显示</Button>
        {mode === 'live' && <Button variant="ghost" onClick={() => { following.current = true; setFollow(true); terminal.current?.scrollToBottom(); }}>
          <ArrowDown size={15} />{follow ? '跟随最新' : '回到最新'}</Button>}
        {mode === 'live' && !connected && <Button variant="ghost" onClick={() => setRevision(value => value + 1)}>重新连接</Button>}
      </div></header>
    {mode === 'history' && <div className="console-history-controls"><select aria-label="历史日志文件" value={file} disabled={loadingFiles}
      onChange={event => { setFile(event.target.value); setCursor(null); }}>
      {!files.length && <option value="">{loadingFiles ? '加载文件列表…' : '没有可读取的历史日志'}</option>}
      {files.map(item => <option key={item.id} value={item.id}>{item.name} · {item.size.toLocaleString('zh-CN')} B · {new Date(item.modifiedAt).toLocaleString('zh-CN')}</option>)}</select>
      <Button variant="ghost" busy={loadingFiles} onClick={() => setFileRevision(value => value + 1)}><RefreshCw size={14} />刷新文件</Button>
      <div className="history-pagination"><span>{loadingPage ? '正在读取…' : page ? `第 ${page.endLine ? page.startLine : 0}–${page.endLine} 行` : '选择文件回看'}</span>
        <Button variant="ghost" disabled={!page?.nextCursor || loadingPage || loadingFiles} onClick={() => setCursor(page!.nextCursor)}>更早 500 行</Button>
        <Button variant="ghost" disabled={!file || loadingPage || loadingFiles} onClick={() => { setCursor(null); setFileRevision(value => value + 1); }}>最新 500 行</Button></div>
    </div>}
    <Message>{error || operation.error}</Message>
    <div className="console-terminal" ref={host} hidden={mode !== 'live'} />
    <div className="console-terminal" ref={archiveHost} hidden={mode !== 'history'} />
    {mode === 'live' && <form className="console-input" onSubmit={submit}><span aria-hidden="true">›</span>
      <input ref={input} aria-label="控制台命令" placeholder={running ? '输入命令，Enter 发送' : '服务未运行，暂不可发送命令'}
        value={command} disabled={!connected || !running} readOnly={operation.busy} aria-busy={operation.busy || undefined}
        onChange={event => setCommand(event.target.value)}
        onKeyDown={event => {
          if (operation.busy) return;
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          if (historyIndex.current === history.current.length) draft.current = command;
          historyIndex.current = Math.max(0, Math.min(history.current.length,
            historyIndex.current + (event.key === 'ArrowUp' ? -1 : 1)));
          setCommand(history.current[historyIndex.current] ?? draft.current);
        }} />
      <Button type="submit" variant="primary" busy={operation.busy} disabled={!connected || !running || !command.trim()}>
        <Send size={15} />发送</Button></form>}
    {mode === 'history' && <footer>临时实例删除后，日志可能随目录删除。</footer>}
  </section>;
}
