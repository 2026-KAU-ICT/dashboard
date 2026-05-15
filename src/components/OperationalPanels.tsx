import { Bell, BrainCircuit, RadioTower } from 'lucide-react';
import { clamp } from '../lib/base';
import type { Esp32BeaconData, Esp32RuntimeData } from '../types';
import { PanelHeader } from './ui';

const OUTER_BEACON_IDS = ['BEACON_01', 'BEACON_04'];
const OUTER_DISTANCE_THRESHOLD = 2.5;

type RiskResult = {
  score: number;
  isNearOuterArea: boolean;
  hasWeakSignal: boolean;
  reason: string;
};

export function OperationalPanels({
  esp32Devices,
}: {
  esp32Devices: Esp32RuntimeData[];
}) {
  const rankedDevices = [...esp32Devices]
    .map((device) => ({
      device,
      risk: calculateDeviceRisk(device),
    }))
    .sort((a, b) => b.risk.score - a.risk.score)
    .slice(0, 4);

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <BeaconSignalPanel esp32Devices={esp32Devices} />
      <RiskPredictionPanel rankedDevices={rankedDevices} />
      <Esp32NotificationPanel esp32Devices={esp32Devices} />
    </section>
  );
}

export function calculateDeviceRisk(device: Esp32RuntimeData): RiskResult {
  const isUnhooked = !device.status.is_hooked;
  const hasFallen = device.status.has_fallen;

  const isNearOuterArea = device.beacons.some(
    (beacon) =>
      OUTER_BEACON_IDS.includes(beacon.id) &&
      typeof beacon.dist === 'number' &&
      beacon.dist > 0 &&
      beacon.dist <= OUTER_DISTANCE_THRESHOLD &&
      beacon.rssi > -100,
  );

  const hasWeakSignal = device.beacons.some(
    (beacon) => beacon.rssi > -100 && beacon.rssi <= -78,
  );

  let score = 0;

  if (hasFallen) score += 60;
  if (isUnhooked) score += 20;
  if (isNearOuterArea) score += 20;

  score = Math.min(score, 100);

  const reason = hasFallen
    ? '추락 감지'
    : isUnhooked && isNearOuterArea
      ? '미체결 상태로 외곽 접근'
      : isUnhooked
        ? '안전고리 미체결'
        : isNearOuterArea
          ? '외곽 위험 위치 접근'
          : '체결 완료';

  return {
    score,
    isNearOuterArea,
    hasWeakSignal,
    reason,
  };
}

