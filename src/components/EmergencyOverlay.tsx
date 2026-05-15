import {
  Download,
  Megaphone,
  ShieldCheck,
  Siren,
  Volume2,
} from 'lucide-react';
import { airbagLabels, floorLabels } from '../config/dashboard';
import { formatTime } from '../lib/base';
import type { Worker } from '../types';
import { InfoTile } from './ui';

type EmergencyOverlayProps = {
  worker: Worker;
  accidentTime?: string | null;
  isAccidentDataReady?: boolean;
  onDownloadAccidentExcel?: () => void;
  onAlarm: () => void;
  onBroadcast: () => void;
  onAcknowledge: () => void;
};

export function EmergencyOverlay({
  worker,
  accidentTime,
  isAccidentDataReady = false,
  onDownloadAccidentExcel,
  onAlarm,
  onBroadcast,
  onAcknowledge,
}: EmergencyOverlayProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-red-950/92 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="emergency-title"
    >
      <div className="w-full max-w-2xl border-2 border-red-300 bg-[#160707] p-5 text-white shadow-panel sm:p-7">
        <div className="flex items-start gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center border border-red-300/60 bg-red-500 text-white">
              <Siren className="h-9 w-9 animate-softBlink" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-red-200">
                Emergency
              </p>
              <h2
                id="emergency-title"
                className="mt-1 text-3xl font-black tracking-normal sm:text-4xl"
              >
                추락 감지
              </h2>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <InfoTile label="작업자" value={`${worker.name} (${worker.worker_id})`} />
          <InfoTile label="위치" value={`${floorLabels[worker.floor]} · ${worker.gateway}`} />
          <InfoTile label="감지 시각" value={accidentTime ?? formatTime(worker.timestamp)} />
          <InfoTile label="에어백" value={airbagLabels[worker.telemetry.airbagState]} />
        </div>

        <div className="mt-4 rounded-xl border border-red-300/25 bg-red-500/10 px-4 py-3">
          <p className="text-sm font-bold text-red-100">
            사고 발생 전후 데이터
          </p>
          <p className="mt-1 text-xs leading-5 text-red-200/80">
            위치, 훅 체결 여부, 훅존 내부/외부 여부, 추락 감지 시각, 위험도 점수를 엑셀로 저장할 수 있습니다.
            사고 후 30초 데이터 수집이 끝나면 다운로드 버튼이 활성화됩니다.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 bg-red-500 px-4 py-3 text-sm font-black text-white transition hover:bg-red-400"
            onClick={onAlarm}
          >
            <Volume2 className="h-5 w-5" />
            조끼 사이렌 재전송
          </button>

          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 bg-amber-300 px-4 py-3 text-sm font-black text-amber-950 transition hover:bg-amber-200"
            onClick={onBroadcast}
          >
            <Megaphone className="h-5 w-5" />
            주변 작업자 경고
          </button>

          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 bg-red-700 px-4 py-3 text-sm font-black text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-stone-600 disabled:text-stone-300"
            onClick={onDownloadAccidentExcel}
            disabled={!isAccidentDataReady || !onDownloadAccidentExcel}
          >
            <Download className="h-5 w-5" />
            {isAccidentDataReady
              ? '사고 데이터 엑셀 다운로드'
              : '사고 후 데이터 수집 중...'}
          </button>

          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 border border-white/20 px-4 py-3 text-sm font-black text-red-50 transition hover:bg-white/10"
            onClick={onAcknowledge}
          >
            <ShieldCheck className="h-5 w-5" />
            확인 및 정지
          </button>
        </div>
      </div>
    </div>
  );
}