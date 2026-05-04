import { BellRing, BrainCircuit, CheckCircle2, Network, Radio, TimerReset, Waves } from 'lucide-react';
import { airbagLabels, cartridgeLabels, floorLabels, gatewayNodes, statusMeta } from '../config/dashboard';
import { clamp } from '../lib/base';
import { calculateWorkerRisk, isInSafetyHookZone } from '../lib/safety';
import type { FloorId, Worker, ZoneSetting } from '../types';
import { InfoTile, MiniSparkline, PanelHeader } from './ui';

export function OperationalPanels({
  workers,
  selectedWorker,
  zoneSettings,
}: {
  workers: Worker[];
  selectedWorker?: Worker;
  zoneSettings: Record<FloorId, ZoneSetting>;
}) {
  const rankedWorkers = [...workers].sort((a, b) => calculateWorkerRisk(b) - calculateWorkerRisk(a)).slice(0, 4);

  return (
    <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
      <GatewayMeshPanel workers={workers} />
      <RiskPredictionPanel workers={rankedWorkers} zoneSettings={zoneSettings} />
      <TelemetryPanel worker={selectedWorker} />
      <IncidentResponsePanel worker={selectedWorker} />
    </section>
  );
}

function GatewayMeshPanel({ workers }: { workers: Worker[] }) {
  const enrichedNodes = gatewayNodes.map((node) => {
    const nodeWorkers = workers.filter((worker) => worker.gateway === node.id);
    const liveRssi = nodeWorkers.length
      ? Math.round(nodeWorkers.reduce((sum, worker) => sum + worker.telemetry.rssiDbm, 0) / nodeWorkers.length)
      : node.rssi;
    const quality = clamp(100 - Math.abs(liveRssi + 45) * 3, 24, 96);
    const status = liveRssi <= -74 ? '주의' : liveRssi <= -67 ? '보통' : '안정';

    return {
      ...node,
      liveRssi,
      quality,
      status,
      vestCount: nodeWorkers.length,
    };
  });
  const averageRssi = Math.round(enrichedNodes.reduce((sum, node) => sum + node.liveRssi, 0) / enrichedNodes.length);
  const packetRate = gatewayNodes.reduce((sum, node) => sum + node.packets, 0) + workers.length * 12;
  const vestCountByGateway = workers.reduce<Record<string, number>>((counts, worker) => {
    counts[worker.gateway] = (counts[worker.gateway] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <PanelHeader icon={<Network className="h-5 w-5 text-emerald-300" />} title="게이트웨이 브리지" right={`${averageRssi} dBm`} />
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <InfoTile label="Gateway" value={`${gatewayNodes.length} online`} />
          <InfoTile label="Packet" value={`${packetRate}/min`} />
        </div>
        <div className="border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100">
          조끼 BLE → 가까운 게이트웨이 → WebSocket 대시보드
        </div>
        <div className="space-y-2">
          {enrichedNodes.map((node) => (
            <div key={node.id} className="grid grid-cols-[76px_1fr_92px] items-center gap-2 text-xs sm:grid-cols-[88px_1fr_110px]">
              <span className="font-bold text-stone-200">{node.id}</span>
              <div className="h-2 bg-white/10">
                <div
                  className={`h-full ${
                    node.liveRssi <= -74 ? 'bg-red-400' : node.liveRssi <= -67 ? 'bg-amber-300' : 'bg-emerald-300'
                  }`}
                  style={{ width: `${node.quality}%` }}
                />
              </div>
              <span className="text-right font-semibold text-stone-400">
                {node.liveRssi} dBm · {vestCountByGateway[node.id] ?? 0}개
              </span>
              <span className="col-start-2 text-[11px] font-semibold text-stone-500">
                {floorLabels[node.floor]} BLE mesh · {node.status}
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

function TelemetryPanel({ worker }: { worker?: Worker }) {
  if (!worker) {
    return null;
  }

  const samples = Array.from({ length: 18 }, (_, index) => {
    const base = Math.sin(index * 0.78 + worker.coords.x / 20) * worker.telemetry.accelerationG * 8;
    const spike = worker.status === 'EMERGENCY' && index === 12 ? worker.telemetry.impactPeakG * 11 : 0;
    return clamp(42 - base - spike, 8, 76);
  });
  const confidenceSamples = Array.from({ length: 18 }, (_, index) => {
    const trend = worker.telemetry.fallConfidence - (17 - index) * 2.6 + Math.sin(index * 0.7) * 5;
    return clamp(trend, 0, 100);
  });
  const latencyScore = clamp(Math.round(((200 - worker.telemetry.latencyMs) / 200) * 100), 0, 100);
  const path = samples.map((y, index) => `${index === 0 ? 'M' : 'L'} ${index * 14} ${y}`).join(' ');

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <PanelHeader icon={<Waves className="h-5 w-5 text-cyan-200" />} title="센서 텔레메트리" right={worker.worker_id} />
      <div className="p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <InfoTile label="Battery" value={`${Math.round(worker.battery)}%`} />
          <InfoTile label="RSSI" value={`${worker.telemetry.rssiDbm} dBm`} />
          <InfoTile label="6축 IMU" value={`${worker.telemetry.accelerationG.toFixed(1)}g`} />
          <InfoTile label="Impact" value={`${worker.telemetry.impactPeakG.toFixed(1)}g`} />
          <InfoTile label="Fall AI" value={`${worker.telemetry.fallConfidence}%`} />
          <InfoTile label="Latency" value={`${worker.telemetry.latencyMs}ms`} />
        </div>
        <div className="mt-4 border border-white/10 bg-black/25 p-3">
          <svg viewBox="0 0 238 84" className="h-24 w-full" role="img" aria-label="IMU waveform">
            <path d="M0 42 H238" stroke="rgba(255,255,255,0.13)" strokeWidth="1" />
            <path d={path} fill="none" stroke={worker.status === 'EMERGENCY' ? '#f87171' : '#67e8f9'} strokeWidth="3" />
          </svg>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <MiniSparkline title="Battery" values={worker.batteryHistory} min={0} max={100} tone={worker.battery <= 25 ? 'red' : 'emerald'} unit="%" />
          <MiniSparkline title="RSSI" values={worker.rssiHistory} min={-90} max={-45} tone={worker.telemetry.rssiDbm <= -72 ? 'red' : 'cyan'} unit="dBm" />
          <MiniSparkline
            title="Fall AI"
            values={confidenceSamples}
            min={0}
            max={100}
            tone={worker.telemetry.fallConfidence >= 70 ? 'red' : 'cyan'}
            unit="%"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <InfoTile label="Airbag" value={`${airbagLabels[worker.telemetry.airbagState]} · ${cartridgeLabels[worker.telemetry.airbagCartridge]}`} />
          <InfoTile label="Edge Logic" value={worker.telemetry.latencyMs <= 200 ? '0.2s 이내' : '지연'} />
        </div>
        <div className="mt-3 border border-white/10 bg-black/25 p-3">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-stone-400">0.2초 판정 SLA</span>
            <span className={worker.telemetry.latencyMs <= 200 ? 'text-emerald-100' : 'text-red-200'}>
              {worker.telemetry.latencyMs}ms
            </span>
          </div>
          <div className="mt-2 h-2 bg-white/10">
            <div
              className={worker.telemetry.latencyMs <= 200 ? 'h-full bg-emerald-300' : 'h-full bg-red-400'}
              style={{ width: `${latencyScore}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function IncidentResponsePanel({ worker }: { worker?: Worker }) {
  if (!worker) {
    return null;
  }

  const packetAgeMs = Math.max(0, Date.now() - new Date(worker.timestamp).getTime());
  const packetAge = packetAgeMs < 1000 ? `${packetAgeMs}ms` : `${Math.round(packetAgeMs / 1000)}s`;
  const isFallSuspected = worker.status === 'EMERGENCY' || worker.telemetry.fallConfidence >= 70;
  const steps = [
    {
      label: '센서 수집',
      value: worker.is_hooked ? '고리 체결' : '미체결',
      detail: `${worker.telemetry.accelerationG.toFixed(1)}g IMU`,
      icon: Radio,
      active: true,
    },
    {
      label: '엣지 판단',
      value: isFallSuspected ? '추락 의심' : '정상 감시',
      detail: `${worker.telemetry.fallConfidence}% confidence`,
      icon: BrainCircuit,
      active: isFallSuspected || worker.status === 'WARNING',
    },
    {
      label: '에어백/LED',
      value: airbagLabels[worker.telemetry.airbagState],
      detail: cartridgeLabels[worker.telemetry.airbagCartridge],
      icon: BellRing,
      active: worker.telemetry.airbagState !== 'READY' || worker.telemetry.ledMode === 'FLASH',
    },
    {
      label: '관제 반영',
      value: worker.telemetry.latencyMs <= 200 ? '0.2s 이내' : '지연 확인',
      detail: `${worker.telemetry.latencyMs}ms WebSocket`,
      icon: TimerReset,
      active: worker.telemetry.latencyMs <= 200,
    },
  ];

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <PanelHeader icon={<CheckCircle2 className="h-5 w-5 text-emerald-300" />} title="사고 대응 플로우" right={worker.worker_id} />
      <div className="p-4">
        <div className="grid grid-cols-2 gap-2">
          <InfoTile label="최근 패킷" value={packetAge} />
          <InfoTile label="대응 단계" value={worker.status === 'EMERGENCY' ? '비상' : worker.status === 'WARNING' ? '경고' : '감시'} />
        </div>
        <div className="mt-4 space-y-3">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.label} className="grid grid-cols-[32px_1fr] gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-8 w-8 items-center justify-center border ${
                      step.active
                        ? 'border-emerald-300/45 bg-emerald-300 text-emerald-950'
                        : 'border-white/10 bg-black/25 text-stone-500'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  {index < steps.length - 1 ? <div className="h-7 w-px bg-white/10" /> : null}
                </div>
                <div className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm text-stone-100">{step.label}</strong>
                    <span className={step.active ? 'text-xs font-black text-emerald-100' : 'text-xs font-bold text-stone-500'}>
                      {step.value}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-stone-500">{step.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
