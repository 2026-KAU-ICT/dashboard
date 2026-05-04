import {
  aerialImagePixels,
  defaultZoneSettings,
  mapZones,
  statusMeta,
  workerProfiles,
} from '../config/dashboard';
import type { Coordinate, EventLog, FloorId, GatewayPayload, Worker, ZoneSetting } from '../types';
import { clamp, createTelemetry, createTrace } from './base';

export const calculateWorkerRisk = (worker: Worker) => {
  const statusScore = worker.status === 'EMERGENCY' ? 100 : worker.status === 'WARNING' ? 62 : 16;
  const hookScore = worker.is_hooked ? 0 : 22;
  const fallScore = worker.telemetry.fallConfidence * 0.45;
  const impactScore = Math.min(worker.telemetry.impactPeakG * 5, 28);
  return Math.round(clamp(statusScore + hookScore + fallScore + impactScore, 0, 100));
};

export const getMapZone = (floor: FloorId) => mapZones.find((item) => item.floor === floor) ?? mapZones[0];

export const isInSafetyHookZone = (
  worker: Worker,
  settings: Record<FloorId, ZoneSetting> = defaultZoneSettings,
) => {
  const zone = getMapZone(worker.floor);
  const setting = settings[worker.floor];
  const radiusX = (setting.dangerRadius / zone.metersWidth) * zone.sourceWidth;
  const radiusY = (setting.dangerRadius / zone.metersHeight) * zone.sourceHeight;
  const normalized =
    ((worker.coords.x - setting.center.x) / Math.max(radiusX, 1)) ** 2 +
    ((worker.coords.y - setting.center.y) / Math.max(radiusY, 1)) ** 2;
  return normalized <= 1;
};

export const mapCoordsToZone = (floor: FloorId, coords: Coordinate) => {
  const zone = getMapZone(floor);
  const xRatio = clamp(coords.x, 0, zone.sourceWidth) / zone.sourceWidth;
  const yRatio = clamp(coords.y, 0, zone.sourceHeight) / zone.sourceHeight;
  const left = zone.left + xRatio * zone.width;
  const top = zone.top + yRatio * zone.height;

  return {
    left,
    top,
    pixelX: Math.round((left / 100) * aerialImagePixels.width),
    pixelY: Math.round((top / 100) * aerialImagePixels.height),
    meterX: Number((xRatio * zone.metersWidth).toFixed(1)),
    meterY: Number((yRatio * zone.metersHeight).toFixed(1)),
  };
};

export const viewportToFloorCoords = (floor: FloorId, leftPercent: number, topPercent: number): Coordinate => {
  const zone = getMapZone(floor);
  return {
    x: Number(clamp(((leftPercent - zone.left) / zone.width) * zone.sourceWidth, 0, zone.sourceWidth).toFixed(1)),
    y: Number(clamp(((topPercent - zone.top) / zone.height) * zone.sourceHeight, 0, zone.sourceHeight).toFixed(1)),
  };
};

export const mapWorkerToZone = (worker: Worker) => mapCoordsToZone(worker.floor, worker.coords);

export const clusterWorkerPoints = (workers: Worker[]) => {
  const clusters: Array<{
    id: string;
    left: number;
    top: number;
    points: Array<Worker & { mapPoint: ReturnType<typeof mapWorkerToZone> }>;
  }> = [];

  workers.forEach((worker) => {
    const mapPoint = mapWorkerToZone(worker);
    const found = clusters.find((cluster) => {
      const distance = Math.hypot(cluster.left - mapPoint.left, cluster.top - mapPoint.top);
      return distance < 4.2;
    });

    if (found) {
      found.points.push({ ...worker, mapPoint });
      found.left = found.points.reduce((sum, point) => sum + point.mapPoint.left, 0) / found.points.length;
      found.top = found.points.reduce((sum, point) => sum + point.mapPoint.top, 0) / found.points.length;
      return;
    }

    clusters.push({
      id: worker.worker_id,
      left: mapPoint.left,
      top: mapPoint.top,
      points: [{ ...worker, mapPoint }],
    });
  });

  return clusters.map((cluster) => ({
    ...cluster,
    id: cluster.points.map((point) => point.worker_id).join('-'),
  }));
};

export const normalizeGatewayPayload = (payload: GatewayPayload): Worker => {
  const profile = workerProfiles[payload.worker_id] ?? {
    name: `작업자 ${payload.worker_id}`,
    role: '현장',
    battery: 100,
    gateway: `GW-${payload.floor}`,
  };

  return {
    ...payload,
    ...profile,
    battery: payload.battery ?? profile.battery,
    telemetry: createTelemetry(payload.status, payload.telemetry),
    trace: createTrace(payload.coords, payload.timestamp),
    batteryHistory: [payload.battery ?? profile.battery],
    rssiHistory: [payload.telemetry?.rssiDbm ?? createTelemetry(payload.status).rssiDbm],
  };
};

export const createEvent = (
  worker: Worker,
  message = statusMeta[worker.status].eventText,
  status: EventLog['status'] = worker.status,
): EventLog => ({
  id: `${worker.worker_id}-${worker.timestamp}-${Math.random().toString(16).slice(2)}`,
  timestamp: worker.timestamp,
  floor: worker.floor,
  workerId: worker.worker_id,
  workerName: worker.name,
  status,
  message,
});

const escapeCsv = (value: string | number | boolean) => `"${String(value).replace(/"/g, '""')}"`;

export const exportSafetyCsv = (workers: Worker[], events: EventLog[]) => {
  const workerRows = workers.map((worker) => [
    'worker',
    worker.timestamp,
    worker.worker_id,
    worker.name,
    worker.floor,
    worker.status,
    worker.is_hooked,
    Math.round(worker.battery),
    worker.telemetry.rssiDbm,
    worker.coords.x,
    worker.coords.y,
    calculateWorkerRisk(worker),
    worker.telemetry.airbagState,
    worker.telemetry.airbagCartridge,
    worker.telemetry.fallConfidence,
    worker.telemetry.latencyMs,
    '',
  ]);
  const eventRows = events.map((event) => [
    'event',
    event.timestamp,
    event.workerId,
    event.workerName,
    event.floor,
    event.status,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    event.message,
  ]);
  const header = [
    'type',
    'timestamp',
    'worker_id',
    'worker_name',
    'floor',
    'status',
    'is_hooked',
    'battery',
    'rssi_dbm',
    'coord_x',
    'coord_y',
    'risk_score',
    'airbag_state',
    'cartridge_state',
    'fall_confidence',
    'latency_ms',
    'message',
  ];
  const csv = [header, ...workerRows, ...eventRows]
    .map((row) => row.map((value) => escapeCsv(value)).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `a-hook-safety-log-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};
