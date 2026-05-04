import { CheckCircle2, Siren, TriangleAlert } from 'lucide-react';
import { statusMeta } from '../config/dashboard';
import type { WorkerStatus } from '../types';
import { clamp } from '../lib/base';

export function MetricCard({
  icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  helper: string;
  tone: 'emerald' | 'amber' | 'red' | 'cyan';
}) {
  const toneClass = {
    emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
    amber: 'border-amber-300/25 bg-amber-300/10 text-amber-100',
    red: 'border-red-400/25 bg-red-400/10 text-red-100',
    cyan: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100',
  }[tone];

  return (
    <article className={`flex min-h-32 items-center justify-between border bg-[#111411] p-4 shadow-panel ${toneClass}`}>
      <div>
        <p className="text-sm font-semibold text-stone-300">{label}</p>
        <strong className="mt-1 block text-4xl font-black tracking-normal text-stone-50 sm:text-5xl">{value}</strong>
        <p className="mt-2 text-xs font-medium text-stone-400">{helper}</p>
      </div>
      <div className="flex h-12 w-12 items-center justify-center border border-white/10 bg-black/20">{icon}</div>
    </article>
  );
}

export function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/10 bg-[#111411] p-2">
      <p className="text-[11px] font-semibold text-stone-500">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-stone-100">{value}</p>
    </div>
  );
}

export function PanelHeader({
  icon,
  title,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  right: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-stone-100">
        {icon}
        {title}
      </div>
      <span className="border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-stone-300">{right}</span>
    </div>
  );
}

export function StatusBadge({ status }: { status: WorkerStatus }) {
  const meta = statusMeta[status];
  const Icon = status === 'NORMAL' ? CheckCircle2 : status === 'WARNING' ? TriangleAlert : Siren;

  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-1 text-xs font-black ${meta.chip}`}>
      <Icon className={`h-3.5 w-3.5 ${status === 'EMERGENCY' ? 'animate-softBlink' : ''}`} />
      {meta.label}
    </span>
  );
}

export function MiniSparkline({
  title,
  values,
  min,
  max,
  tone,
  unit,
}: {
  title: string;
  values: number[];
  min: number;
  max: number;
  tone: 'emerald' | 'cyan' | 'red';
  unit: string;
}) {
  const stroke = tone === 'red' ? '#f87171' : tone === 'cyan' ? '#67e8f9' : '#6ee7b7';
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 34 - ((clamp(value, min, max) - min) / (max - min)) * 28;
    return `${x},${y}`;
  });
  const latest = values[values.length - 1] ?? 0;

  return (
    <div className="border border-white/10 bg-black/25 p-3">
      <div className="flex items-center justify-between text-xs font-bold">
        <span className="text-stone-400">{title}</span>
        <span className={tone === 'red' ? 'text-red-200' : tone === 'cyan' ? 'text-cyan-100' : 'text-emerald-100'}>
          {Math.round(latest)} {unit}
        </span>
      </div>
      <svg viewBox="0 0 100 38" className="mt-2 h-12 w-full" preserveAspectRatio="none" role="img" aria-label={`${title} trend`}>
        <path d="M0 34 H100" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        <polyline points={points.join(' ')} fill="none" stroke={stroke} strokeWidth="2.6" />
      </svg>
    </div>
  );
}
