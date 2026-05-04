import { Cpu, Lightbulb, Megaphone, Settings2, SlidersHorizontal, UsersRound, Volume2 } from 'lucide-react';
import { airbagLabels, cartridgeLabels, floorLabels, ledLabels } from '../config/dashboard';
import { calculateWorkerRisk, mapWorkerToZone } from '../lib/safety';
import type { FloorId, LedMode, Worker, ZoneSetting } from '../types';
import { InfoTile, StatusBadge } from './ui';

export function ControlPanel({
  selectedWorker,
  zoneSettings,
  onActivateAlarm,
  onBroadcastEvacuation,
  onLedModeChange,
  onResetCartridge,
  onZoneChange,
  onApplyZone,
}: {
  selectedWorker?: Worker;
  zoneSettings: Record<FloorId, ZoneSetting>;
  onActivateAlarm: () => void;
  onBroadcastEvacuation: (floor: FloorId | 'ALL') => void;
  onLedModeChange: (mode: LedMode) => void;
  onResetCartridge: () => void;
  onZoneChange: (floor: FloorId, key: 'threshold' | 'dangerRadius', value: number) => void;
  onApplyZone: (floor: FloorId) => void;
}) {
  const selectedMapPoint = selectedWorker ? mapWorkerToZone(selectedWorker) : undefined;

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-stone-100">
          <Settings2 className="h-5 w-5 text-cyan-200" />
          Downlink Control
        </div>
        <span className="border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-stone-300">양방향</span>
      </div>

      <div className="p-4">
        {selectedWorker ? (
          <div className="border border-white/10 bg-black/20 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-stone-400">{selectedWorker.worker_id}</p>
                <h2 className="mt-1 text-xl font-black tracking-normal text-stone-50">{selectedWorker.name}</h2>
                <p className="mt-1 text-sm text-stone-400">
                  {floorLabels[selectedWorker.floor]} · {selectedWorker.role} · {selectedWorker.gateway}
                </p>
              </div>
              <StatusBadge status={selectedWorker.status} />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <InfoTile label="Hook" value={selectedWorker.is_hooked ? '체결' : '미체결'} />
              <InfoTile label="Battery" value={`${Math.round(selectedWorker.battery)}%`} />
              <InfoTile label="RSSI XY" value={`${Math.round(selectedWorker.coords.x)}, ${Math.round(selectedWorker.coords.y)}`} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              <InfoTile label="Risk" value={`${calculateWorkerRisk(selectedWorker)}%`} />
              <InfoTile label="Cartridge" value={cartridgeLabels[selectedWorker.telemetry.airbagCartridge]} />
              <InfoTile label="LED" value={ledLabels[selectedWorker.telemetry.ledMode]} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
              <InfoTile label="Map px" value={selectedMapPoint ? `${selectedMapPoint.pixelX}, ${selectedMapPoint.pixelY}` : '-'} />
              <InfoTile label="Field m" value={selectedMapPoint ? `${selectedMapPoint.meterX}, ${selectedMapPoint.meterY}` : '-'} />
            </div>

            <button
              type="button"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 bg-red-500 px-4 py-3 text-sm font-black text-white transition hover:bg-red-400"
              onClick={onActivateAlarm}
            >
              <Volume2 className="h-5 w-5" />
              원격 사이렌 작동
            </button>
            <div className="mt-2 grid grid-cols-3 border border-white/10 bg-[#111411] text-xs font-black">
              {(['OFF', 'STEADY', 'FLASH'] as LedMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`inline-flex items-center justify-center gap-1 px-2 py-2 transition ${
                    selectedWorker.telemetry.ledMode === mode
                      ? 'bg-amber-300 text-amber-950'
                      : 'text-stone-300 hover:bg-white/10'
                  }`}
                  onClick={() => onLedModeChange(mode)}
                >
                  <Lightbulb className="h-3.5 w-3.5" />
                  {ledLabels[mode]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 inline-flex w-full items-center justify-center gap-2 border border-amber-300/35 px-4 py-3 text-sm font-black text-amber-100 transition hover:bg-amber-300/10"
              onClick={() => onBroadcastEvacuation(selectedWorker.floor)}
            >
              <Megaphone className="h-5 w-5" />
              같은 층 작업자 동시 경고
            </button>
            {selectedWorker.telemetry.airbagCartridge !== 'CHARGED' ? (
              <button
                type="button"
                className="mt-2 inline-flex w-full items-center justify-center gap-2 border border-emerald-300/35 px-4 py-3 text-sm font-black text-emerald-100 transition hover:bg-emerald-300/10"
                onClick={onResetCartridge}
              >
                <Cpu className="h-5 w-5" />
                에어백 카트리지 교체 완료
              </button>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          className="mt-4 inline-flex w-full items-center justify-center gap-2 border border-red-300/35 px-4 py-3 text-sm font-black text-red-100 transition hover:bg-red-300/10"
          onClick={() => onBroadcastEvacuation('ALL')}
        >
          <UsersRound className="h-5 w-5" />
          전체 현장 대피 알림
        </button>

        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-stone-100">
            <SlidersHorizontal className="h-4 w-4 text-emerald-300" />
            Safety Hook Zone
          </div>

          {(Object.keys(zoneSettings) as FloorId[]).map((floor) => {
            const setting = zoneSettings[floor];
            return (
              <div key={floor} className="border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="text-sm text-stone-100">{floorLabels[floor]}</strong>
                    <p className="mt-1 text-xs text-stone-500">
                      중심 {Math.round(setting.center.x)}, {Math.round(setting.center.y)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="border border-emerald-300/30 px-2 py-1 text-xs font-bold text-emerald-100 transition hover:bg-emerald-300/10"
                    onClick={() => onApplyZone(floor)}
                  >
                    적용
                  </button>
                </div>

                <label className="mt-3 block text-xs font-semibold text-stone-400">
                  RSSI 임계값
                  <span className="float-right text-stone-200">{setting.threshold} dBm</span>
                  <input
                    className="range-control mt-2 w-full"
                    type="range"
                    min="-90"
                    max="-45"
                    value={setting.threshold}
                    onChange={(event) => onZoneChange(floor, 'threshold', Number(event.target.value))}
                  />
                </label>

                <label className="mt-3 block text-xs font-semibold text-stone-400">
                  위험 반경
                  <span className="float-right text-stone-200">{setting.dangerRadius} m</span>
                  <input
                    className="range-control mt-2 w-full"
                    type="range"
                    min="3"
                    max="18"
                    value={setting.dangerRadius}
                    onChange={(event) => onZoneChange(floor, 'dangerRadius', Number(event.target.value))}
                  />
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
