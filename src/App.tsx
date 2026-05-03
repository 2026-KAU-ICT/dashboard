import {
  Activity,
  Bell,
  CheckCircle2,
  HardHat,
  MapPinned,
  RadioTower,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  TriangleAlert,
  UserRound,
  Volume2,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import aerialSite from './assets/aerial-site.svg';

type WorkerStatus = 'NORMAL' | 'WARNING' | 'EMERGENCY';
type FloorId = '3F' | '4F' | 'ROOF';
type FloorFilter = 'ALL' | FloorId;
type ConnectionState = 'connecting' | 'live' | 'mock' | 'offline';

type GatewayPayload = {
  worker_id: string;
  floor: FloorId;
  status: WorkerStatus;
  is_hooked: boolean;
  coords: {
    x: number;
    y: number;
  };
  timestamp: string;
};

type Worker = GatewayPayload & {
  name: string;
  role: string;
  battery: number;
  gateway: string;
};

type EventLog = {
  id: string;
  timestamp: string;
  floor: FloorId;
  workerId: string;
  workerName: string;
  status: WorkerStatus | 'CONTROL';
  message: string;
};

type DownlinkCommand =
  | {
      command: 'ACTIVATE_ALARM';
      target_id: string;
    }
  | {
      command: 'UPDATE_ZONE';
      floor: FloorId;
      threshold_rssi: number;
      danger_radius_m: number;
    };

type ZoneSetting = {
  threshold: number;
  dangerRadius: number;
};

const QUERY_KEYS = {
  workers: ['workers'] as const,
  events: ['events'] as const,
};

const floorLabels: Record<FloorId, string> = {
  '3F': '3층',
  '4F': '4층',
  ROOF: '옥상',
};

const workerProfiles: Record<
  string,
  Pick<Worker, 'name' | 'role' | 'battery' | 'gateway'>
> = {
  A001: { name: '김도윤', role: '철근', battery: 86, gateway: 'GW-4F-02' },
  A002: { name: '박민재', role: '거푸집', battery: 74, gateway: 'GW-3F-01' },
  A003: { name: '이서준', role: '전기', battery: 91, gateway: 'GW-RF-01' },
  A004: { name: '최하린', role: '안전', battery: 68, gateway: 'GW-4F-01' },
  A005: { name: '정우진', role: '양중', battery: 79, gateway: 'GW-3F-02' },
  A006: { name: '윤태오', role: '배관', battery: 63, gateway: 'GW-RF-02' },
};

const initialWorkers: Worker[] = [
  {
    worker_id: 'A001',
    floor: '4F',
    status: 'NORMAL',
    is_hooked: true,
    coords: { x: 120, y: 85 },
    timestamp: new Date().toISOString(),
    ...workerProfiles.A001,
  },
  {
    worker_id: 'A002',
    floor: '3F',
    status: 'WARNING',
    is_hooked: false,
    coords: { x: 74, y: 48 },
    timestamp: new Date().toISOString(),
    ...workerProfiles.A002,
  },
  {
    worker_id: 'A003',
    floor: 'ROOF',
    status: 'NORMAL',
    is_hooked: true,
    coords: { x: 151, y: 56 },
    timestamp: new Date().toISOString(),
    ...workerProfiles.A003,
  },
  {
    worker_id: 'A004',
    floor: '4F',
    status: 'NORMAL',
    is_hooked: true,
    coords: { x: 39, y: 108 },
    timestamp: new Date().toISOString(),
    ...workerProfiles.A004,
  },
  {
    worker_id: 'A005',
    floor: '3F',
    status: 'NORMAL',
    is_hooked: true,
    coords: { x: 138, y: 96 },
    timestamp: new Date().toISOString(),
    ...workerProfiles.A005,
  },
  {
    worker_id: 'A006',
    floor: 'ROOF',
    status: 'WARNING',
    is_hooked: false,
    coords: { x: 92, y: 112 },
    timestamp: new Date().toISOString(),
    ...workerProfiles.A006,
  },
];

const initialEvents: EventLog[] = [
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
];

const defaultZoneSettings: Record<FloorId, ZoneSetting> = {
  '3F': { threshold: -68, dangerRadius: 8 },
  '4F': { threshold: -71, dangerRadius: 6 },
  ROOF: { threshold: -64, dangerRadius: 10 },
};

const mapZones: Array<{
  floor: FloorId;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  border: string;
}> = [
  {
    floor: '3F',
    left: 9,
    top: 22,
    width: 29,
    height: 53,
    color: 'rgba(52, 211, 153, 0.1)',
    border: 'rgba(52, 211, 153, 0.72)',
  },
  {
    floor: '4F',
    left: 38,
    top: 18,
    width: 31,
    height: 56,
    color: 'rgba(56, 189, 248, 0.1)',
    border: 'rgba(56, 189, 248, 0.72)',
  },
  {
    floor: 'ROOF',
    left: 68,
    top: 14,
    width: 23,
    height: 58,
    color: 'rgba(245, 158, 11, 0.11)',
    border: 'rgba(245, 158, 11, 0.74)',
  },
];

const statusMeta: Record<
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

const gatewayUrl = import.meta.env.VITE_GATEWAY_WS_URL as string | undefined;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const formatTime = (timestamp: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));

