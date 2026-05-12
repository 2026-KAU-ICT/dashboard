import {
  aerialImagePixels,
  beaconAnchors,
  defaultZoneSettings,
  gatewayNodes,
  mapZones,
  statusMeta,
  workerProfiles,
} from '../config/dashboard';
import type {
  AirbagCartridgeState,
  AirbagState,
  BeaconSignal,
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
  const batteryScore = worker.battery <= 25 ? 12 : 0;
  return Math.round(clamp(statusScore + hookScore + fallScore + batteryScore, 0, 100));
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

const beaconCalibrationAnchors = [
  ...beaconAnchors,
  ...gatewayNodes.map((node) => ({
    id: node.id,
    floor: node.floor,
    label: node.id,
    ...node.anchor,
  })),
];

const isRecord = (value: unknown): value is GatewayRawPayload =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readRecord = (source: GatewayRawPayload, key: string) =>
  isRecord(source[key]) ? source[key] : undefined;

const readAnyRecord = (source: GatewayRawPayload, keys: string[]) => {
  for (const key of keys) {
    const record = readRecord(source, key);
    if (record) {
      return record;
    }

    const matchedKey = Object.keys(source).find((sourceKey) => sourceKey.toLowerCase() === key.toLowerCase());
    if (matchedKey && isRecord(source[matchedKey])) {
      return source[matchedKey];
    }
  }
  return undefined;
};

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

const normalizeFloor = (value: unknown, fallback: FloorId = '4F'): FloorId => {
  const normalized = String(value ?? '4F').trim().toUpperCase();
  if (['1F', '1', 'F1', '1층'].includes(normalized)) {
    return '1F';
  }
  if (['2F', '2', 'F2', '2층'].includes(normalized)) {
    return '2F';
  }
  if (['3F', '3', 'F3', '3층'].includes(normalized)) {
    return '3F';
  }
  if (['4F', '4', 'F4', '4층'].includes(normalized)) {
    return '4F';
  }
  return fallback;
};

const normalizeStatus = (raw: GatewayRawPayload, isHooked: boolean, zoneEntered = false): WorkerStatus => {
  const rawStatus = readValue(raw, ['status', 'state', 'event']);
  const value = typeof rawStatus === 'string' || typeof rawStatus === 'number' ? String(rawStatus).trim().toUpperCase() : '';
  const fallDetected = readBoolean(raw, [
    'has_fallen',
    'hasFallen',
    'fall_status',
    'fallStatus',
    'fall_detected',
    'fallDetected',
    'is_fall',
    'airbag_deployed',
  ]);
  const dangerZoneEntered =
    readBoolean(raw, ['zone_entered', 'zoneEntered', 'hook_zone_required', 'danger_zone']) ?? zoneEntered;

  if (fallDetected || ['EMERGENCY', 'FALL', 'FALL_DETECTED', 'CRASH'].includes(value)) {
    return 'EMERGENCY';
  }
  if (!isHooked && (dangerZoneEntered || ['WARNING', 'WARN', 'DANGER', 'UNHOOKED'].includes(value))) {
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
  if (['FLASH', 'BLINK', 'BLINKING', 'RED_BLINK', 'RED_BLINKING', 'LED_BLINK', '점멸'].includes(normalized)) {
    return 'FLASH';
  }
  if (['STEADY', 'ON', 'SOLID', 'LED_ON', '점등'].includes(normalized)) {
    return 'STEADY';
  }
  if (['OFF', 'LED_OFF', '꺼짐'].includes(normalized)) {
    return 'OFF';
  }
  return undefined;
};

const findBeaconAnchor = (id: string, floor?: FloorId) =>
  beaconCalibrationAnchors.find((anchor) => anchor.id.toLowerCase() === id.toLowerCase() && (!floor || anchor.floor === floor)) ??
  beaconCalibrationAnchors.find((anchor) => anchor.id.toLowerCase() === id.toLowerCase());

const readDetectedBeacons = (raw: GatewayRawPayload): BeaconSignal[] => {
  const positionData = readAnyRecord(raw, ['position_data', 'positionData', 'position']) ?? raw;
  const value = readValue(positionData, ['detected_beacons', 'detectedBeacons', 'beacons', 'beacon_list']);

  const normalizeBeacon = (item: unknown, fallbackId?: string): BeaconSignal | undefined => {
    if (!isRecord(item)) {
      return undefined;
    }

    const id = readString(item, ['id', 'beacon_id', 'beaconId', 'uuid', 'name']) ?? fallbackId;
    const rssi = readNumber(item, ['rssi', 'rssi_dbm', 'rssiDbm']);
    const dist = readNumber(item, ['dist', 'distance', 'distance_m', 'distanceM']);
    const coords = readRecord(item, 'coords') ?? readRecord(item, 'coord') ?? item;
    const x = readNumber(coords, ['x', 'coord_x', 'relative_x', 'rel_x']);
    const y = readNumber(coords, ['y', 'coord_y', 'relative_y', 'rel_y']);
    return id && rssi !== undefined
      ? { id, rssi, ...(dist !== undefined ? { dist } : {}), ...(x !== undefined && y !== undefined ? { x, y } : {}) }
      : undefined;
  };

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeBeacon(item))
      .filter((item): item is BeaconSignal => Boolean(item));
  }

  if (isRecord(value)) {
    const singleBeacon = normalizeBeacon(value);
    if (singleBeacon) {
      return [singleBeacon];
    }

    return Object.entries(value)
      .map(([id, item]) => normalizeBeacon(item, id))
      .filter((item): item is BeaconSignal => Boolean(item));
  }

  return [];
};