function BeaconSignalPanel({ esp32Devices }: { esp32Devices: Esp32RuntimeData[] }) {
  const grouped = new Map<
    string,
    {
      id: string;
      rssiSum: number;
      count: number;
      dist?: number;
      gatewayIds: Set<number>;
    }
  >();

  esp32Devices.forEach((device) => {
    device.beacons.forEach((beacon: Esp32BeaconData) => {
      const current = grouped.get(beacon.id) ?? {
        id: beacon.id,
        rssiSum: 0,
        count: 0,
        dist: undefined,
        gatewayIds: new Set<number>(),
      };

      current.rssiSum += beacon.rssi;
      current.count += 1;
      current.dist =
        current.dist === undefined || beacon.dist < current.dist
          ? beacon.dist
          : current.dist;
      current.gatewayIds.add(device.gw_id);

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

  const gatewayNames = (ids: Set<number>) => {
    const list = [...ids].sort((a, b) => a - b).map((id) => `GW-${id}`);

    if (!list.length) {
      return '수신 대기';
    }

    return list.length > 2
      ? `${list.slice(0, 2).join(', ')} 외 ${list.length - 2}개`
      : list.join(', ');
  };

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <PanelHeader
        icon={<RadioTower className="h-5 w-5 text-emerald-300" />}
        title="비콘 신호 강도"
        right={averageRssi}
      />

      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-white/10 bg-black/25 px-3 py-2">
            <p className="text-[11px] font-semibold text-stone-500">수신 장비</p>
            <strong className="mt-1 block text-sm font-black text-stone-100">
              {esp32Devices.length}개 GW
            </strong>
          </div>

          <div className="border border-white/10 bg-black/25 px-3 py-2">
            <p className="text-[11px] font-semibold text-stone-500">활성 비콘</p>
            <strong className="mt-1 block text-sm font-black text-stone-100">
              {liveSignals.length}개 수신
            </strong>
          </div>
        </div>

        <div className="space-y-2">
          {liveSignals.length === 0 && (
            <div className="border border-white/10 bg-black/20 p-3 text-sm font-semibold text-stone-400">
              아직 수신된 비콘 데이터가 없습니다.
            </div>
          )}

          {liveSignals.map((beacon) => (
            <article key={beacon.id} className="border border-white/10 bg-black/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs font-black text-stone-100">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${signalTone(beacon.rssi)}`} />
                    <span className="truncate">{beacon.id}</span>
                  </p>

                  <p className="mt-1 truncate text-[11px] font-semibold text-stone-500">
                    {gatewayNames(beacon.gatewayIds)}
                  </p>
                </div>

                <span className={`shrink-0 whitespace-nowrap border px-2 py-1 text-xs font-black ${statusTone(beacon.rssi)}`}>
                  {beacon.status}
                </span>
              </div>

              <div className="mt-3">
                <div className="h-2.5 bg-white/10">
                  <div
                    className={`h-full ${signalTone(beacon.rssi)}`}
                    style={{ width: `${beacon.quality}%` }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-stone-500">
                  <span>
                    {beacon.dist !== undefined ? `거리 ${beacon.dist.toFixed(1)}m` : '거리 계산 대기'}
                  </span>
                  <span className="text-stone-300">{beacon.rssi} dBm</span>
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
  rankedDevices,
}: {
  rankedDevices: {
    device: Esp32RuntimeData;
    risk: RiskResult;
  }[];
}) {
  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <PanelHeader
        icon={<BrainCircuit className="h-5 w-5 text-amber-200" />}
        title="실시간 위험도 분석"
        right="가중치"
      />

      <div className="space-y-3 p-4">
        {rankedDevices.length === 0 && (
          <div className="border border-white/10 bg-black/20 p-3 text-sm font-semibold text-stone-400">
            아직 수신된 작업자 데이터가 없습니다.
          </div>
        )}

        {rankedDevices.map(({ device, risk }) => (
          <article key={device.gw_id} className="border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <strong className="text-sm text-stone-100">GW-{device.gw_id}</strong>
                <p className="mt-1 text-xs text-stone-500">
                  {risk.reason}
                  {risk.hasWeakSignal ? ' · 신호 약함' : ''}
                </p>
              </div>

              <span
                className={`text-xl font-black ${
                  risk.score >= 70
                    ? 'text-red-200'
                    : risk.score >= 45
                      ? 'text-amber-100'
                      : 'text-emerald-100'
                }`}
              >
                {risk.score}%
              </span>
            </div>

            <div className="mt-3 h-2 bg-white/10">
              <div
                className={`h-full ${
                  risk.score >= 70
                    ? 'bg-red-400'
                    : risk.score >= 45
                      ? 'bg-amber-300'
                      : 'bg-emerald-300'
                }`}
                style={{ width: `${risk.score}%` }}
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className="border border-white/10 px-2 py-1 text-stone-400">
                {device.status.is_hooked ? '체결' : '미체결'}
              </span>
              <span className="border border-white/10 px-2 py-1 text-stone-400">
                {device.status.has_fallen ? '추락 감지' : '추락 없음'}
              </span>
              <span className="border border-white/10 px-2 py-1 text-stone-400">
                {risk.isNearOuterArea ? '외곽 접근' : '외곽 아님'}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Esp32NotificationPanel({ esp32Devices }: { esp32Devices: Esp32RuntimeData[] }) {
  const notifications = [...esp32Devices]
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
    .map((device) => {
      const status = device.status.has_fallen
        ? '비상'
        : device.status.is_hooked
          ? '정상'
          : '경고';

      const message = device.status.has_fallen
        ? '추락 감지'
        : device.status.is_hooked
          ? '체결 완료'
          : '안전고리 미체결';

      return {
        id: `${device.gw_id}-${device.receivedAt}`,
        time: new Date(device.receivedAt).toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
        title: `GW-${device.gw_id}`,
        status,
        message,
      };
    });

  const statusTone = (status: string) => {
    if (status === '비상') {
      return 'border-red-300/35 bg-red-400/10 text-red-100';
    }

    if (status === '경고') {
      return 'border-amber-300/35 bg-amber-300/10 text-amber-100';
    }

    return 'border-emerald-300/35 bg-emerald-300/10 text-emerald-100';
  };

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <PanelHeader
        icon={<Bell className="h-5 w-5 text-amber-200" />}
        title="실시간 알림 센터"
        right={String(notifications.length)}
      />

      <div className="max-h-[410px] overflow-y-auto">
        {notifications.length === 0 && (
          <div className="border-t border-white/10 p-4 text-sm font-semibold text-stone-400">
            아직 수신된 알림이 없습니다.
          </div>
        )}

        {notifications.map((item) => (
          <article key={item.id} className="border-t border-white/10 px-4 py-3">
            <div className="grid grid-cols-[80px_1fr_auto] items-start gap-3">
              <span className="text-xs font-semibold text-stone-500">{item.time}</span>

              <div>
                <strong className="text-sm text-stone-100">{item.title}</strong>
                <p className="mt-1 text-xs font-semibold text-stone-400">{item.message}</p>
              </div>

              <span className={`whitespace-nowrap border px-2 py-1 text-xs font-black ${statusTone(item.status)}`}>
                {item.status}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}