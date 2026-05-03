## A-Hook Integrated Control System

React 기반 건설 현장 실시간 안전 관제 대시보드입니다.

### Run

```bash
npm install
npm run dev
```

기본 개발 서버는 `http://localhost:5173`에서 실행됩니다.

### Build

```bash
npm run build
```

### Gateway WebSocket

실제 ESP32 게이트웨이에 연결하려면 `.env`에 WebSocket 주소를 설정합니다.

```bash
VITE_GATEWAY_WS_URL=ws://게이트웨이주소
```

설정하지 않으면 Mock Gateway 이벤트로 대시보드를 시뮬레이션합니다.
