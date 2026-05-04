import { Bell, Download } from 'lucide-react';
import { floorLabels } from '../config/dashboard';
import { formatTime } from '../lib/base';
import { exportSafetyCsv } from '../lib/safety';
import type { EventLog, Worker } from '../types';
import { StatusBadge } from './ui';

export function NotificationPanel({ events, workers }: { events: EventLog[]; workers: Worker[] }) {
  return (
    <section className="flex min-h-[420px] flex-col border border-white/10 bg-[#101310] shadow-panel">
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-stone-100">
          <Bell className="h-5 w-5 text-amber-200" />
          실시간 알림 센터
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-bold text-stone-200 transition hover:bg-white/10"
            onClick={() => exportSafetyCsv(workers, events)}
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
          <span className="border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-stone-300">
            {events.length}
          </span>
        </div>
      </div>

      <div className="max-h-[520px] flex-1 overflow-y-auto">
        {events.map((event) => (
          <article key={event.id} className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 border-b border-white/10 px-4 py-3">
            <time className="text-xs font-semibold text-stone-500">{formatTime(event.timestamp)}</time>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-stone-100">{floorLabels[event.floor]}</span>
                <span className="text-sm font-bold text-stone-300">{event.workerName}</span>
                {event.status === 'CONTROL' ? (
                  <span className="border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-xs font-bold text-cyan-100">제어</span>
                ) : event.status === 'BATTERY' ? (
                  <span className="border border-amber-300/35 bg-amber-300/10 px-2 py-0.5 text-xs font-bold text-amber-100">배터리</span>
                ) : event.status === 'MAINTENANCE' ? (
                  <span className="border border-emerald-300/35 bg-emerald-300/10 px-2 py-0.5 text-xs font-bold text-emerald-100">정비</span>
                ) : (
                  <StatusBadge status={event.status} />
                )}
              </div>
              <p className="mt-1 truncate text-sm text-stone-400">{event.message}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
