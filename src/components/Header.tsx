import { RadioTower, Wifi, WifiOff, Zap } from 'lucide-react';
import type { ConnectionState } from '../types';

export function Header({
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
