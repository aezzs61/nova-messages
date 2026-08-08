const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

// WebSocket sunucusunu HTTP sunucumuzla birleştiriyoruz
const wss = new WebSocketServer({ server });

// Statik dosyaları (index.html, app.js, style.css vb.) dışarı sunar
app.use(express.static(path.join(__dirname, './')));

const clients = new Map();
const pendingCodes = new Map();

// Render'ın otomatik atadığı portu kullanır, yerelde 8080'e düşer
const PORT = process.env.PORT || 8080;

wss.on('connection', (ws) => {
    let currentUsername = null;
    console.log("\n[SUNUCU] Yeni bir canlı WebSocket bağlantısı kuruldu!");

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log("[GELEN İSTEK]:", data.type);

            switch (data.type) {
                case 'request-code': {
                    const code = Math.floor(100000 + Math.random() * 900000).toString();
                    pendingCodes.set(data.target, { code, expires: Date.now() + 120000 });

                    console.log("\n========================================");
                    console.log(` GİRİŞ YÖNTEMİ : ${data.method ? data.method.toUpperCase() : 'GİRİŞ'}`);
                    console.log(` KULLANICI/HEDEF: ${data.target}`);
                    console.log(` GİRİŞ KODU    : ${code}`);
                    console.log("========================================\n");

                    ws.send(JSON.stringify({ type: 'code-sent', target: data.target }));
                    break;
                }

                case 'verify-code': {
                    const record = pendingCodes.get(data.target);
                    if (record && record.code === data.code && Date.now() < record.expires) {
                        pendingCodes.delete(data.target);
                        ws.send(JSON.stringify({ type: 'code-verified', target: data.target }));
                        console.log(`[DOĞRULANDI] ${data.target}`);
                    } else {
                        ws.send(JSON.stringify({ type: 'login-failed', reason: 'Geçersiz veya süresi dolmuş kod!' }));
                    }
                    break;
                }

                case 'register-username': {
                    currentUsername = data.username;
                    clients.set(currentUsername, ws);
                    console.log(`[KULLANICI KAYIT] ${currentUsername}`);
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
            console.error("[HATA]:", err);
        }
    });

    ws.on('close', () => {
        if (currentUsername) {
            clients.delete(currentUsername);
            console.log(`[AYRILDI] ${currentUsername}`);
        }
    });
});

function sendToUser(targetId, payload) {
    const targetWs = clients.get(targetId);
    if (targetWs && targetWs.readyState === 1) {
        targetWs.send(JSON.stringify(payload));
    }
}

// Render üzerinde tüm trafiği dinleyen HTTP dinleyicisi
server.listen(PORT, () => {
    console.log(`\n==========================================`);
    console.log(` Nova Messages Sunucusu ${PORT} Portunda Aktif`);
    console.log(`==========================================\n`);
});