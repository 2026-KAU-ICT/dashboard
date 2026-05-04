import { CheckCircle2, Megaphone, ShieldCheck, Volume2 } from 'lucide-react';
import { floorLabels } from '../config/dashboard';
import { formatTime } from '../lib/base';
import type { FloorId } from '../types';
import { InfoTile } from './ui';

export type EmergencyActionKind = 'ALARM_RELAY' | 'BROADCAST_WARNING' | 'ACK_STOP';

export type EmergencyActionResult = {
  action: EmergencyActionKind;
  workerId: string;
  workerName: string;
  floor: FloorId;
  gateway: string;
  timestamp: string;
};

const actionCopy: Record<
  EmergencyActionKind,
  {
    title: string;
    description: string;
    icon: typeof Volume2;
  }
> = {
  ALARM_RELAY: {
    title: '조끼 사이렌 재전송 완료',
    description: '대상 작업자 조끼의 부저와 LED 재작동 명령을 게이트웨이로 전송했습니다.',
    icon: Volume2,
  },
  BROADCAST_WARNING: {
    title: '주변 작업자 경고 완료',
    description: '같은 층 작업자에게 대피 경고 방송 명령을 전송했습니다.',
    icon: Megaphone,
  },
  ACK_STOP: {
    title: '확인 및 정지 처리 완료',
    description: '관제 화면의 비상 사이렌을 정지하고 확인 조치를 이벤트 로그에 기록했습니다.',
    icon: ShieldCheck,
  },
};

export function EmergencyActionDialog({
  result,
  onClose,
}: {
  result: EmergencyActionResult;
  onClose: () => void;
}) {
  const copy = actionCopy[result.action];
  const Icon = copy.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-action-title"
    >
      <div className="w-full max-w-xl border border-emerald-300/50 bg-[#0d1511] p-5 text-white shadow-panel sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center border border-emerald-300/50 bg-emerald-400 text-emerald-950">
            <Icon className="h-7 w-7" />
          </div>
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-emerald-200">
              <CheckCircle2 className="h-4 w-4" />
              Action recorded
            </p>
            <h2 id="emergency-action-title" className="mt-2 text-2xl font-black tracking-normal">
              {copy.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-300">{copy.description}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <InfoTile label="작업자" value={`${result.workerName} (${result.workerId})`} />
          <InfoTile label="위치" value={`${floorLabels[result.floor]} · ${result.gateway}`} />
          <InfoTile label="처리 시각" value={formatTime(result.timestamp)} />
        </div>

        <button
          type="button"
          className="mt-6 inline-flex w-full items-center justify-center bg-emerald-300 px-4 py-3 text-sm font-black text-emerald-950 transition hover:bg-emerald-200"
          onClick={onClose}
        >
          관제 화면으로 돌아가기
        </button>
      </div>
    </div>
  );
}
