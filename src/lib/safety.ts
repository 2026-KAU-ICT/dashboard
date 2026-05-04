import {
  aerialImagePixels,
  defaultZoneSettings,
  gatewayNodes,
  mapZones,
  statusMeta,
  workerProfiles,
} from '../config/dashboard';
import type {
  AirbagCartridgeState,
  AirbagState,
  Coordinate,
  EventLog,
  FloorId,
  GatewayPayload,
  GatewayRawPayload,
  LedMode,
  Worker,
  WorkerStatus,
  WorkerTelemetry,
  ZoneSetting,
} from '../types';
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

export const findNearestGateway = (floor: FloorId, coords: Coordinate) => {
  const candidates = gatewayNodes.filter((node) => node.floor === floor && node.status !== 'offline');
  return candidates
    .map((node) => ({
      node,
      distance: Math.hypot(node.anchor.x - coords.x, node.anchor.y - coords.y),
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.node;
};

const isRecord = (value: unknown): value is GatewayRawPayload =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readRecord = (source: GatewayRawPayload, key: string) =>
  isRecord(source[key]) ? source[key] : undefined;

const readValue = (source: GatewayRawPayload, keys: string[]) => {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }

    const matchedKey = Object.keys(source).find((sourceKey) => sourceKey.toLowerCase() === key.toLowerCase());
    if (matchedKey) {
      const matchedValue = source[matchedKey];
      if (matchedValue !== undefined && matchedValue !== null && matchedValue !== '') {
        return matchedValue;
      }
    }
  }
  return undefined;
};

const readNumber = (source: GatewayRawPayload, keys: string[]) => {
  const value = readValue(source, keys);
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const readString = (source: GatewayRawPayload, keys: string[]) => {
  const value = readValue(source, keys);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
};

const readBoolean = (source: GatewayRawPayload, keys: string[]) => {
  const value = readValue(source, keys);
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'hooked', 'connected', 'closed'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n', 'unhooked', 'open'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
};

const normalizeFloor = (value: unknown): FloorId => {
  const normalized = String(value ?? '4F').trim().toUpperCase();
  if (['3F', '3', 'F3', '3층'].includes(normalized)) {
    return '3F';
  }
  if (['ROOF', 'RF', 'R', '옥상'].includes(normalized)) {
    return 'ROOF';
  }
  return '4F';
};

const normalizeStatus = (raw: GatewayRawPayload, isHooked: boolean): WorkerStatus => {
  const value = String(readValue(raw, ['status', 'state', 'event']) ?? '').trim().toUpperCase();
  const fallDetected = readBoolean(raw, ['fall_detected', 'fallDetected', 'is_fall', 'airbag_deployed']);
  const zoneEntered = readBoolean(raw, ['zone_entered', 'zoneEntered', 'hook_zone_required', 'danger_zone']);

  if (fallDetected || ['EMERGENCY', 'FALL', 'FALL_DETECTED', 'CRASH'].includes(value)) {
    return 'EMERGENCY';
  }
  if (!isHooked && (zoneEntered || ['WARNING', 'WARN', 'DANGER', 'UNHOOKED'].includes(value))) {
    return 'WARNING';
  }
  if (['WARNING', 'WARN', 'DANGER'].includes(value)) {
    return 'WARNING';
  }
  return 'NORMAL';
};

const normalizeTimestamp = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(milliseconds).toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && /^\d+(\.\d+)?$/.test(value.trim())) {
      const milliseconds = numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue;
      return new Date(milliseconds).toISOString();
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return new Date().toISOString();
};

const normalizeAirbagState = (value: unknown, status: WorkerStatus): AirbagState | undefined => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (['DEPLOYED', 'USED', 'OPEN', '전개'].includes(normalized) || status === 'EMERGENCY') {
    return 'DEPLOYED';
  }
  if (['ARMED', 'READY_TO_DEPLOY', '준비'].includes(normalized)) {
    return 'ARMED';
  }
  if (['READY', 'IDLE', '대기'].includes(normalized)) {
    return 'READY';
  }
  return undefined;
};

const normalizeCartridgeState = (value: unknown, status: WorkerStatus): AirbagCartridgeState | undefined => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (['USED', 'EMPTY', 'SPENT', '사용됨'].includes(normalized) || status === 'EMERGENCY') {
    return 'USED';
  }
  if (['MISSING', 'NONE', 'NO_CARTRIDGE', '없음'].includes(normalized)) {
    return 'MISSING';
  }
  if (['CHARGED', 'FULL', 'READY', '충전됨'].includes(normalized)) {
    return 'CHARGED';
  }
  return undefined;
};

const normalizeLedMode = (value: unknown): LedMode | undefined => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (['FLASH', 'BLINK', 'BLINKING', '점멸'].includes(normalized)) {
    return 'FLASH';
  }
  if (['STEADY', 'ON', 'SOLID', '점등'].includes(normalized)) {
    return 'STEADY';
  }
  if (['OFF', '꺼짐'].includes(normalized)) {
    return 'OFF';
  }
  return undefined;
};