const strongestBeacon = (beacons: BeaconSignal[]) =>
  [...beacons].sort((a, b) => b.rssi - a.rssi)[0];

const inferFloorFromBeacons = (beacons: BeaconSignal[]) => {
  const strongest = strongestBeacon(beacons);
  if (!strongest) {
    return undefined;
  }

  return findBeaconAnchor(strongest.id)?.floor;
};

const inferFloorFromGatewayId = (gatewayId?: string): FloorId | undefined => {
  if (!gatewayId) {
    return undefined;
  }

  const normalized = gatewayId.trim().toUpperCase();
  const matchedGateway = gatewayNodes.find((node) => node.id.toUpperCase() === normalized);
  if (matchedGateway) {
    return matchedGateway.floor;
  }

  const floorMatch = normalized.match(/([1-4])F/);
  if (floorMatch) {
    return normalizeFloor(floorMatch[1]);
  }

  const numericId = Number(normalized);
  if (!Number.isFinite(numericId)) {
    return undefined;
  }

  if (numericId >= 1 && numericId <= 4) {
    return normalizeFloor(numericId);
  }

  const hundreds = Math.floor(numericId / 100);
  return hundreds >= 1 && hundreds <= 4 ? normalizeFloor(hundreds) : undefined;
};

type BeaconSample = {
  beacon: BeaconSignal;
  anchor: NonNullable<ReturnType<typeof findBeaconAnchor>>;
};

const sourceToMeters = (floor: FloorId, coords: Coordinate): Coordinate => {
  const zone = getMapZone(floor);
  return {
    x: (coords.x / zone.sourceWidth) * zone.metersWidth,
    y: (coords.y / zone.sourceHeight) * zone.metersHeight,
  };
};

const metersToSource = (floor: FloorId, coords: Coordinate): Coordinate => {
  const zone = getMapZone(floor);
  return {
    x: Number(clamp((coords.x / zone.metersWidth) * zone.sourceWidth, 0, zone.sourceWidth).toFixed(1)),
    y: Number(clamp((coords.y / zone.metersHeight) * zone.sourceHeight, 0, zone.sourceHeight).toFixed(1)),
  };
};

const trilaterateFromDistances = (floor: FloorId, samples: BeaconSample[]): Coordinate | undefined => {
  const rangedSamples = samples
    .filter((sample) => sample.beacon.dist !== undefined && sample.beacon.dist > 0)
    .sort((a, b) => (a.beacon.dist ?? Number.POSITIVE_INFINITY) - (b.beacon.dist ?? Number.POSITIVE_INFINITY));
  if (rangedSamples.length < 3) {
    return undefined;
  }

  const [reference, ...others] = rangedSamples;
  const refPoint = sourceToMeters(floor, reference.anchor);
  const refDistance = reference.beacon.dist ?? 0;
  const equations = others.map((sample) => {
    const point = sourceToMeters(floor, sample.anchor);
    const distance = sample.beacon.dist ?? 0;
    return {
      a: 2 * (point.x - refPoint.x),
      b: 2 * (point.y - refPoint.y),
      c: refDistance ** 2 - distance ** 2 - refPoint.x ** 2 + point.x ** 2 - refPoint.y ** 2 + point.y ** 2,
    };
  });

  const ata00 = equations.reduce((sum, equation) => sum + equation.a ** 2, 0);
  const ata01 = equations.reduce((sum, equation) => sum + equation.a * equation.b, 0);
  const ata11 = equations.reduce((sum, equation) => sum + equation.b ** 2, 0);
  const atb0 = equations.reduce((sum, equation) => sum + equation.a * equation.c, 0);
  const atb1 = equations.reduce((sum, equation) => sum + equation.b * equation.c, 0);
  const determinant = ata00 * ata11 - ata01 ** 2;

  if (Math.abs(determinant) < 0.0001) {
    return undefined;
  }

  return metersToSource(floor, {
    x: (atb0 * ata11 - ata01 * atb1) / determinant,
    y: (ata00 * atb1 - ata01 * atb0) / determinant,
  });
};

