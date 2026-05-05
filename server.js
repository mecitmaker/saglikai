const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const REQUIRE_APP_CHECK = process.env.REQUIRE_APP_CHECK === 'true';

let db = null;
try {
    const serviceAccount = require('./firebase-key.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log('🛡️  Firebase Admin SDK aktif.');
} catch (error) {
    console.error('⚠️  Firebase Admin SDK başlatılamadı:', error.message);
    console.error('⚠️  Firestore işlemleri devre dışı kalacak.');
}
const KVKK_CONSENT_VERSION = 'v1.0';

// Initialize Groq (Ana Teşhis Motoru — Llama 4 Maverick)
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GROQ_PRIMARY_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"; // Llama 4 (Nisan 2026, doğrulanmış)
const GROQ_FALLBACK_MODEL = "llama-3.3-70b-versatile"; // Yedek: Kararlı, ücretsiz, çok güçlü

// Initialize Gemini API (Takip ve Vision Katmanı)
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "API_KEY_BEKLENIYOR");

// Model Tanımları
const FLASH_MODEL = "gemini-2.0-flash-001"; // Takip/Sohbet: Kararlı, test edilmiş, her zaman çalışıyor
const PRO_MODEL = "gemini-1.5-pro"; // VIP: Derin zeka, vision, doktor raporu (Pro key aktif)

console.log(`🔑 GROQ API Key: ${process.env.GROQ_API_KEY ? 'Yüklü ✅' : 'Eksik ❌'}`);
console.log(`🔑 Gemini API Key: ${process.env.GEMINI_API_KEY ? 'Yüklü ✅' : 'Eksik ❌'}`);
console.log(`🧠 Mimari: Groq Llama 4 (Teşhis) → Gemini 2.5 Flash (Takip) → Gemini 2.5 Pro (VIP)`);

// =====================================================
// 🛡️ ZAMAN AŞIMI KORUMASI (Tüm AI çağrıları için)
// =====================================================
function withTimeout(promise, ms, label = 'AI') {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(Object.assign(new Error(`${label} ${ms}ms içinde yanıt vermedi.`), { code: 'TIMEOUT' })), ms)
        )
    ]);
}

const AI_TIMEOUT_MS = 20000;  // 20 saniye — DeepSeek için biraz daha geniş
const RACE_TIMEOUT_MS = 15000;