const normalizeGatewayPayload = (payload: GatewayPayload): Worker => {
  const profile = workerProfiles[payload.worker_id] ?? {
    name: `작업자 ${payload.worker_id}`,
    role: '현장',
    battery: 100,
    gateway: `GW-${payload.floor}`,
  };

  return {
    ...payload,
    ...profile,
  };
};

const createEvent = (worker: Worker, message = statusMeta[worker.status].eventText): EventLog => ({
  id: `${worker.worker_id}-${worker.timestamp}-${Math.random().toString(16).slice(2)}`,
  timestamp: worker.timestamp,
  floor: worker.floor,
  workerId: worker.worker_id,
  workerName: worker.name,
  status: worker.status,
  message,
});

function App() {
  const queryClient = useQueryClient();
  const [selectedFloor, setSelectedFloor] = useState<FloorFilter>('ALL');
  const [selectedWorkerId, setSelectedWorkerId] = useState('A001');
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [zoneSettings, setZoneSettings] = useState(defaultZoneSettings);
  const [commandFeedback, setCommandFeedback] = useState('대기 중');
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [lastEmergencyKey, setLastEmergencyKey] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
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
      queryClient.setQueryData<Worker[]>(QUERY_KEYS.workers, (current = initialWorkers) => {
        const exists = current.some((worker) => worker.worker_id === nextWorker.worker_id);
        if (!exists) {
          return [...current, nextWorker];
        }

        return current.map((worker) =>
          worker.worker_id === nextWorker.worker_id
            ? {
                ...worker,
                ...nextWorker,
                battery: clamp(worker.battery - (nextWorker.status === 'EMERGENCY' ? 2 : 0.2), 18, 100),
              }
            : worker,
        );
      });

      queryClient.setQueryData<EventLog[]>(QUERY_KEYS.events, (current = initialEvents) => [
        createEvent(nextWorker, message),
        ...current,
      ].slice(0, 60));
    },
    [queryClient],
  );

  useEffect(() => {
    if (!gatewayUrl) {
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

        pushWorkerUpdate({
          worker_id: base.worker_id,
          floor: base.floor,
          status,
          is_hooked: nextHooked,
          coords: {
            x: clamp(base.coords.x + driftX + (tick % 3) * 5, 12, 190),
            y: clamp(base.coords.y + driftY + (tick % 4) * 3, 12, 132),
          },
          timestamp: new Date().toISOString(),
        });
      }, 1400);

      return () => window.clearInterval(timer);
    }

    setConnectionState('connecting');
    const socket = new WebSocket(gatewayUrl);
    socketRef.current = socket;

    socket.addEventListener('open', () => setConnectionState('live'));
    socket.addEventListener('close', () => setConnectionState('offline'));
    socket.addEventListener('error', () => setConnectionState('offline'));
    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data) as GatewayPayload;
        pushWorkerUpdate(payload);
      } catch {
        setCommandFeedback('수신 데이터 형식 오류');
      }
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [pushWorkerUpdate]);

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

    return { total, unhooked, emergency, warning };
  }, [workers]);

  const sendCommand = useCallback(
    (command: DownlinkCommand) => {
      const commandText = JSON.stringify(command);
      if (connectionState === 'live' && socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(commandText);
        setCommandFeedback('게이트웨이 전송 완료');
      } else {
        setCommandFeedback('Mock 모드 명령 기록');
      }

      const target =
        'target_id' in command
          ? workers.find((worker) => worker.worker_id === command.target_id)
          : undefined;
      const floor = 'floor' in command ? command.floor : target?.floor ?? '4F';
      const workerName = target?.name ?? '구역 설정';
      const message =
        command.command === 'ACTIVATE_ALARM'
          ? `${workerName} 조끼 부저/LED 작동`
          : `${floorLabels[command.floor]} 안전 훅 존 갱신`;

      queryClient.setQueryData<EventLog[]>(QUERY_KEYS.events, (current = initialEvents) => [
        {
          id: `control-${Date.now()}`,
          timestamp: new Date().toISOString(),
          floor,
          workerId: target?.worker_id ?? command.command,
          workerName,
          status: 'CONTROL' as const,
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

  const updateZoneSetting = (floor: FloorId, key: keyof ZoneSetting, value: number) => {
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
    });
  };

  return (
    <main className="min-h-screen bg-[#090b0a] px-4 py-4 text-stone-100 sm:px-5 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-4">
        <Header connectionState={connectionState} commandFeedback={commandFeedback} />

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_370px]">
          <SiteMap
            workers={workers}
            selectedFloor={selectedFloor}
            selectedWorkerId={selectedWorker?.worker_id}
            onFloorChange={setSelectedFloor}
            onSelectWorker={setSelectedWorkerId}
          />

          <aside className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1">
            <ControlPanel
              selectedWorker={selectedWorker}
              zoneSettings={zoneSettings}
              onActivateAlarm={activateSelectedAlarm}
              onApplyZone={applyZoneSetting}
              onZoneChange={updateZoneSetting}
            />
            <NotificationPanel events={events} />
          </aside>
        </div>
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
        />
      )}
    </main>
  );
}

