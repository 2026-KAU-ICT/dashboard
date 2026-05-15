import {
  Gauge,
  HardHat,
  ShieldAlert,
  Siren,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ControlActionDialog,
  type ControlActionResult,
} from './components/ControlActionDialog';
import { ControlPanel } from './components/ControlPanel';
import {
  EmergencyActionDialog,
  type EmergencyActionKind,
  type EmergencyActionResult,
} from './components/EmergencyActionDialog';
import { EmergencyOverlay } from './components/EmergencyOverlay';
import { Header } from './components/Header';
import {
  OperationalPanels,
  calculateDeviceRisk,
} from './components/OperationalPanels';
import { SiteMap } from './components/SiteMap';
import { MetricCard } from './components/ui';
import {
  QUERY_KEYS,
  beaconAnchors,
  defaultGatewayZoneSettings,
  defaultZoneSettings,
  floorLabels,
  gatewayUrls,
  initialEvents,
  initialWorkers,
  ledLabels,
  statusMeta,
} from './config/dashboard';
import type {
  ConnectionState,
  Coordinate,
  DownlinkCommand,
  EventLog,
  FloorFilter,
  FloorId,
  GatewayAnchor,
  GatewayPayload,
  GatewayZoneSetting,
  LedMode,
  Worker,
  WorkerStatus,
  Esp32GatewayData,
  Esp32RuntimeData,
} from './types';
import { clamp, createTelemetry } from './lib/base';
import {
  createEvent,
  isInSafetyHookZone,
  normalizeGatewayPayload,
  parseGatewayMessage,
} from './lib/safety';

function estimateWorkerCoordsFromBeacons(
  floor: FloorId,
  beacons: Esp32GatewayData['beacons'],
): Coordinate | null {
  if (!Array.isArray(beacons) || beacons.length === 0) {
    return null;
  }

  let weightSum = 0;
  let xSum = 0;
  let ySum = 0;

  beacons.forEach((beacon) => {
    const anchor = beaconAnchors.find(
      (item) =>
        item.floor === floor &&
        item.id.toLowerCase() === beacon.id.toLowerCase(),
    );

    if (!anchor || typeof beacon.dist !== 'number' || beacon.dist <= 0) {
      return;
    }

    // 가까운 비콘일수록 더 큰 영향을 주기 위해 거리의 제곱 역수를 가중치로 사용
    const weight = 1 / (beacon.dist * beacon.dist);

    xSum += anchor.x * weight;
    ySum += anchor.y * weight;
    weightSum += weight;
  });

  if (weightSum === 0) {
    return null;
  }

  return {
    x: xSum / weightSum,
    y: ySum / weightSum,
  };
}

type AccidentLogRow = {
  timestampMs: number;
  time: string;
  gatewayId: number;
  workerId: string;
  floor: FloorId;
  workerX: number;
  workerY: number;
  isHooked: boolean;
  hasFallen: boolean;
  isInsideHookZone: boolean;
  riskScore: number;
};

