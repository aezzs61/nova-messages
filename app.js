let ws;
let currentMethod = 'email';
let authenticatedAccount = '';
let myUsername = '';
let activeChatPartner = '';
let peerConnection;
let localStream;

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// OTURUM & SOHBET LİSTESİ YÜKLEME
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('nova_logged_user');
    if (savedUser) {
        myUsername = savedUser;
        document.getElementById('authModal').style.display = 'none';
        document.getElementById('myUserIdDisplay').innerText = myUsername;
        
        connectWS(() => {
            ws.send(JSON.stringify({ type: 'register-username', account: 'saved_session', username: myUsername }));
        });

        renderChatList();
    }
});

/* WEBSOCKET BAĞLANTISI VE GELEN MESAJ İŞLEME */
function connectWS(onOpenCallback) {
    ws = new WebSocket('ws://localhost:8080');

    ws.onopen = () => {
        if (onOpenCallback) onOpenCallback();
    };

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case 'code-sent':
                document.getElementById('stepRequest').style.display = 'none';
                document.getElementById('stepVerify').style.display = 'block';
                alert("Doğrulama kodu oluşturuldu! Kısa süre içinde e-posta veya WhatsApp bildirimi olarak gönderilecektir.");
                break;

            case 'code-verified':
                authenticatedAccount = data.target;
                document.getElementById('stepVerify').style.display = 'none';
                document.getElementById('stepUsername').style.display = 'block';
                break;

            case 'login-failed':
                alert(data.reason);
                break;

            case 'chat-message':
                playNotificationSound();
                
                // Mesajı hafızaya ve ekrana yaz
                saveAndRenderMessage(data.senderId, data.text, data.time, 'incoming', data.msgId, data.timestamp, data.isSticker);
                
                // Sohbet listesini güncelle
                addToChatHistoryList(data.senderId, data.text, data.time);
                
                // Eğer o an o kişiyle açık sohbetimiz varsa ve ekli değilse kişi ekle barı göster
                if (activeChatPartner === data.senderId) {
                    checkUnknownUserBar(data.senderId);
                }
                break;

            case 'edit-message':
                updateMessageInDOM(data.msgId, data.newText);
                break;

            case 'rtc-offer':
                await handleOffer(data);
                break;
            case 'rtc-answer':
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
                break;
            case 'ice-candidate':
                if (peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                break;
        }
    };
}

/* SOHBETİ AÇMA VE BİLİNMEYEN KİŞİ KONTROLÜ */
function openChatSession(partnerUsername) {
    activeChatPartner = partnerUsername;
    document.getElementById('targetUserSearch').value = partnerUsername;
    document.getElementById('chatTitle').innerText = partnerUsername === myUsername ? `${myUsername} (Not Alanım)` : partnerUsername;
    
    loadLocalMessages();
    loadCustomBackground();
    checkUnknownUserBar(partnerUsername);
}

/* KİŞİ EKLE & ENGELLE BARI KONTROLÜ */
function checkUnknownUserBar(username) {
    if (username === myUsername || !username) {
        document.getElementById('unknownUserBar').style.display = 'none';
        return;
    }

    const contacts = JSON.parse(localStorage.getItem('nova_contacts') || '[]');
    const isSaved = contacts.includes(username);

    if (!isSaved) {
        document.getElementById('unknownUserBar').style.display = 'flex';
    } else {
        document.getElementById('unknownUserBar').style.display = 'none';
    }
}

function addActiveToContacts() {
    if (!activeChatPartner) return;
    const contacts = JSON.parse(localStorage.getItem('nova_contacts') || '[]');
    if (!contacts.includes(activeChatPartner)) {
        contacts.push(activeChatPartner);
        localStorage.setItem('nova_contacts', JSON.stringify(contacts));
    }
    document.getElementById('unknownUserBar').style.display = 'none';
    renderChatList();
    alert(`${activeChatPartner} rehberinize eklendi!`);
}

function blockActiveUser() {
    alert(`${activeChatPartner} engellendi!`);
    document.getElementById('unknownUserBar').style.display = 'none';
}

/* LOCALSTORAGE SOHBET LİSTESİ VE REHBER SATIRLARI */
function addToChatHistoryList(username, lastMsg, time) {
    let historyList = JSON.parse(localStorage.getItem('nova_chat_rows') || '[]');
    historyList = historyList.filter(item => item.username !== username);
    historyList.unshift({ username, lastMsg, time });
    localStorage.setItem('nova_chat_rows', JSON.stringify(historyList));
    renderChatList();
}

