import { BrainCircuit, Network, Waves } from 'lucide-react';
import { airbagLabels, cartridgeLabels, floorLabels, gatewayNodes, statusMeta } from '../config/dashboard';
import { clamp } from '../lib/base';
import { calculateWorkerRisk, isInSafetyHookZone } from '../lib/safety';
import type { Worker } from '../types';
import { InfoTile, MiniSparkline, PanelHeader } from './ui';

export function OperationalPanels({
  workers,
  selectedWorker,
}: {
  workers: Worker[];
  selectedWorker?: Worker;
}) {
  const rankedWorkers = [...workers].sort((a, b) => calculateWorkerRisk(b) - calculateWorkerRisk(a)).slice(0, 4);

  return (
    <section className="grid gap-4 xl:grid-cols-3">
      <GatewayMeshPanel />
      <RiskPredictionPanel workers={rankedWorkers} />
      <TelemetryPanel worker={selectedWorker} />
    </section>
  );
}

function GatewayMeshPanel() {
  const averageRssi = Math.round(gatewayNodes.reduce((sum, node) => sum + node.rssi, 0) / gatewayNodes.length);
  const packetRate = gatewayNodes.reduce((sum, node) => sum + node.packets, 0);

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <PanelHeader icon={<Network className="h-5 w-5 text-emerald-300" />} title="BLE Mesh 네트워크" right={`${averageRssi} dBm`} />
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <InfoTile label="Gateway" value={`${gatewayNodes.length} online`} />
          <InfoTile label="Packet" value={`${packetRate}/min`} />
        </div>
        <div className="space-y-2">
          {gatewayNodes.map((node) => (
            <div key={node.id} className="grid grid-cols-[88px_1fr_56px] items-center gap-2 text-xs">
              <span className="font-bold text-stone-200">{node.id}</span>
              <div className="h-2 bg-white/10">
                <div
                  className="h-full bg-emerald-300"
                  style={{ width: `${clamp(100 - Math.abs(node.rssi + 45) * 3, 24, 96)}%` }}
                />
              </div>
              <span className="text-right font-semibold text-stone-400">{floorLabels[node.floor]}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RiskPredictionPanel({ workers }: { workers: Worker[] }) {
  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <PanelHeader icon={<BrainCircuit className="h-5 w-5 text-amber-200" />} title="위험 패턴 분석" right="예측" />
      <div className="space-y-3 p-4">
        {workers.map((worker) => {
          const risk = calculateWorkerRisk(worker);
          const danger = !worker.is_hooked && isInSafetyHookZone(worker);

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
  const path = samples.map((y, index) => `${index === 0 ? 'M' : 'L'} ${index * 14} ${y}`).join(' ');

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <PanelHeader icon={<Waves className="h-5 w-5 text-cyan-200" />} title="센서 텔레메트리" right={worker.worker_id} />
      <div className="p-4">
        <div className="grid grid-cols-2 gap-2">
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
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <MiniSparkline title="Battery" values={worker.batteryHistory} min={0} max={100} tone={worker.battery <= 25 ? 'red' : 'emerald'} unit="%" />
          <MiniSparkline title="RSSI" values={worker.rssiHistory} min={-90} max={-45} tone={worker.telemetry.rssiDbm <= -72 ? 'red' : 'cyan'} unit="dBm" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <InfoTile label="Airbag" value={`${airbagLabels[worker.telemetry.airbagState]} · ${cartridgeLabels[worker.telemetry.airbagCartridge]}`} />
          <InfoTile label="Edge Logic" value={worker.telemetry.latencyMs <= 200 ? '0.2s 이내' : '지연'} />
        </div>
      </div>
    </section>
  );
}
