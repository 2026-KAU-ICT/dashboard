import type {
  AirbagCartridgeState,
  AirbagState,
  EventLog,
  FloorId,
  GatewayNode,
  LedMode,
  MapZone,
  Worker,
  WorkerStatus,
  ZoneSetting,
} from '../types';
import { createTelemetry, createTrace } from '../lib/base';

export const QUERY_KEYS = {
  workers: ['workers'] as const,
  events: ['events'] as const,
};

export const floorLabels: Record<FloorId, string> = {
  '3F': '3층',
  '4F': '4층',
  ROOF: '옥상',
};

export const airbagLabels: Record<AirbagState, string> = {
  READY: '대기',
  ARMED: '준비',
  DEPLOYED: '전개',
};

export const cartridgeLabels: Record<AirbagCartridgeState, string> = {
  CHARGED: '충전됨',
  USED: '사용됨',
  MISSING: '없음',
};

export const ledLabels: Record<LedMode, string> = {
  OFF: '꺼짐',
  STEADY: '점등',
  FLASH: '점멸',
};

export const workerProfiles: Record<string, Pick<Worker, 'name' | 'role' | 'battery' | 'gateway'>> = {
  A001: { name: '김도윤', role: '철근', battery: 86, gateway: 'GW-4F-02' },
  A002: { name: '박민재', role: '거푸집', battery: 74, gateway: 'GW-3F-01' },
  A003: { name: '이서준', role: '전기', battery: 91, gateway: 'GW-RF-01' },
  A004: { name: '최하린', role: '안전', battery: 68, gateway: 'GW-4F-01' },
  A005: { name: '정우진', role: '양중', battery: 79, gateway: 'GW-3F-02' },
  A006: { name: '윤태오', role: '배관', battery: 24, gateway: 'GW-RF-02' },
};

export const initialWorkers: Worker[] = [
  {
    worker_id: 'A001',
    floor: '4F',
    status: 'NORMAL',
    is_hooked: true,
    coords: { x: 120, y: 85 },
    timestamp: new Date().toISOString(),
    telemetry: createTelemetry('NORMAL', { latencyMs: 118 }),
    trace: createTrace({ x: 120, y: 85 }, new Date().toISOString()),
    batteryHistory: [93, 91, 89, 88, 86],
    rssiHistory: [-54, -55, -57, -56, -58],
    ...workerProfiles.A001,
  },
  {
    worker_id: 'A002',
    floor: '3F',
    status: 'WARNING',
    is_hooked: false,
    coords: { x: 74, y: 48 },
    timestamp: new Date().toISOString(),
    telemetry: createTelemetry('WARNING', { fallConfidence: 61, impactPeakG: 2.6 }),
    trace: createTrace({ x: 74, y: 48 }, new Date().toISOString()),
    batteryHistory: [82, 80, 78, 76, 74],
    rssiHistory: [-61, -64, -68, -66, -67],
    ...workerProfiles.A002,
  },
  {
    worker_id: 'A003',
    floor: 'ROOF',
    status: 'NORMAL',
    is_hooked: true,
    coords: { x: 151, y: 56 },
    timestamp: new Date().toISOString(),
    telemetry: createTelemetry('NORMAL', { latencyMs: 132 }),
    trace: createTrace({ x: 151, y: 56 }, new Date().toISOString()),
    batteryHistory: [96, 95, 94, 92, 91],
    rssiHistory: [-59, -60, -62, -61, -60],
    ...workerProfiles.A003,
  },
  {
    worker_id: 'A004',
    floor: '4F',
    status: 'NORMAL',
    is_hooked: true,
    coords: { x: 39, y: 108 },
    timestamp: new Date().toISOString(),
    telemetry: createTelemetry('NORMAL', { accelerationG: 1.1, airbagCartridge: 'MISSING' }),
    trace: createTrace({ x: 39, y: 108 }, new Date().toISOString()),
    batteryHistory: [74, 72, 71, 69, 68],
    rssiHistory: [-52, -54, -55, -56, -55],
    ...workerProfiles.A004,
  },
  {
    worker_id: 'A005',
    floor: '3F',
    status: 'NORMAL',
    is_hooked: true,
    coords: { x: 138, y: 96 },
    timestamp: new Date().toISOString(),
    telemetry: createTelemetry('NORMAL', { latencyMs: 146 }),
    trace: createTrace({ x: 138, y: 96 }, new Date().toISOString()),
    batteryHistory: [87, 85, 83, 81, 79],
    rssiHistory: [-58, -60, -59, -61, -60],
    ...workerProfiles.A005,
  },
  {
    worker_id: 'A006',
    floor: 'ROOF',
    status: 'WARNING',
    is_hooked: false,
    coords: { x: 92, y: 112 },
    timestamp: new Date().toISOString(),
    telemetry: createTelemetry('WARNING', { latencyMs: 169, fallConfidence: 58, rssiDbm: -72 }),
    trace: createTrace({ x: 92, y: 112 }, new Date().toISOString()),
    batteryHistory: [34, 31, 29, 26, 24],
    rssiHistory: [-65, -69, -71, -70, -72],
    ...workerProfiles.A006,
  },
];

