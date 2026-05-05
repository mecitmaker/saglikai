const fetch = require('node-fetch');

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testFullFlow() {
    let history = [];
    let context = null;

    console.log("========================================");
    console.log("🔥 ADIM 1: İLK ŞİKAYET");
    console.log("========================================");
    const req1 = await fetch('http://localhost:3000/api/analyze-symptoms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symptoms: 'Çok sık idrara çıkıyorum, günde 15 defa' })
    });
    const res1 = await req1.json();
    console.log("[ASİSTAN NOTU]:\n", res1.result.asistan_notu);
    console.log("\n[SORULAR]:", JSON.stringify(res1.result.sorular, null, 2));
    
    context = res1.result;
    history.push({ sender: 'user', text: 'Çok sık idrara çıkıyorum, günde 15 defa' });
    history.push({ sender: 'assistant', text: res1.result.asistan_notu });

    if (!res1.result.sorular || res1.result.sorular.length === 0) return console.log("Flow ended early.");

    await delay(1000);

    console.log("\n========================================");
    console.log("🔥 ADIM 2: TAKİP SORULARINA CEVAP (Turn 1)");
    console.log("========================================");
    
    const ans1 = "Yanma yok, sadece çok su içiyorum sanırım, bir de ağız kuruluğu var.";
    console.log("[KULLANICI CEVABI]:", ans1);
    
    const req2 = await fetch('http://localhost:3000/api/chat-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            history: history,
            message: ans1,
            analysisContext: context
        })
    });
    const res2 = await req2.json();
    console.log("[ASİSTAN CEVABI]:\n", res2.response);
    console.log("\n[YENİ SORULAR]:", JSON.stringify(res2.karsi_sorular, null, 2));

    history.push({ sender: 'user', text: ans1 });
    history.push({ sender: 'assistant', text: res2.response });

    if (!res2.karsi_sorular || res2.karsi_sorular.length === 0) return console.log("\n✅ Teşhis tamamlandı, döngü bitti.");

    await delay(1000);

    console.log("\n========================================");
    console.log("🔥 ADIM 3: 2. TAKİP SORULARINA CEVAP (Turn 2)");
    console.log("========================================");

    const ans2 = "Ailede şeker hastası var, evet.";
    console.log("[KULLANICI CEVABI]:", ans2);

    const req3 = await fetch('http://localhost:3000/api/chat-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            history: history,
            message: ans2,
            analysisContext: context
        })
    });
    const res3 = await req3.json();
    console.log("[ASİSTAN CEVABI]:\n", res3.response);
    console.log("\n[YENİ SORULAR]:", JSON.stringify(res3.karsi_sorular, null, 2));

    if (!res3.karsi_sorular || res3.karsi_sorular.length === 0) return console.log("\n✅ Teşhis tamamlandı, döngü bitti.");
}

testFullFlow();
