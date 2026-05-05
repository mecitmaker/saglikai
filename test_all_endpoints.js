const fetch = require('node-fetch');

async function testEndpoint(name, url, body) {
    console.log(`\n⏳ Test: ${name} [${url}]...`);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            console.log(`❌ HATA (${res.status}): ${await res.text()}`);
            return;
        }
        const data = await res.json();
        console.log(`✅ BAŞARILI!`);
        // Çıktının sadece ilk 100 karakterini görelim, terminali boğmayalım
        if(data.success && data.result) {
            console.log("   -->", JSON.stringify(data.result).substring(0, 150) + "...");
        } else if(data.success && data.data) {
            console.log("   -->", JSON.stringify(data.data).substring(0, 150) + "...");
        } else {
             console.log("   -->", JSON.stringify(data).substring(0, 150) + "...");
        }
    } catch (e) {
        console.log(`❌ İSTEK HATASI: ${e.message}`);
    }
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTests() {
    console.log("==================================================");
    console.log("🚀 TÜM ÖZELLİKLER ARKA PLAN TESTİ BAŞLIYOR...");
    console.log("==================================================");

    await testEndpoint("1. Hastalık Bilgisi (Disease Info)", "http://localhost:3000/api/disease-info", { disease: 'Hipertansiyon' });
    await delay(12000); // 12 saniye bekleme (Rate Limit engeli için)

    // Deep Dive body formatı { disease, context } yerine frontend'de nasıl gönderiliyor? 
    // public/premium-features.js: body: JSON.stringify({ disease, context })
    await testEndpoint("2. Derinlemesine Analiz (Deep Dive)", "http://localhost:3000/api/deep-dive", { disease: 'Böbrek Taşı', context: 'Yan ağrısı' });
    await delay(12000);

    // Natural Remedies: body: JSON.stringify({ symptoms })
    await testEndpoint("3. Doğal Çözümler (Natural Remedies)", "http://localhost:3000/api/natural-remedies", { symptoms: 'Boğaz ağrısı ve öksürük' });
    await delay(12000);

    // Mental Health: body: JSON.stringify({ assessment: userInput })
    await testEndpoint("4. Psikolojik Destek (Mental Health)", "http://localhost:3000/api/mental-health", { assessment: 'Çok stresliyim, odaklanamıyorum.' });
    await delay(12000);

    // Medication: body: JSON.stringify({ query: ilaçAdı, context: ekBelirti })
    await testEndpoint("5. İlaç Analizi (Medication Analysis)", "http://localhost:3000/api/analyze-medication", { query: 'Aspirin', context: 'Mide ağrısı' });

    console.log("\n==================================================");
    console.log("🏁 TÜM TESTLER TAMAMLANDI.");
}

runTests();