export const initialEvents: EventLog[] = [
  {
    id: 'seed-1',
    timestamp: new Date().toISOString(),
    floor: '3F',
    workerId: 'A002',
    workerName: workerProfiles.A002.name,
    status: 'WARNING',
    message: '미체결 상태로 위험 구역 진입',
  },
  {
    id: 'seed-2',
    timestamp: new Date().toISOString(),
    floor: 'ROOF',
    workerId: 'A006',
    workerName: workerProfiles.A006.name,
    status: 'WARNING',
    message: '옥상 안전 훅 존 임계값 초과',
  },
  {
    id: 'seed-3',
    timestamp: new Date().toISOString(),
    floor: 'ROOF',
    workerId: 'A006',
    workerName: workerProfiles.A006.name,
    status: 'BATTERY',
    message: '배터리 부족 점검 필요',
  },
  {
    id: 'seed-4',
    timestamp: new Date().toISOString(),
    floor: '4F',
    workerId: 'A004',
    workerName: workerProfiles.A004.name,
    status: 'MAINTENANCE',
    message: '에어백 카트리지 장착 필요',
  },
];

export const defaultZoneSettings: Record<FloorId, ZoneSetting> = {
  '3F': { threshold: -68, dangerRadius: 8, center: { x: 116, y: 68 } },
  '4F': { threshold: -71, dangerRadius: 6, center: { x: 114, y: 66 } },
  ROOF: { threshold: -64, dangerRadius: 10, center: { x: 112, y: 64 } },
};

export const gatewayNodes: GatewayNode[] = [
  { id: 'GW-3F-01', floor: '3F', status: 'online', rssi: -57, packets: 128, anchor: { x: 52, y: 42 } },
  { id: 'GW-3F-02', floor: '3F', status: 'online', rssi: -61, packets: 116, anchor: { x: 152, y: 103 } },
  { id: 'GW-4F-01', floor: '4F', status: 'online', rssi: -54, packets: 139, anchor: { x: 48, y: 105 } },
  { id: 'GW-4F-02', floor: '4F', status: 'online', rssi: -59, packets: 133, anchor: { x: 146, y: 72 } },
  { id: 'GW-RF-01', floor: 'ROOF', status: 'online', rssi: -63, packets: 101, anchor: { x: 144, y: 52 } },
  { id: 'GW-RF-02', floor: 'ROOF', status: 'online', rssi: -66, packets: 96, anchor: { x: 76, y: 114 } },
];

export const mapZones: MapZone[] = [
  {
    floor: '3F',
    left: 9,
    top: 22,
    width: 29,
    height: 53,
    color: 'rgba(52, 211, 153, 0.1)',
    border: 'rgba(52, 211, 153, 0.72)',
    sourceWidth: 200,
    sourceHeight: 140,
    metersWidth: 42,
    metersHeight: 31,
  },
  {
    floor: '4F',
    left: 38,
    top: 18,
    width: 31,
    height: 56,
    color: 'rgba(56, 189, 248, 0.1)',
    border: 'rgba(56, 189, 248, 0.72)',
    sourceWidth: 200,
    sourceHeight: 140,
    metersWidth: 39,
    metersHeight: 29,
  },
  {
    floor: 'ROOF',
    left: 68,
    top: 14,
    width: 23,
    height: 58,
    color: 'rgba(245, 158, 11, 0.11)',
    border: 'rgba(245, 158, 11, 0.74)',
    sourceWidth: 200,
    sourceHeight: 140,
    metersWidth: 32,
    metersHeight: 27,
  },
];

export const statusMeta: Record<
  WorkerStatus,
  {
    label: string;
    eventText: string;
    marker: string;
    chip: string;
    border: string;
  }
> = {
  NORMAL: {
    label: '정상',
    eventText: '체결 완료',
    marker: 'bg-emerald-400 text-emerald-950 ring-emerald-300/50',
    chip: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100',
    border: 'border-emerald-400/45',
  },
  WARNING: {
    label: '경고',
    eventText: '미체결 위험 구역 진입',
    marker: 'bg-amber-300 text-amber-950 ring-amber-200/55',
    chip: 'border-amber-300/50 bg-amber-300/10 text-amber-100',
    border: 'border-amber-300/45',
  },
  EMERGENCY: {
    label: '비상',
    eventText: '추락 징후 감지',
    marker: 'bg-red-500 text-white ring-red-300/70',
    chip: 'border-red-400/60 bg-red-500/15 text-red-100',
    border: 'border-red-400/55',
  },
};

export const aerialImagePixels = { width: 1200, height: 760 };
export const gatewayUrls = String(
  import.meta.env.VITE_GATEWAY_WS_URLS ?? import.meta.env.VITE_GATEWAY_WS_URL ?? '',
)
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