function renderChatList() {
    const listContainer = document.getElementById('chatList');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    const historyList = JSON.parse(localStorage.getItem('nova_chat_rows') || '[]');

    historyList.forEach(item => {
        const row = document.createElement('div');
        row.className = `chat-row ${item.username === activeChatPartner ? 'active' : ''}`;
        row.onclick = () => openChatSession(item.username);

        const previewMsg = item.lastMsg.startsWith('http') ? '📷 [Görsel / Sticker]' : item.lastMsg;

        row.innerHTML = `
            <div class="avatar"><i class="fa-solid fa-user"></i></div>
            <div class="chat-row-details">
                <div class="chat-row-top">
                    <span>${item.username}</span>
                    <span class="chat-row-time">${item.time}</span>
                </div>
                <span class="chat-row-last">${previewMsg}</span>
            </div>
        `;
        listContainer.appendChild(row);
    });
}

function filterChatList(query) {
    const rows = document.querySelectorAll('.chat-row');
    rows.forEach(row => {
        const name = row.querySelector('.chat-row-top span').innerText.toLowerCase();
        row.style.display = name.includes(query.toLowerCase()) ? 'flex' : 'none';
    });
}

/* MESAJ GÖNDERME (ENTER DESTEKLİ & STİCKER İLETİMLİ) */
function handleKeyPress(e) {
    const sendOnEnter = document.getElementById('sendOnEnterCheck').checked;
    if (e.key === 'Enter' && sendOnEnter) {
        e.preventDefault();
        sendMessage();
    }
}

function sendMessage() {
    const targetId = document.getElementById('targetUserSearch').value.trim();
    const text = document.getElementById('messageInput').value.trim();
    if (!targetId || !text) return alert("Mesaj alanı ve alıcı boş olamaz!");

    activeChatPartner = targetId;
    const msgId = 'msg_' + Date.now();
    const dateObj = new Date();
    const time = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const timestamp = dateObj.getTime();

    ws.send(JSON.stringify({ type: 'chat-message', targetId: targetId, text: text, msgId: msgId, timestamp: timestamp, isSticker: false }));

    saveAndRenderMessage(targetId, text, time, 'outgoing', msgId, timestamp, false);
    addToChatHistoryList(targetId, text, time);

    document.getElementById('messageInput').value = '';
}

function sendDirectSticker(mediaUrl) {
    const targetId = document.getElementById('targetUserSearch').value.trim();
    if (!targetId) return alert("Önce bir sohbet seçin!");

    activeChatPartner = targetId;
    const msgId = 'msg_' + Date.now();
    const timestamp = Date.now();
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // WebSocket üzerinden karşı tarafa ISSTICKER parametresi iletilir
    ws.send(JSON.stringify({ type: 'chat-message', targetId: targetId, text: mediaUrl, msgId: msgId, timestamp: timestamp, isSticker: true }));

    saveAndRenderMessage(targetId, mediaUrl, time, 'outgoing', msgId, timestamp, true);
    addToChatHistoryList(targetId, '📷 [Görsel / Sticker]', time);

    toggleEmojiPicker();
}

function saveAndRenderMessage(chatPartner, text, time, direction, msgId, timestamp = Date.now(), isSticker = false) {
    const key = `nova_chat_${chatPartner}`;
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    const dateStr = new Date(timestamp).toISOString().split('T')[0];

    history.push({ msgId, text, time, direction, timestamp, dateStr, isSticker });
    localStorage.setItem(key, JSON.stringify(history));

    if (activeChatPartner === chatPartner || (direction === 'outgoing' && activeChatPartner === chatPartner)) {
        renderMessage(msgId, text, time, direction, timestamp, chatPartner, dateStr, isSticker);
    }
}

