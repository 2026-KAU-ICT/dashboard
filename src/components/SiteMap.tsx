import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { MapPinned, RadioTower, UserRound } from 'lucide-react';
import campusMap from '../assets/kau-campus.png';
import { floorLabels, mapZones, statusMeta } from '../config/dashboard';
import { clamp } from '../lib/base';
import {
  calculateWorkerRisk,
  clusterWorkerPoints,
  getMapZone,
  mapCoordsToZone,
  mapWorkerToZone,
  viewportToFloorCoords,
} from '../lib/safety';
import type { Coordinate, FloorFilter, FloorId, Worker, ZoneSetting } from '../types';
import { StatusBadge } from './ui';

export function SiteMap({
  workers,
  selectedFloor,
  selectedWorkerId,
  zoneSettings,
  editableZoneFloors,
  onZoneCenterChange,
  onFloorChange,
  onSelectWorker,
}: {
  workers: Worker[];
  selectedFloor: FloorFilter;
  selectedWorkerId?: string;
  zoneSettings: Record<FloorId, ZoneSetting>;
  editableZoneFloors: FloorId[];
  onZoneCenterChange: (floor: FloorId, center: Coordinate) => void;
  onFloorChange: (floor: FloorFilter) => void;
  onSelectWorker: (workerId: string) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [dragFloor, setDragFloor] = useState<FloorId | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const visibleWorkers = selectedFloor === 'ALL' ? workers : workers.filter((worker) => worker.floor === selectedFloor);
  const clusters = useMemo(() => clusterWorkerPoints(visibleWorkers), [visibleWorkers]);
  const selectedWorker = workers.find((worker) => worker.worker_id === selectedWorkerId);
  const selectedCluster = clusters.find((cluster) => cluster.id === selectedClusterId);
  const selectedMapPoint = selectedWorker ? mapWorkerToZone(selectedWorker) : undefined;
  const selectedZone = selectedWorker ? getMapZone(selectedWorker.floor) : undefined;
  const breadcrumbPath =
    selectedWorker && (selectedFloor === 'ALL' || selectedFloor === selectedWorker.floor)
      ? selectedWorker.trace
          .map((sample, index) => {
            const point = mapCoordsToZone(selectedWorker.floor, sample);
            return `${index === 0 ? 'M' : 'L'} ${point.left} ${point.top}`;
          })
          .join(' ')
      : '';

  const updateDraggedZone = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragFloor || !mapRef.current || !editableZoneFloors.includes(dragFloor)) {
      return;
    }

    const rect = mapRef.current.getBoundingClientRect();
    const leftPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const topPercent = ((event.clientY - rect.top) / rect.height) * 100;
    onZoneCenterChange(dragFloor, viewportToFloorCoords(dragFloor, leftPercent, topPercent));
  };

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <div className="flex flex-col gap-3 border-b border-white/10 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-stone-100">
            <MapPinned className="h-5 w-5 text-emerald-300" />
            항공뷰 모니터링
          </div>
          <p className="mt-1 text-sm text-stone-400">조끼 BLE → 가까운 게이트웨이 → WebSocket 웹</p>
        </div>

        <div className="grid grid-cols-4 border border-white/10 bg-black/20 text-xs font-semibold sm:text-sm">
          {(['ALL', '3F', '4F', 'ROOF'] as FloorFilter[]).map((floor) => (
            <button
              key={floor}
              type="button"
              className={`px-2 py-2 transition sm:px-3 ${
                selectedFloor === floor ? 'bg-emerald-300 text-emerald-950' : 'text-stone-300 hover:bg-white/10'
              }`}
              onClick={() => onFloorChange(floor)}
            >
              {floor === 'ALL' ? '전체' : floorLabels[floor]}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 sm:p-4">
        <div
          ref={mapRef}
          className="map-grid relative aspect-[1901/911] min-h-[260px] overflow-hidden border border-white/10 bg-[#0f1412] sm:min-h-[360px] lg:min-h-[460px]"
          onPointerMove={updateDraggedZone}
          onPointerUp={() => setDragFloor(null)}
          onPointerLeave={() => setDragFloor(null)}
        >
          <img
            src={campusMap}
            alt="한국항공대학교 강의동 항공뷰"
            className="absolute inset-0 h-full w-full object-cover opacity-90"
            draggable={false}
          />
          <div className="pointer-events-none absolute inset-0 bg-black/10" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1/3 animate-scan bg-gradient-to-b from-transparent via-cyan-200/10 to-transparent" />

          {mapZones.map((zone) => {
            const dimmed = selectedFloor !== 'ALL' && selectedFloor !== zone.floor;
            const setting = zoneSettings[zone.floor];
            const isZoneEditable = editableZoneFloors.includes(zone.floor);
            const dangerWidth = clamp((setting.dangerRadius * 2 / zone.metersWidth) * 100, 16, 48);
            const dangerHeight = clamp((setting.dangerRadius * 2 / zone.metersHeight) * 100, 16, 48);
            return (
              <div
                key={zone.floor}
                className={`absolute border-2 transition ${dimmed ? 'opacity-30' : 'opacity-100'}`}
                style={{
                  left: `${zone.left}%`,
                  top: `${zone.top}%`,
                  width: `${zone.width}%`,
                  height: `${zone.height}%`,
                  background: zone.color,
                  borderColor: zone.border,
                }}
              >
                <div className="absolute left-2 top-2 inline-flex items-center gap-1.5 border border-white/10 bg-black/55 px-1.5 py-1 text-[10px] font-black text-stone-100 backdrop-blur sm:gap-2 sm:px-2 sm:text-xs">
                  <RadioTower className="h-3.5 w-3.5" />
                  {floorLabels[zone.floor]} Gateway
                </div>
                <div
                  className={`absolute rounded-full border border-amber-200/75 bg-amber-300/10 touch-none ${
                    isZoneEditable ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-70'
                  }`}
                  style={{
                    left: `${(setting.center.x / zone.sourceWidth) * 100}%`,
                    top: `${(setting.center.y / zone.sourceHeight) * 100}%`,
                    width: `${dangerWidth}%`,
                    height: `${dangerHeight}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    if (isZoneEditable) {
                      setDragFloor(zone.floor);
                    }
                  }}
                >
                  <span className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 whitespace-nowrap border border-amber-200/30 bg-black/55 px-2 py-1 text-[11px] font-black text-amber-100 sm:block">
                    Hook Zone
                  </span>
                </div>
              </div>
            );
          })}

          {breadcrumbPath ? (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d={breadcrumbPath} fill="none" stroke="rgba(251, 191, 36, 0.78)" strokeDasharray="1.6 1.6" strokeWidth="0.45" />
              {selectedWorker?.trace.map((sample, index) => {
                const point = mapCoordsToZone(selectedWorker.floor, sample);
                return (
                  <circle
                    key={`${sample.timestamp}-${index}`}
                    cx={point.left}
                    cy={point.top}
                    r={index === selectedWorker.trace.length - 1 ? 0.72 : 0.38}
                    fill={index === selectedWorker.trace.length - 1 ? '#fbbf24' : 'rgba(251, 191, 36, 0.52)'}
                  />
                );
              })}
            </svg>
          ) : null}

          {clusters.map((cluster) => {
            if (cluster.points.length > 1) {
              const urgent = cluster.points.some((point) => point.status === 'EMERGENCY');
              return (
                <button
                  type="button"
                  key={cluster.id}
                  className={`absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center border-2 text-sm font-black ring-4 transition hover:scale-110 sm:h-12 sm:w-12 ${
                    urgent
                      ? 'border-red-200 bg-red-500 text-white ring-red-300/60'
                      : 'border-cyan-100 bg-cyan-300 text-cyan-950 ring-cyan-200/40'
                  }`}
                  style={{ left: `${cluster.left}%`, top: `${cluster.top}%` }}
                  onClick={() => setSelectedClusterId(selectedClusterId === cluster.id ? null : cluster.id)}
                  title={`${cluster.points.length}명 작업자`}
                >
                  {cluster.points.length}
                </button>
              );
            }

            const worker = cluster.points[0];
            const point = worker.mapPoint;
            const meta = statusMeta[worker.status];
            const isSelected = worker.worker_id === selectedWorkerId;
            const risk = calculateWorkerRisk(worker);

            return (
              <button
                type="button"
                key={worker.worker_id}
                className={`absolute flex h-10 w-10 items-center justify-center border-2 sm:h-11 sm:w-11 ${meta.border} ${
                  worker.status === 'EMERGENCY' ? 'animate-pulseDanger' : '-translate-x-1/2 -translate-y-1/2'
                } ${meta.marker} ring-4 transition hover:scale-110 ${isSelected ? 'outline outline-2 outline-white' : ''}`}
                style={{
                  left: `${point.left}%`,
                  top: `${point.top}%`,
                }}
                title={`${worker.name} ${floorLabels[worker.floor]} ${meta.label}`}
                onClick={() => onSelectWorker(worker.worker_id)}
              >
                <UserRound className="h-5 w-5" />
                <span className="sr-only">{worker.name}</span>
                <span className="absolute left-1/2 top-full mt-2 hidden min-w-24 -translate-x-1/2 border border-white/10 bg-black/70 px-2 py-1 text-xs font-bold text-stone-50 shadow-panel backdrop-blur sm:block">
                  {worker.worker_id} · {risk}%
                </span>
              </button>
            );
          })}

          {selectedCluster ? (
            <div
              className="absolute z-20 min-w-44 -translate-x-1/2 border border-white/10 bg-black/80 p-2 shadow-panel backdrop-blur"
              style={{ left: `${selectedCluster.left}%`, top: `${selectedCluster.top + 7}%` }}
            >
              {selectedCluster.points.map((worker) => (
                <button
                  key={worker.worker_id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left text-xs font-bold text-stone-100 hover:bg-white/10"
                  onClick={() => {
                    onSelectWorker(worker.worker_id);
                    setSelectedClusterId(null);
                  }}
                >
                  <span>{worker.name}</span>
                  <StatusBadge status={worker.status} />
                </button>
              ))}
            </div>
          ) : null}

          {selectedMapPoint ? (
            <div className="absolute left-3 right-3 top-3 border border-white/10 bg-black/65 px-3 py-2 text-[11px] font-semibold text-stone-200 backdrop-blur sm:left-auto sm:right-3 sm:text-xs">
              {selectedMapPoint.pixelX}px, {selectedMapPoint.pixelY}px · {selectedMapPoint.meterX}m, {selectedMapPoint.meterY}m
            </div>
          ) : null}

          <div className="absolute bottom-3 left-3 grid gap-2 text-xs font-semibold text-stone-200 sm:grid-cols-3">
            <LegendItem color="bg-emerald-400" label="정상" />
            <LegendItem color="bg-amber-300" label="경고" />
            <LegendItem color="bg-red-500" label="비상" />
          </div>
        </div>

        {selectedWorker && selectedMapPoint && selectedZone ? (
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
            <CalibrationTile label="상대 좌표" value={`${Math.round(selectedWorker.coords.x)}, ${Math.round(selectedWorker.coords.y)}`} />
            <CalibrationTile label="항공뷰 픽셀" value={`${selectedMapPoint.pixelX}px, ${selectedMapPoint.pixelY}px`} />
            <CalibrationTile label="현장 거리" value={`${selectedMapPoint.meterX}m, ${selectedMapPoint.meterY}m`} />
            <CalibrationTile
              label="RSSI/스케일"
              value={`${selectedWorker.telemetry.rssiDbm} dBm · ${selectedZone.metersWidth}m x ${selectedZone.metersHeight}m`}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CalibrationTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/10 bg-black/25 px-3 py-2">
      <p className="text-[11px] font-semibold text-stone-500">{label}</p>
      <p className="mt-1 break-keep text-sm font-black text-stone-100">{value}</p>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 border border-white/10 bg-black/55 px-2.5 py-1.5 backdrop-blur">
      <span className={`h-2.5 w-2.5 ${color}`} />
      {label}
    </span>
  );
}
