const WebSocket = require('ws');

const ESP32_WS_URL = 'ws://192.168.4.1:81';
const LOCAL_WS_PORT = 3001;

let esp32Socket = null;
const browserClients = new Set();

function connectToEsp32() {
  console.log(`[ESP32] 연결 시도: ${ESP32_WS_URL}`);

  esp32Socket = new WebSocket(ESP32_WS_URL);

  esp32Socket.on('open', () => {
    console.log('[ESP32] 연결 성공');
  });

  esp32Socket.on('message', (data) => {
    const message = data.toString();
    console.log('[ESP32 데이터]', message);

    browserClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  esp32Socket.on('close', () => {
    console.log('[ESP32] 연결 종료. 2초 후 재연결 시도');
    esp32Socket = null;

    setTimeout(connectToEsp32, 2000);
  });

  esp32Socket.on('error', (error) => {
    console.error('[ESP32] 에러:', error.message);
  });
}

const localServer = new WebSocket.Server({
  port: LOCAL_WS_PORT,
});

localServer.on('connection', (client) => {
  console.log('[React] 브라우저 클라이언트 연결');
  browserClients.add(client);

  client.on('message', (data) => {
    const message = data.toString();
    console.log('[React 명령]', message);

    if (esp32Socket && esp32Socket.readyState === WebSocket.OPEN) {
      esp32Socket.send(message);
    } else {
      console.warn('[ESP32] 연결 안 됨. 명령 전송 실패');
    }
  });

  client.on('close', () => {
    console.log('[React] 브라우저 클라이언트 연결 종료');
    browserClients.delete(client);
  });

  client.on('error', (error) => {
    console.error('[React] 브라우저 클라이언트 에러:', error.message);
    browserClients.delete(client);
  });
});

console.log(`[Proxy] 로컬 WebSocket 서버 실행 중: ws://localhost:${LOCAL_WS_PORT}`);

connectToEsp32();