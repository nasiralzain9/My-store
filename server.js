
const express = require("express");
const fs = require("fs");
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

app.get("/admin", (req, res) => {
    let adminFile = fs.existsSync("admin.html") ? "admin.html" : "index.html";
    res.sendFile(__dirname + "/" + adminFile);
});

// --- Baileys WhatsApp Gateway ---
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const pino = require("pino");

let sock = null;
let waQrCodeImg = "";
let isWaConnected = false;
let phoneNum = "";
let initializing = false;

async function startWa() {
    if (initializing || isWaConnected) return;
    initializing = true;
    try {
        const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: "silent" })
        });
        sock.ev.on("creds.update", saveCreds);
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if(qr) {
                waQrCodeImg = await QRCode.toDataURL(qr);
                isWaConnected = false;
            }
            if(connection === "open") {
                isWaConnected = true;
                waQrCodeImg = "";
                initializing = false;
                phoneNum = sock.user ? sock.user.id.split(":")[0] : "Connected";
            } else if(connection === "close") {
                isWaConnected = false;
                initializing = false;
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if(shouldReconnect) {
                    setTimeout(() => startWa(), 3000);
                } else {
                    phoneNum = "";
                    waQrCodeImg = "";
                }
            }
        });
    } catch(e) {
        initializing = false;
    }
}

startWa();

app.get("/api/whatsapp/status", (req, res) => {
    res.json({ connected: isWaConnected, phone: phoneNum });
});

app.post("/api/whatsapp/generate-qr", async (req, res) => {
    if(isWaConnected) {
        return res.json({ success: false, message: "Already Connected!" });
    }
    if(!sock || !waQrCodeImg) {
        await startWa();
    }
    let count = 0;
    while(!waQrCodeImg && !isWaConnected && count < 8) {
        await new Promise(r => setTimeout(r, 500));
        count++;
    }
    if(waQrCodeImg) {
        res.json({ success: true, qr: waQrCodeImg });
    } else {
        res.json({ success: false, message: "Generating QR, please retry in 3 seconds." });
    }
});

app.post("/api/whatsapp/disconnect", async (req, res) => {
    try {
        if(sock) await sock.logout();
    } catch(e) {}
    isWaConnected = false;
    phoneNum = "";
    waQrCodeImg = "";
    initializing = false;
    try {
        fs.rmSync("auth_info_baileys", { recursive: true, force: true });
    } catch(e) {}
    res.json({ success: true, message: "Disconnected" });
    setTimeout(() => startWa(), 2000);
});

app.listen(PORT, () => {
    console.log("Elite FinMobiles Server running at http://localhost:" + PORT);
});
