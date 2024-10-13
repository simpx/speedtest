const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const port = process.env.PORT || 8000;

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 创建 HTTP 服务器
const server = http.createServer(app);
let clientCount = 0;

// WebSocket 逻辑
// 创建 WebSocket 服务器，使用相同的 HTTP 服务器，并指定路径为 '/ws'
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
    clientCount++;
    const message = JSON.stringify({ type: 'server', clientCount: clientCount });
    ws.send(message);
    console.log('New client connected, current count:', clientCount);

    ws.on('message', (message) => {
        // 处理消息并广播给所有客户端
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => {
        clientCount--;
        console.log('Client disconnected, current count:', clientCount);
    });
});

// 启动服务器
server.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${port}`);
});
