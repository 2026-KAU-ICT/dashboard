import { BrainCircuit, RadioTower } from 'lucide-react';
import { beaconAnchors, floorLabels, statusMeta } from '../config/dashboard';
import { clamp } from '../lib/base';
import { calculateWorkerRisk, isInSafetyHookZone } from '../lib/safety';
import type { BeaconSignal, EventLog, FloorId, Worker, ZoneSetting } from '../types';
import { NotificationPanel } from './NotificationPanel';
import { PanelHeader } from './ui';

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
  const grouped = new Map<
    string,
    {
      id: string;
      label: string;
      rssiSum: number;
      count: number;
      dist?: number;
      workerNames: Set<string>;
    }
  >();

  workers.forEach((worker) => {
    worker.beacons?.forEach((beacon: BeaconSignal) => {
      const anchor = beaconAnchors.find((item) => item.id.toLowerCase() === beacon.id.toLowerCase());
      const current = grouped.get(beacon.id) ?? {
        id: beacon.id,
        label: anchor?.label ?? beacon.id,
        rssiSum: 0,
        count: 0,
        dist: undefined,
        workerNames: new Set<string>(),
      };

      current.rssiSum += beacon.rssi;
      current.count += 1;
      current.dist = current.dist === undefined || (beacon.dist !== undefined && beacon.dist < current.dist) ? beacon.dist : current.dist;
      current.workerNames.add(worker.name);
      grouped.set(beacon.id, current);
    });
  });

  const liveSignals = [...grouped.values()]
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
    .sort((a, b) => a.id.localeCompare(b.id));

  const fallbackBeacons = Array.from(
    new Map(
      beaconAnchors
        .filter((anchor) => anchor.id.startsWith('Safety_'))
        .map((anchor) => [anchor.id, anchor]),
    ).values(),
  ).slice(0, 4);
  const rows = fallbackBeacons.map((anchor) => {
    const liveSignal = liveSignals.find((signal) => signal.id.toLowerCase() === anchor.id.toLowerCase());
    return liveSignal ?? {
      id: anchor.id,
      label: anchor.label,
      rssi: undefined,
      quality: 12,
      status: '수신 대기',
      dist: undefined,
      count: 0,
      workerNames: new Set<string>(),
    };
  });
  const averageRssi = liveSignals.length
    ? `${Math.round(liveSignals.reduce((sum, row) => sum + row.rssi, 0) / liveSignals.length)} dBm`
    : '수신 대기';
  const signalTone = (rssi?: number) =>
    rssi === undefined
      ? 'bg-stone-600'
      : rssi <= -78
        ? 'bg-red-400'
        : rssi <= -65
          ? 'bg-amber-300'
          : 'bg-emerald-300';
  const statusTone = (rssi?: number) =>
    rssi === undefined
      ? 'border-stone-500/30 bg-stone-500/10 text-stone-400'
      : rssi <= -78
        ? 'border-red-300/35 bg-red-400/10 text-red-100'
        : rssi <= -65
          ? 'border-amber-300/35 bg-amber-300/10 text-amber-100'
          : 'border-emerald-300/35 bg-emerald-300/10 text-emerald-100';
  const workerNames = (names: Set<string>) => {
    const list = [...names];
    if (!list.length) {
      return '감지 대기';
    }

    return list.length > 2 ? `${list.slice(0, 2).join(', ')} 외 ${list.length - 2}명` : list.join(', ');
  };

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <PanelHeader icon={<RadioTower className="h-5 w-5 text-emerald-300" />} title="비콘 신호 강도" right={averageRssi} />
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-white/10 bg-black/25 px-3 py-2">
            <p className="text-[11px] font-semibold text-stone-500">설치 비콘</p>
            <strong className="mt-1 block text-sm font-black text-stone-100">{rows.length}개 기준점</strong>
          </div>
          <div className="border border-white/10 bg-black/25 px-3 py-2">
            <p className="text-[11px] font-semibold text-stone-500">활성 비콘</p>
            <strong className="mt-1 block text-sm font-black text-stone-100">
              {liveSignals.length}/{rows.length}개 수신
            </strong>
          </div>
        </div>
        <div className="space-y-2">
          {rows.map((beacon) => (
            <article key={beacon.id} className="border border-white/10 bg-black/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs font-black text-stone-100">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${signalTone(beacon.rssi)}`} />
                    <span className="truncate">{beacon.label}</span>
                  </p>
                  <p className="mt-1 truncate text-[11px] font-semibold text-stone-500">{workerNames(beacon.workerNames)}</p>
                </div>
                <span className={`shrink-0 whitespace-nowrap border px-2 py-1 text-xs font-black ${statusTone(beacon.rssi)}`}>
                  {beacon.status}
                </span>
              </div>
              <div className="mt-3">
                <div className="h-2.5 bg-white/10">
                  <div className={`h-full ${signalTone(beacon.rssi)}`} style={{ width: `${beacon.quality}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-stone-500">
                  <span>{beacon.dist !== undefined ? `거리 ${beacon.dist.toFixed(1)}m` : '거리 계산 대기'}</span>
                  <span className="text-stone-300">
                    {beacon.rssi === undefined ? 'RSSI 대기' : `${beacon.rssi} dBm`}
                  </span>
                </div>
              </div>
            </article>
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
