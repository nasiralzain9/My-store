const express = require("express");
const fs = require("fs");
const session = require("express-session");
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Session setup taaki login state yaad rahe aur bar-bar login na mange
app.use(session({
    secret: "elite-finmobiles-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 din tak login rahega
}));

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

// Admin panel protect karne ke liye session check
app.get("/admin", (req, res) => {
    if (!req.session.isAdminLoggedIn) {
        return res.redirect("/"); // Agar login nahi hai toh index/login page par bhej dega
    }
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

// Temporary store for OTPs (Phone -> OTP)
const otpStore = {};

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

// --- REAL OTP SENDING API ---
app.post("/api/send-otp", async (req, res) => {
    const { phone } = req.body;
    if (!isWaConnected || !sock) {
        return res.json({ success: false, message: "WhatsApp server connected nahi hai!" });
    }
    
    // Asli 6 digit ka random OTP generate hoga
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[phone] = otp;

    try {
        let formattedPhone = phone.includes("@s.whatsapp.net") ? phone : phone + "@s.whatsapp.net";
        await sock.sendMessage(formattedPhone, { text: `Aapka OTP code hai: *${otp}*. Kisi ke sath share na karein.` });
        
        res.json({ success: true, message: "OTP WhatsApp par bhej diya gaya hai!" });
    } catch (err) {
        res.json({ success: false, message: "OTP bhejne mein error aayi: " + err.message });
    }
});

// --- OTP VERIFICATION & LOGIN API ---
app.post("/api/verify-otp", (req, res) => {
    const { phone, otp } = req.body;
    if (otpStore[phone] && otpStore[phone] === otp) {
        delete otpStore[phone]; // OTP use hone ke baad delete ho jayega
        req.session.isAdminLoggedIn = true; // Session set kar diya (ab refresh par login nahi maangega)
        res.json({ success: true, message: "Login successful!" });
    } else {
        res.json({ success: false, message: "Galat OTP hai, kripya dobara try karein!" });
    }
});

// --- LOGOUT API ---
app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
        res.json({ success: true, message: "Logged out successfully" });
    });
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
