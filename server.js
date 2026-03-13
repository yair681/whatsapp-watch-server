const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());

let qrRaw = null;
let isReady = false;
let messages = [];
let client = null;
let status = 'starting';

function startClient() {
    console.log('[DEBUG] Starting WhatsApp client...');
    status = 'starting';

    client = new Client({
        authStrategy: new LocalAuth({
            dataPath: '/tmp/.wwebjs_auth'
        }),
        puppeteer: {
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || require('puppeteer').executablePath(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    });

    client.on('loading_screen', (percent, message) => {
        console.log(`[DEBUG] Loading: ${percent}% - ${message}`);
        status = `loading ${percent}%`;
    });

    client.on('authenticated', () => {
        console.log('[DEBUG] Authenticated!');
        status = 'authenticated';
    });

    client.on('auth_failure', (msg) => {
        console.log('[DEBUG] Auth failure:', msg);
        status = 'auth_failed';
        qrRaw = null;
    });

    client.on('qr', (qr) => {
        console.log('[DEBUG] QR Code received, length:', qr.length);
        isReady = false;
        qrRaw = qr;
        status = 'waiting_scan';
    });

    client.on('ready', () => {
        console.log('[DEBUG] WhatsApp Ready!');
        isReady = true;
        qrRaw = null;
        status = 'ready';
    });

    client.on('message', async (msg) => {
        console.log('[DEBUG] Message from:', msg.from);
        try {
            const contact = await msg.getContact();
            const name = contact.pushname || contact.number;
            messages.unshift({
                id: msg.id._serialized,
                from: name,
                number: contact.number,
                body: msg.body,
                time: new Date(msg.timestamp * 1000).toLocaleTimeString('he-IL', {
                    hour: '2-digit',
                    minute: '2-digit'
                })
            });
            if (messages.length > 20) messages = messages.slice(0, 20);
        } catch (e) {
            console.log('[DEBUG] Message error:', e.message);
        }
    });

    client.on('disconnected', (reason) => {
        console.log('[DEBUG] Disconnected:', reason);
        isReady = false;
        qrRaw = null;
        status = 'disconnected';
        setTimeout(startClient, 5000);
    });

    client.initialize().catch(err => {
        console.log('[DEBUG] Initialize error:', err.message);
        status = 'error: ' + err.message;
        setTimeout(startClient, 5000);
    });
}

// סטטוס מפורט
app.get('/status', (req, res) => {
    res.json({
        ready: isReady,
        hasQr: !!qrRaw,
        status: status
    });
});

// QR טרי בכל בקשה
app.get('/qr', async (req, res) => {
    if (isReady) return res.json({ ready: true });
    if (qrRaw) {
        const freshQr = await qrcode.toDataURL(qrRaw);
        res.json({ qr: freshQr });
    } else {
        res.json({ waiting: true, status });
    }
});

// הודעות
app.get('/messages', (req, res) => {
    res.json({ messages });
});

// תגובה מהירה
app.post('/reply', async (req, res) => {
    const { number, text } = req.body;
    if (!isReady) return res.json({ error: 'not ready' });
    try {
        await client.sendMessage(`${number}@c.us`, text);
        res.json({ ok: true });
    } catch (e) {
        res.json({ error: e.message });
    }
});

// דף בית
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
