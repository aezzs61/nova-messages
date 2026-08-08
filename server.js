const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Statik dosyaları (index.html, app.js, style.css vb.) dışarı aç
app.use(express.static(path.join(__dirname, './')));

const clients = new Map();
const pendingCodes = new Map();

// Render'ın dinamik atadığı portu kullan, yoksa 8080
const PORT = process.env.PORT || 8080;

wss.on('connection', (ws) => {
    let currentUsername = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'request-code': {
                    const code = Math.floor(100000 + Math.random() * 900000).toString();
                    pendingCodes.set(data.target, { code, expires: Date.now() + 120000 });

                    console.log(`\n========================================`);
                    console.log(`GİRİŞ KODU (${data.target}): ${code}`);
                    console.log(`========================================\n`);

                    ws.send(JSON.stringify({ type: 'code-sent', target: data.target }));
                    break;
                }

                case 'verify-code': {
                    const record = pendingCodes.get(data.target);
                    if (record && record.code === data.code && Date.now() < record.expires) {
                        pendingCodes.delete(data.target);
                        ws.send(JSON.stringify({ type: 'code-verified', target: data.target }));
                    } else {
                        ws.send(JSON.stringify({ type: 'login-failed', reason: 'Geçersiz veya süresi dolmuş kod!' }));
                    }
                    break;
                }

                case 'register-username': {
                    currentUsername = data.username;
                    clients.set(currentUsername, ws);
                    break;
                }

                case 'chat-message':
                    sendToUser(data.targetId, {
                        type: 'chat-message',
                        senderId: currentUsername,
                        text: data.text,
                        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        msgId: data.msgId,
                        timestamp: data.timestamp,
                        isSticker: data.isSticker
                    });
                    break;

                case 'edit-message':
                    sendToUser(data.targetId, {
                        type: 'edit-message',
                        senderId: currentUsername,
                        msgId: data.msgId,
                        newText: data.newText
                    });
                    break;

                case 'rtc-offer':
                case 'rtc-answer':
                case 'ice-candidate':
                    sendToUser(data.targetId, { ...data, senderId: currentUsername });
                    break;
            }
        } catch (err) {
            console.error("Hata:", err);
        }
    });

    ws.on('close', () => {
        if (currentUsername) clients.delete(currentUsername);
    });
});

function sendToUser(targetId, payload) {
    const targetWs = clients.get(targetId);
    if (targetWs && targetWs.readyState === 1) {
        targetWs.send(JSON.stringify(payload));
    }
}

server.listen(PORT, () => {
    console.log(`Nova Messages Sunucusu ${PORT} portunda aktif...`);
});