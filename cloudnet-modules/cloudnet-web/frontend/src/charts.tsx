import { useRef } from 'react';
import { Link } from 'react-router';
import { Pie, PieChart, ResponsiveContainer, Sector, Tooltip, type PieSectorShapeProps } from 'recharts';
import { Panel } from './components';

const palette = ['#2563eb', '#ea580c', '#16a34a', '#9333ea', '#dc2626', '#0891b2',
  '#ca8a04', '#db2777', '#0d9488', '#6366f1', '#a16207', '#65a30d'];
export const otherColor = '#8b8b93';

// Allocate across all related charts, retaining a visible category's color when rankings change.
export function useChartColors(ids: string[]) {
  const mapping = useRef(new Map<string, string>());
  const visible = new Set(ids);
  for (const id of mapping.current.keys()) if (!visible.has(id)) mapping.current.delete(id);
  for (const id of [...visible].sort()) {
    if (mapping.current.has(id)) continue;
    const used = new Set(mapping.current.values());
    mapping.current.set(id, palette.find(color => !used.has(color)) ?? `hsl(${mapping.current.size * 137.508 % 360} 65% 48%)`);
  }
  return (id: string) => mapping.current.get(id) ?? otherColor;
}

export interface Slice { id: string; name: string; value: number; color?: string; to?: string }
export function topSlices(items: Slice[]) {
  const ordered = [...items].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  const top = ordered.slice(0, 6);
  if (ordered.length > 6) top.push({ id: '__other', name: '其他', value: ordered.slice(6).reduce((sum, item) => sum + item.value, 0), color: otherColor });
  return top;
}

export function Donut({ title, items, format, size }: { title: string; items: Slice[]; format: (value: number) => string; size?: number }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const chartSize = size ?? 190;
  const style = size === undefined ? undefined : { width: size, height: size, flexBasis: size };
  return <Panel title={title} className="distribution-panel"><div className="resource-chart">
    {total > 0 ? <div className="donut" style={style}><ResponsiveContainer width="100%" height={chartSize}>
      <PieChart><Pie data={items} dataKey="value" nameKey="name" innerRadius={54 * chartSize / 190} outerRadius={80 * chartSize / 190} isAnimationActive={false}
        shape={(props: PieSectorShapeProps) => <Sector {...props} fill={items[props.index]?.color ?? otherColor} stroke="var(--card)" strokeWidth={2} />} />
      <Tooltip formatter={value => format(Number(value))}
        contentStyle={{ background: 'var(--card)', border: '1px solid var(--line-strong)', borderRadius: 8 }} itemStyle={{ color: 'var(--ink)' }} /></PieChart>
    </ResponsiveContainer></div> : <div className="donut empty-chart" style={style}>{items.length ? '当前用量为零' : '暂无有效数据'}</div>}
    <div className="chart-legend">{items.map(item => <div key={item.id}>
      <span className="chart-dot" style={{ background: item.color }} />
      {item.to ? <Link title={item.name} to={item.to}>{item.name}</Link> : <span title={item.name}>{item.name}</span>}
      <strong>{format(item.value)}<small>{total > 0 ? `${(item.value / total * 100).toFixed(1)}%` : '—'}</small></strong>
    </div>)}</div></div></Panel>;
}
