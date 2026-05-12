import { CheckCircle2, Siren, TriangleAlert } from 'lucide-react';
import { statusMeta } from '../config/dashboard';
import type { WorkerStatus } from '../types';

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
    <article className={`flex min-h-28 items-center justify-between gap-3 border bg-[#111411] p-4 shadow-panel sm:min-h-32 ${toneClass}`}>
      <div>
        <p className="text-sm font-semibold text-stone-300">{label}</p>
        <strong className="mt-1 block text-3xl font-black tracking-normal text-stone-50 sm:text-5xl">{value}</strong>
        <p className="mt-2 text-xs font-medium text-stone-400">{helper}</p>
      </div>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-white/10 bg-black/20 sm:h-12 sm:w-12">{icon}</div>
    </article>
  );
}

export function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/10 bg-[#111411] p-2">
      <p className="text-[11px] font-semibold text-stone-500">{label}</p>
      <p className="mt-1 break-keep text-sm font-black text-stone-100">{value}</p>
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
