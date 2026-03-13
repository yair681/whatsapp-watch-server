const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const pino = require('pino');
const fs = require('fs');

const app = express();
app.use(express.json());

let qrRaw = null;
let isReady = false;
let messages = [];
let sock = null;
let status = 'starting';

const AUTH_DIR = '/tmp/baileys_auth';
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

async function startClient() {
    console.log('[DEBUG] Starting Baileys client...');
    status = 'starting';

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['WhatsApp Watch', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('[DEBUG] QR received!');
            qrRaw = qr;
            isReady = false;
            status = 'waiting_scan';
        }

        if (connection === 'open') {
            console.log('[DEBUG] Connected!');
            isReady = true;
            qrRaw = null;
            status = 'ready';
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log('[DEBUG] Disconnected, code:', code);
            isReady = false;
            status = 'disconnected';

            const shouldReconnect = code !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('[DEBUG] Reconnecting...');
                setTimeout(startClient, 3000);
            } else {
                console.log('[DEBUG] Logged out, clearing auth...');
                fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                fs.mkdirSync(AUTH_DIR, { recursive: true });
                setTimeout(startClient, 3000);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
        if (type !== 'notify') return;
        for (const msg of msgs) {
            if (!msg.message || msg.key.fromMe) continue;
            const from = msg.key.remoteJid;
            const number = from.replace('@s.whatsapp.net', '').replace('@g.us', '');
            const name = msg.pushName || number;
            const body =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                '📎 קובץ';

            console.log('[DEBUG] Message from:', name);
            messages.unshift({
                id: msg.key.id,
                from: name,
                number,
                body,
                time: new Date(msg.messageTimestamp * 1000).toLocaleTimeString('he-IL', {
                    hour: '2-digit',
                    minute: '2-digit'
                })
            });
            if (messages.length > 20) messages = messages.slice(0, 20);
        }
    });
}

app.get('/status', (req, res) => {
    res.json({ ready: isReady, hasQr: !!qrRaw, status });
});

app.get('/qr', async (req, res) => {
    if (isReady) return res.json({ ready: true });
    if (qrRaw) {
        const freshQr = await qrcode.toDataURL(qrRaw);
        res.json({ qr: freshQr });
    } else {
        res.json({ waiting: true, status });
    }
});

app.get('/messages', (req, res) => {
    res.json({ messages });
});

app.post('/reply', async (req, res) => {
    const { number, text } = req.body;
    if (!isReady || !sock) return res.json({ error: 'not ready' });
    try {
        await sock.sendMessage(`${number}@s.whatsapp.net`, { text });
        res.json({ ok: true });
    } catch (e) {
        res.json({ error: e.message });
    }
});

app.get('/', (req, res) => {
    res.send(`
        <html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:40px">
        <h2>WhatsApp Watch Server</h2>
        <p>Status: <b style="color:#25D366">${status}</b></p>
        <p>${isReady ? '✅ מחובר' : qrRaw ? '📱 ממתין לסריקה' : '⏳ טוען...'}</p>
        <p>
            <a href="/status" style="color:#25D366">סטטוס</a> | 
            <a href="/qr" style="color:#25D366">QR</a> | 
            <a href="/messages" style="color:#25D366">הודעות</a>
        </p>
        </body></html>
    `);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[DEBUG] Server running on port ${PORT}`);
    startClient();
});
