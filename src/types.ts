export type WorkerStatus = 'NORMAL' | 'WARNING' | 'EMERGENCY';
export type FloorId = '1F' | '2F' | '3F' | '4F';
export type FloorFilter = 'ALL' | FloorId;
export type ConnectionState = 'connecting' | 'live' | 'mock' | 'offline';
export type AirbagState = 'READY' | 'ARMED' | 'DEPLOYED';
export type AirbagCartridgeState = 'CHARGED' | 'USED' | 'MISSING';
export type LedMode = 'OFF' | 'STEADY' | 'FLASH';

export type Coordinate = {
  x: number;
  y: number;
};

export type PositionSample = Coordinate & {
  timestamp: string;
};

export type BeaconSignal = {
  id: string;
  dist?: number;
  rssi: number;
  x?: number;
  y?: number;
};

export type WorkerTelemetry = {
  accelerationG: number;
  fallConfidence: number;
  latencyMs: number;
  rssiDbm: number;
  airbagState: AirbagState;
  airbagCartridge: AirbagCartridgeState;
  ledMode: LedMode;
};

export type GatewayPayload = {
  worker_id: string;
  gateway_id?: string;
  floor: FloorId;
  status: WorkerStatus;
  is_hooked: boolean;
  coords: Coordinate;
  timestamp: string;
  battery?: number;
  beacons?: BeaconSignal[];
  telemetry?: Partial<WorkerTelemetry>;
};

export type GatewayRawPayload = Record<string, unknown>;

export type Worker = GatewayPayload & {
  name: string;
  role: string;
  battery: number;
  gateway: string;
  telemetry: WorkerTelemetry;
  trace: PositionSample[];
  batteryHistory: number[];
  rssiHistory: number[];
};

export type EventLog = {
  id: string;
  timestamp: string;
  floor: FloorId;
  workerId: string;
  workerName: string;
  status: WorkerStatus | 'CONTROL' | 'BATTERY' | 'MAINTENANCE';
  message: string;
};

export type DownlinkCommand =
  | {
      command: 'ACTIVATE_ALARM';
      target_id: string;
    }
  | {
      command: 'UPDATE_ZONE';
      floor: FloorId;
      threshold_rssi: number;
      danger_radius_m: number;
      zone_center: Coordinate;
    }
  | {
      command: 'SET_LED_MODE';
      target_id: string;
      mode: LedMode;
    }
  | {
      command: 'BROADCAST_EVACUATION';
      floor: FloorId | 'ALL';
      reason: string;
    }
  | {
      command: 'RESET_AIRBAG_CARTRIDGE';
      target_id: string;
    }
  | {
      command: 'UPDATE_GATEWAY_ZONE';
      floor: FloorId;
      anchors: GatewayAnchor[];
    };

export type ZoneSetting = {
  threshold: number;
  dangerRadius: number;
  center: Coordinate;
};

export type GatewayAnchor = Coordinate & {
  id: string;
  label: string;
};

export type GatewayZoneSetting = {
  anchors: GatewayAnchor[];
};

export type BeaconAnchor = Coordinate & {
  id: string;
  floor: FloorId;
  label: string;
};

export type MapZone = {
  floor: FloorId;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  border: string;
  sourceWidth: number;
  sourceHeight: number;
  metersWidth: number;
  metersHeight: number;
};

export type GatewayNode = {
  id: string;
  floor: FloorId;
  status: 'online' | 'degraded' | 'offline';
  rssi: number;
  packets: number;
  anchor: Coordinate;
};

export type Esp32BeaconData = {
  id: string;
  dist: number;
  rssi: number;
};

export type Esp32StatusData = {
  has_fallen: boolean;
  is_hooked: boolean;
};

export type Esp32GatewayData = {
  gw_id: number;
  status: Esp32StatusData;
  beacons: Esp32BeaconData[];
  ts?: number;
};

export type Esp32RuntimeData = Esp32GatewayData & {
  receivedAt: string;
  latencyMs: number;
};