function App() {
  const queryClient = useQueryClient();
  const [selectedFloor, setSelectedFloor] = useState<FloorFilter>('1F');
  const [selectedWorkerId, setSelectedWorkerId] = useState('ESP32-GW-1');
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [activeGatewayIds, setActiveGatewayIds] = useState<number[]>([]);
  const [gatewayHookStatusMap, setGatewayHookStatusMap] = useState<Record<number, boolean>>({});
  const [gatewayFallStatusMap, setGatewayFallStatusMap] = useState<Record<number, boolean>>({});
  const [gatewayUptimeMap, setGatewayUptimeMap] = useState<Record<number, number>>({});
  const [gatewayUpdateDelayMap, setGatewayUpdateDelayMap] = useState<Record<number, number>>({});
  const [esp32DeviceMap, setEsp32DeviceMap] = useState<Record<number, Esp32RuntimeData>>({});
  const [zoneSettings, setZoneSettings] = useState(defaultZoneSettings);
  const [draftZoneSettings, setDraftZoneSettings] = useState(defaultZoneSettings);
  const [editingZoneFloors, setEditingZoneFloors] = useState<FloorId[]>([]);
  const [gatewayZoneSettings, setGatewayZoneSettings] = useState(defaultGatewayZoneSettings);
  const [commandFeedback, setCommandFeedback] = useState('대기 중');
  const [activeEmergency, setActiveEmergency] = useState<Worker | null>(null);
  const [acknowledgedEmergencyIds, setAcknowledgedEmergencyIds] = useState<string[]>([]);
  const [accidentTime, setAccidentTime] = useState<string | null>(null);
  const [accidentSnapshot, setAccidentSnapshot] = useState<AccidentLogRow[]>([]);
  const [isAccidentDataReady, setIsAccidentDataReady] = useState(false);

  const accidentLogRef = useRef<AccidentLogRow[]>([]);
  const fallDetectedAtMsRef = useRef<number | null>(null);
  const accidentSnapshotRef = useRef<AccidentLogRow[]>([]);
  const [emergencyActionResult, setEmergencyActionResult] = useState<EmergencyActionResult | null>(null);
  const [controlActionResult, setControlActionResult] = useState<ControlActionResult | null>(null);
  const activeFloor: FloorId = selectedFloor === 'ALL' ? '1F' : selectedFloor;

  const socketsRef = useRef<WebSocket[]>([]);

  const previousGatewayReceiveRef = useRef<
    Record<number, { ts: number; receivedAtMs: number }>
  >({});

  const sirenRef = useRef<{
    context: AudioContext;
    oscillator: OscillatorNode;
    lfo: OscillatorNode;
    gain: GainNode;
  } | null>(null);

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}시간 ${m}분 ${s}초`;
    }

    if (m > 0) {
      return `${m}분 ${s}초`;
    }

    return `${s}초`;
  };

  const formatAccidentTime = (date: Date) =>
    date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  
  const downloadAccidentExcel = useCallback(() => {
    const rows = accidentSnapshotRef.current.length
      ? accidentSnapshotRef.current
      : accidentSnapshot;

    if (!rows.length) {
      alert('다운로드할 사고 데이터가 없습니다.');
      return;
    }

    const excelData = rows.map((log, index) => ({
      번호: index + 1,
      기록시간: log.time,
      게이트웨이ID: log.gatewayId,
      작업자ID: log.workerId,
      층: log.floor,
      작업자_X좌표: Number(log.workerX.toFixed(2)),
      작업자_Y좌표: Number(log.workerY.toFixed(2)),
      훅체결여부: log.isHooked ? '체결됨' : '미체결',
      추락감지여부: log.hasFallen ? '추락 감지' : '정상',
      훅존위치: log.isInsideHookZone ? '훅존 내부' : '훅존 외부',
      위험도점수: log.riskScore,
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, '사고 발생 데이터');

    const safeFileTime = (accidentTime ?? formatAccidentTime(new Date()))
      .replace(/[/:]/g, '-')
      .replace(/\s/g, '_');

    XLSX.writeFile(workbook, `사고_발생_데이터_${safeFileTime}.xlsx`);
  }, [accidentSnapshot, accidentTime]);

  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: QUERY_KEYS.workers,
    queryFn: async () => [],
    initialData: [],
  });

  const { data: events = initialEvents } = useQuery({
    queryKey: QUERY_KEYS.events,
    queryFn: async () => initialEvents,
    initialData: initialEvents,
  });

  const findNearestGatewayAnchor = useCallback(
    (floor: FloorId, coords: Coordinate, settings: Record<FloorId, GatewayZoneSetting> = gatewayZoneSettings) =>
      settings[floor].anchors
        .map((anchor) => ({
          anchor,
          distance: Math.hypot(anchor.x - coords.x, anchor.y - coords.y),
        }))
        .sort((a, b) => a.distance - b.distance)[0]?.anchor,
    [gatewayZoneSettings],
  );

  const resolveBeaconZoneAnchors = useCallback((payload: GatewayPayload): GatewayAnchor[] => {
    const seen = new Set<string>();

    return (payload.beacons ?? [])
      .map((beacon): GatewayAnchor | undefined => {
        if (seen.has(beacon.id)) {
          return undefined;
        }

        seen.add(beacon.id);

        if (beacon.x !== undefined && beacon.y !== undefined) {
          return {
            id: beacon.id,
            label: beacon.id,
            x: beacon.x,
            y: beacon.y,
          };
        }

        const anchor =
          beaconAnchors.find(
            (item) => item.id.toLowerCase() === beacon.id.toLowerCase() && item.floor === payload.floor,
          ) ?? beaconAnchors.find((item) => item.id.toLowerCase() === beacon.id.toLowerCase());

        return anchor
          ? {
              id: beacon.id,
              label: anchor.label,
              x: anchor.x,
              y: anchor.y,
            }
          : undefined;
      })
      .filter((anchor): anchor is GatewayAnchor => Boolean(anchor))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, []);

  const syncBeaconZoneFromPayload = useCallback(
    (payload: GatewayPayload) => {
      const anchors = resolveBeaconZoneAnchors(payload);

      if (anchors.length < 3) {
        return;
      }

      const isSameAnchors = (currentAnchors: GatewayAnchor[]) =>
        currentAnchors.length === anchors.length &&
        currentAnchors.every((anchor, index) => {
          const nextAnchor = anchors[index];
          return anchor.id === nextAnchor.id && anchor.x === nextAnchor.x && anchor.y === nextAnchor.y;
        });

      setGatewayZoneSettings((current) =>
        isSameAnchors(current[payload.floor].anchors)
          ? current
          : {
              ...current,
              [payload.floor]: { anchors },
            },
      );
    },
    [resolveBeaconZoneAnchors],
  );

  const pushWorkerUpdate = useCallback(
    (payload: GatewayPayload, message?: string) => {
      syncBeaconZoneFromPayload(payload);

      const normalizedWorker = normalizeGatewayPayload(payload);
      const calibratedGateway =
        payload.gateway_id ?? findNearestGatewayAnchor(payload.floor, payload.coords)?.id ?? normalizedWorker.gateway;

      const nextWorker: Worker = {
        ...normalizedWorker,
        gateway_id: calibratedGateway,
        gateway: calibratedGateway,
      };

      let eventWorker = nextWorker;

      queryClient.setQueryData<Worker[]>(QUERY_KEYS.workers, (current = []) => {
        const exists = current.some((worker) => worker.worker_id === nextWorker.worker_id);

        if (!exists) {
          return [...current, nextWorker];
        }

        return current.map((worker) => {
          if (worker.worker_id !== nextWorker.worker_id) {
            return worker;
          }

          const nextBattery = clamp(
            payload.battery ?? worker.battery - (nextWorker.status === 'EMERGENCY' ? 2 : 0.7),
            5,
            100,
          );

          const airbagCartridge =
            payload.telemetry?.airbagCartridge ??
            (nextWorker.status === 'EMERGENCY'
              ? nextWorker.telemetry.airbagCartridge
              : worker.telemetry.airbagCartridge);

          const merged: Worker = {
            ...worker,
            ...nextWorker,
            battery: nextBattery,
            gateway: nextWorker.gateway,
            gateway_id: nextWorker.gateway_id,
            beacons: nextWorker.beacons?.length ? nextWorker.beacons : worker.beacons,
            telemetry: {
              ...worker.telemetry,
              ...nextWorker.telemetry,
              airbagCartridge,
            },
            trace: [...worker.trace, { ...nextWorker.coords, timestamp: nextWorker.timestamp }].slice(-28),
            batteryHistory: [...worker.batteryHistory, nextBattery].slice(-18),
            rssiHistory: [...worker.rssiHistory, nextWorker.telemetry.rssiDbm].slice(-18),
          };

          eventWorker = merged;
          return merged;
        });
      });

      const eventStatus: EventLog['status'] =
        eventWorker.telemetry.airbagCartridge !== 'CHARGED'
          ? 'MAINTENANCE'
          : eventWorker.battery <= 25
            ? 'BATTERY'
            : eventWorker.status;

      const eventMessage =
        message ??
        (eventStatus === 'MAINTENANCE'
          ? eventWorker.telemetry.airbagCartridge === 'MISSING'
            ? '에어백 카트리지 장착 필요'
            : '에어백 카트리지 교체 필요'
          : eventStatus === 'BATTERY'
            ? '배터리 부족 점검 필요'
            : statusMeta[eventWorker.status].eventText);

      queryClient.setQueryData<EventLog[]>(QUERY_KEYS.events, (current = initialEvents) => [
        createEvent(eventWorker, eventMessage, eventStatus),
        ...current,
      ].slice(0, 60));
    },
    [findNearestGatewayAnchor, queryClient, syncBeaconZoneFromPayload],
  );

  const pushWorkerUpdateRef = useRef(pushWorkerUpdate);

  useEffect(() => {
    pushWorkerUpdateRef.current = pushWorkerUpdate;
  }, [pushWorkerUpdate]);

  useEffect(() => {
    if (gatewayUrls.length) {
      return;
    }

    setConnectionState('mock');

    let tick = 0;

    const timer = window.setInterval(() => {
      tick += 1;

      const base = initialWorkers[tick % initialWorkers.length];
      const emergencyCycle = tick % 48 === 0;
      const warningCycle = tick % 10 === 0 || !base.is_hooked;
      const status: WorkerStatus = emergencyCycle ? 'EMERGENCY' : warningCycle ? 'WARNING' : 'NORMAL';
      const nextHooked = status === 'NORMAL';
      const driftX = Math.sin(tick * 0.8 + base.coords.x) * 14;
      const driftY = Math.cos(tick * 0.64 + base.coords.y) * 10;

      const coords = {
        x: clamp(base.coords.x + driftX + (tick % 3) * 5, 12, 190),
        y: clamp(base.coords.y + driftY + (tick % 4) * 3, 12, 132),
      };

      const floorBeacons = beaconAnchors.filter((beacon) => beacon.floor === base.floor).slice(0, 4);
      const beacons = floorBeacons.map((beacon) => {
        const distance = Math.hypot(beacon.x - coords.x, beacon.y - coords.y);
        const dist = Number((distance * 0.34).toFixed(1));

        return {
          id: beacon.id,
          dist,
          rssi: Math.round(clamp(-42 - distance * 0.28 + Math.sin(tick + beacon.x) * 2, -92, -35)),
        };
      });

      const unhookedDanger = !nextHooked && isInSafetyHookZone({ ...base, coords, status, is_hooked: nextHooked }, zoneSettings);

      pushWorkerUpdate({
        worker_id: base.worker_id,
        floor: base.floor,
        status,
        is_hooked: nextHooked,
        coords,
        timestamp: new Date().toISOString(),
        beacons,
        telemetry: createTelemetry(status, {
          accelerationG: Number((0.8 + Math.abs(Math.sin(tick)) * (status === 'EMERGENCY' ? 4.2 : 1.4)).toFixed(1)),
          fallConfidence: status === 'EMERGENCY' ? 96 : unhookedDanger ? 72 : status === 'WARNING' ? 55 : 12,
          latencyMs: status === 'EMERGENCY' ? 142 : 118 + (tick % 6) * 9,
          rssiDbm: -55 - (tick % 7) * 3 - (status === 'EMERGENCY' ? 8 : 0),
        }),
      }, unhookedDanger ? 'A-Hook 존 미체결 진입' : undefined);
    }, 500);

    return () => window.clearInterval(timer);
  }, [pushWorkerUpdate, zoneSettings]);

  useEffect(() => {
    if (!gatewayUrls.length) {
      return;
    }

    let disposed = false;

    console.log('연결 시도 URL 목록:', gatewayUrls);
    setConnectionState('connecting');

    const sockets = gatewayUrls.map((url) => {
      console.log('WebSocket 연결 시도:', url);
      return new WebSocket(url);
    });

    socketsRef.current = sockets;

    const syncConnectionState = () => {
      if (disposed) {
        return;
      }

      const openCount = sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length;

      if (openCount > 0) {
        setConnectionState('live');
        return;
      }

      const stillConnecting = sockets.some((socket) => socket.readyState === WebSocket.CONNECTING);
      setConnectionState(stillConnecting ? 'connecting' : 'offline');
    };

    sockets.forEach((socket) => {
      socket.addEventListener('open', () => {
        console.log('WebSocket 연결 성공:', socket.url);
        syncConnectionState();
      });

      socket.addEventListener('close', () => {
        console.log('WebSocket 연결 종료:', socket.url);
        syncConnectionState();
      });

      socket.addEventListener('error', (error) => {
        console.error('WebSocket 에러:', socket.url, error);
        syncConnectionState();
      });

      socket.addEventListener('message', (event) => {
        if (disposed) {
          return;
        }

        console.log('ESP32 원본 데이터:', event.data);

        try {
          const receivedAtMs = Date.now();

          const parsedData = JSON.parse(event.data);
          console.log('JSON 변환된 데이터:', parsedData);

          const esp32Data = parsedData as Partial<Esp32GatewayData>;

          const gatewayUptimeSec =
            typeof esp32Data.ts === 'number'
              ? esp32Data.ts
              : 0;

          // 갱신 지연 계산
          // ESP32의 ts는 "게이트웨이가 켜진 뒤 지난 시간"입니다.
          // 따라서 절대적인 네트워크 지연시간은 계산할 수 없고,
          // 이전 데이터와 현재 데이터의 ts 차이와 React 수신 간격을 비교해서
          // "1초 주기 대비 데이터 수신이 얼마나 밀렸는지"를 계산합니다.
          let updateDelayMs = 0;

          if (typeof esp32Data.gw_id === 'number' && typeof esp32Data.ts === 'number') {
            const gwId = esp32Data.gw_id;
            const previous = previousGatewayReceiveRef.current[gwId];

            if (previous) {
              const expectedIntervalMs = (gatewayUptimeSec - previous.ts) * 1000;
              const actualIntervalMs = receivedAtMs - previous.receivedAtMs;
              const rawUpdateDelayMs = actualIntervalMs - expectedIntervalMs;

              updateDelayMs = Math.round(clamp(rawUpdateDelayMs, 0, 10000));
            }

            previousGatewayReceiveRef.current[gwId] = {
              ts: gatewayUptimeSec,
              receivedAtMs,
            };

            setGatewayUpdateDelayMap((current) => ({
              ...current,
              [gwId]: updateDelayMs,
            }));
          }

          const safeLatencyMs = updateDelayMs;

          if (typeof esp32Data.gw_id === 'number') {
            const gwId = esp32Data.gw_id;

            setActiveGatewayIds((current) =>
              current.includes(gwId)
                ? current
                : [...current, gwId],
            );

            setGatewayUptimeMap((current) => ({
              ...current,
              [gwId]: gatewayUptimeSec,
            }));

            if (typeof esp32Data.status?.is_hooked === 'boolean') {
              setGatewayHookStatusMap((current) => ({
                ...current,
                [gwId]: esp32Data.status!.is_hooked,
              }));
            }

            if (typeof esp32Data.status?.has_fallen === 'boolean') {
              setGatewayFallStatusMap((current) => ({
                ...current,
                [gwId]: esp32Data.status!.has_fallen,
              }));
            }

            if (
              typeof esp32Data.status?.is_hooked === 'boolean' &&
              typeof esp32Data.status?.has_fallen === 'boolean'
            ) {
              setEsp32DeviceMap((current) => ({
                ...current,
                [gwId]: {
                  gw_id: gwId,
                  status: {
                    is_hooked: esp32Data.status!.is_hooked,
                    has_fallen: esp32Data.status!.has_fallen,
                  },
                  beacons: Array.isArray(esp32Data.beacons) ? esp32Data.beacons : [],
                  ts: esp32Data.ts,
                  receivedAt: new Date(receivedAtMs).toISOString(),
                  latencyMs: safeLatencyMs,
                },
              }));
            }
          }

          const payloads = parseGatewayMessage(parsedData);
          console.log('대시보드용으로 변환된 데이터:', payloads);

          if (!payloads.length) {
            console.warn('parseGatewayMessage 결과가 비어 있음');
            setCommandFeedback('수신 데이터 필드 확인 필요');
            return;
          }

          const mappedPayloads = payloads.map((payload) => {
            const floor: FloorId =
              typeof esp32Data.gw_id === 'number'
                ? esp32Data.gw_id === 1
                  ? '1F'
                  : esp32Data.gw_id === 2
                    ? '2F'
                    : esp32Data.gw_id === 3
                      ? '3F'
                      : '4F'
                : payload.floor;

            const estimatedCoords = estimateWorkerCoordsFromBeacons(
              floor,
              Array.isArray(esp32Data.beacons) ? esp32Data.beacons : [],
            );

            const averageRssi =
              Array.isArray(esp32Data.beacons) && esp32Data.beacons.length > 0
                ? Math.round(
                    esp32Data.beacons.reduce((sum, beacon) => sum + beacon.rssi, 0) /
                      esp32Data.beacons.length,
                  )
                : payload.telemetry?.rssiDbm ?? 0;

            const status: WorkerStatus =
              esp32Data.status?.has_fallen === true
                ? 'EMERGENCY'
                : esp32Data.status?.is_hooked === false
                  ? 'WARNING'
                  : 'NORMAL';

            return {
              ...payload,

              worker_id: `ESP32-GW-${esp32Data.gw_id ?? 'UNKNOWN'}`,

              floor,
              gateway_id: typeof esp32Data.gw_id === 'number' ? esp32Data.gw_id : payload.gateway_id,

              status,
              is_hooked:
                typeof esp32Data.status?.is_hooked === 'boolean'
                  ? esp32Data.status.is_hooked
                  : payload.is_hooked,

              coords: estimatedCoords ?? payload.coords,
              beacons: Array.isArray(esp32Data.beacons) ? esp32Data.beacons : payload.beacons,

              timestamp: new Date(receivedAtMs).toISOString(),

              telemetry: {
                ...payload.telemetry,
                rssiDbm: averageRssi,
                latencyMs: safeLatencyMs,
                fallConfidence: esp32Data.status?.has_fallen ? 100 : 0,
              },
            };
          });

          mappedPayloads.forEach((payload) => {
            const gatewayPayload = payload as GatewayPayload;

            const logWorker = normalizeGatewayPayload(gatewayPayload);

            const hasFallen = gatewayPayload.status === 'EMERGENCY';
            const isHooked = gatewayPayload.is_hooked;
            const isUnhooked = !isHooked;

            const isOuterArea =
              gatewayPayload.coords.x <= 20 ||
              gatewayPayload.coords.x >= 180 ||
              gatewayPayload.coords.y <= 15 ||
              gatewayPayload.coords.y >= 125;

            const isInsideHookZone = isInSafetyHookZone(
              logWorker,
              zoneSettings,
            );

            const fallScore = hasFallen ? 60 : 0;
            const hookScore = isUnhooked ? 15 : 0;
            const outerScore = isOuterArea ? 15 : 0;
            const hookZoneScore = !isInsideHookZone ? 10 : 0;

            const riskScore = fallScore + hookScore + outerScore + hookZoneScore;

            const logRow: AccidentLogRow = {
              timestampMs: receivedAtMs,
              time: formatAccidentTime(new Date(receivedAtMs)),
              gatewayId:
                typeof gatewayPayload.gateway_id === 'number'
                  ? gatewayPayload.gateway_id
                  : Number(gatewayPayload.worker_id.replace('ESP32-GW-', '')),
              workerId: gatewayPayload.worker_id,
              floor: gatewayPayload.floor,
              workerX: gatewayPayload.coords.x,
              workerY: gatewayPayload.coords.y,
              isHooked,
              hasFallen,
              isInsideHookZone,
              riskScore,
            };

            accidentLogRef.current = [...accidentLogRef.current, logRow].slice(-1000);

            if (hasFallen && fallDetectedAtMsRef.current === null) {
              const fallTimeMs = receivedAtMs;

              fallDetectedAtMsRef.current = fallTimeMs;
              setAccidentTime(formatAccidentTime(new Date(fallTimeMs)));
              setIsAccidentDataReady(false);

              window.setTimeout(() => {
                const snapshot = accidentLogRef.current.filter((log) => {
                  return (
                    log.timestampMs >= fallTimeMs - 30000 &&
                    log.timestampMs <= fallTimeMs + 30000
                  );
                });

                accidentSnapshotRef.current = snapshot;
                setAccidentSnapshot(snapshot);
                setIsAccidentDataReady(true);
              }, 30000);
            }

            pushWorkerUpdateRef.current(gatewayPayload);
          });
        } catch (error) {
          console.error('수신 데이터 처리 중 오류:', error);
          setCommandFeedback('수신 데이터 형식 오류');
        }
      });
    });

    return () => {
      disposed = true;
      sockets.forEach((socket) => socket.close());
      socketsRef.current = [];
    };
  }, []);

  const selectedWorker = useMemo(
    () => workers.find((worker) => worker.worker_id === selectedWorkerId),
    [selectedWorkerId, workers],
  );

  const changeFloor = useCallback(
    (floor: FloorFilter) => {
      setSelectedFloor(floor);

      if (floor === 'ALL') {
        return;
      }

      const floorWorker = workers.find((worker) => worker.floor === floor);

      if (floorWorker) {
        setSelectedWorkerId(floorWorker.worker_id);
      }
    },
    [workers],
  );

  const visibleZoneSettings = useMemo(() => {
    const next = { ...zoneSettings };

    editingZoneFloors.forEach((floor) => {
      next[floor] = draftZoneSettings[floor];
    });

    return next;
  }, [draftZoneSettings, editingZoneFloors, zoneSettings]);

  const pendingEmergencyWorker = useMemo(() => {
    return [...workers]
      .filter((worker) => worker.status === 'EMERGENCY' && !acknowledgedEmergencyIds.includes(worker.worker_id))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
  }, [acknowledgedEmergencyIds, workers]);

  const startSirenSound = useCallback(() => {
    if (sirenRef.current) {
      return;
    }

    const audioWindow = window as Window & {
      webkitAudioContext?: typeof AudioContext;
    };

    const AudioCtor = window.AudioContext ?? audioWindow.webkitAudioContext;

    if (!AudioCtor) {
      return;
    }

    try {
      const context = new AudioCtor();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const lfo = context.createOscillator();
      const lfoGain = context.createGain();

      oscillator.type = 'sawtooth';
      oscillator.frequency.value = 760;
      lfo.frequency.value = 4.2;
      lfoGain.gain.value = 0.045;
      gain.gain.value = 0.025;

      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      lfo.start();

      sirenRef.current = { context, oscillator, lfo, gain };
    } catch {
      setCommandFeedback('브라우저 사운드 권한 대기');
    }
  }, []);

  const stopSirenSound = useCallback(() => {
    const siren = sirenRef.current;

    if (!siren) {
      return;
    }

    siren.gain.gain.setTargetAtTime(0.0001, siren.context.currentTime, 0.03);

    window.setTimeout(() => {
      siren.oscillator.stop();
      siren.lfo.stop();
      siren.context.close();
    }, 120);

    sirenRef.current = null;
  }, []);

  useEffect(() => {
    setAcknowledgedEmergencyIds((current) => {
      const next = current.filter((id) =>
        workers.some((worker) => worker.worker_id === id && worker.status === 'EMERGENCY'),
      );

      if (next.length === current.length && next.every((id, index) => id === current[index])) {
        return current;
      }

      return next;
    });
  }, [workers]);

  useEffect(() => {
    if (activeEmergency || !pendingEmergencyWorker) {
      return;
    }

    setSelectedWorkerId(pendingEmergencyWorker.worker_id);
    setSelectedFloor(pendingEmergencyWorker.floor);
    setActiveEmergency(pendingEmergencyWorker);
    startSirenSound();
  }, [activeEmergency, pendingEmergencyWorker, startSirenSound]);

  useEffect(() => stopSirenSound, [stopSirenSound]);

  const esp32Devices = useMemo(
    () => Object.values(esp32DeviceMap).sort((a, b) => a.gw_id - b.gw_id),
    [esp32DeviceMap],
  );

  const riskAnalysisRisk = useMemo(() => {
    if (!selectedWorker) {
      return undefined;
    }

    const selectedGatewayId =
      typeof selectedWorker.gateway_id === 'number'
        ? selectedWorker.gateway_id
        : Number(selectedWorker.worker_id.replace('ESP32-GW-', ''));

    const selectedDevice = esp32Devices.find(
      (device) => device.gw_id === selectedGatewayId,
    );

    if (!selectedDevice) {
      return undefined;
    }

    const hasFallen = selectedDevice.status.has_fallen;
    const isUnhooked = !selectedDevice.status.is_hooked;

    // 외곽 판단: 지도 좌표가 가장자리 쪽에 있으면 위험 점수 부여
    // 현재 좌표 범위가 대략 x: 0~200, y: 0~140 기준이라면 아래처럼 판단
    const isOuterArea =
      selectedWorker.coords.x <= 20 ||
      selectedWorker.coords.x >= 180 ||
      selectedWorker.coords.y <= 15 ||
      selectedWorker.coords.y >= 125;

    // 훅존 안에 있는지 판단
    const isInsideHookZone = isInSafetyHookZone(
      selectedWorker,
      zoneSettings,
    );

    const fallScore = hasFallen ? 60 : 0;
    const hookScore = isUnhooked ? 15 : 0;
    const outerScore = isOuterArea ? 15 : 0;
    const hookZoneScore = !isInsideHookZone ? 10 : 0;

    return fallScore + hookScore + outerScore + hookZoneScore;
  }, [selectedWorker, esp32Devices, zoneSettings]);

  const metrics = useMemo(() => {
    const total = activeGatewayIds.length;
    const unhooked = activeGatewayIds.filter((gwId) => gatewayHookStatusMap[gwId] === false).length;
    const emergency = activeGatewayIds.filter((gwId) => gatewayFallStatusMap[gwId] === true).length;

    const updateDelayValues = activeGatewayIds
      .map((gwId) => gatewayUpdateDelayMap[gwId])
      .filter((delay): delay is number => typeof delay === 'number');

    const averageUpdateDelayMs = updateDelayValues.length
      ? Math.round(
          updateDelayValues.reduce((sum, delay) => sum + delay, 0) /
            updateDelayValues.length,
        )
      : 0;

    return { total, unhooked, emergency, averageUpdateDelayMs };
  }, [activeGatewayIds, gatewayHookStatusMap, gatewayFallStatusMap, gatewayUpdateDelayMap]);

  const createGatewayCommandPayload = (command: DownlinkCommand) => {
    switch (command.command) {
      case 'ACTIVATE_ALARM':
        return {
          type: 'CONTROL',
          command: 'ACTIVATE_ALARM',
          target_worker_id: command.target_id,
          target_id: command.target_id,
        };

      case 'SET_LED_MODE': {
        const hardwareCommand = command.mode === 'OFF' ? 'LED_OFF' : command.mode === 'STEADY' ? 'LED_ON' : 'LED_BLINK';

        return {
          type: 'CONTROL',
          command: hardwareCommand,
          target_worker_id: command.target_id,
          target_id: command.target_id,
          mode: command.mode,
        };
      }

      case 'BROADCAST_EVACUATION':
        return {
          type: 'CONTROL',
          command: 'EVACUATION_ALERT',
          scope: command.floor === 'ALL' ? 'ALL' : 'FLOOR',
          floor: command.floor,
          reason: command.reason,
        };

      case 'RESET_AIRBAG_CARTRIDGE':
        return {
          type: 'CONTROL',
          command: 'RESET_AIRBAG_CARTRIDGE',
          target_worker_id: command.target_id,
          target_id: command.target_id,
        };

      case 'UPDATE_ZONE':
        return {
          type: 'CONFIG',
          command: 'UPDATE_ZONE',
          floor: command.floor,
          threshold_rssi: command.threshold_rssi,
          danger_radius_m: command.danger_radius_m,
          zone_center: command.zone_center,
        };

      case 'UPDATE_GATEWAY_ZONE':
        return {
          type: 'CONFIG',
          command: 'UPDATE_GATEWAY_ZONE',
          floor: command.floor,
          anchors: command.anchors,
        };
    }
  };

  const sendCommand = useCallback(
    (command: DownlinkCommand) => {
      const commandText = JSON.stringify(createGatewayCommandPayload(command));
      const openSockets = socketsRef.current.filter((socket) => socket.readyState === WebSocket.OPEN);

      if (connectionState === 'live' && openSockets.length > 0) {
        openSockets.forEach((socket) => socket.send(commandText));
        setCommandFeedback(`게이트웨이 ${openSockets.length}곳 전송 완료`);
      } else {
        setCommandFeedback('Mock 모드 명령 기록');
      }

      const target =
        'target_id' in command
          ? workers.find((worker) => worker.worker_id === command.target_id)
          : undefined;

      const floor = 'floor' in command ? command.floor : target?.floor ?? '4F';
      const eventFloor: FloorId = floor === 'ALL' ? '4F' : floor;
      const workerName = target?.name ?? (command.command === 'BROADCAST_EVACUATION' ? '전체 작업자' : '구역 설정');

      const message = (() => {
        switch (command.command) {
          case 'ACTIVATE_ALARM':
            return `${workerName} 조끼 부저/LED 작동`;

          case 'SET_LED_MODE':
            return `${workerName} LED ${ledLabels[command.mode]} 제어`;

          case 'BROADCAST_EVACUATION':
            return `${floor === 'ALL' ? '전체 현장' : floorLabels[floor]} 주변 작업자 동시 경고`;

          case 'RESET_AIRBAG_CARTRIDGE':
            return `${workerName} 에어백 카트리지 교체 완료`;

          case 'UPDATE_ZONE':
            return `${floorLabels[command.floor]} A-Hook 존 갱신`;

          case 'UPDATE_GATEWAY_ZONE':
            return `${floorLabels[command.floor]} 비콘 기준점 갱신`;
        }
      })();

      if (command.command === 'SET_LED_MODE' || command.command === 'RESET_AIRBAG_CARTRIDGE') {
        queryClient.setQueryData<Worker[]>(QUERY_KEYS.workers, (current = initialWorkers) =>
          current.map((worker) => {
            if (worker.worker_id !== command.target_id) {
              return worker;
            }

            if (command.command === 'SET_LED_MODE') {
              return {
                ...worker,
                telemetry: {
                  ...worker.telemetry,
                  ledMode: command.mode,
                },
              };
            }

            return {
              ...worker,
              telemetry: {
                ...worker.telemetry,
                airbagState: 'READY',
                airbagCartridge: 'CHARGED',
              },
            };
          }),
        );
      }

      const controlStatus: EventLog['status'] =
        command.command === 'RESET_AIRBAG_CARTRIDGE' ? 'MAINTENANCE' : 'CONTROL';

      queryClient.setQueryData<EventLog[]>(QUERY_KEYS.events, (current = initialEvents) => [
        {
          id: `control-${Date.now()}`,
          timestamp: new Date().toISOString(),
          floor: eventFloor,
          workerId: target?.worker_id ?? command.command,
          workerName,
          status: controlStatus,
          message,
        },
        ...current,
      ].slice(0, 60));
    },
    [connectionState, queryClient, workers],
  );

  const activateSelectedAlarm = () => {
    if (!selectedWorker) {
      return;
    }

    const worker = selectedWorker;

    sendCommand({
      command: 'ACTIVATE_ALARM',
      target_id: worker.worker_id,
    });

    setControlActionResult({
      action: 'VEST_ALARM',
      floor: worker.floor,
      workerId: worker.worker_id,
      workerName: worker.name,
      gateway: worker.gateway,
      affectedCount: 1,
      timestamp: new Date().toISOString(),
    });
  };

  const updateZoneSetting = (floor: FloorId, key: 'threshold' | 'dangerRadius', value: number) => {
    setDraftZoneSettings((current) => ({
      ...current,
      [floor]: {
        ...current[floor],
        [key]: value,
      },
    }));
  };

  const beginZoneEdit = (floor: FloorId) => {
    setDraftZoneSettings((current) => ({
      ...current,
      [floor]: zoneSettings[floor],
    }));

    setEditingZoneFloors((current) => (current.includes(floor) ? current : [...current, floor]));
  };

  const applyZoneSetting = (floor: FloorId) => {
    const setting = draftZoneSettings[floor];

    setZoneSettings((current) => ({
      ...current,
      [floor]: setting,
    }));

    setEditingZoneFloors((current) => current.filter((editingFloor) => editingFloor !== floor));

    sendCommand({
      command: 'UPDATE_ZONE',
      floor,
      threshold_rssi: setting.threshold,
      danger_radius_m: setting.dangerRadius,
      zone_center: setting.center,
    });
  };

  const updateZoneCenter = (floor: FloorId, center: Coordinate) => {
    setDraftZoneSettings((current) => ({
      ...current,
      [floor]: {
        ...current[floor],
        center,
      },
    }));
  };

  const setSelectedLedMode = (mode: LedMode) => {
    if (!selectedWorker) {
      return;
    }

    sendCommand({
      command: 'SET_LED_MODE',
      target_id: selectedWorker.worker_id,
      mode,
    });
  };

  const resetSelectedCartridge = () => {
    if (!selectedWorker) {
      return;
    }

    const worker = selectedWorker;

    sendCommand({
      command: 'RESET_AIRBAG_CARTRIDGE',
      target_id: worker.worker_id,
    });

    setControlActionResult({
      action: 'CARTRIDGE_RESET',
      floor: worker.floor,
      workerId: worker.worker_id,
      workerName: worker.name,
      gateway: worker.gateway,
      affectedCount: 1,
      timestamp: new Date().toISOString(),
    });
  };

  const broadcastEvacuation = (floor: FloorId | 'ALL') => {
    sendCommand({
      command: 'BROADCAST_EVACUATION',
      floor,
      reason: 'FALL_OR_UNHOOKED_DANGER',
    });

    setControlActionResult({
      action: floor === 'ALL' ? 'SITE_EVACUATION' : 'FLOOR_WARNING',
      floor,
      workerId: floor === 'ALL' ? undefined : selectedWorker?.worker_id,
      workerName: floor === 'ALL' ? undefined : selectedWorker?.name,
      gateway: floor === 'ALL' ? 'ALL-GATEWAYS' : selectedWorker?.gateway,
      affectedCount: floor === 'ALL' ? workers.length : workers.filter((worker) => worker.floor === floor).length,
      timestamp: new Date().toISOString(),
    });
  };

  const handleEmergencyAction = (action: EmergencyActionKind) => {
    if (!activeEmergency) {
      return;
    }

    const worker = activeEmergency;
    const handledAt = new Date().toISOString();

    stopSirenSound();

    setAcknowledgedEmergencyIds((current) =>
      current.includes(worker.worker_id) ? current : [...current, worker.worker_id],
    );

    if (action === 'ALARM_RELAY') {
      sendCommand({
        command: 'ACTIVATE_ALARM',
        target_id: worker.worker_id,
      });
    }

    if (action === 'BROADCAST_WARNING') {
      sendCommand({
        command: 'BROADCAST_EVACUATION',
        floor: worker.floor,
        reason: 'EMERGENCY_FALL_DETECTED',
      });
    }

    if (action === 'ACK_STOP') {
      setCommandFeedback('비상 알림 확인 및 관제 사이렌 정지');

      const acknowledgementEvent: EventLog = {
        id: `ack-${Date.now()}`,
        timestamp: handledAt,
        floor: worker.floor,
        workerId: worker.worker_id,
        workerName: worker.name,
        status: 'CONTROL',
        message: `${worker.name} 추락 알림 확인 및 관제 사이렌 정지`,
      };

      queryClient.setQueryData<EventLog[]>(QUERY_KEYS.events, (current = initialEvents) => [
        acknowledgementEvent,
        ...current,
      ].slice(0, 60));
    }

    setActiveEmergency(null);

    setEmergencyActionResult({
      action,
      workerId: worker.worker_id,
      workerName: worker.name,
      floor: worker.floor,
      gateway: worker.gateway,
      timestamp: handledAt,
    });
  };

  return (
    <main className="min-h-screen bg-[#090b0a] px-3 py-3 text-stone-100 sm:px-5 sm:py-4 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1840px] flex-col gap-4">
        <Header connectionState={connectionState} commandFeedback={commandFeedback} />

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={<HardHat className="h-6 w-6" />}
            label="총 작업자"
            value={metrics.total}
            helper="현장 활성 태그"
            tone="emerald"
          />
          <MetricCard
            icon={<ShieldAlert className="h-6 w-6" />}
            label="훅 미체결"
            value={metrics.unhooked}
            helper="안전고리 미체결"
            tone="amber"
          />
          <MetricCard
            icon={<Siren className="h-6 w-6" />}
            label="사고 발생"
            value={metrics.emergency}
            helper="추락 징후"
            tone="red"
          />
          <MetricCard
            icon={<Gauge className="h-6 w-6" />}
            label="갱신 지연"
            value={metrics.averageUpdateDelayMs}
            helper="ms / 수신 주기 오차"
            tone="cyan"
          />
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(330px,390px)] lg:items-start 2xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <SiteMap
            workers={workers}
            selectedFloor={selectedFloor}
            selectedWorkerId={selectedWorker?.worker_id}
            zoneSettings={visibleZoneSettings}
            editableZoneFloors={editingZoneFloors}
            onZoneCenterChange={updateZoneCenter}
            onFloorChange={changeFloor}
            onSelectWorker={setSelectedWorkerId}
          />

          <aside className="grid gap-4 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
            <ControlPanel
              selectedWorker={selectedWorker}
              risk={riskAnalysisRisk}
              activeFloor={activeFloor}
              zoneSetting={draftZoneSettings[activeFloor]}
              isZoneEditable={editingZoneFloors.includes(activeFloor)}
              onBeginZoneEdit={() => beginZoneEdit(activeFloor)}
              onZoneRadiusChange={(value) => updateZoneSetting(activeFloor, 'dangerRadius', value)}
              onZoneThresholdChange={(value) => updateZoneSetting(activeFloor, 'threshold', value)}
              onApplyZoneSetting={() => applyZoneSetting(activeFloor)}
              onActivateAlarm={activateSelectedAlarm}
              onBroadcastFloor={() => {
                if (!selectedWorker) {
                  return;
                }

                broadcastEvacuation(selectedWorker.floor);
              }}
              onBroadcastSite={() => broadcastEvacuation('ALL')}
            />
          </aside>

          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <OperationalPanels esp32Devices={esp32Devices} />
          </div>
        </div>
      </div>

      {activeEmergency && (
        <EmergencyOverlay
          worker={activeEmergency}
          accidentTime={accidentTime}
          isAccidentDataReady={isAccidentDataReady}
          onDownloadAccidentExcel={downloadAccidentExcel}
          onAlarm={() => handleEmergencyAction('ALARM_RELAY')}
          onBroadcast={() => handleEmergencyAction('BROADCAST_WARNING')}
          onAcknowledge={() => handleEmergencyAction('ACK_STOP')}
        />
      )}

      {emergencyActionResult && (
        <EmergencyActionDialog result={emergencyActionResult} onClose={() => setEmergencyActionResult(null)} />
      )}

      {controlActionResult && (
        <ControlActionDialog result={controlActionResult} onClose={() => setControlActionResult(null)} />
      )}
    </main>
  );
}

export default App;