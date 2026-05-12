import { BrainCircuit, RadioTower } from 'lucide-react';
import { beaconAnchors, floorLabels, statusMeta } from '../config/dashboard';
import { clamp } from '../lib/base';
import { calculateWorkerRisk, isInSafetyHookZone } from '../lib/safety';
import type { BeaconSignal, EventLog, FloorId, Worker, ZoneSetting } from '../types';
import { NotificationPanel } from './NotificationPanel';
import { InfoTile, PanelHeader } from './ui';

export function OperationalPanels({
  workers,
  events,
  zoneSettings,
}: {
  workers: Worker[];
  events: EventLog[];
  zoneSettings: Record<FloorId, ZoneSetting>;
}) {
  const rankedWorkers = [...workers].sort((a, b) => calculateWorkerRisk(b) - calculateWorkerRisk(a)).slice(0, 4);

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <BeaconSignalPanel workers={workers} />
      <RiskPredictionPanel workers={rankedWorkers} zoneSettings={zoneSettings} />
      <NotificationPanel events={events} workers={workers} />
    </section>
  );
}

function BeaconSignalPanel({ workers }: { workers: Worker[] }) {
  const findAnchor = (id: string, floor: FloorId) =>
    beaconAnchors.find((anchor) => anchor.id.toLowerCase() === id.toLowerCase() && anchor.floor === floor) ??
    beaconAnchors.find((anchor) => anchor.id.toLowerCase() === id.toLowerCase());
  const grouped = new Map<
    string,
    {
      id: string;
      label: string;
      floor: FloorId;
      rssiSum: number;
      count: number;
      dist?: number;
      workerNames: Set<string>;
    }
  >();

  workers.forEach((worker) => {
    worker.beacons?.forEach((beacon: BeaconSignal) => {
      const anchor = findAnchor(beacon.id, worker.floor);
      const key = `${worker.floor}-${beacon.id}`;
      const current = grouped.get(key) ?? {
        id: beacon.id,
        label: anchor?.label ?? beacon.id,
        floor: anchor?.floor ?? worker.floor,
        rssiSum: 0,
        count: 0,
        dist: undefined,
        workerNames: new Set<string>(),
      };

      current.rssiSum += beacon.rssi;
      current.count += 1;
      current.dist = current.dist === undefined || (beacon.dist !== undefined && beacon.dist < current.dist) ? beacon.dist : current.dist;
      current.workerNames.add(worker.name);
      grouped.set(key, current);
    });
  });

  const liveRows = [...grouped.values()]
    .map((beacon) => {
      const rssi = Math.round(beacon.rssiSum / beacon.count);
      const quality = clamp(((rssi + 100) / 80) * 100, 8, 98);
      const status = rssi <= -78 ? '약함' : rssi <= -65 ? '보통' : '강함';
      return {
        ...beacon,
        rssi,
        quality,
        status,
      };
    })
    .sort((a, b) => b.rssi - a.rssi)
    .slice(0, 6);

  const rows = liveRows.length
    ? liveRows
    : beaconAnchors.slice(0, 4).map((anchor) => ({
        id: anchor.id,
        label: anchor.label,
        floor: anchor.floor,
        rssi: undefined,
        quality: 12,
        status: '수신 대기',
        dist: undefined,
        count: 0,
        workerNames: new Set<string>(),
      }));
  const averageRssi = liveRows.length
    ? `${Math.round(liveRows.reduce((sum, row) => sum + row.rssi, 0) / liveRows.length)} dBm`
    : '수신 대기';
  const sampleCount = liveRows.reduce((sum, row) => sum + row.count, 0);

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <PanelHeader icon={<RadioTower className="h-5 w-5 text-emerald-300" />} title="비콘 신호 강도" right={averageRssi} />
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <InfoTile label="Beacon" value={`${rows.length}개`} />
          <InfoTile label="Sample" value={sampleCount ? `${sampleCount} readings` : '대기'} />
        </div>
        <div className="border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100">
          조끼가 측정한 비콘 RSSI/거리 → 게이트웨이 → WebSocket 대시보드
        </div>
        <div className="space-y-2">
          {rows.map((beacon) => (
            <div key={beacon.id} className="grid grid-cols-[76px_1fr_92px] items-center gap-2 text-xs sm:grid-cols-[88px_1fr_110px]">
              <span className="font-bold text-stone-200">{beacon.label}</span>
              <div className="h-2 bg-white/10">
                <div
                  className={`h-full ${
                    beacon.rssi === undefined
                      ? 'bg-stone-600'
                      : beacon.rssi <= -78
                        ? 'bg-red-400'
                        : beacon.rssi <= -65
                          ? 'bg-amber-300'
                          : 'bg-emerald-300'
                  }`}
                  style={{ width: `${beacon.quality}%` }}
                />
              </div>
              <span className="text-right font-semibold text-stone-400">
                {beacon.rssi === undefined ? '대기' : `${beacon.rssi} dBm`}
              </span>
              <span className="col-start-2 text-[11px] font-semibold text-stone-500">
                {floorLabels[beacon.floor]} · {beacon.dist !== undefined ? `${beacon.dist.toFixed(1)}m` : `${beacon.count} samples`} · {beacon.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RiskPredictionPanel({
  workers,
  zoneSettings,
}: {
  workers: Worker[];
  zoneSettings: Record<FloorId, ZoneSetting>;
}) {
  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <PanelHeader icon={<BrainCircuit className="h-5 w-5 text-amber-200" />} title="위험 패턴 분석" right="예측" />
      <div className="space-y-3 p-4">
        {workers.map((worker) => {
          const risk = calculateWorkerRisk(worker);
          const danger = !worker.is_hooked && isInSafetyHookZone(worker, zoneSettings);

          return (
            <article key={worker.worker_id} className="border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <strong className="text-sm text-stone-100">{worker.name}</strong>
                  <p className="mt-1 text-xs text-stone-500">
                    {floorLabels[worker.floor]} · {danger ? '미체결 존 진입' : statusMeta[worker.status].eventText}
                  </p>
                </div>
                <span className={`text-xl font-black ${risk >= 70 ? 'text-red-200' : risk >= 45 ? 'text-amber-100' : 'text-emerald-100'}`}>
                  {risk}%
                </span>
              </div>
              <div className="mt-3 h-2 bg-white/10">
                <div
                  className={`h-full ${risk >= 70 ? 'bg-red-400' : risk >= 45 ? 'bg-amber-300' : 'bg-emerald-300'}`}
                  style={{ width: `${risk}%` }}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
