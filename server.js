const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());

let qrRaw = null;
let isReady = false;
let messages = [];
let client = null;

function startClient() {
    client = new Client({
        authStrategy: new LocalAuth(),
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

    client.on('qr', (qr) => {
        console.log('QR Code received');
        isReady = false;
        qrRaw = qr;
    });

    client.on('ready', () => {
        console.log('WhatsApp Ready!');
        isReady = true;
        qrRaw = null;
    });

    client.on('message', async (msg) => {
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
    });

    client.on('disconnected', () => {
        console.log('Disconnected, restarting...');
        isReady = false;
        qrRaw = null;
        setTimeout(startClient, 3000);
    });

    client.initialize();
}

app.get('/status', (req, res) => {
    res.json({ ready: isReady, hasQr: !!qrRaw });
});

// מייצר QR טרי בכל פעם
app.get('/qr', async (req, res) => {
    if (isReady) return res.json({ ready: true });
    if (qrRaw) {
        const freshQr = await qrcode.toDataURL(qrRaw);
        res.json({ qr: freshQr });
    } else {
        res.json({ waiting: true });
    }
});

app.get('/messages', (req, res) => {
    res.json({ messages });
});

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

app.get('/', (req, res) => {
    res.send(`
        <html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:40px">
        <h2>WhatsApp Watch Server</h2>
        <p>Status: ${isReady ? '✅ מחובר' : qrRaw ? '📱 ממתין לסריקה' : '⏳ טוען...'}</p>
        <p><a href="/qr" style="color:#25D366">QR</a> | 
           <a href="/messages" style="color:#25D366">הודעות</a> |
           <a href="/status" style="color:#25D366">סטטוס</a></p>
        </body></html>
    `);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    startClient();
});
