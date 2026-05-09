import { CheckCircle2, Cpu, Megaphone, UsersRound, Volume2 } from 'lucide-react';
import { floorLabels } from '../config/dashboard';
import { formatTime } from '../lib/base';
import type { FloorId } from '../types';
import { InfoTile } from './ui';

export type ControlActionKind = 'VEST_ALARM' | 'FLOOR_WARNING' | 'SITE_EVACUATION' | 'CARTRIDGE_RESET';

export type ControlActionResult = {
  action: ControlActionKind;
  floor: FloorId | 'ALL';
  timestamp: string;
  affectedCount: number;
  workerId?: string;
  workerName?: string;
  gateway?: string;
};

const actionCopy: Record<
  ControlActionKind,
  {
    title: string;
    description: string;
    icon: typeof Megaphone;
    actionLabel: string;
  }
> = {
  VEST_ALARM: {
    title: '원격 사이렌 작동 명령 전송 완료',
    description: '선택한 작업자의 조끼로 부저와 LED 강제 작동 명령을 전송했습니다.',
    icon: Volume2,
    actionLabel: '개별 조끼 사이렌',
  },
  FLOOR_WARNING: {
    title: '같은 층 작업자 동시 경고 전송 완료',
    description: '선택 작업자와 같은 층에 있는 조끼로 부저와 LED 경고 명령을 브로드캐스트했습니다.',
    icon: Megaphone,
    actionLabel: '층별 경고 방송',
  },
  SITE_EVACUATION: {
    title: '전체 현장 대피 알림 전송 완료',
    description: '모든 층 게이트웨이로 대피 알림을 전송해 현장 전체 작업자의 즉시 이동을 유도합니다.',
    icon: UsersRound,
    actionLabel: '전체 대피 방송',
  },
  CARTRIDGE_RESET: {
    title: '에어백 카트리지 교체 완료 처리',
    description: '대상 작업자의 에어백 카트리지 상태를 충전됨으로 갱신하고 정비 기록을 남겼습니다.',
    icon: Cpu,
    actionLabel: '카트리지 정비 완료',
  },
};

export function ControlActionDialog({
  result,
  onClose,
}: {
  result: ControlActionResult;
  onClose: () => void;
}) {
  const copy = actionCopy[result.action];
  const Icon = copy.icon;
  const target =
    result.workerName && result.workerId
      ? `${result.workerName} (${result.workerId})`
      : result.floor === 'ALL'
        ? '전체 현장'
        : floorLabels[result.floor];
  const scope =
    result.action === 'VEST_ALARM' || result.action === 'CARTRIDGE_RESET'
      ? '개별 조끼 1명'
      : result.floor === 'ALL'
      ? `전체 작업자 ${result.affectedCount}명`
      : `${floorLabels[result.floor]} 작업자 ${result.affectedCount}명`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="control-action-title"
    >
      <div className="w-full max-w-xl border border-cyan-200/45 bg-[#0c1314] p-5 text-white shadow-panel sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center border border-cyan-200/45 bg-cyan-300 text-cyan-950">
            <Icon className="h-7 w-7" />
          </div>
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-cyan-100">
              <CheckCircle2 className="h-4 w-4" />
              Command recorded
            </p>
            <h2 id="control-action-title" className="mt-2 text-2xl font-black tracking-normal">
              {copy.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-300">{copy.description}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <InfoTile label="명령" value={copy.actionLabel} />
          <InfoTile label="대상" value={target} />
          <InfoTile label="범위" value={scope} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <InfoTile label="처리 시각" value={formatTime(result.timestamp)} />
          <InfoTile label="게이트웨이" value={result.gateway ?? '브로드캐스트'} />
        </div>

        <button
          type="button"
          className="mt-6 inline-flex w-full items-center justify-center bg-cyan-300 px-4 py-3 text-sm font-black text-cyan-950 transition hover:bg-cyan-200"
          onClick={onClose}
        >
          확인
        </button>
      </div>
    </div>
  );
}
