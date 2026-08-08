const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: 8080 });
const clients = new Map();       // username -> ws
const pendingCodes = new Map();  // target -> { code, expires }

console.log("==========================================");
console.log(" Nova Messages Sunucusu 8080 Portunda Aktif");
console.log("==========================================");

wss.on('connection', (ws) => {
    let currentUsername = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                // 1. KOD İSTEĞİ (E-posta/Tel No)
                case 'request-code': {
                    const code = Math.floor(100000 + Math.random() * 900000).toString();
                    pendingCodes.set(data.target, { code, expires: Date.now() + 120000 });

                    console.log("\n========================================");
                    console.log(`GİRİŞ TİPİ : ${data.method.toUpperCase()}`);
                    console.log(`HEDEF     : ${data.target}`);
                    console.log(`GİRİŞ KODU: ${code}`);
                    console.log("========================================\n");

                    ws.send(JSON.stringify({ type: 'code-sent', target: data.target }));
                    break;
                }

                // 2. KOD DOĞRULAMA
                case 'verify-code': {
                    const record = pendingCodes.get(data.target);
                    if (record && record.code === data.code && Date.now() < record.expires) {
                        pendingCodes.delete(data.target);
                        ws.send(JSON.stringify({ type: 'code-verified', target: data.target }));
                        console.log(`[KOD DOĞRULANDI] ${data.target}`);
                    } else {
                        ws.send(JSON.stringify({ type: 'login-failed', reason: 'Geçersiz veya süresi dolmuş kod!' }));
                    }
                    break;
                }

                // 3. KULLANICI ADI İLE KAYIT VE OTURUM AÇMA
                case 'register-username': {
                    currentUsername = data.username;
                    clients.set(currentUsername, ws);
                    console.log(`[AKTİF KULLANICI] Hesabı: ${data.account} -> Kullanıcı Adı: ${currentUsername}`);
                    break;
                }

                // ANLIK MESAJLAŞMA (Kullanıcı adları üzerinden gönderilir)
                case 'chat-message':
                    sendToUser(data.targetId, {
                        type: 'chat-message',
                        senderId: currentUsername,
                        text: data.text,
                        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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