const estimateCoordsFromBeacons = (floor: FloorId, beacons: BeaconSignal[]): Coordinate | undefined => {
  const samples = beacons
    .map((beacon) => ({
      beacon,
      anchor: findBeaconAnchor(beacon.id, floor),
    }))
    .filter((sample): sample is BeaconSample => Boolean(sample.anchor && sample.anchor.floor === floor));

  if (!samples.length) {
    return undefined;
  }

  const trilateratedCoords = trilaterateFromDistances(floor, samples);
  if (trilateratedCoords) {
    return trilateratedCoords;
  }

  const weighted = samples.map((sample) => ({
    anchor: sample.anchor,
    weight:
      sample.beacon.dist !== undefined && sample.beacon.dist > 0
        ? 1 / (sample.beacon.dist + 0.2) ** 2
        : Math.max(0.0001, 10 ** (sample.beacon.rssi / 20)),
  }));
  const totalWeight = weighted.reduce((sum, sample) => sum + sample.weight, 0);

  return {
    x: Number((weighted.reduce((sum, sample) => sum + sample.anchor.x * sample.weight, 0) / totalWeight).toFixed(1)),
    y: Number((weighted.reduce((sum, sample) => sum + sample.anchor.y * sample.weight, 0) / totalWeight).toFixed(1)),
  };
};

const isBeaconDangerZoneEntered = (floor: FloorId, beacons: BeaconSignal[]) => {
  const strongest = strongestBeacon(beacons);
  return strongest ? strongest.rssi >= defaultZoneSettings[floor].threshold : false;
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

const normalizeCoords = (raw: GatewayRawPayload, floor: FloorId, beacons: BeaconSignal[]): Coordinate => {
  const coords = readRecord(raw, 'coords') ?? readRecord(raw, 'coord') ?? readRecord(raw, 'position') ?? raw;
  const x = readNumber(coords, ['x', 'coord_x', 'relative_x', 'rel_x', 'coords.x']);
  const y = readNumber(coords, ['y', 'coord_y', 'relative_y', 'rel_y', 'coords.y']);
  if (x !== undefined && y !== undefined) {
    return { x, y };
  }

  const beaconCoords = estimateCoordsFromBeacons(floor, beacons);
  if (beaconCoords) {
    return beaconCoords;
  }

  return {
    x: 100,
    y: 70,
  };
};

export const normalizeRawGatewayPayload = (raw: unknown): GatewayPayload | undefined => {
  if (!isRecord(raw)) {
    return undefined;
  }

  const header = readAnyRecord(raw, ['header']) ?? {};
  const sensorData = readAnyRecord(raw, ['sensor_data', 'sensorData']) ?? {};
  const positionData = readAnyRecord(raw, ['position_data', 'positionData']) ?? {};
  const statusData = readAnyRecord(raw, ['status']) ?? {};
  const expandedRaw: GatewayRawPayload = {
    ...raw,
    ...header,
    ...sensorData,
    ...positionData,
    ...statusData,
  };
  const detectedBeacons = readDetectedBeacons(expandedRaw);
  const gatewayId = readString(expandedRaw, ['gateway_id', 'gatewayId', 'gateway', 'gw_id']);
  const workerId =
    readString(expandedRaw, ['worker_id', 'workerId', 'vest_id', 'vestId', 'tag_id', 'device_id', 'deviceId']) ??
    (gatewayId ? `W-${gatewayId}` : undefined);
  if (!workerId) {
    return undefined;
  }

  const explicitFloor = readValue(expandedRaw, ['floor', 'level']);
  const floor =
    explicitFloor === undefined
      ? inferFloorFromGatewayId(gatewayId) ?? inferFloorFromBeacons(detectedBeacons) ?? '1F'
      : normalizeFloor(explicitFloor);
  const zoneEntered = isBeaconDangerZoneEntered(floor, detectedBeacons);
  const hookValue = readBoolean(expandedRaw, ['is_hooked', 'isHooked', 'hooked', 'hook_closed', 'hook_state']);
  const status = normalizeStatus(expandedRaw, hookValue ?? true, zoneEntered);
  const isHooked = hookValue ?? status === 'NORMAL';
  const strongest = strongestBeacon(detectedBeacons);
  const telemetry = normalizeTelemetry(expandedRaw, status);
  const fallDetected = readBoolean(expandedRaw, ['has_fallen', 'hasFallen', 'fall_status', 'fallStatus', 'fall_detected', 'fallDetected', 'is_fall']);

  return {
    worker_id: workerId,
    gateway_id: gatewayId,
    floor,
    status,
    is_hooked: isHooked,
    coords: normalizeCoords(expandedRaw, floor, detectedBeacons),
    timestamp: normalizeTimestamp(readValue(expandedRaw, ['timestamp', 'time', 'ts'])),
    battery: readNumber(expandedRaw, ['battery', 'battery_percent', 'battery_pct', 'batteryPercent', 'batteryLevel', 'bat_pct']),
    beacons: detectedBeacons,
    telemetry: {
      ...telemetry,
      ...(strongest && telemetry.rssiDbm === undefined ? { rssiDbm: strongest.rssi } : {}),
      ...(fallDetected && telemetry.fallConfidence === undefined ? { fallConfidence: 96 } : {}),
    },
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
    rssiHistory: [payload.telemetry?.rssiDbm ?? payload.beacons?.[0]?.rssi ?? createTelemetry(payload.status).rssiDbm],
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
  link.download = `a-hook-log-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};
