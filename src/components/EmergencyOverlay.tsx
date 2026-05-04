import { Megaphone, ShieldCheck, Siren, Volume2, X } from 'lucide-react';
import { airbagLabels, floorLabels } from '../config/dashboard';
import { formatTime } from '../lib/base';
import type { Worker } from '../types';
import { InfoTile } from './ui';

export function EmergencyOverlay({
  worker,
  onClose,
  onAlarm,
  onBroadcast,
}: {
  worker: Worker;
  onClose: () => void;
  onAlarm: () => void;
  onBroadcast: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-950/92 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl border-2 border-red-300 bg-[#160707] p-5 text-white shadow-panel sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center border border-red-300/60 bg-red-500 text-white">
              <Siren className="h-9 w-9 animate-softBlink" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-red-200">Emergency</p>
              <h2 className="mt-1 text-3xl font-black tracking-normal sm:text-4xl">추락 감지</h2>
            </div>
          </div>
          <button
            type="button"
            className="border border-white/20 p-2 text-red-100 transition hover:bg-white/10"
            onClick={onClose}
            aria-label="팝업 닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <InfoTile label="작업자" value={`${worker.name} (${worker.worker_id})`} />
          <InfoTile label="위치" value={`${floorLabels[worker.floor]} · ${worker.gateway}`} />
          <InfoTile label="감지 시각" value={formatTime(worker.timestamp)} />
          <InfoTile label="에어백" value={airbagLabels[worker.telemetry.airbagState]} />
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className="inline-flex flex-1 items-center justify-center gap-2 bg-red-500 px-4 py-3 text-sm font-black text-white transition hover:bg-red-400"
            onClick={onAlarm}
          >
            <Volume2 className="h-5 w-5" />
            조끼 사이렌 재전송
          </button>
          <button
            type="button"
            className="inline-flex flex-1 items-center justify-center gap-2 bg-amber-300 px-4 py-3 text-sm font-black text-amber-950 transition hover:bg-amber-200"
            onClick={onBroadcast}
          >
            <Megaphone className="h-5 w-5" />
            주변 작업자 경고
          </button>
          <button
            type="button"
            className="inline-flex flex-1 items-center justify-center gap-2 border border-white/20 px-4 py-3 text-sm font-black text-red-50 transition hover:bg-white/10"
            onClick={onClose}
          >
            <ShieldCheck className="h-5 w-5" />
            확인 및 정지
          </button>
        </div>
      </div>
    </div>
  );
}