function Header({
  connectionState,
  commandFeedback,
}: {
  connectionState: ConnectionState;
  commandFeedback: string;
}) {
  const isConnected = connectionState === 'live' || connectionState === 'mock';
  const connectionLabel: Record<ConnectionState, string> = {
    connecting: '연결 중',
    live: 'WebSocket Live',
    mock: 'Mock Gateway',
    offline: '오프라인',
  };

  return (
    <header className="flex flex-col gap-3 border-b border-white/10 pb-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200/80">
          <RadioTower className="h-4 w-4" />
          A-Hook Integrated Control System
        </div>
        <h1 className="mt-2 text-2xl font-black tracking-normal text-stone-50 sm:text-3xl">
          실시간 안전 관제 대시보드
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-stone-200">
          {isConnected ? <Wifi className="h-4 w-4 text-emerald-300" /> : <WifiOff className="h-4 w-4 text-red-300" />}
          {connectionLabel[connectionState]}
        </span>
        <span className="inline-flex items-center gap-2 border border-white/10 bg-[#121512] px-3 py-2 text-sm text-stone-300">
          <Zap className="h-4 w-4 text-amber-300" />
          {commandFeedback}
        </span>
      </div>
    </header>
  );
}

function MetricCard({
  icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  helper: string;
  tone: 'emerald' | 'amber' | 'red' | 'cyan';
}) {
  const toneClass = {
    emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
    amber: 'border-amber-300/25 bg-amber-300/10 text-amber-100',
    red: 'border-red-400/25 bg-red-400/10 text-red-100',
    cyan: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100',
  }[tone];

  return (
    <article className={`flex min-h-32 items-center justify-between border bg-[#111411] p-4 shadow-panel ${toneClass}`}>
      <div>
        <p className="text-sm font-semibold text-stone-300">{label}</p>
        <strong className="mt-1 block text-4xl font-black tracking-normal text-stone-50 sm:text-5xl">{value}</strong>
        <p className="mt-2 text-xs font-medium text-stone-400">{helper}</p>
      </div>
      <div className="flex h-12 w-12 items-center justify-center border border-white/10 bg-black/20">{icon}</div>
    </article>
  );
}