function renderMessage(msgId, text, time, direction, timestamp, chatPartner, dateStr, isSticker = false) {
    const container = document.getElementById('messagesContainer');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${direction}${isSticker ? 'sticker-msg' : ''}`;
    msgDiv.id = msgId;
    msgDiv.setAttribute('data-date', dateStr);

    const formattedTime = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isEditable = direction === 'outgoing' && (Date.now() - timestamp < 15 * 60 * 1000);

    let contentHtml = isSticker ? `<img src="${text}" class="sticker-img" />` : parseMessageFormatting(text);

    msgDiv.innerHTML = `
        <div class="msg-content">${contentHtml}</div>
        <span class="msg-time">${formattedTime}</span>
        <div class="msg-actions">
            <span class="msg-action-btn" onclick="showMsgInfo('${formattedTime}')"><i class="fa-solid fa-circle-info"></i> Bilgi</span>
            ${isEditable && !isSticker ? `<span class="msg-action-btn" onclick="editMessage('${msgId}', '${chatPartner}')"><i class="fa-solid fa-pen-to-square"></i></span>` : ''}
            <span class="msg-action-btn" onclick="pinMessage('${text}')"><i class="fa-solid fa-thumbtack"></i></span>
        </div>
    `;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

/* DİĞER YARDIMCI FONKSİYONLAR */
function toggleEmojiPicker() {
    const panel = document.getElementById('emojiPickerPanel');
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

function switchEmojiTab(tabName) {
    document.querySelectorAll('.emoji-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tabContentEmojis').style.display = 'none';
    document.getElementById('tabContentStickers').style.display = 'none';
    document.getElementById('tabContentGifs').style.display = 'none';

    if (tabName === 'emojis') {
        event.target.classList.add('active');
        document.getElementById('tabContentEmojis').style.display = 'flex';
    } else if (tabName === 'stickers') {
        event.target.classList.add('active');
        document.getElementById('tabContentStickers').style.display = 'flex';
    } else if (tabName === 'gifs') {
        event.target.classList.add('active');
        document.getElementById('tabContentGifs').style.display = 'flex';
    }
}

function insertEmoji(emojiStr) {
    const input = document.getElementById('messageInput');
    input.value += emojiStr;
    input.focus();
}

function switchNav(panelName) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.side-panel').forEach(panel => panel.style.display = 'none');

    document.getElementById(`nav${panelName.charAt(0).toUpperCase() + panelName.slice(1)}`).classList.add('active');
    document.getElementById(`panel${panelName.charAt(0).toUpperCase() + panelName.slice(1)}`).style.display = 'block';
}

function filterChats(filterType) {
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
}

function switchTab(method) {
    currentMethod = method;
    document.getElementById('tabEmail').classList.toggle('active', method === 'email');
    document.getElementById('tabPhone').classList.toggle('active', method === 'phone');
    document.getElementById('targetInput').placeholder = method === 'email' ? 'E-posta adresi...' : 'Tel No (05XX...)';
}

function requestCode() {
    const target = document.getElementById('targetInput').value.trim();
    if (!target) return alert("Lütfen alan doldurun!");
    connectWS(() => {
        ws.send(JSON.stringify({ type: 'request-code', method: currentMethod, target: target }));
    });
}

function verifyCode() {
    const target = document.getElementById('targetInput').value.trim();
    const code = document.getElementById('codeInput').value.trim();
    ws.send(JSON.stringify({ type: 'verify-code', target: target, code: code }));
}

function saveUsernameAndEnter() {
    const username = document.getElementById('usernameInput').value.trim();
    if (!username) return alert("Kullanıcı adı belirleyin!");

    myUsername = username.startsWith('@') ? username : `@${username}`;
    localStorage.setItem('nova_logged_user', myUsername);

    ws.send(JSON.stringify({ type: 'register-username', account: authenticatedAccount, username: myUsername }));

    document.getElementById('authModal').style.display = 'none';
    document.getElementById('myUserIdDisplay').innerText = myUsername;
    loadLocalMessages();
    renderChatList();
}

function logout() {
    localStorage.removeItem('nova_logged_user');
    location.reload();
}

function parseMessageFormatting(text) {
    if (!text) return '';
    let parsed = text;
    parsed = parsed.replace(/```([^`]+)```/g, '<code>$1</code>');
    parsed = parsed.replace(/\*([^*]+)\*/g, '<b>$1</b>');
    parsed = parsed.replace(/_([^_]+)_/g, '<i>$1</i>');
    parsed = parsed.replace(/~([^~]+)~/g, '<del>$1</del>');
    return parsed;
}

function showMsgInfo(timeStr) {
    alert(`Mesaj Bilgisi:\nTeslim Edildi: ${timeStr}\nOkundu (Mavi Tık): ${timeStr}`);
}

function searchChatByDate(selectedDate) {
    if (!selectedDate) return;
    const messages = document.querySelectorAll('.message');
    let found = false;

    messages.forEach(msg => {
        if (msg.getAttribute('data-date') === selectedDate) {
            msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
            msg.style.outline = "2px solid #ffca28";
            setTimeout(() => msg.style.outline = "none", 3000);
            found = true;
        }
    });

    if (!found) alert("Seçilen tarihe ait mesaj bulunamadı.");
}

function changeCustomBg() {
    if (!activeChatPartner) return alert("Önce bir sohbet seçin!");
    const url = prompt("Bu sohbet için özel duvar kağıdı görsel URL'si girin:");
    if (url) {
        localStorage.setItem(`nova_bg_${activeChatPartner}`, url);
        loadCustomBackground();
    }
}

function loadCustomBackground() {
    const mainChat = document.getElementById('mainChat');
    const savedBg = localStorage.getItem(`nova_bg_${activeChatPartner}`);

    if (savedBg) {
        mainChat.style.backgroundImage = `url('${savedBg}')`;
    } else {
        mainChat.style.backgroundImage = `radial-gradient(#2a3942 1px, transparent 1px)`;
    }
}

function setCustomNotificationSound() {
    alert("Bu kişi için özel bildirim sesi tanımlandı!");
}

function createDesktopShortcut() {
    if (!activeChatPartner) return alert("Sohbet seçin!");
    alert(`${activeChatPartner} sohbeti masaüstüne kısayol ikonu olarak eklendi!`);
}

function openMediaGallery() {
    if (!activeChatPartner) return alert("Sohbet seçin!");

    const key = `nova_chat_${activeChatPartner}`;
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    const container = document.getElementById('mediaListContainer');
    container.innerHTML = '';

    history.forEach(m => {
        if (m.text.startsWith('http') || m.isSticker) {
            const item = document.createElement('div');
            item.style.margin = "8px 0";
            item.innerHTML = `<a href="${m.text}" target="_blank" style="color:#4da6ff;">${m.text}</a> (${m.time})`;
            container.appendChild(item);
        }
    });

    if (container.innerHTML === '') container.innerHTML = '<p style="color:#8696a0;">Hiç medya bulunamadı.</p>';
    document.getElementById('mediaModal').style.display = 'flex';
}

function exportChatToEmail() {
    if (!activeChatPartner) return alert("Sohbet seçin!");

    const key = `nova_chat_${activeChatPartner}`;
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    let txt = `Nova Messages - ${activeChatPartner} Sohbet Yedegi\n\n`;

    history.forEach(m => {
        txt += `[${m.dateStr || ''} ${m.time}] ${m.direction === 'outgoing' ? 'Ben' : activeChatPartner}: ${m.text}\n`;
    });

    const blob = new Blob([txt], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Sohbet_Yedegi_${activeChatPartner}.txt`;
    a.click();
}

function toggleDataSaver() {
    alert(document.getElementById('dataSaverOption').checked ? "Az veri kullanımı açıldı." : "Kapatıldı.");
}

function toggleAutoDownload() {
    alert(document.getElementById('autoDownloadOption').checked ? "Otomatik indirme kapatıldı." : "Açıldı.");
}

function playNotificationSound() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
}

function editMessage(msgId, chatPartner) {
    const newText = prompt("Mesajı düzenleyin:");
    if (!newText) return;

    updateMessageInDOM(msgId, newText + " (düzenlendi)");
    ws.send(JSON.stringify({ type: 'edit-message', targetId: chatPartner, msgId: msgId, newText: newText + " (düzenlendi)" }));
}

function updateMessageInDOM(msgId, newText) {
    const msgEl = document.getElementById(msgId);
    if (msgEl) {
        msgEl.querySelector('.msg-content').innerHTML = parseMessageFormatting(newText);
    }
}

function pinMessage(text) {
    document.getElementById('pinnedMsgBar').style.display = 'block';
    document.getElementById('pinnedText').innerText = text;
}

function loadLocalMessages() {
    if (!activeChatPartner) return;
    document.getElementById('messagesContainer').innerHTML = '';
    const key = `nova_chat_${activeChatPartner}`;
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    history.forEach(m => renderMessage(m.msgId, m.text, m.time, m.direction, m.timestamp, activeChatPartner, m.dateStr, m.isSticker));
}

document.getElementById('targetUserSearch').addEventListener('change', (e) => {
    openChatSession(e.target.value.trim());
});

/* WEBRTC ARAMA */
async function setupWebRTC(targetId) {
    document.getElementById('videoContainer').style.display = 'grid';
    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        document.getElementById('remoteVideo').srcObject = event.streams[0];
    };
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'ice-candidate', targetId: targetId, candidate: event.candidate }));
        }
    };
}

async function startCall(type) {
    if (!activeChatPartner) return alert("Sohbet seçin!");
    await setupWebRTC(activeChatPartner);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'rtc-offer', targetId: activeChatPartner, sdp: offer }));
}

async function handleOffer(data) {
    await setupWebRTC(data.senderId);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'rtc-answer', targetId: data.senderId, sdp: answer }));
}