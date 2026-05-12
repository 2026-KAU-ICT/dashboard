import type { Coordinate, PositionSample, WorkerStatus, WorkerTelemetry } from '../types';

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const formatTime = (timestamp: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));

export const createTelemetry = (
  status: WorkerStatus,
  overrides: Partial<WorkerTelemetry> = {},
): WorkerTelemetry => ({
  accelerationG: status === 'EMERGENCY' ? 3.8 : status === 'WARNING' ? 1.7 : 0.9,
  fallConfidence: status === 'EMERGENCY' ? 96 : status === 'WARNING' ? 54 : 12,
  latencyMs: status === 'EMERGENCY' ? 148 : status === 'WARNING' ? 176 : 122,
  rssiDbm: status === 'EMERGENCY' ? -73 : status === 'WARNING' ? -66 : -58,
  airbagState: status === 'EMERGENCY' ? 'DEPLOYED' : status === 'WARNING' ? 'ARMED' : 'READY',
  airbagCartridge: status === 'EMERGENCY' ? 'USED' : 'CHARGED',
  ledMode: status === 'NORMAL' ? 'OFF' : 'FLASH',
  ...overrides,
});

export const createTrace = (coords: Coordinate, timestamp: string): PositionSample[] => [
  {
    x: clamp(coords.x - 22, 0, 200),
    y: clamp(coords.y - 16, 0, 140),
    timestamp,
  },
  {
    x: clamp(coords.x - 13, 0, 200),
    y: clamp(coords.y - 9, 0, 140),
    timestamp,
  },
  {
    x: clamp(coords.x - 6, 0, 200),
    y: clamp(coords.y - 4, 0, 140),
    timestamp,
  },
  { ...coords, timestamp },
];