function SiteMap({
  workers,
  selectedFloor,
  selectedWorkerId,
  onFloorChange,
  onSelectWorker,
}: {
  workers: Worker[];
  selectedFloor: FloorFilter;
  selectedWorkerId?: string;
  onFloorChange: (floor: FloorFilter) => void;
  onSelectWorker: (workerId: string) => void;
}) {
  const visibleWorkers = selectedFloor === 'ALL' ? workers : workers.filter((worker) => worker.floor === selectedFloor);

  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <div className="flex flex-col gap-3 border-b border-white/10 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-stone-100">
            <MapPinned className="h-5 w-5 text-emerald-300" />
            항공뷰 모니터링
          </div>
          <p className="mt-1 text-sm text-stone-400">조끼 → BLE → 게이트웨이 → 웹</p>
        </div>

        <div className="grid grid-cols-4 border border-white/10 bg-black/20 text-sm font-semibold">
          {(['ALL', '3F', '4F', 'ROOF'] as FloorFilter[]).map((floor) => (
            <button
              key={floor}
              type="button"
              className={`px-3 py-2 transition ${
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
        <div className="map-grid relative aspect-[16/10] min-h-[460px] overflow-hidden border border-white/10 bg-[#0f1412]">
          <img
            src={aerialSite}
            alt="건설 현장 항공뷰"
            className="absolute inset-0 h-full w-full object-cover opacity-90"
            draggable={false}
          />
          <div className="pointer-events-none absolute inset-0 bg-black/10" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1/3 animate-scan bg-gradient-to-b from-transparent via-cyan-200/10 to-transparent" />

          {mapZones.map((zone) => {
            const dimmed = selectedFloor !== 'ALL' && selectedFloor !== zone.floor;
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
                <div className="absolute left-2 top-2 inline-flex items-center gap-2 border border-white/10 bg-black/55 px-2 py-1 text-xs font-black text-stone-100 backdrop-blur">
                  <RadioTower className="h-3.5 w-3.5" />
                  {floorLabels[zone.floor]} Gateway
                </div>
              </div>
            );
          })}

          {visibleWorkers.map((worker) => {
            const point = mapWorkerToZone(worker);
            const meta = statusMeta[worker.status];
            const isSelected = worker.worker_id === selectedWorkerId;

            return (
              <button
                type="button"
                key={worker.worker_id}
                className={`absolute flex h-11 w-11 items-center justify-center border-2 ${meta.border} ${
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
                <span className="absolute left-1/2 top-full mt-2 min-w-24 -translate-x-1/2 border border-white/10 bg-black/70 px-2 py-1 text-xs font-bold text-stone-50 shadow-panel backdrop-blur">
                  {worker.worker_id}
                </span>
              </button>
            );
          })}

          <div className="absolute bottom-3 left-3 grid gap-2 text-xs font-semibold text-stone-200 sm:grid-cols-3">
            <LegendItem color="bg-emerald-400" label="정상" />
            <LegendItem color="bg-amber-300" label="경고" />
            <LegendItem color="bg-red-500" label="비상" />
          </div>
        </div>
      </div>
    </section>
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

function ControlPanel({
  selectedWorker,
  zoneSettings,
  onActivateAlarm,
  onZoneChange,
  onApplyZone,
}: {
  selectedWorker?: Worker;
  zoneSettings: Record<FloorId, ZoneSetting>;
  onActivateAlarm: () => void;
  onZoneChange: (floor: FloorId, key: keyof ZoneSetting, value: number) => void;
  onApplyZone: (floor: FloorId) => void;
}) {
  return (
    <section className="border border-white/10 bg-[#101310] shadow-panel">
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-stone-100">
          <Settings2 className="h-5 w-5 text-cyan-200" />
          Downlink Control
        </div>
        <span className="border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-stone-300">양방향</span>
      </div>

      <div className="p-4">
        {selectedWorker ? (
          <div className="border border-white/10 bg-black/20 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-stone-400">{selectedWorker.worker_id}</p>
                <h2 className="mt-1 text-xl font-black tracking-normal text-stone-50">{selectedWorker.name}</h2>
                <p className="mt-1 text-sm text-stone-400">
                  {floorLabels[selectedWorker.floor]} · {selectedWorker.role} · {selectedWorker.gateway}
                </p>
              </div>
              <StatusBadge status={selectedWorker.status} />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <InfoTile label="Hook" value={selectedWorker.is_hooked ? '체결' : '미체결'} />
              <InfoTile label="Battery" value={`${Math.round(selectedWorker.battery)}%`} />
              <InfoTile label="RSSI XY" value={`${Math.round(selectedWorker.coords.x)}, ${Math.round(selectedWorker.coords.y)}`} />
            </div>

            <button
              type="button"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 bg-red-500 px-4 py-3 text-sm font-black text-white transition hover:bg-red-400"
              onClick={onActivateAlarm}
            >
              <Volume2 className="h-5 w-5" />
              원격 사이렌 작동
            </button>
          </div>
        ) : null}

        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-stone-100">
            <SlidersHorizontal className="h-4 w-4 text-emerald-300" />
            Safety Hook Zone
          </div>

          {(Object.keys(zoneSettings) as FloorId[]).map((floor) => {
            const setting = zoneSettings[floor];
            return (
              <div key={floor} className="border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between">
                  <strong className="text-sm text-stone-100">{floorLabels[floor]}</strong>
                  <button
                    type="button"
                    className="border border-emerald-300/30 px-2 py-1 text-xs font-bold text-emerald-100 transition hover:bg-emerald-300/10"
                    onClick={() => onApplyZone(floor)}
                  >
                    적용
                  </button>
                </div>

                <label className="mt-3 block text-xs font-semibold text-stone-400">
                  RSSI 임계값
                  <span className="float-right text-stone-200">{setting.threshold} dBm</span>
                  <input
                    className="range-control mt-2 w-full"
                    type="range"
                    min="-90"
                    max="-45"
                    value={setting.threshold}
                    onChange={(event) => onZoneChange(floor, 'threshold', Number(event.target.value))}
                  />
                </label>

                <label className="mt-3 block text-xs font-semibold text-stone-400">
                  위험 반경
                  <span className="float-right text-stone-200">{setting.dangerRadius} m</span>
                  <input
                    className="range-control mt-2 w-full"
                    type="range"
                    min="3"
                    max="18"
                    value={setting.dangerRadius}
                    onChange={(event) => onZoneChange(floor, 'dangerRadius', Number(event.target.value))}
                  />
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/10 bg-[#111411] p-2">
      <p className="text-[11px] font-semibold text-stone-500">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-stone-100">{value}</p>
    </div>
  );
}

function NotificationPanel({ events }: { events: EventLog[] }) {
  return (
    <section className="flex min-h-[420px] flex-col border border-white/10 bg-[#101310] shadow-panel">
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-stone-100">
          <Bell className="h-5 w-5 text-amber-200" />
          실시간 알림 센터
        </div>
        <span className="border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-stone-300">
          {events.length}
        </span>
      </div>

      <div className="max-h-[520px] flex-1 overflow-y-auto">
        {events.map((event) => (
          <article key={event.id} className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 border-b border-white/10 px-4 py-3">
            <time className="text-xs font-semibold text-stone-500">{formatTime(event.timestamp)}</time>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-stone-100">{floorLabels[event.floor]}</span>
                <span className="text-sm font-bold text-stone-300">{event.workerName}</span>
                {event.status === 'CONTROL' ? (
                  <span className="border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-xs font-bold text-cyan-100">제어</span>
                ) : (
                  <StatusBadge status={event.status} />
                )}
              </div>
              <p className="mt-1 truncate text-sm text-stone-400">{event.message}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: WorkerStatus }) {
  const meta = statusMeta[status];
  const Icon = status === 'NORMAL' ? CheckCircle2 : status === 'WARNING' ? TriangleAlert : Siren;

  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-1 text-xs font-black ${meta.chip}`}>
      <Icon className={`h-3.5 w-3.5 ${status === 'EMERGENCY' ? 'animate-softBlink' : ''}`} />
      {meta.label}
    </span>
  );
}

function EmergencyOverlay({
  worker,
  onClose,
  onAlarm,
}: {
  worker: Worker;
  onClose: () => void;
  onAlarm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-950/92 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl border-2 border-red-300 bg-[#160707] p-5 text-white shadow-panel sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center border border-red-300/60 bg-red-500 text-white">
              <Siren className="h-9 w-9 animate-softBlink" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-red-200">Emergency</p>
              <h2 className="mt-1 text-3xl font-black tracking-normal sm:text-4xl">추락 감지</h2>
            </div>
          </div>
          <button
            type="button"
            className="border border-white/20 p-2 text-red-100 transition hover:bg-white/10"
            onClick={onClose}
            aria-label="팝업 닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <InfoTile label="작업자" value={`${worker.name} (${worker.worker_id})`} />
          <InfoTile label="위치" value={`${floorLabels[worker.floor]} · ${worker.gateway}`} />
          <InfoTile label="감지 시각" value={formatTime(worker.timestamp)} />
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className="inline-flex flex-1 items-center justify-center gap-2 bg-red-500 px-4 py-3 text-sm font-black text-white transition hover:bg-red-400"
            onClick={onAlarm}
          >
            <Volume2 className="h-5 w-5" />
            조끼 사이렌 재전송
          </button>
          <button
            type="button"
            className="inline-flex flex-1 items-center justify-center gap-2 border border-white/20 px-4 py-3 text-sm font-black text-red-50 transition hover:bg-white/10"
            onClick={onClose}
          >
            <ShieldCheck className="h-5 w-5" />
            확인 및 정지
          </button>
        </div>
      </div>
    </div>
  );
}

function mapWorkerToZone(worker: Worker) {
  const zone = mapZones.find((item) => item.floor === worker.floor) ?? mapZones[0];
  const left = zone.left + (clamp(worker.coords.x, 0, 200) / 200) * zone.width;
  const top = zone.top + (clamp(worker.coords.y, 0, 140) / 140) * zone.height;

  return { left, top };
}

export default App;