const normalizeTelemetry = (raw: GatewayRawPayload, status: WorkerStatus): Partial<WorkerTelemetry> => {
  const telemetry = readRecord(raw, 'telemetry') ?? raw;
  const airbagDeployed =
    readBoolean(raw, ['airbag_deployed', 'airbagDeployed']) ??
    readBoolean(telemetry, ['airbag_deployed', 'airbagDeployed']);
  const airbagState = normalizeAirbagState(
    readValue(telemetry, ['airbagState', 'airbag_state', 'airbag']),
    airbagDeployed ? 'EMERGENCY' : status,
  );
  const airbagCartridge = normalizeCartridgeState(
    readValue(telemetry, ['airbagCartridge', 'airbag_cartridge', 'cartridge_state', 'cartridge']),
    airbagDeployed ? 'EMERGENCY' : status,
  );
  const ledMode = normalizeLedMode(readValue(telemetry, ['ledMode', 'led_mode', 'led']));

  const overrides: Partial<WorkerTelemetry> = {
    accelerationG: readNumber(telemetry, ['accelerationG', 'acceleration_g', 'accel_g', 'imu_g', 'acc_g']),
    impactPeakG: readNumber(telemetry, ['impactPeakG', 'impact_peak_g', 'impact_g', 'shock_g']),
    fallConfidence: readNumber(telemetry, ['fallConfidence', 'fall_confidence', 'fall_probability', 'confidence']),
    latencyMs: readNumber(telemetry, ['latencyMs', 'latency_ms', 'edge_latency_ms', 'decision_latency_ms']),
    rssiDbm: readNumber(telemetry, ['rssiDbm', 'rssi_dbm', 'rssi']),
    airbagState,
    airbagCartridge,
    ledMode,
  };

  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<WorkerTelemetry>;
};

const normalizeCoords = (raw: GatewayRawPayload): Coordinate => {
  const coords = readRecord(raw, 'coords') ?? readRecord(raw, 'coord') ?? readRecord(raw, 'position') ?? raw;
  return {
    x: readNumber(coords, ['x', 'coord_x', 'relative_x', 'rel_x', 'coords.x']) ?? 100,
    y: readNumber(coords, ['y', 'coord_y', 'relative_y', 'rel_y', 'coords.y']) ?? 70,
  };
};

export const normalizeRawGatewayPayload = (raw: unknown): GatewayPayload | undefined => {
  if (!isRecord(raw)) {
    return undefined;
  }

  const workerId = readString(raw, ['worker_id', 'workerId', 'id', 'tag_id', 'device_id']);
  if (!workerId) {
    return undefined;
  }

  const hookValue = readBoolean(raw, ['is_hooked', 'isHooked', 'hooked', 'hook_closed', 'hook_state']);
  const floor = normalizeFloor(readValue(raw, ['floor', 'level']));
  const status = normalizeStatus(raw, hookValue ?? true);
  const isHooked = hookValue ?? status === 'NORMAL';

  return {
    worker_id: workerId,
    gateway_id: readString(raw, ['gateway_id', 'gatewayId', 'gateway', 'gw_id']),
    floor,
    status,
    is_hooked: isHooked,
    coords: normalizeCoords(raw),
    timestamp: normalizeTimestamp(readValue(raw, ['timestamp', 'time', 'ts'])),
    battery: readNumber(raw, ['battery', 'battery_percent', 'battery_pct', 'batteryPercent', 'batteryLevel', 'bat_pct']),
    telemetry: normalizeTelemetry(raw, status),
  };
};

export const parseGatewayMessage = (data: unknown): GatewayPayload[] => {
  const root = isRecord(data) && isRecord(data.payload) ? data.payload : data;
  const envelope = isRecord(root) ? root : undefined;
  const list =
    Array.isArray(root)
      ? root
      : isRecord(root) && Array.isArray(root.workers)
        ? root.workers
        : isRecord(root) && Array.isArray(root.devices)
          ? root.devices
          : isRecord(root) && root.worker
            ? [root.worker]
          : [root];

  return list
    .map((item) => (envelope && isRecord(item) ? { ...envelope, ...item } : item))
    .map((item) => normalizeRawGatewayPayload(item))
    .filter((payload): payload is GatewayPayload => Boolean(payload));
};

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
    gateway: findNearestGateway(payload.floor, payload.coords)?.id ?? `GW-${payload.floor}`,
  };
  const gateway = payload.gateway_id ?? findNearestGateway(payload.floor, payload.coords)?.id ?? profile.gateway;

  return {
    ...payload,
    ...profile,
    gateway_id: gateway,
    gateway,
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
    worker.gateway,
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
  const traceRows = workers.flatMap((worker) =>
    worker.trace.map((sample, index) => [
      'trace',
      sample.timestamp,
      worker.worker_id,
      worker.name,
      worker.floor,
      worker.gateway,
      'POSITION',
      worker.is_hooked,
      '',
      '',
      sample.x,
      sample.y,
      '',
      '',
      '',
      '',
      '',
      `breadcrumb_${index + 1}`,
    ]),
  );
  const eventRows = events.map((event) => [
    'event',
    event.timestamp,
    event.workerId,
    event.workerName,
    event.floor,
    '',
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
    'gateway_id',
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
  const csv = [header, ...workerRows, ...traceRows, ...eventRows]
    .map((row) => row.map((value) => escapeCsv(value)).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `safety-hook-log-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};