// =====================================================
// 1. KATMAN: GROQ (Llama 4 Maverick — Demir Bilek)
// =====================================================
async function safeGenerateGroq(promptParts, modelOverride = null) {
    const content = Array.isArray(promptParts)
        ? promptParts.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join('\n')
        : String(promptParts || '');

    const model = modelOverride || GROQ_PRIMARY_MODEL;
    console.log(`[GROQ] Model: ${model}`);

    const chatCompletion = await withTimeout(
        groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Sen dünyanın en iyi klinik başhekimisin. 
TALİMATLAR:
1. SADECE TÜRKÇE konuş. "ç, ş, ğ, ı, ö, ü" karakterlerini kusursuz kullan.
2. Derinlik: Yüzeysel cevap verme. Anatomik bağlantıları açıkla.
3. Format: SADECE ham JSON döndür. Markdown (code blocks) YASAK.
4. Hitap: "Sayın hasta" deme. Doğrudan ve profesyonel gir.`
                },
                {
                    role: "user",
                    content: content + "\n\nKRİTİK: Yanıtını SADECE saf JSON olarak ve eksiksiz Türkçe karakterlerle ver."
                }
            ],
            model: model,
            temperature: 0.2,
            response_format: { type: "json_object" }
        }),
        AI_TIMEOUT_MS,
        'Groq'
    );

    const rawText = chatCompletion.choices[0]?.message?.content || "{}";
    return { response: { text: () => rawText }, _source: `groq-${model.split('/').pop()}` };
}

// =====================================================
// 2. KATMAN: GEMINI FLASH (Akıllı Ara İşlemler)
// =====================================================
async function safeGenerateFlash(promptParts) {
    const model = genAI.getGenerativeModel({ model: FLASH_MODEL });
    const content = Array.isArray(promptParts)
        ? promptParts.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join('\n')
        : String(promptParts || '');
    
    const result = await withTimeout(
        model.generateContent({
            contents: [{ role: "user", parts: [{ text: content + "\n\nKRİTİK TALİMAT: Yanıtını mutlaka JSON formatında ve SADECE Türkçe olarak ver." }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
        }),
        AI_TIMEOUT_MS,
        'Gemini Flash'
    );
    
    return { response: { text: () => result.response.text() }, _source: 'gemini-flash' };
}

// =====================================================
// 3. KATMAN: GEMINI PRO (Derin Zeka — Sadece VIP)
// =====================================================
async function safeGeneratePro(promptParts) {
    try {
        const model = genAI.getGenerativeModel({ model: PRO_MODEL });
        const content = Array.isArray(promptParts)
            ? promptParts.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join('\n')
            : String(promptParts || '');
        
        const result = await withTimeout(
            model.generateContent({
                contents: [{ role: "user", parts: [{ text: content + "\n\nKRİTİK TALİMAT: Yanıtını mutlaka JSON formatında ver." }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
            }),
            25000, // Pro için 25sn (daha derin düşünür)
            'Gemini Pro'
        );
        
        return { response: { text: () => result.response.text() }, _source: 'gemini-pro' };
    } catch (error) {
        console.warn(`⚡ Gemini Pro başarısız (${error.code || error.message}), Flash yedek hattına geçiliyor...`);
        return await safeGenerateFlash(promptParts);
    }
}

// =====================================================
// ⚡ AKILLI KATMAN MOTORU (Validation Shield Entegre)
// Ana: Groq Llama 4 (Hız + Ücretsiz)
// Yedek: Gemini 3.1 Flash (Kararlılık)
// =====================================================
async function smartGenerate(promptParts) {
    // Deneme 1: Llama 4 Scout
    try {
        console.log('[MOTOR] Groq Llama 4 Scout devreye giriyor...');
        const result = await safeGenerateGroq(promptParts, GROQ_PRIMARY_MODEL);
        const text = result.response.text();
        if (!text || text.length < 150) throw new Error('Groq cevabı çok kısa/yüzeysel.');
        return result;
    } catch (e1) {
        console.warn('⚠️ Llama 4 Scout başarısız, Llama 3.3 70B hattına geçiliyor:', e1.message);
        // Deneme 2: Llama 3.3 70B (Kararsız Groq için iç yedek)
        try {
            const result2 = await safeGenerateGroq(promptParts, GROQ_FALLBACK_MODEL);
            const text2 = result2.response.text();
            if (!text2 || text2.length < 150) throw new Error('Groq yedek de yetersiz.');
            return result2;
        } catch (e2) {
            console.warn('⚠️ Groq tamamen başarısız, Gemini Flash hattına geçiliyor:', e2.message);
            // Deneme 3: Gemini Flash (Son şareş)
            return await safeGenerateFlash(promptParts);
        }
    }
}

// GÖRMENİN ZİRVESİ: GEMINI VISION (Pro -> Flash Fallback)
async function safeGenerateVision(textPrompt, imagePart) {
    try {
        const model = genAI.getGenerativeModel({ model: PRO_MODEL });
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [ { text: textPrompt + "\nKRİTİK: Yanıtını JSON olarak dön." }, imagePart ] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
        });
        
        return { response: { text: () => result.response.text() } };
    } catch (error) {
        console.warn('Vision Pro hatası, Flash Vision deneniyor...');
        try {
            const flashModel = genAI.getGenerativeModel({ model: FLASH_MODEL });
            const fResult = await flashModel.generateContent({
                contents: [{ role: "user", parts: [ { text: textPrompt }, imagePart ] }],
                generationConfig: { responseMimeType: "application/json" }
            });
            return { response: { text: () => fResult.response.text() } };
        } catch (fErr) {
            console.error('Vision tamamen çöktü.');
            throw fErr;
        }
    }
}

// Global Security Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];
const isProduction = process.env.NODE_ENV === 'production';

const corsOptions = isProduction
    ? {
        origin: function(origin, callback) {
            if (!origin) return callback(null, true);
            if (ALLOWED_ORIGINS.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error('CORS politikası bu origin için izin vermiyor.'));
        }
    }
    : (ALLOWED_ORIGINS.length ? { origin: ALLOWED_ORIGINS } : {});

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));

// Simple request logger for debugging
app.use((req, res, next) => {
    console.log(`[REQ] ${req.method} ${req.url}`);
    next();
});

app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('sw.js') || filePath.endsWith('index.html') || filePath.endsWith('login.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Rate Limiting: Prevent abuse
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    message: { error: "Çok fazla istek gönderdiniz. Lütfen 15 dakika sonra tekrar deneyin." }
});

const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: "Çok hızlı istek gönderdiniz. Lütfen 1 dakika bekleyin." }
});

// Authentication Middleware
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = null;
        return next();
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Oturum geçersiz. Lütfen tekrar giriş yapın.' });
    }
};

const verifyAppCheckToken = async (req, res, next) => {
    const appCheckToken = req.headers['x-firebase-appcheck'];
    if (!appCheckToken) {
        if (REQUIRE_APP_CHECK) {
            return res.status(403).json({
                error: 'Uygulama doğrulaması gerekli.',
                code: 'APP_CHECK_REQUIRED'
            });
        }
        return next();
    }

    try {
        const decoded = await admin.appCheck().verifyToken(appCheckToken);
        req.appCheck = decoded;
        return next();
    } catch (error) {
        console.error('App Check doğrulama hatası:', error.message);
        return res.status(403).json({
            error: 'Uygulama doğrulaması başarısız.',
            code: 'APP_CHECK_INVALID'
        });
    }
};

async function getKvkkConsent(uid) {
    const docRef = db.collection('users').doc(uid).collection('consents').doc('kvkk');
    const doc = await docRef.get();
    if (!doc.exists) {
        return { accepted: false, version: null };
    }
    const data = doc.data() || {};
    return {
        accepted: data.accepted === true,
        version: data.version || null,
        acceptedAt: data.acceptedAt || null
    };
}

const requireKvkkConsent = async (req, res, next) => {
    if (!req.user) {
        return next();
    }
    try {
        const consent = await getKvkkConsent(req.user.uid);
        if (!consent.accepted) {
            return res.status(403).json({
                error: 'KVKK onayı gerekli. Lütfen aydınlatma metnini onaylayın.',
                code: 'KVKK_REQUIRED'
            });
        }
        next();
    } catch (error) {
        console.error('KVKK kontrol hatası:', error);
        res.status(500).json({ error: 'KVKK doğrulaması yapılamadı.' });
    }
};

app.use('/api/', apiLimiter);
app.use(['/api/analyze-symptoms', '/api/analyze-image', '/api/doctor-report', '/api/follow-up', '/api/chat-followup', '/api/deep-dive', '/api/disease-info', '/api/analyze-medication', '/api/analyze-medication-image', '/api/natural-remedies', '/api/analyze-lab-results', '/api/analyze-lab-image', '/api/health-profile', '/api/drug-interactions', '/api/symptom-trend', '/api/mental-health'], aiLimiter);
app.use('/api/', authenticateUser);
app.use('/api/', verifyAppCheckToken);

// Multer setup for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeName = crypto.randomUUID() + ext;
        cb(null, safeName);
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ===== SYSTEM PROMPTS (GEMINI ADAPTED) =====
const MEDICAL_PROMPT = `Sen dünyaca ünlü bir tanı uzmanı ve empati yeteneği yüksek bir klinik başhekimisin. Kullanıcı sana şikayetini anlattığında, ona bir "Uzman Konsültasyonu" kalitesinde inanılmaz detaylı, doyurucu ve adım adım bir analiz sunmalısın.

ÜSLUP KURALLARI:
1. DOĞAL VE PROFESYONEL HİTAP: "Sayın hasta", "Değerli hasta" gibi yapay, robotik ve soğuk hitapları KESİNLİKLE KULLANMA. Doğrudan ve doğal bir şekilde cümleye gir (Örn: "Anlıyorum, yaşadığınız bu durum..." veya "Bahsettiğiniz şikayetler...").
2. DERİNLEMESİNE ANALİZ: Şikayeti okuduğunda sadece "Şu olabilir" deyip kestirip atma. Belirtilerin anatomik ve fizyolojik olarak neden kaynaklanabileceğini, birbirleriyle nasıl bağlantılı olduğunu hastanın anlayacağı dilde ama uzman bir derinlikle UZUN UZUN anlat.
3. AKILLI SORULAR: Durumu netleştirmek için eksik olan kritik bilgiler varsa EN FAZLA 3 adet net soru sor. Eğer hasta her şeyi detaylı anlattıysa hiç soru sorma.

JSON FORMATI (SADECE BUNU DÖN):
{
  "_zihin_haritasi": "Önce burada kendi kendine düşün. Bu belirtiler ne anlama geliyor? Hangi nadir veya yaygın hastalıklar olabilir? Ne sormalıyım? (İstediğin kadar uzun yazabilirsin, bu senin iç sesin).",
  "asistan_notu": "Hastaya doğrudan hitap ettiğin, şikayetlerini ve olası fizyolojik nedenlerini uzun uzun, paragraf paragraf anlattığın, çok doyurucu ve güven verici ANA METİN.",
  "risk_seviyesi": "Normal/Orta/Yüksek/Kritik",
  "teshisler": [{"ad": "Olası Hastalık", "oran": "%...", "neden": "Kapsamlı klinik sebep açıklaması"}],
  "cikarimlar": ["Hastaya özel çok spesifik klinik tespit 1", "Hastaya özel spesifik klinik tespit 2", "Klinik tespit 3"],
  "yapilmasi_gerekenler": ["Pratik öneri 1", "Pratik öneri 2", "Pratik öneri 3"],
  "kacinilmasi_gerekenler": ["Uzak durulması gerekenler 1", "Uzak durulması gerekenler 2"],
  "doktora_gitme": {"seviye": "Düşük/Orta/Acil", "not": "Ne zaman gitmeli..."},
  "sorular": [ 
      {"q": "Teşhisi daraltacak net bir soru?", "opts": ["Şık 1", "Şık 2", "Şık 3"]} 
  ] // Soru sormana gerek yoksa boş dizi [] dönebilirsin.
}

DİKKAT: Yanıtın KESİNLİKLE parse edilebilir tek bir JSON olmalıdır. Tüm alanlar (çıkarımlar vs.) son derece zengin, hastaya özel ve kaliteli yazılmalıdır. Sıradan ve kısa cümleler KABUL EDİLEMEZ.`;

const DISEASE_INFO_PROMPT = `Sen bir sağlık araştırmacısısın. Sorulan hastalığı incele; modern tedavilerini, doğal yöntemlerini açıkla. Sadece JSON formatında yanıt ver.

{
  "hastalik_tanimi": "Özet",
  "modern_tedaviler": ["Tedavi 1"],
  "geleneksel_ve_dogal_yontemler": ["Yöntem 1"],
  "turkiyede_uzman_kurumlar_ve_gelismeler": ["İlgili Dernek"],
  "klinik_ve_uzman_onerileri": {
    "hastane_tipleri": ["Hangi tür kurumlar (Örn: Eğitim Araştırma, Branş Hastanesi)"],
    "uzmanlik_alanlari": ["Hangi bölüm bakmalı (Örn: Kardiyoloji, Dermatoloji)"],
    "turkiyedeki_populer_merkezler": ["Öncü hastaneler veya şehirler"],
    "arama_terimleri": ["Doktor bulmak için anahtar kelimeler"]
  }
}`;


const DEEP_DIVE_PROMPT = `Sen profesyonel bir tıp araştırmacısısın. Hastalık hakkında teknik bilgi ver. Sadece JSON formatında yanıt ver.

{
    "mechanism": "Hastalığın fizyolojik nedeni",
    "risk_factors": ["Faktör 1"],
    "clinical_findings": ["Spesifik bulgu 1"],
    "diagnostics": ["Test 1"],
    "diet_guide": ["Öneri 1"],
    "recent_research": ["Klinik çalışma 1"]
}`;

const MEDICATION_PROMPT = `Sen kıdemli bir klinik eczacısın. Verilen ilacı (veya ilaç kutusu görselini) derinlemesine incele ve SADECE JSON formatında profesyonel bir "Akıllı Prospektüs" özeti sun.

{
    "ilac_adi": "İlacın Tam Adı ve Dozu (Örn: Parol 500mg Tablet)",
    "etkin_madde": "Ana etken madde (Örn: Parasetamol)",
    "ne_ise_yarar": "Hangi hastalıkların tedavisinde kullanılır (Kısa ve öz)",
    "nasil_kullanilir": "Genel kullanım talimatı (Örn: Günde 3 defa tok karnına)",
    "yan_etkiler": ["En sık görülen 3-5 yan etki"],
    "uyarilar": ["Kritik uyarılar (Örn: Karaciğer yetmezliğinde dikkat)"],
    "etkilesimler": {
        "alkol": "Alkol ile kullanım riski (Yüksek/Düşük/Yok ve neden)",
        "besin": "Önemli besin etkileşimleri (Örn: Greyfurt ile almayınız)",
        "diger_ilaclar": "Sık kullanılan diğer ilaçlarla etkileşim notu"
    },
    "gebelik_kategorisi": "A, B, C, D veya X ve kısa açıklama",
    "muadilleri": ["Piyasadaki en yaygın 2-3 muadil ismi"],
    "saklama_kosullari": "Örn: 25 derece altı oda sıcaklığında, ışıktan koruyarak",
    "risk_meter": 2 // 1-10 arası genel risk/yan etki ağırlık skoru
}`;

const DOCTOR_REPORT_PROMPT = `Sen yapay zeka tabanlı bir sağlık asistanısın. Amacın, hastanın anlattığı karışık semptomları ve sohbet geçmişini, GERÇEK BİR DOKTORA sunulmak üzere derli toplu, yapılandırılmış bir "Hasta Ön Bilgi ve Şikayet Özeti" formuna dönüştürmektir.
Görevin KESİNLİKLE tıbbi teşhis koymak (Diferansiyel Diyagnoz vb.) DEĞİLDİR. Sadece hastanın derdini gerçek bir hekime çok daha iyi, eksiksiz ve profesyonel bir şekilde aktarabilmesi için bir köprü görevi görmektir. Yasal sorumluluklar gereği raporun hiçbir yerinde kesin tanı bulunmamalıdır.

ZORUNLU JSON ŞEMASI:
{
    "header": {
        "belge_turu": "Hekim İçin Ön Bilgi / Anamnez Özeti",
        "uyari": "Bu belge yapay zeka tarafından hastanın beyanlarına dayanarak hazırlanmıştır, kesin tıbbi teşhis içermez."
    },
    "hasta_beyani_ozeti": "Hastanın kendi kelimelerinden yola çıkarak şikayetlerinin net, kronolojik ve profesyonel bir özeti.",
    "ana_semptomlar": ["Başlıca şikayet 1", "Başlıca şikayet 2"],
    "eslik_eden_durumlar": ["Varsa diğer hafif belirtiler veya durumlar"],
    "siddet_ve_sure": "Şikayetlerin ne zamandır devam ettiği ve hasta tarafından tarif edilen şiddeti (Örn: 2 gündür, artan seyirde).",
    "tetikleyici_veya_hafifletici_faktorler": ["Hastanın belirttiğine göre ağrıyı/durumu artıran veya azaltan şeyler"],
    "doktora_sorulabilecek_sorular": ["Hastanın muayene sırasında gerçek doktora sorması faydalı olabilecek 2-3 akıllıca soru (Örn: 'Bu durum kullandığım tansiyon ilacıyla ilgili olabilir mi?')"]
}

DİKKAT: Sadece JSON dön. Hiçbir hastalık ismini kesin teşhis gibi yazma, sadece ihtimal veya şikayet olarak belirt.`;

const NATURAL_REMEDY_PROMPT = `Geleneksel tıp uzmanısın. Acil durum yoksa doğal çözüm öner. Sadece JSON formatında yanıt ver. guvenli_mi boolean olmalı.

{
    "guvenli_mi": true,
    "aciklama": "Açıklama",
    "bitkisel_caylar": [{"isim": "Çay", "tarif": "Tarif", "fayda": "Fayda"}],
    "ev_uygulamalari": [{"isim": "Uyg", "aciklama": "Açık"}],
    "beslenme_onerileri": [{"isim": "Besin", "aciklama": "Neden"}],
    "yasam_tarzi": [{"isim": "Tavsiye", "aciklama": "Detay"}],
    "kacinilmasi_gerekenler": [{"isim": "Yasak", "neden": "Nedeni"}]
}`;

const FOLLOW_UP_PROMPT = `Sen dünyaca ünlü bir klinik başhekimisin. Kullanıcı, sorduğun detaylandırma sorularına yanıt verdi. Bu yeni bilgiler ışığında teşhisi GÜNCELLE.

ÜSLUP VE MANTIK:
1. DOĞAL HİTAP: "Sayın hasta", "Hasta bildirmiş" gibi ifadeleri KESİNLİKLE kullanma. Doğal ve profesyonel bir şekilde konuşmaya devam et.
2. DERİN YORUMLAMA: Kullanıcının verdiği yeni cevapların fizyolojik ve anatomik olarak ne anlama geldiğini detaylıca açıkla. "Cevaplarınızı aldım" diyerek kolaya kaçma. Hangi belirtinin neyi elediğini veya güçlendirdiğini UZUN UZUN anlat.
3. DİNAMİK AKIŞ: Eğer tablo netleştiyse yeni soru sorma ve süreci çok detaylı ve güven verici bir raporla bitir. Ancak tablo hala karışıksa, EN FAZLA 1-2 YENİ soru sorabilirsin.

JSON yapısı (SADECE bunu dön):
{
  "_zihin_haritasi": "Yeni cevaplarla tablo nasıl değişti? Hastanın durumu neye evrildi? Kendi iç analizini yap (100 kelimeye kadar çıkabilirsin).",
  "asistan_notu": "Yeni cevapların tıbbi anlamını detaylıca yorumlayan, güncel ve çok kapsamlı durum özeti. Kesinlikle kısa geçiştirme.",
  "risk_seviyesi": "Normal/Orta/Yüksek/Kritik",
  "teshisler": [{"ad": "Güncel Olası Hastalık", "oran": "%...", "neden": "Kapsamlı açıklama"}],
  "cikarimlar": ["Hastaya özel güncellenen spesifik çıkarım 1", "Güncellenen spesifik çıkarım 2"],
  "yapilmasi_gerekenler": ["Somut öneri 1", "Somut öneri 2", "Somut öneri 3"],
  "kacinilmasi_gerekenler": ["Kaçınılacak 1", "Kaçınılacak 2"],
  "doktora_gitme": {"seviye": "Düşük/Orta/Acil", "not": "Ne zaman gitmeli"},
  "sorular": [] // Tablo netleştiyse BOŞ BIRAK, gerekliyse max 2 yeni soru ekle.
}

DİKKAT: Sadece JSON dön. Sıradan, jenerik ve kısa cümleler YASAKTIR.`;


const IMAGE_GUARD_PROMPT = `Sen bir güvenlik denetim asistanısın. Verilen görselin sağlık uygulaması için uygunluğunu değerlendir.
Sadece JSON dön:
{
  "allow": true,
  "category": "medical_related|medication_related|non_medical|explicit_nudity|sexual_content|violence|other",
  "reason": "kısa gerekçe"
}
Kurallar:
- Cinsel içerik, çıplaklık, cinsel organ, pornografi => allow false.
- Sağlıkla alakasız içerik (telefon, manzara, rastgele obje, oyun ekranı vb) => allow false.
- Şiddet/grafik içerik => allow false.
- Yalnızca sağlıkla ilgili vücut belirtisi, yara/deri semptomu veya ilaç kutusu/tablet/blister gibi içeriklerde allow true dönebilirsin.
- Emin değilsen allow false döndür.`;

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Helper: Convert File to Generative Part
function fileToGenerativePart(filePath, mimeType) {
    return {
        inlineData: {
            data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
            mimeType
        },
    };
}

async function moderateUploadedImage(filePath, mimeType, contextLabel) {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
        const err = new Error('Sadece JPG, PNG veya WEBP formatında görsel yükleyebilirsiniz.');
        err.status = 400;
        throw err;
    }

    const imagePart = fileToGenerativePart(filePath, mimeType);
    const guardPrompt = `${IMAGE_GUARD_PROMPT}\nBağlam: ${contextLabel}`;
    const guardResult = await safeGenerateVision(guardPrompt, imagePart);
    const guardData = parseGeminiResponse(guardResult.response.text());
    const allow = guardData && guardData.allow === true;

    if (!allow) {
        const err = new Error(
            'Yüklenen görsel sağlık analizi için uygun değil. Lütfen yalnızca belirti/ilaç görseli yükleyin.'
        );
        err.status = 422;
        err.code = 'IMAGE_POLICY_REJECTED';
        err.category = guardData && guardData.category ? guardData.category : 'other';
        throw err;
    }
}

// Helper: Safe JSON parse
function parseGeminiResponse(responseText) {
    try {
        return JSON.parse(responseText);
    } catch (e1) {
        const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
            try { return JSON.parse(codeBlockMatch[1]); } catch (e2) {}
        }
        const braceMatch = responseText.match(/\{[\s\S]*\}/);
        if (braceMatch) {
            try { return JSON.parse(braceMatch[0]); } catch (e3) {}
        }
        throw new Error(`Yapay zeka yanıtı parse edilemedi.`);
    }
}

/** Gemini Flash — yalnızca bu çağrı; hata olursa dışarıda Groq ile birlikte değerlendirilir (çift Groq önlenir). */
async function tryGeminiFlashOnly(promptParts) {
    const model = genAI.getGenerativeModel({ model: FLASH_MODEL });
    const content = Array.isArray(promptParts)
        ? promptParts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join('\n')
        : String(promptParts || '');
    const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: content + '\n\nKRİTİK TALİMAT: Yanıtını mutlaka JSON formatında ver.' }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    });
    return parseGeminiResponse(result.response.text());
}

async function tryGroqMedicalJson(promptParts) {
    const result = await safeGenerateGroq(promptParts);
    return parseGeminiResponse(result.response.text());
}

function riskRankTeshisSeviyesi(r) {
    const s = String(r || '').toLowerCase();
    if (s.includes('kritik')) return 4;
    if (s.includes('yüksek') || s.includes('yuksek')) return 3;
    if (s.includes('orta')) return 2;
    return 1;
}

function maxRiskSeviyesi(a, b) {
    return riskRankTeshisSeviyesi(a) >= riskRankTeshisSeviyesi(b) ? (a || b || 'Orta') : (b || a || 'Orta');
}

function riskRankDoktora(sev) {
    const s = String(sev || '').toLowerCase();
    if (s.includes('acil')) return 3;
    if (s.includes('orta')) return 2;
    if (s.includes('düşük') || s.includes('dusuk')) return 1;
    return 2;
}

function pickDoktoraGitme(dg, df) {
    const g = dg && typeof dg === 'object' ? dg : {};
    const f = df && typeof df === 'object' ? df : {};
    const sevG = String(g.seviye || g.aciliyet || '');
    const sevF = String(f.seviye || f.aciliyet || '');
    const pick = riskRankDoktora(sevF) >= riskRankDoktora(sevG) ? f : g;
    const seviye = String(pick.seviye || pick.aciliyet || 'Orta');
    const not = String(pick.not || pick.aciklama || 'Lütfen takipte kalın.');
    if (!sevG && !sevF && !pick.not && !pick.aciklama) {
        return { seviye: 'Orta', not: 'Lütfen takipte kalın.' };
    }
    return { seviye, not };
}

function uniqStringLists(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const x of list) {
            const t = String(x || '').trim();
            if (!t) continue;
            const k = t.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(t);
        }
    }
    return out;
}

/** Flash + Groq soru listelerini tekrarsız birleştirir (en fazla 3). */
function mergeSorularLists(flashList, groqList) {
    const A = Array.isArray(flashList) ? flashList : [];
    const B = Array.isArray(groqList) ? groqList : [];
    const out = [];
    const seen = new Set();
    const keyOf = (q) => String(q?.q || q?.soru || '').trim().toLowerCase();
    for (const q of [...A, ...B]) {
        const k = keyOf(q);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(q);
        if (out.length >= 3) break;
    }
    return out;
}

async function runSymptomAnalysis(context, symptomTextForNormalize) {
    const promptParts = [MEDICAL_PROMPT, `Belirtiler:\n${context}`];
    
    let raw;
    let analysis_meta;
    
    try {
        console.log('[ANALİZ] Gemini Flash katmanlı analiz başlıyor...');
        const result = await smartGenerate(promptParts);
        raw = parseGeminiResponse(result.response.text());
        analysis_meta = { models: [result._source], status: 'success' };
    } catch (error) {
        console.error('Analiz katmanları tamamen başarısız:', error);
        throw error;
    }

    return {
        result: normalizeMedicalAnalysisResult(raw, symptomTextForNormalize),
        analysis_meta
    };
}

function sanitizeInput(input, maxLen = 500) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

function buildDefaultDiagnoses(symptomText = '') {
    const s = String(symptomText || '').toLowerCase();
    const pool = [];
    if (s.includes('boğaz') || s.includes('bogaz') || s.includes('öksür') || s.includes('oksur')) {
        pool.push(
            { hastalik: 'Viral üst solunum yolu enfeksiyonu', olasilik: '%62', durum: 'Orta', neden: 'Boğaz ağrısı ve solunum yakınmaları birlikte görülüyor.' },
            { hastalik: 'Akut farenjit', olasilik: '%48', durum: 'Orta', neden: 'Boğazda tahriş ve yutkunma yakınması farenjiti düşündürür.' }
        );
    }
    if (s.includes('ateş') || s.includes('ates') || s.includes('titreme')) {
        pool.push(
            { hastalik: 'Viral enfeksiyon', olasilik: '%58', durum: 'Orta', neden: 'Ateş, vücudun enfeksiyona verdiği sistemik yanıt olabilir.' },
            { hastalik: 'Bakteriyel enfeksiyon', olasilik: '%31', durum: 'Orta', neden: 'Yüksek ateş ve kötüleşen tablo bakteriyel etiyolojiyi düşündürebilir.' }
        );
    }
    if (s.includes('karın') || s.includes('karin') || s.includes('ishal') || s.includes('kusma')) {
        pool.push(
            { hastalik: 'Akut gastroenterit', olasilik: '%57', durum: 'Orta', neden: 'Bulantı, kusma veya ishal ile birlikte karın şikayetleri uyumlu.' },
            { hastalik: 'Gıda kaynaklı enfeksiyon', olasilik: '%37', durum: 'Orta', neden: 'Ani başlayan gastrointestinal yakınmalar gıda kaynaklı olabilir.' }
        );
    }
    pool.push(
        { hastalik: 'Mevsimsel enfeksiyon / irritasyon', olasilik: '%25', durum: 'Düşük', neden: 'Belirti paterni hafif-orta enfeksiyöz veya irritatif tabloyla uyumlu olabilir.' },
        { hastalik: 'Klinik değerlendirme gerektiren non-spesifik tablo', olasilik: '%18', durum: 'Düşük', neden: 'Belirtiler kesin tanı için fizik muayene ve tetkik gerektirir.' }
    );
    return pool.slice(0, 6).map((d) => ({ ...d, topluluk_verisi: 'Veri sınırlı, klinik değerlendirme ile netleştirilir.' }));
}

function normalizeOptionList(list, fallback) {
    const clean = Array.isArray(list) ? list.map((x) => String(x || '').trim()).filter(Boolean) : [];
    return clean.length ? clean : fallback;
}

function normalizeMedicalAnalysisResult(raw, symptomText = '') {
    const result = raw && typeof raw === 'object' ? raw : {};
    
    // Yeni basit yapıdan gelenleri eski yapıya map edelim (Uyumluluk için)
    const asistanMesaji = result.asistan_notu || result.asistan_mesaji || result.genel_bilgi || "Analiziniz hazır.";
    
    const diagnosesRaw = Array.isArray(result.teshisler) ? result.teshisler : 
                        (Array.isArray(result.olasi_teshisler) ? result.olasi_teshisler : []);

    let diagnoses = diagnosesRaw
        .map((d) => ({
            hastalik: String(d?.ad || d?.hastalik || d?.name || '').trim(),
            olasilik: String(d?.oran || d?.olasilik || '').trim() || '%35',
            durum: String(d?.durum || 'Orta').trim(),
            neden: String(d?.neden || d?.aciklama || '').trim() || 'Belirtileriniz bu olasılığı destekliyor.'
        }))
        .filter((d) => d.hastalik);

    if (diagnoses.length < 3) {
        const extra = buildDefaultDiagnoses(symptomText);
        diagnoses = [...diagnoses, ...extra].slice(0, 5);
    }

    const cikarimlar = normalizeOptionList(result.cikarimlar, [
        'Belirtileriniz klinik tablo ile uyum gösteriyor.',
        'Sıvı alımı ve dinlenme şu an için kritik öneme sahip.',
        'Belirtilerin seyri 24 saat boyunca izlenmelidir.'
    ]);

    const explicitEmptySorular =
        result.soru_fazı_bitti === true &&
        Array.isArray(result.sorular) &&
        result.sorular.length === 0;
    const rawQuestionsSource = result.sorular !== undefined ? result.sorular : result.takip_sorulari;

    let normalizedQuestions = [];
    if (explicitEmptySorular) {
        normalizedQuestions = [];
    } else if (Array.isArray(rawQuestionsSource)) {
        normalizedQuestions = rawQuestionsSource
            .map((q) => {
                const soru = String(q?.q || q?.soru || '').trim();
                let secenekler = normalizeOptionList(q?.opts || q?.secenekler, [])
                    .map((s) => String(s || '').trim().slice(0, 120))
                    .filter(Boolean);
                secenekler = [...new Set(secenekler.map((s) => s))].slice(0, 4);
                if (secenekler.length === 2) {
                    const pad = 'Kararsızım / net söylemek zor';
                    if (!secenekler.some((o) => o.toLowerCase().includes('kararsız'))) secenekler.push(pad);
                }
                if (!soru || secenekler.length < 2) return null;
                return { soru, secenekler, q: soru, opts: secenekler };
            })
            .filter(Boolean)
            .slice(0, 3);
    }

    const defaultMcq = [
        {
            soru: 'Şikayetleriniz yaklaşık ne zamandır devam ediyor?',
            secenekler: ['Bugün başladı', '1–2 gündür', '3–7 gündür', 'Daha uzun süredir'],
            q: 'Şikayetleriniz yaklaşık ne zamandır devam ediyor?',
            opts: ['Bugün başladı', '1–2 gündür', '3–7 gündür', 'Daha uzun süredir']
        }
    ];
    if (!normalizedQuestions.length && !explicitEmptySorular) {
        normalizedQuestions = defaultMcq;
    }

    return {
        asistan_mesaji: asistanMesaji,
        asistan_notu: asistanMesaji,
        analiz: {
            risk_seviyesi: String(result.risk_seviyesi || result?.doktora_gitme?.seviye || 'Orta'),
            teshisler: diagnoses
        },
        cikarimlar,
        yapilmasi_gerekenler: normalizeOptionList(result.yapilmasi_gerekenler, ['Dinlenin', 'Bol sıvı tüketin']),
        kacinilmasi_gerekenler: normalizeOptionList(result.kacinilmasi_gerekenler, ['Aşırı efor', 'Rastgele ilaç kullanımı']),
        doktora_gitme: {
            aciliyet: String(result?.doktora_gitme?.seviye || result?.doktora_gitme?.aciliyet || 'Orta'),
            aciklama: String(result?.doktora_gitme?.not || result?.doktora_gitme?.aciklama || 'Lütfen takipte kalın.')
        },
        sorular: normalizedQuestions,
        takip_sorulari: normalizedQuestions
    };
}

// ===== API ROUTELERI =====
app.post('/api/analyze-symptoms', requireKvkkConsent, async (req, res) => {
    try {
        const { symptoms, history } = req.body;
        let context = Array.isArray(history) && history.length > 0 
            ? `Geçmiş Bilgiler:\n${history.map(h => `- ${h}`).join('\n')}\nYeni Belirti: ${symptoms}`
            : symptoms;
            
        // Cross-Module Intelligence: Profil ve Tahlil Ekleme
        if (req.user && db) {
            try {
                let ekBilgiler = [];
                const profileDoc = await db.collection('users').doc(req.user.uid).get();
                if (profileDoc.exists && profileDoc.data().profile) {
                    const p = profileDoc.data().profile;
                    ekBilgiler.push(`[SAĞLIK PROFİLİ: Yaş ${p.yas || 'Bilinmiyor'}, Cinsiyet ${p.cinsiyet || 'Bilinmiyor'}, Kilo ${p.kilo_kg || 'Bilinmiyor'}kg, Boy ${p.boy_cm || 'Bilinmiyor'}cm, Kronik: ${p.kronik || 'Yok'}, İlaçlar: ${p.ilaclar || 'Yok'}, Alerjiler: ${p.alerjiler || 'Yok'}]`);
                }
                const labsSnapshot = await db.collection('users').doc(req.user.uid).collection('labs').orderBy('timestamp', 'desc').limit(1).get();
                if (!labsSnapshot.empty) {
                    const lastLab = labsSnapshot.docs[0].data().result;
                    if (lastLab && lastLab.ozet) {
                        ekBilgiler.push(`[SON TAHLİL ÖZETİ: ${lastLab.ozet} | Anormal Değerler: ${(lastLab.anormal_degerler_ozet || []).join(', ')}]`);
                    }
                }
                if (ekBilgiler.length > 0) {
                    context = ekBilgiler.join('\n') + '\n\n' + context;
                }
            } catch (err) {
                console.error("Ek bağlam çekilemedi:", err);
            }
        }

        console.log(`\n🔍 Analiz Talebi: ${context}`);

        const { result: normalized, analysis_meta } = await runSymptomAnalysis(context, symptoms);
        res.json({ success: true, result: normalized, analysis_meta });
    } catch (error) {
        console.error('Analiz Hatası:', error);
        res.status(500).json({ error: error.message || 'Analiz gerçekleştirilemedi.' });
    }
});

app.post('/api/analyze-image', requireKvkkConsent, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Görüntü yok' });
        const { symptoms } = req.body;
        try {
            await moderateUploadedImage(req.file.path, req.file.mimetype, 'symptom_analysis');
        } catch (policyError) {
            const hasSymptoms = typeof symptoms === 'string' && symptoms.trim().length > 0;
            if (policyError.code === 'IMAGE_POLICY_REJECTED' && hasSymptoms) {
                const { result: fallbackData, analysis_meta } = await runSymptomAnalysis(symptoms, symptoms);
                fs.unlinkSync(req.file.path);
                return res.json({
                    success: true,
                    result: fallbackData,
                    analysis_meta,
                    fallback_mode: 'text',
                    warning: 'Yüklenen görsel sağlık analizi için uygun bulunmadı. Analiz belirtiler metni üzerinden devam etti.'
                });
            }
            throw policyError;
        }
        const imagePart = {
            inlineData: {
                data: fs.readFileSync(req.file.path).toString("base64"),
                mimeType: req.file.mimetype
            }
        };
        const promptText = MEDICAL_PROMPT + (symptoms ? `\nKullanıcı belirtileri: ${symptoms}` : "\nBelirtiler metni verilmedi.");
        const result = await safeGenerateVision(promptText, imagePart);
        
        fs.unlinkSync(req.file.path);
        const data = normalizeMedicalAnalysisResult(parseGeminiResponse(result.response.text()), symptoms);
        res.json({ success: true, result: data });
    } catch (error) {
        if (req.file) fs.unlinkSync(req.file.path);
        const status = error.status || 500;
        res.status(status).json({
            error: status === 429 ? 'Sistem yoğun' : (error.message || 'Görsel analiz hatası'),
            code: error.code || undefined,
            category: error.category || undefined
        });
    }
});

app.post('/api/disease-info', async (req, res) => {
    try {
        const disease = sanitizeInput(req.body?.disease, 200);
        if (!disease) return res.status(400).json({ error: 'Hastalık adı gerekli.' });
        const result = await safeGenerateFlash([DISEASE_INFO_PROMPT, `Hastalık: ${disease}`]);
        const data = parseGeminiResponse(result.response.text());
        res.json({ success: true, result: data });
    } catch (error) {
        console.error('Hastalık Bilgi Hatası:', error);
        const status = error.status || 500;
        res.status(status).json({ error: status === 429 ? 'Sistem yoğun' : (error.message || 'Hata oluştu') });
    }
});

app.post('/api/deep-dive', async (req, res) => {
    try {
        const disease = sanitizeInput(req.body?.disease, 200);
        if (!disease) return res.status(400).json({ error: 'Hastalık adı gerekli.' });
        const result = await safeGeneratePro([DEEP_DIVE_PROMPT, `Hastalık Teknik Detay: ${disease}`]);
        const data = parseGeminiResponse(result.response.text());
        res.json({ success: true, result: data });
    } catch (error) {
        console.error('Deep Dive Hatası:', error);
        const status = error.status || 500;
        res.status(status).json({ error: status === 429 ? 'Sistem yoğun' : (error.message || 'Hata oluştu') });
    }
});

app.post('/api/analyze-medication', async (req, res) => {
    try {
        const medication = sanitizeInput(req.body?.medication, 200);
        if (!medication) return res.status(400).json({ error: 'İlaç adı gerekli.' });
        const result = await safeGenerateFlash([MEDICATION_PROMPT, `İlaç: ${medication}`]);
        const data = parseGeminiResponse(result.response.text());
        res.json({ success: true, result: data });
    } catch (error) {
        console.error('İlaç Analiz Hatası:', error);
        res.status(error.status || 500).json({ 
            error: error.status === 429 ? 'Groq Limitine Takıldı (429). Lütfen biraz bekleyin.' : (error.message || 'İlaç analizi yapılamadı.') 
        });
    }
});

app.post('/api/doctor-report', async (req, res) => {
    try {
        const { analysis } = req.body;
        const result = await safeGeneratePro([DOCTOR_REPORT_PROMPT, `Analiz Verisi: ${JSON.stringify(analysis)}`]);
        const data = parseGeminiResponse(result.response.text());
        res.json({ success: true, result: data });
    } catch (error) {
        console.error('Rapor Hatası:', error);
        res.status(error.status || 500).json({ 
            error: error.status === 429 ? 'Sistem yoğun. Lütfen biraz bekleyin.' : (error.message || 'Rapor oluşturulamadı.') 
        });
    }
});

app.post('/api/analyze-medication-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Görüntü yok' });

        try {
            await moderateUploadedImage(req.file.path, req.file.mimetype, 'medication_analysis');
        } catch (policyError) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            const status = policyError.status || 422;
            return res.status(status).json({
                error: policyError.message || 'Yüklenen görsel ilaç analizi için uygun değil.',
                code: policyError.code || undefined,
                category: policyError.category || undefined
            });
        }

        const imagePart = {
            inlineData: {
                data: fs.readFileSync(req.file.path).toString("base64"),
                mimeType: req.file.mimetype
            }
        };

        const result = await safeGenerateVision(MEDICATION_PROMPT, imagePart); 
        fs.unlinkSync(req.file.path);
        
        const data = parseGeminiResponse(result.response.text());
        res.json({ success: true, result: data });
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('Görsel İlaç Analiz Hatası:', error);
        res.status(error.status || 500).json({ error: 'Görsel analiz hatası: ' + (error.message || 'Bilinmiyor') });
    }
});

app.post('/api/natural-remedies', async (req, res) => {
    try {
        const symptoms = sanitizeInput(req.body?.symptoms, 500);
        if (!symptoms) return res.status(400).json({ error: 'Belirtiler gerekli.' });
        const result = await safeGenerateFlash([NATURAL_REMEDY_PROMPT, `Belirtiler:\n${symptoms}`]);
        const data = parseGeminiResponse(result.response.text());
        res.json({ success: true, result: data });
    } catch (error) {
        console.error('Doğal Çözüm Hatası:', error);
        const status = error.status || 500;
        res.status(status).json({
            error: status === 429 ? 'Sistem yoğun' : (error.message || 'Arama başarısız.')
        });
    }
});

app.post('/api/follow-up', requireKvkkConsent, async (req, res) => {
    try {
        const { originalSymptoms, previousResult, followUpAnswer, history } = req.body;
        
        // Building cumulative context
        const contextList = Array.isArray(history) ? [...history, followUpAnswer] : [originalSymptoms, followUpAnswer];
        const contextString = contextList.join(' | ');

        const prevTeshis = previousResult?.analiz?.teshisler || previousResult?.olasi_teshisler || previousResult?.teshisler || [];
        const contextPrompt = `${FOLLOW_UP_PROMPT}\n\nTÜM GEÇMİŞ BİLGİLER: ${contextString}\nÖnceki teşhisler: ${JSON.stringify(prevTeshis)}`;
        
        console.log('[FOLLOW-UP] smartGenerate yarışı başlıyor...');
        const result = await smartGenerate([contextPrompt]);
        const raw = parseGeminiResponse(result.response.text());
        const normalized = normalizeMedicalAnalysisResult(raw, sanitizeInput(String(originalSymptoms || ''), 500));

        res.json({ success: true, result: normalized });
    } catch (error) {
        console.error('Takip Sorusu Hatası:', error);
        const status = error.status || 500;
        res.status(status).json({ error: status === 429 ? 'Sistem yoğun' : (error.message || 'Hata oluştu') });
    }
});

app.post('/api/chat-followup', requireKvkkConsent, async (req, res) => {
    try {
        const { history, message, analysisContext } = req.body;
        const safeHistory = Array.isArray(history) ? history : [];
        const compactContext = analysisContext
            ? JSON.stringify({
                risk: analysisContext?.analiz?.risk_seviyesi || analysisContext?.doktora_gitme?.aciliyet || null,
                olasi_teshisler: analysisContext?.analiz?.teshisler || analysisContext?.olasi_teshisler || [],
                acil_onlemler: analysisContext?.acil_onlemler || []
            })
            : 'Yok';
        
        let contextPrompt = `Sen dünyaca ünlü bir klinik başhekimisin. Kullanıcı sana takip sorularının yanıtını veya yeni şikayetini iletti.

KRİTİK KURALLAR:
1. ÜÇÜNCÜ ŞAHIS YASAĞI: ASLA "Hastanın", "Hasta belirtmiş" gibi rapor dili kullanma. Doğrudan "Anlıyorum, başınız ağrıyormuş" gibi konuş.
2. DERİN YORUMLAMA (ÇOK ÖNEMLİ): Kullanıcının verdiği yeni bilgileri ASLA kısaca geçiştirme. "Bilgiler için teşekkürler" deyip bırakma. Bu yeni bilgilerin anatomik/fizyolojik olarak tabloyu nasıl değiştirdiğini, hangi hastalık ihtimallerini elediğini veya güçlendirdiğini UZUN UZUN anlat.
3. HAFIZA: Geçmiş konuşma loglarını oku, aynı soruyu tekrar sorma.
4. KAPANIŞ VE DİNAMİK AKIŞ: Eğer kullanıcının durumu yeterince netleştiyse yeni soru sorma ("karsi_sorular" dizisini boş [] dön) ve süreci tavsiyelerle bitir. Ancak tablo karışıksa teşhisi daraltmak için en fazla 1-2 yeni soru sor.

JSON formatında dön:
{
  "_zihin_haritasi": "Önce burada kendi kendine düşün. Yeni bilgilerle tablo nasıl değişti? Hangi ihtimaller elendi? Ne sormalıyım? (İstediğin kadar uzun yazabilirsin, bu senin iç sesin).",
  "cevap": "Kullanıcının yeni mesajını detaylıca (en az 4-5 cümle) yorumlayan, fizyolojik bağlantıları anlatan, çok kapsamlı ve güven verici ANA METİN. ASLA kısa cevap verme.",
  "karsi_sorular": [
    {
      "soru": "Gerekirse soracağın teşhis daraltıcı soru",
      "secenekler": ["Evet", "Hayır", "Bazen"]
    }
  ]
}

--- Son Analiz Bağlamı ---
${compactContext}

--- Geçmiş Konuşma ---
${safeHistory.map(msg => `[${msg.sender === 'user' ? 'Kullanıcı' : 'Asistan'}]: ${msg.text}`).join('\n')}

--- Yeni Mesaj ---
[Kullanıcı]: ${message}`;

        console.log("[CHAT-FOLLOWUP] smartGenerate yarışı başlıyor (Groq vs Flash)...");
        const result = await smartGenerate([contextPrompt]);
        console.log(`[CHAT-FOLLOWUP] Yanıt geldi! Kaynak: ${result._source || 'bilinmiyor'}`);
        const data = parseGeminiResponse(result.response.text());
        console.log("[CHAT-FOLLOWUP] Parse başarılı.");
        const responseText = data.cevap || data.response || result.response.text();
        
        let questionsToReturn = Array.isArray(data.karsi_sorular) ? data.karsi_sorular : [];

        res.json({
            success: true,
            response: responseText,
            mini_analiz: [],
            karsi_sorular: questionsToReturn,
            moral_mesaji: null
        });
    } catch (error) {
        console.error("Chat API Error:", error);
        const status = error.status || 500;
        res.status(status).json({ error: status === 429 ? 'Sistem yoğun' : 'Hata oluştu' });
    }
});

app.get('/api/status', async (req, res) => {
    const hasKey = !!process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.includes('GELEN_ANAHTAR');
    const hasGemini = !!process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('API_KEY_BEKLENIYOR');
    res.json({
        gemini: hasGemini,
        mode: GROQ_TEXT_MODEL,
        flash: FLASH_MODEL,
        pro: PRO_MODEL,
        status: hasKey ? `Aktif (${GROQ_TEXT_MODEL})` : "GROQ API Anahtarı Eksik",
        gemini_status: hasGemini ? 'Aktif' : 'API Anahtarı Eksik'
    });
});

// ===== KVKK CONSENT ENDPOINTS =====
app.get('/api/consent/kvkk/status', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Bu işlem için giriş yapmalısınız.' });
    try {
        const consent = await getKvkkConsent(req.user.uid);
        res.json({ success: true, ...consent });
    } catch (error) {
        console.error('KVKK durum okuma hatası:', error);
        res.status(500).json({ error: 'KVKK onay durumu alınamadı.' });
    }
});

app.post('/api/consent/kvkk', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Bu işlem için giriş yapmalısınız.' });
    try {
        const requestedVersion = req.body?.version;
        const version = typeof requestedVersion === 'string' && requestedVersion.trim()
            ? requestedVersion.trim()
            : KVKK_CONSENT_VERSION;

        const consentRef = db.collection('users').doc(req.user.uid).collection('consents').doc('kvkk');
        await consentRef.set({
            accepted: true,
            version,
            acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        res.json({ success: true, accepted: true, version });
    } catch (error) {
        console.error('KVKK onay kayıt hatası:', error);
        res.status(500).json({ error: 'KVKK onayı kaydedilemedi.' });
    }
});

// ===== YENİ: FIRESTORE HISTORY ENDPOINTS =====

// Get History
app.get('/api/history', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Bu işlem için giriş yapmalısınız.' });
    try {
        const snapshot = await db.collection('users').doc(req.user.uid).collection('history').orderBy('timestamp', 'desc').limit(20).get();
        const history = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            history.push({ id: doc.id, date: data.date, symptoms: data.symptoms, result: data.result });
        });
        res.json({ success: true, history });
    } catch (error) {
        console.error('Firebase DB Hatası (GET):', error);
        res.status(500).json({ error: 'Geçmiş alınamadı.' });
    }
});

// Save to History
app.post('/api/history', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Bu işlem için giriş yapmalısınız.' });
    try {
        const { symptoms, result } = req.body;
        const newRecord = {
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            date: new Date().toLocaleString('tr-TR'),
            symptoms: symptoms.substring(0, 100) + (symptoms.length > 100 ? '...' : ''),
            result: result
        };
        const docRef = await db.collection('users').doc(req.user.uid).collection('history').add(newRecord);
        res.json({ success: true, id: docRef.id, newRecord });
    } catch (error) {
        console.error('Firebase DB Hatası (POST):', error);
        res.status(500).json({ error: 'Geçmiş kaydedilemedi.' });
    }
});

// Delete all user history for account deletion flows
app.delete('/api/history/all', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Bu işlem için giriş yapmalısınız.' });
    try {
        const historyRef = db.collection('users').doc(req.user.uid).collection('history');
        const snapshot = await historyRef.get();
        const batch = db.batch();
        snapshot.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        res.json({ success: true, deleted: snapshot.size });
    } catch (error) {
        console.error('Firebase DB Hatası (DELETE ALL):', error);
        res.status(500).json({ error: 'Tüm geçmiş silinemedi.' });
    }
});

// Delete from History
app.delete('/api/history/:id', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Bu işlem için giriş yapmalısınız.' });
    try {
        await db.collection('users').doc(req.user.uid).collection('history').doc(req.params.id).delete();
        res.json({ success: true });
    } catch (error) {
        console.error('Firebase DB Hatası (DELETE):', error);
        res.status(500).json({ error: 'Kayıt silinemedi.' });
    }
});

// ===== YENİ ÖZELLİKLER: 5 PREMIUM MODÜL =====

// --- 1. TAHLİL SONUCU OKUYUCU ---
const LAB_RESULT_PROMPT = `Sen kıdemli bir dahiliye uzmanısın. Kullanıcının verdiği laboratuvar tahlil sonuçlarını analiz et.

Yanıtını mutlaka json formatında ver:
{
    "ozet": "Genel sağlık durumu özeti (2-3 cümle)",
    "saglik_skoru": 85,
    "degerler": [
        {
            "isim": "Değer adı (Örn: Hemoglobin)",
            "sonuc": "13.5",
            "birim": "g/dL",
            "referans": "12-16",
            "durum": "normal|dusuk|yuksek|kritik",
            "aciklama": "Bu değerin ne anlama geldiği"
        }
    ],
    "anormal_degerler_ozet": ["Anormal değer açıklaması"],
    "onerilen_uzmanlik": ["Hangi doktora gitmeli"],
    "genel_tavsiyeler": ["Beslenme/yaşam tarzı önerileri"],
    "acil_uyari": null
}

KRİTİK: Türkçe yaz. Tıbbi terimleri kullan ama halk dilinde de açıkla.`;

app.post('/api/analyze-lab-results', requireKvkkConsent, async (req, res) => {
    try {
        const labText = sanitizeInput(req.body?.labText, 3000);
        if (!labText) return res.status(400).json({ error: 'Tahlil sonuçları gerekli.' });
        const result = await safeGenerateFlash([LAB_RESULT_PROMPT, `Tahlil Sonuçları:\n${labText}`]);
        const data = parseGeminiResponse(result.response.text());
        
        if (req.user && db) {
            try {
                await db.collection('users').doc(req.user.uid).collection('labs').add({
                    labText,
                    result: data,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (dbErr) {
                console.error("Tahlil kaydetme hatası:", dbErr);
            }
        }
        
        res.json({ success: true, result: data });
    } catch (error) {
        console.error('Tahlil Analiz Hatası:', error);
        res.status(error.status || 500).json({ error: error.message || 'Tahlil analizi yapılamadı.' });
    }
});

app.post('/api/analyze-lab-image', requireKvkkConsent, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Görüntü yok' });
        await moderateUploadedImage(req.file.path, req.file.mimetype, 'lab_result');
        const imagePart = fileToGenerativePart(req.file.path, req.file.mimetype);
        const result = await safeGenerateVision(
            LAB_RESULT_PROMPT + '\nGörseldeki tahlil sonuçlarını oku ve analiz et.',
            imagePart
        );
        fs.unlinkSync(req.file.path);
        const data = parseGeminiResponse(result.response.text());
        
        if (req.user && db) {
            try {
                await db.collection('users').doc(req.user.uid).collection('labs').add({
                    result: data,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (dbErr) {
                console.error("Görsel tahlil kaydetme hatası:", dbErr);
            }
        }
        
        res.json({ success: true, result: data });
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('Tahlil Görsel Hatası:', error);
        res.status(error.status || 500).json({ error: error.message || 'Tahlil görseli analiz edilemedi.' });
    }
});

// --- 2. KİŞİSEL SAĞLIK PROFİLİ & RİSK HARİTASI ---
const HEALTH_PROFILE_PROMPT = `Sen önleyici tıp uzmanısın. Kullanıcının sağlık profilini değerlendir ve kişisel risk haritası oluştur.

Yanıtını mutlaka json formatında ver:
{
    "genel_skor": 78,
    "bmi": { "deger": 24.5, "kategori": "Normal", "yorum": "..." },
    "risk_haritasi": [
        { "alan": "Kardiyovasküler", "risk": "dusuk|orta|yuksek", "puan": 25, "faktorler": ["Faktör 1"], "oneri": "Öneri" },
        { "alan": "Diyabet", "risk": "dusuk|orta|yuksek", "puan": 40, "faktorler": ["Faktör 1"], "oneri": "Öneri" },
        { "alan": "Kanser", "risk": "dusuk|orta|yuksek", "puan": 15, "faktorler": ["Faktör 1"], "oneri": "Öneri" },
        { "alan": "Mental Sağlık", "risk": "dusuk|orta|yuksek", "puan": 30, "faktorler": ["Faktör 1"], "oneri": "Öneri" },
        { "alan": "Solunum", "risk": "dusuk|orta|yuksek", "puan": 20, "faktorler": ["Faktör 1"], "oneri": "Öneri" }
    ],
    "gunluk_ihtiyaclar": { "kalori": 2000, "su_litre": 2.5 },
    "periyodik_kontroller": ["6 ayda bir kan tahlili", "Yılda bir göz kontrolü"],
    "kisisel_tavsiyeler": ["Tavsiye 1", "Tavsiye 2"]
}

KRİTİK: Yaş, cinsiyet, kilo, boy, aile geçmişi, sigara/alkol gibi faktörleri dikkate al.`;

app.post('/api/health-profile', requireKvkkConsent, async (req, res) => {
    try {
        const profile = req.body?.profile;
        if (!profile) return res.status(400).json({ error: 'Profil bilgileri gerekli.' });
        const profileText = typeof profile === 'string' ? profile : JSON.stringify(profile);
        const result = await safeGenerateFlash([HEALTH_PROFILE_PROMPT, `Kullanıcı Profili:\n${profileText}`]);
        const data = parseGeminiResponse(result.response.text());
        
        if (req.user && db) {
            try {
                await db.collection('users').doc(req.user.uid).set({ profile: typeof profile === 'string' ? JSON.parse(profile) : profile }, { merge: true });
            } catch (dbErr) {
                console.error("Profil kaydetme hatası:", dbErr);
            }
        }
        
        res.json({ success: true, result: data });
    } catch (error) {
        console.error('Profil Analiz Hatası:', error);
        res.status(error.status || 500).json({ error: error.message || 'Profil analizi yapılamadı.' });
    }
});

// --- 3. İLAÇ ETKİLEŞİM KONTROLCÜSÜ ---
const DRUG_INTERACTION_PROMPT = `Sen klinik farmakoloji uzmanısın. Verilen ilaçların birbirleriyle ve besinlerle etkileşimlerini analiz et.

Yanıtını mutlaka json formatında ver:
{
    "ilaclar": [
        { "ad": "İlaç adı", "etken_madde": "..." }
    ],
    "etkilesimler": [
        {
            "ilac1": "İlaç A",
            "ilac2": "İlaç B",
            "ciddiyet": "dusuk|orta|yuksek|tehlikeli",
            "aciklama": "Etkileşim açıklaması",
            "oneri": "Ne yapılmalı"
        }
    ],
    "besin_etkilesimleri": [
        { "ilac": "İlaç adı", "besin": "Besin adı", "etki": "Açıklama" }
    ],
    "alkol_uyumu": [
        { "ilac": "İlaç adı", "risk": "yok|dusuk|yuksek|tehlikeli", "aciklama": "..." }
    ],
    "zaman_cizelgesi": [
        { "ilac": "İlaç adı", "zaman": "Sabah tok karnına", "not": "..." }
    ],
    "genel_uyari": "Özet uyarı mesajı"
}

KRİTİK: Hayati tehlike varsa açıkça belirt. Türkçe yaz.`;

app.post('/api/drug-interactions', async (req, res) => {
    try {
        const medications = req.body?.medications;
        if (!medications || !Array.isArray(medications) || medications.length < 1) {
            return res.status(400).json({ error: 'En az 1 ilaç girmelisiniz.' });
        }
        const medList = medications.map(m => sanitizeInput(m, 100)).filter(Boolean).slice(0, 10);
        const result = await safeGenerateFlash([DRUG_INTERACTION_PROMPT, `İlaçlar: ${medList.join(', ')}`]);
        const data = parseGeminiResponse(result.response.text());
        res.json({ success: true, result: data });
    } catch (error) {
        console.error('Etkileşim Hatası:', error);
        res.status(error.status || 500).json({ error: error.message || 'Etkileşim analizi yapılamadı.' });
    }
});

// --- 4. BELİRTİ TAKİP GRAFİĞİ (Symptom Tracker) ---
const SYMPTOM_TREND_PROMPT = `Sen klinik epidemiyoloji uzmanısın. Kullanıcının belirli bir süredeki belirti kayıtlarını analiz edip trend ve pattern tespiti yap.

Yanıtını mutlaka json formatında ver:
{
    "genel_trend": "iyilesme|stabil|kotulesme",
    "trend_aciklama": "Belirtileriniz son 1 haftada...",
    "pattern_tespitleri": ["Stresli günlerde belirtiler artıyor", "Hafta sonları iyileşme var"],
    "tetikleyiciler": ["Stres", "Yetersiz uyku"],
    "risk_degerlendirmesi": "dusuk|orta|yuksek",
    "doktora_git_mi": { "gerekli": true, "neden": "...", "hangi_bolum": "..." },
    "tavsiyeler": ["Tavsiye 1"],
    "doktor_raporu_ozet": "Doktora gösterilecek 2-3 cümlelik özet"
}`;

app.post('/api/symptom-trend', requireKvkkConsent, async (req, res) => {
    try {
        const entries = req.body?.entries;
        if (!entries || !Array.isArray(entries) || entries.length < 2) {
            return res.status(400).json({ error: 'Trend analizi için en az 2 kayıt gerekli.' });
        }
        const safeEntries = entries.slice(0, 30).map(e => ({
            tarih: sanitizeInput(e.tarih, 30),
            belirti: sanitizeInput(e.belirti, 100),
            siddet: Math.min(Math.max(parseInt(e.siddet) || 5, 1), 10),
            not: sanitizeInput(e.not || '', 200)
        }));
        const result = await safeGenerateFlash([SYMPTOM_TREND_PROMPT, `Belirti Kayıtları:\n${JSON.stringify(safeEntries)}`]);
        const data = parseGeminiResponse(result.response.text());
        res.json({ success: true, result: data });
    } catch (error) {
        console.error('Trend Hatası:', error);
        res.status(error.status || 500).json({ error: error.message || 'Trend analizi yapılamadı.' });
    }
});

// --- 5. MENTAL SAĞLIK MODÜLÜ ---
const MENTAL_HEALTH_PROMPT = `Sen klinik psikolog ve psikiyatristin. Kullanıcının verdiği mood ve stres bilgilerini değerlendir.

Yanıtını mutlaka json formatında ver:
{
    "genel_durum": "iyi|orta|dikkat_gerekli|acil_destek",
    "skor": 72,
    "degerlendirme": "Genel değerlendirme metni (3-4 cümle, empatik)",
    "stres_seviyesi": "dusuk|orta|yuksek",
    "anksiyete_belirtileri": ["Belirti 1"],
    "depresyon_belirtileri": ["Belirti 1"],
    "guclu_yonler": ["Güçlü yön 1"],
    "tavsiyeler": [
        { "baslik": "Nefes Egzersizi", "aciklama": "4-7-8 tekniği...", "icon": "🫁" },
        { "baslik": "Fiziksel Aktivite", "aciklama": "...", "icon": "🏃" }
    ],
    "profesyonel_destek": { "gerekli": false, "neden": "...", "uzmanlik": "..." },
    "moral_mesaji": "Motivasyon cümlesi"
}

KRİTİK: İntihar düşüncesi varsa MUTLAKA acil_destek döndür ve 182 hattını öner. Empatik ol, yargılama.`;

app.post('/api/mental-health', requireKvkkConsent, async (req, res) => {
    try {
        const assessment = req.body?.assessment;
        if (!assessment) return res.status(400).json({ error: 'Değerlendirme bilgisi gerekli.' });
        const assessText = typeof assessment === 'string' ? assessment : JSON.stringify(assessment);
        const result = await safeGenerateFlash([MENTAL_HEALTH_PROMPT, `Kullanıcı Bilgileri:\n${assessText}`]);
        const data = parseGeminiResponse(result.response.text());
        res.json({ success: true, result: data });
    } catch (error) {
        console.error('Mental Sağlık Hatası:', error);
        res.status(error.status || 500).json({ error: error.message || 'Değerlendirme yapılamadı.' });
    }
});

// --- YENİ: EKSPER GÖRÜŞÜ (GEMINI PRO YÜKSELTME) ---
const ELEVATE_PROMPT = `Sen bir 'Uzman Konseyi' veya Başhekimsindir (En Gelişmiş Tıbbi Yapay Zeka). Aşağıdaki ilk analiz (triage) sonucunda vaka riskli bulunmuştur. 
Görevlerin:
1. İhtimal dışı veya gözden kaçan spesifik, nadir komplikasyonları teşhis etmek.
2. Vakanın neden "Yüksek" veya "Kritik" risk taşıdığını hastaya uygun bir (1. şahıs - sen dili) dille açıklamak.

Yanıtını SADECE şu JSON formatında dön:
{
  "uzman_notu": "Kullanıcıya vereceğin, konsey düzeyindeki derin tıbbi analizin açıklaması. Güven verici ama ciddiyeti koruyan bir ton.",
  "kiritik_ihtimaller": ["Kritik İhtimal 1", "Kritik İhtimal 2", "Gözden kaçabilecek nadir detay 3"]
}`;

app.post('/api/elevate-to-pro', requireKvkkConsent, async (req, res) => {
    try {
        const { analysis, symptoms } = req.body;
        const result = await safeGeneratePro([ELEVATE_PROMPT, `Semptomlar: ${symptoms}\n\nİlk Analiz (Groq/Flash): ${JSON.stringify(analysis)}`]);
        const data = parseGeminiResponse(result.response.text());
        res.json({ success: true, result: data });
    } catch (error) {
        console.error('Pro Yükseltme Hatası:', error);
        res.status(error.status || 500).json({ error: error.message || 'VIP analiz yapılamadı.' });
    }
});



// Global error handlers — prevent silent crashes
process.on('uncaughtException', (err) => {
    console.error('💥 Yakalanmamış hata:', err.message);
    console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
    console.error('💥 İşlenmemiş Promise hatası:', reason);
});

app.listen(PORT, () => {
    console.log(`🚀 SağlıkAI AKTİF: http://localhost:3000`);
    console.log(`🧠 Hiyerarşi: Groq Llama 4 (Teşhis) → Gemini 2.5 Flash (Takip) → Gemini 2.5 Pro (VIP)`);
});
