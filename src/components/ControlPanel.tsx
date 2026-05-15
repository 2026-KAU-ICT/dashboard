import {
  MapPinned,
  Megaphone,
  RadioTower,
  Settings2,
  ShieldCheck,
  Siren,
  UserRound,
  Volume2,
} from 'lucide-react';
import { floorLabels } from '../config/dashboard';
import { mapWorkerToZone } from '../lib/safety';
import type { FloorId, Worker, ZoneSetting } from '../types';
import { InfoTile, StatusBadge } from './ui';

export function ControlPanel({
  selectedWorker,
  risk,
  activeFloor,
  zoneSetting,
  isZoneEditable,
  onBeginZoneEdit,
  onZoneRadiusChange,
  onZoneThresholdChange,
  onApplyZoneSetting,
  onActivateAlarm,
  onBroadcastFloor,
  onBroadcastSite,
}: {
  selectedWorker?: Worker;
  risk?: number;
  activeFloor: FloorId;
  zoneSetting: ZoneSetting;
  isZoneEditable: boolean;
  onBeginZoneEdit: () => void;
  onZoneRadiusChange: (value: number) => void;
  onZoneThresholdChange: (value: number) => void;
  onApplyZoneSetting: () => void;
  onActivateAlarm: () => void;
  onBroadcastFloor: () => void;
  onBroadcastSite: () => void;
}) {
  const selectedMapPoint = selectedWorker ? mapWorkerToZone(selectedWorker) : undefined;

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-stone-100">
          <Settings2 className="h-5 w-5 text-cyan-200" />
          작업자 실시간 정보
        </div>
        <span className="border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-stone-300">
          선택 중
        </span>
      </div>

      <div className="p-4">
        <div className="border border-white/10 bg-black/25 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-stone-300">
              <MapPinned className="h-4 w-4 text-amber-300" />
              Hook Zone 설정
            </div>

            <span className="border border-white/10 bg-black/30 px-2 py-1 text-[11px] font-black text-stone-300">
              {floorLabels[activeFloor]}
            </span>
          </div>

          <div className="mt-3 grid gap-3 text-xs">
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-stone-400">
                <span>훅존 반경</span>
                <span>{zoneSetting.dangerRadius}m</span>
              </div>
              <input
                type="range"
                min={3}
                max={20}
                step={1}
                value={zoneSetting.dangerRadius}
                disabled={!isZoneEditable}
                onChange={(event) => onZoneRadiusChange(Number(event.target.value))}
                className="w-full accent-amber-300 disabled:opacity-40"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-stone-400">
                <span>RSSI 기준값</span>
                <span>{zoneSetting.threshold} dBm</span>
              </div>
              <input
                type="range"
                min={-90}
                max={-40}
                step={1}
                value={zoneSetting.threshold}
                disabled={!isZoneEditable}
                onChange={(event) => onZoneThresholdChange(Number(event.target.value))}
                className="w-full accent-cyan-300 disabled:opacity-40"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="border border-amber-200/40 bg-amber-300/10 px-3 py-2 text-xs font-black text-amber-100 transition hover:bg-amber-300/20"
                onClick={onBeginZoneEdit}
              >
                위치/크기 수정
              </button>

              <button
                type="button"
                className="bg-amber-300 px-3 py-2 text-xs font-black text-amber-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={onApplyZoneSetting}
                disabled={!isZoneEditable}
              >
                설정 저장
              </button>
            </div>

            <p className="text-[11px] font-semibold leading-5 text-stone-500">
              수정 모드에서 지도 위 Hook Zone을 드래그하면 위치가 바뀝니다.
            </p>
          </div>
        </div>

        <div className="mt-4">
          {selectedWorker ? (
            <div className="border border-white/10 bg-black/20 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-stone-400">
                    {selectedWorker.worker_id}
                  </p>
                  <h2 className="mt-1 text-xl font-black tracking-normal text-stone-50">
                    {selectedWorker.name}
                  </h2>
                  <p className="mt-1 text-sm text-stone-400">
                    {floorLabels[selectedWorker.floor]} · {selectedWorker.role} ·{' '}
                    {selectedWorker.gateway}
                  </p>
                </div>
                <StatusBadge status={selectedWorker.status} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
                <InfoTile
                  label="Hook"
                  value={selectedWorker.is_hooked ? '체결' : '미체결'}
                />
                <InfoTile
                  label="Risk"
                  value={typeof risk === 'number' ? `${risk}%` : '-'}
                />
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
                <InfoTile
                  label="위치 좌표"
                  value={`${Math.round(selectedWorker.coords.x)}, ${Math.round(
                    selectedWorker.coords.y,
                  )}`}
                />
                <InfoTile
                  label="Gateway"
                  value={selectedWorker.gateway}
                />
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
                <InfoTile
                  label="Map px"
                  value={
                    selectedMapPoint
                      ? `${selectedMapPoint.pixelX}, ${selectedMapPoint.pixelY}`
                      : '-'
                  }
                />
                <InfoTile
                  label="Field m"
                  value={
                    selectedMapPoint
                      ? `${selectedMapPoint.meterX}, ${selectedMapPoint.meterY}`
                      : '-'
                  }
                />
              </div>

              <div className="mt-4 border border-white/10 bg-black/25 p-3">
                <div className="flex items-center gap-2 text-xs font-bold text-stone-300">
                  <RadioTower className="h-4 w-4 text-cyan-200" />
                  수신 비콘 데이터
                </div>

                {selectedWorker.beacons?.length ? (
                  <div className="mt-3 grid gap-2">
                    {selectedWorker.beacons.map((beacon) => (
                      <div
                        key={beacon.id}
                        className="flex items-center justify-between border border-white/10 bg-black/25 px-3 py-2 text-xs"
                      >
                        <span className="font-bold text-stone-200">
                          {beacon.id}
                        </span>
                        <span className="text-stone-400">
                          {typeof beacon.dist === 'number' ? `${beacon.dist}m` : '-'}
                          {' · '}
                          {typeof beacon.rssi === 'number'
                            ? `${beacon.rssi} dBm`
                            : '-'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs font-semibold text-stone-500">
                    아직 수신된 비콘 데이터가 없습니다.
                  </p>
                )}
              </div>

              <div className="mt-4 border border-white/10 bg-black/25 p-3">
                <div className="flex items-center gap-2 text-xs font-bold text-stone-300">
                  <Siren className="h-4 w-4 text-red-300" />
                  원격 제어
                </div>

                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 bg-red-500 px-3 py-2 text-xs font-black text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={onActivateAlarm}
                    disabled={!selectedWorker}
                  >
                    <Volume2 className="h-4 w-4" />
                    원격 사이렌 작동
                  </button>

                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 bg-amber-300 px-3 py-2 text-xs font-black text-amber-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={onBroadcastFloor}
                    disabled={!selectedWorker}
                  >
                    <Megaphone className="h-4 w-4" />
                    같은 층 작업자 동시 알림
                  </button>

                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 border border-white/20 px-3 py-2 text-xs font-black text-red-50 transition hover:bg-white/10"
                    onClick={onBroadcastSite}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    전체 현장 대피 알림
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-2 text-xs">
                <div className="flex items-center gap-2 border border-white/10 bg-black/25 px-3 py-2 text-stone-300">
                  <UserRound className="h-4 w-4 text-emerald-300" />
                  현재 선택된 작업자의 WebSocket 수신 데이터가 지도와 이 패널에 반영됩니다.
                </div>

                <div className="flex items-center gap-2 border border-white/10 bg-black/25 px-3 py-2 text-stone-300">
                  <MapPinned className="h-4 w-4 text-amber-300" />
                  비콘 거리값을 기반으로 계산된 위치 좌표입니다.
                </div>

                <div className="flex items-center gap-2 border border-white/10 bg-black/25 px-3 py-2 text-stone-300">
                  <ShieldCheck className="h-4 w-4 text-cyan-300" />
                  Hook 상태와 추락 감지 상태에 따라 위험도가 갱신됩니다.
                </div>
              </div>
            </div>
          ) : (
            <div className="border border-white/10 bg-black/20 p-4 text-sm font-semibold text-stone-400">
              지도에서 작업자 아이콘을 선택하면 현재 수신 중인 작업자 데이터가 여기에 표시됩니다.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}