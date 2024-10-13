const WebSocket = require('ws');                                                                                                              
const wss = new WebSocket.Server({ port: 3000, host: '0.0.0.0' }); 

let clientCount = 0;

wss.on('connection', (ws) => {
    clientCount++;

    const message = JSON.stringify({ type: 'server', clientCount: clientCount });
    ws.send(message);
    
    console.log('New client connected, current count:', clientCount);

    ws.on('message', (message) => {
        // 将收到的消息广播给所有其他客户端
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

console.log('WebSocket server running on ws://0.0.0.0:3000');
