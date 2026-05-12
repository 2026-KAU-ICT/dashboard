import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { Layers3, MapPinned, RadioTower, UserRound } from 'lucide-react';
import campusMap from '../assets/kau-campus.png';
import { beaconAnchors, floorLabels, statusMeta } from '../config/dashboard';
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

const floorTabs: FloorId[] = ['1F', '2F', '3F', '4F'];
const satelliteMapUrl = String(import.meta.env.VITE_SITE_SATELLITE_MAP_URL ?? '').trim();

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
  const activeFloor: FloorId = selectedFloor === 'ALL' ? '1F' : selectedFloor;
  const mapSource = satelliteMapUrl || campusMap;
  const activeZone = getMapZone(activeFloor);
  const visibleWorkers = workers.filter((worker) => worker.floor === activeFloor);
  const clusters = useMemo(() => clusterWorkerPoints(visibleWorkers), [visibleWorkers]);
  const selectedWorker = workers.find((worker) => worker.worker_id === selectedWorkerId && worker.floor === activeFloor);
  const selectedCluster = clusters.find((cluster) => cluster.id === selectedClusterId);
  const selectedMapPoint = selectedWorker ? mapWorkerToZone(selectedWorker) : undefined;
  const setting = zoneSettings[activeFloor];
  const isZoneEditable = editableZoneFloors.includes(activeFloor);
  const beaconPoints = beaconAnchors
    .filter((anchor) => anchor.floor === activeFloor && anchor.id.startsWith('Safety_'))
    .map((anchor) => ({
      anchor,
      point: mapCoordsToZone(activeFloor, anchor),
    }));
  const beaconPolygonPoints = beaconPoints.map(({ point }) => `${point.left},${point.top}`).join(' ');
  const dangerWidth = clamp((setting.dangerRadius * 2 / activeZone.metersWidth) * 100, 12, 52);
  const dangerHeight = clamp((setting.dangerRadius * 2 / activeZone.metersHeight) * 100, 12, 52);
  const breadcrumbPath = selectedWorker
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
            층별 관제뷰
          </div>
          <p className="mt-1 text-sm text-stone-400">층별 독립 좌표계 · 조끼 BLE → 가까운 게이트웨이 → WebSocket 웹</p>
        </div>

        <div className="grid grid-cols-4 border border-white/10 bg-black/20 text-xs font-semibold sm:text-sm">
          {floorTabs.map((floor) => (
            <button
              key={floor}
              type="button"
              className={`px-2 py-2 transition sm:px-3 ${
                activeFloor === floor ? 'bg-emerald-300 text-emerald-950' : 'text-stone-300 hover:bg-white/10'
              }`}
              onClick={() => {
                setSelectedClusterId(null);
                onFloorChange(floor);
              }}
            >
              {floorLabels[floor]}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 sm:p-4">
        <div
          ref={mapRef}
          className="map-grid relative aspect-[1901/911] min-h-[260px] overflow-hidden border border-white/10 bg-[#0f1412] sm:min-h-[360px] lg:min-h-[520px]"
          onPointerMove={updateDraggedZone}
          onPointerUp={() => {
            setDragFloor(null);
          }}
          onPointerLeave={() => {
            setDragFloor(null);
          }}
        >
          <img
            src={mapSource}
            alt={`${floorLabels[activeFloor]} 한국항공대학교 강의동 관제뷰`}
            className="absolute inset-0 h-full w-full object-cover opacity-90"
            draggable={false}
          />
          <div className="pointer-events-none absolute inset-0 bg-black/10" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1/3 animate-scan bg-gradient-to-b from-transparent via-cyan-200/10 to-transparent" />

          <div
            className="absolute inset-0 border-2 transition"
            style={{
              background: activeZone.color,
              borderColor: activeZone.border,
            }}
          >
            <div className="absolute right-2 top-2 inline-flex items-center gap-1.5 border border-white/10 bg-black/60 px-1.5 py-1 text-[10px] font-black text-stone-100 backdrop-blur sm:gap-2 sm:px-2 sm:text-xs">
              <Layers3 className="h-3.5 w-3.5" />
              {visibleWorkers.length}명 표시
            </div>
            <div className="absolute left-2 top-2 inline-flex items-center gap-1.5 border border-cyan-200/20 bg-black/60 px-1.5 py-1 text-[10px] font-black text-cyan-100 backdrop-blur sm:gap-2 sm:px-2 sm:text-xs">
              <RadioTower className="h-3.5 w-3.5" />
              비콘 설치 범위
            </div>
            {beaconPolygonPoints ? (
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon
                  points={beaconPolygonPoints}
                  fill="rgba(34, 211, 238, 0.1)"
                  stroke="rgba(103, 232, 249, 0.84)"
                  strokeDasharray="1.4 1.1"
                  strokeWidth="0.42"
                />
              </svg>
            ) : null}
            {beaconPoints.map(({ anchor, point }) => (
              <div
                key={`${anchor.floor}-${anchor.id}`}
                className="pointer-events-none absolute z-10 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-cyan-100 bg-cyan-300/85 text-cyan-950 shadow-panel sm:h-8 sm:w-8"
                style={{
                  left: `${point.left}%`,
                  top: `${point.top}%`,
                }}
                title={`${floorLabels[activeFloor]} ${anchor.label} 설치 위치`}
              >
                <RadioTower className="h-3.5 w-3.5" />
                <span className="absolute left-1/2 top-full mt-1 hidden -translate-x-1/2 whitespace-nowrap border border-cyan-100/30 bg-black/70 px-1.5 py-0.5 text-[10px] font-black text-cyan-50 backdrop-blur sm:block">
                  {anchor.id}
                </span>
              </div>
            ))}
            <div
              className={`absolute z-10 rounded-full border border-amber-200/75 bg-amber-300/10 touch-none ${
                isZoneEditable ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-70'
              }`}
              style={{
                left: `${(setting.center.x / activeZone.sourceWidth) * 100}%`,
                top: `${(setting.center.y / activeZone.sourceHeight) * 100}%`,
                width: `${dangerWidth}%`,
                height: `${dangerHeight}%`,
                transform: 'translate(-50%, -50%)',
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (isZoneEditable) {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragFloor(activeFloor);
                }
              }}
            >
              <span className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 whitespace-nowrap border border-amber-200/30 bg-black/55 px-2 py-1 text-[11px] font-black text-amber-100 sm:block">
                Hook Zone
              </span>
            </div>
          </div>

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
              {floorLabels[activeFloor]} · {selectedMapPoint.pixelX}px, {selectedMapPoint.pixelY}px · {selectedMapPoint.meterX}m, {selectedMapPoint.meterY}m
            </div>
          ) : null}

          <div className="absolute bottom-3 left-3 grid gap-2 text-xs font-semibold text-stone-200 sm:grid-cols-3">
            <LegendItem color="bg-emerald-400" label="정상" />
            <LegendItem color="bg-amber-300" label="경고" />
            <LegendItem color="bg-red-500" label="비상" />
          </div>
        </div>

        {selectedWorker && selectedMapPoint ? (
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
            <CalibrationTile label="층별 상대 좌표" value={`${Math.round(selectedWorker.coords.x)}, ${Math.round(selectedWorker.coords.y)}`} />
            <CalibrationTile label="항공뷰 픽셀" value={`${selectedMapPoint.pixelX}px, ${selectedMapPoint.pixelY}px`} />
            <CalibrationTile label="현장 거리" value={`${selectedMapPoint.meterX}m, ${selectedMapPoint.meterY}m`} />
            <CalibrationTile
              label="RSSI/스케일"
              value={`${selectedWorker.telemetry.rssiDbm} dBm · ${activeZone.metersWidth}m x ${activeZone.metersHeight}m`}
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
