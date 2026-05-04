import {
  Activity,
  BatteryWarning,
  BrainCircuit,
  Cpu,
  Gauge,
  HardHat,
  ShieldAlert,
  Siren,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ControlPanel } from './components/ControlPanel';
import { EmergencyOverlay } from './components/EmergencyOverlay';
import { Header } from './components/Header';
import { NotificationPanel } from './components/NotificationPanel';
import { OperationalPanels } from './components/OperationalPanels';
import { SiteMap } from './components/SiteMap';
import { MetricCard } from './components/ui';
import {
  QUERY_KEYS,
  defaultZoneSettings,
  floorLabels,
  gatewayNodes,
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
  GatewayPayload,
  LedMode,
  Worker,
  WorkerStatus,
  ZoneSetting,
} from './types';
import { clamp, createTelemetry } from './lib/base';
import {
  calculateWorkerRisk,
  createEvent,
  isInSafetyHookZone,
  normalizeGatewayPayload,
  parseGatewayMessage,
} from './lib/safety';

function App() {
  const queryClient = useQueryClient();
  const [selectedFloor, setSelectedFloor] = useState<FloorFilter>('ALL');
  const [selectedWorkerId, setSelectedWorkerId] = useState('A001');
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [zoneSettings, setZoneSettings] = useState(defaultZoneSettings);
  const [commandFeedback, setCommandFeedback] = useState('대기 중');
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [lastEmergencyKey, setLastEmergencyKey] = useState('');
  const socketsRef = useRef<WebSocket[]>([]);
  const sirenRef = useRef<{
    context: AudioContext;
    oscillator: OscillatorNode;
    lfo: OscillatorNode;
    gain: GainNode;
  } | null>(null);

  const { data: workers = initialWorkers } = useQuery({
    queryKey: QUERY_KEYS.workers,
    queryFn: async () => initialWorkers,
    initialData: initialWorkers,
  });

  const { data: events = initialEvents } = useQuery({
    queryKey: QUERY_KEYS.events,
    queryFn: async () => initialEvents,
    initialData: initialEvents,
  });

  const pushWorkerUpdate = useCallback(
    (payload: GatewayPayload, message?: string) => {
      const nextWorker = normalizeGatewayPayload(payload);
      let eventWorker = nextWorker;
      queryClient.setQueryData<Worker[]>(QUERY_KEYS.workers, (current = initialWorkers) => {
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
    [queryClient],
  );

  useEffect(() => {
    if (!gatewayUrls.length) {
      setConnectionState('mock');
      let tick = 0;
      const timer = window.setInterval(() => {
        tick += 1;
        const base = initialWorkers[tick % initialWorkers.length];
        const emergencyCycle = tick % 18 === 0;
        const warningCycle = tick % 5 === 0 || !base.is_hooked;
        const status: WorkerStatus = emergencyCycle ? 'EMERGENCY' : warningCycle ? 'WARNING' : 'NORMAL';
        const nextHooked = status === 'NORMAL';
        const driftX = Math.sin(tick * 0.8 + base.coords.x) * 14;
        const driftY = Math.cos(tick * 0.64 + base.coords.y) * 10;

        const coords = {
          x: clamp(base.coords.x + driftX + (tick % 3) * 5, 12, 190),
          y: clamp(base.coords.y + driftY + (tick % 4) * 3, 12, 132),
        };
        const unhookedDanger = !nextHooked && isInSafetyHookZone({ ...base, coords, status, is_hooked: nextHooked }, zoneSettings);

        pushWorkerUpdate({
          worker_id: base.worker_id,
          floor: base.floor,
          status,
          is_hooked: nextHooked,
          coords,
          timestamp: new Date().toISOString(),
          telemetry: createTelemetry(status, {
            accelerationG: Number((0.8 + Math.abs(Math.sin(tick)) * (status === 'EMERGENCY' ? 4.2 : 1.4)).toFixed(1)),
            impactPeakG: Number((1 + Math.abs(Math.cos(tick * 0.7)) * (status === 'EMERGENCY' ? 6.4 : 2.1)).toFixed(1)),
            fallConfidence: status === 'EMERGENCY' ? 96 : unhookedDanger ? 72 : status === 'WARNING' ? 55 : 12,
            latencyMs: status === 'EMERGENCY' ? 142 : 118 + (tick % 6) * 9,
            rssiDbm: -55 - (tick % 7) * 3 - (status === 'EMERGENCY' ? 8 : 0),
          }),
        }, unhookedDanger ? '세이프티 훅 존 미체결 진입' : undefined);
      }, 1400);

      return () => window.clearInterval(timer);
    }

    setConnectionState('connecting');
    const sockets = gatewayUrls.map((url) => new WebSocket(url));
    socketsRef.current = sockets;
    let disposed = false;

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
      socket.addEventListener('open', syncConnectionState);
      socket.addEventListener('close', syncConnectionState);
      socket.addEventListener('error', syncConnectionState);
      socket.addEventListener('message', (event) => {
        if (disposed) {
          return;
        }

        try {
          const payloads = parseGatewayMessage(JSON.parse(event.data));
          if (!payloads.length) {
            setCommandFeedback('수신 데이터 필드 확인 필요');
            return;
          }

          payloads.forEach((payload) => pushWorkerUpdate(payload));
        } catch {
          setCommandFeedback('수신 데이터 형식 오류');
        }
      });
    });

    return () => {
      disposed = true;
      sockets.forEach((socket) => socket.close());
      socketsRef.current = [];
    };
  }, [pushWorkerUpdate, zoneSettings]);

  const selectedWorker = useMemo(
    () => workers.find((worker) => worker.worker_id === selectedWorkerId) ?? workers[0],
    [selectedWorkerId, workers],
  );

  const emergencyWorker = useMemo(() => {
    return [...workers]
      .filter((worker) => worker.status === 'EMERGENCY')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
  }, [workers]);

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
    if (!emergencyWorker) {
      return;
    }

    const emergencyKey = `${emergencyWorker.worker_id}-${emergencyWorker.timestamp}`;
    if (emergencyKey !== lastEmergencyKey) {
      setLastEmergencyKey(emergencyKey);
      setSelectedWorkerId(emergencyWorker.worker_id);
      setEmergencyOpen(true);
      startSirenSound();
    }
  }, [emergencyWorker, lastEmergencyKey, startSirenSound]);

  useEffect(() => stopSirenSound, [stopSirenSound]);

  const metrics = useMemo(() => {
    const total = workers.length;
    const unhooked = workers.filter((worker) => !worker.is_hooked).length;
    const emergency = workers.filter((worker) => worker.status === 'EMERGENCY').length;
    const warning = workers.filter((worker) => worker.status === 'WARNING').length;
    const predicted = workers.filter((worker) => calculateWorkerRisk(worker) >= 70).length;
    const lowBattery = workers.filter((worker) => worker.battery <= 25).length;
    const cartridgeReplace = workers.filter((worker) => worker.telemetry.airbagCartridge !== 'CHARGED').length;
    const latency = Math.round(
      workers.reduce((sum, worker) => sum + worker.telemetry.latencyMs, 0) / Math.max(total, 1),
    );

    return { total, unhooked, emergency, warning, predicted, lowBattery, cartridgeReplace, latency };
  }, [workers]);

  const sendCommand = useCallback(
    (command: DownlinkCommand) => {
      const commandText = JSON.stringify(command);
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
            return `${floorLabels[command.floor]} 안전 훅 존 갱신`;
        }
      })();

      if (command.command === 'SET_LED_MODE' || command.command === 'RESET_AIRBAG_CARTRIDGE') {
        queryClient.setQueryData<Worker[]>(QUERY_KEYS.workers, (current = initialWorkers) =>
          current.map((worker) => {
            if (worker.worker_id !== command.target_id) {
              return worker;
            }

            if (command.command === 'SET_LED_MODE') {
              return { ...worker, telemetry: { ...worker.telemetry, ledMode: command.mode } };
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

    sendCommand({
      command: 'ACTIVATE_ALARM',
      target_id: selectedWorker.worker_id,
    });
  };

  const updateZoneSetting = (floor: FloorId, key: 'threshold' | 'dangerRadius', value: number) => {
    setZoneSettings((current) => ({
      ...current,
      [floor]: {
        ...current[floor],
        [key]: value,
      },
    }));
  };

  const applyZoneSetting = (floor: FloorId) => {
    const setting = zoneSettings[floor];
    sendCommand({
      command: 'UPDATE_ZONE',
      floor,
      threshold_rssi: setting.threshold,
      danger_radius_m: setting.dangerRadius,
      zone_center: setting.center,
    });
  };

  const updateZoneCenter = (floor: FloorId, center: Coordinate) => {
    setZoneSettings((current) => ({
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

    sendCommand({
      command: 'RESET_AIRBAG_CARTRIDGE',
      target_id: selectedWorker.worker_id,
    });
  };

  const broadcastEvacuation = (floor: FloorId | 'ALL') => {
    sendCommand({
      command: 'BROADCAST_EVACUATION',
      floor,
      reason: 'FALL_OR_UNHOOKED_DANGER',
    });
  };

  return (
    <main className="min-h-screen bg-[#090b0a] px-3 py-3 text-stone-100 sm:px-5 sm:py-4 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-4">
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
            label="미체결"
            value={metrics.unhooked}
            helper="즉시 확인 대상"
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
            icon={<Activity className="h-6 w-6" />}
            label="경고 이벤트"
            value={metrics.warning}
            helper="0.2s 표시 SLA"
            tone="cyan"
          />
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={<BrainCircuit className="h-6 w-6" />}
            label="예측 위험"
            value={metrics.predicted}
            helper="패턴 분석 대상"
            tone="amber"
          />
          <MetricCard
            icon={<Gauge className="h-6 w-6" />}
            label="평균 지연"
            value={metrics.latency}
            helper="ms WebSocket"
            tone="cyan"
          />
          <MetricCard
            icon={<BatteryWarning className="h-6 w-6" />}
            label="배터리 부족"
            value={metrics.lowBattery}
            helper="교체/충전 대상"
            tone="amber"
          />
          <MetricCard
            icon={<Cpu className="h-6 w-6" />}
            label="카트리지 교체"
            value={metrics.cartridgeReplace}
            helper="리필 키트 대상"
            tone="red"
          />
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(330px,370px)]">
          <SiteMap
            workers={workers}
            selectedFloor={selectedFloor}
            selectedWorkerId={selectedWorker?.worker_id}
            zoneSettings={zoneSettings}
            onZoneCenterChange={updateZoneCenter}
            onFloorChange={setSelectedFloor}
            onSelectWorker={setSelectedWorkerId}
          />

          <aside className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
            <ControlPanel
              selectedWorker={selectedWorker}
              zoneSettings={zoneSettings}
              onActivateAlarm={activateSelectedAlarm}
              onBroadcastEvacuation={broadcastEvacuation}
              onLedModeChange={setSelectedLedMode}
              onResetCartridge={resetSelectedCartridge}
              onApplyZone={applyZoneSetting}
              onZoneChange={updateZoneSetting}
            />
            <NotificationPanel events={events} workers={workers} />
          </aside>
        </div>

        <OperationalPanels workers={workers} selectedWorker={selectedWorker} />
      </div>

      {emergencyOpen && emergencyWorker && (
        <EmergencyOverlay
          worker={emergencyWorker}
          onClose={() => {
            setEmergencyOpen(false);
            stopSirenSound();
          }}
          onAlarm={() =>
            sendCommand({
              command: 'ACTIVATE_ALARM',
              target_id: emergencyWorker.worker_id,
            })
          }
          onBroadcast={() =>
            sendCommand({
              command: 'BROADCAST_EVACUATION',
              floor: emergencyWorker.floor,
              reason: 'EMERGENCY_FALL_DETECTED',
            })
          }
        />
      )}
    </main>
  );
}

export default App;
