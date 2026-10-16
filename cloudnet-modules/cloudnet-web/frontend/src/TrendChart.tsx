import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { hasMetric } from './format';
import type { MetricAggregate, MetricPoint } from './types';

export const historyRanges: Record<string, number> = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440 };
export function HistoryRange({ value, label, param = 'range' }: { value: string; label: string; param?: string }) {
  const [, setParams] = useSearchParams();
  return <select aria-label={label} value={value} onChange={event => setParams(previous => {
    const next = new URLSearchParams(previous); next.set(param, event.target.value); return next;
  }, { replace: true })}>{Object.entries(historyRanges).map(([range, minutes]) =>
    <option key={range} value={range}>最近 {minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`}</option>)}</select>;
}

export function HistoryLegend({ items, param, className = '' }: { items: TrendSeries[]; param: string; className?: string }) {
  const [params, setParams] = useSearchParams();
  const hidden = new Set(params.getAll(param));
  return <div className={`trend-legend ${className}`}>{items.map(item => <button key={item.key} title={item.name}
    className={hidden.has(item.key) ? 'muted' : ''} aria-pressed={!hidden.has(item.key)} onClick={() => setParams(previous => {
      const next = new URLSearchParams(previous); const values = new Set(next.getAll(param));
      values.has(item.key) ? values.delete(item.key) : values.add(item.key);
      next.delete(param); values.forEach(value => next.append(param, value)); return next;
    }, { replace: true })}><i className="chart-dot" style={{ background: item.color }} /><span>{item.name}</span></button>)}</div>;
}
export interface TrendRow { time: number; values: Record<string, (Omit<MetricAggregate, 'peak'> & { peak?: number }) | undefined> }
export interface TrendSeries { key: string; name: string; color: string; dashed?: boolean }
export const historyClock = (time: number) => new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

export function historyRows(points: MetricPoint<string>[], generatedAt: number, range: string): TrendRow[] {
  const end = Math.floor(generatedAt / 60000) * 60000;
  const byTime = new Map(points.map(point => [point.time, point.values]));
  return Array.from({ length: historyRanges[range] + 1 }, (_, index) => {
    const time = end - (historyRanges[range] - index) * 60000;
    return { time, values: byTime.get(time) ?? {} };
  });
}

export const TrendChart = memo(function TrendChart({ rows, series, format, maximum, compact = false, showPeak = true, extra }:
  { rows: TrendRow[]; series: TrendSeries[]; format: (value: number | null | undefined) => string;
    maximum?: number; compact?: boolean; showPeak?: boolean; extra?: (row: TrendRow, series: TrendSeries) => ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null);
  const dots = useMemo(() => new Set(series.filter(item => {
    let count = 0;
    for (const row of rows) if (hasMetric(row.values[item.key]?.average) && ++count > 1) return false;
    return count === 1;
  }).map(item => item.key)), [rows, series]);
  return <div ref={anchor} className={compact ? 'sparkline-chart' : 'trend-chart'}><ResponsiveContainer width="100%" height="100%">
    <LineChart data={rows} accessibilityLayer={!compact} margin={compact ? { top: 3, right: 3, bottom: 3, left: 3 } : { top: 12, right: 16, left: 8, bottom: 0 }}>
      {!compact && <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />}
      <XAxis hide={compact} dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={historyClock}
        tick={{ fill: 'var(--body)', fontSize: 11 }} minTickGap={35} axisLine={false} tickLine={false} />
      <YAxis hide={compact} width={maximum ? 48 : 76} domain={[0, maximum ?? 'auto']} tickFormatter={value => format(Number(value))}
        tick={{ fill: 'var(--body)', fontSize: 10 }} axisLine={false} tickLine={false} />
      <Tooltip portal={document.body} wrapperStyle={{ position: 'fixed', top: 0, left: 0, zIndex: 50, pointerEvents: 'none' }}
        isAnimationActive={false} content={({ active, payload, coordinate }) => {
        const row = payload?.[0]?.payload as TrendRow | undefined;
        return active && row && coordinate ? <TrendTooltip anchor={anchor.current} coordinate={coordinate}
          row={row} series={series} format={format} showPeak={showPeak} extra={extra} /> : null;
      }} />
      {series.map(item => <Line key={item.key} name={item.name} dataKey={(row: TrendRow) => row.values[item.key]?.average ?? null}
        stroke={item.color} strokeDasharray={item.dashed ? '5 4' : undefined} strokeWidth={compact ? 1.5 : 2} type="linear"
        dot={dots.has(item.key) ? { r: compact ? 2 : 3 } : false}
        activeDot={{ r: compact ? 2 : 3 }} connectNulls={false} isAnimationActive={false} />)}
    </LineChart>
  </ResponsiveContainer></div>;
});

function TrendTooltip({ anchor, coordinate, row, series, format, showPeak, extra }:
  { anchor: HTMLDivElement | null; coordinate: { x: number; y: number }; row: TrendRow; series: TrendSeries[];
    format: (value: number | null | undefined) => string; showPeak: boolean; extra?: (row: TrendRow, series: TrendSeries) => ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    function place() {
      if (!anchor || !element.current) return;
      const chart = anchor.getBoundingClientRect();
      const box = element.current.getBoundingClientRect();
      if (chart.bottom <= 0 || chart.top >= window.innerHeight || chart.right <= 0 || chart.left >= window.innerWidth) {
        setPosition(null);
        return;
      }
      const x = chart.left + coordinate.x;
      const y = chart.top + coordinate.y;
      setPosition({
        left: Math.max(8, Math.min(x + 12, document.documentElement.clientWidth - box.width - 8)),
        top: Math.max(8, Math.min(y + 12 + box.height > window.innerHeight - 8 ? y - box.height - 12 : y + 12,
          window.innerHeight - box.height - 8)),
      });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, coordinate.x, coordinate.y, row, series]);
  return <div ref={element} className="trend-tooltip" style={{ ...position, opacity: position ? 1 : 0 }}>
    <strong className="trend-tooltip-time">{new Date(row.time).toLocaleString('zh-CN')}</strong>
    {series.map(item => { const value = row.values[item.key]; return <div className="trend-tooltip-row" key={item.key}>
      <span className="trend-tooltip-label"><i className="chart-dot" style={{ background: item.color }} />{item.name}</span>
      <dl className={`trend-tooltip-values ${showPeak ? '' : 'trend-tooltip-average'}`}><div><dt>分钟平均</dt><dd>{format(value?.average)}</dd></div>
        {showPeak && <div><dt>分钟峰值</dt><dd>{format(value?.peak)}</dd></div>}</dl>
      {extra && <div className="trend-tooltip-extra">{extra(row, item)}</div>}
    </div>; })}
  </div>;
}
