const fetch = require('node-fetch');

async function test() {
    try {
        console.log("=== ADIM 1: İLK ŞİKAYET ===");
        const res1 = await fetch('http://localhost:3000/api/analyze-symptoms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symptoms: 'Çok sık idrara çıkıyorum' })
        });
        const data1 = await res1.json();
        console.log(JSON.stringify(data1.result, null, 2));
        
        if (data1.result.sorular && data1.result.sorular.length > 0) {
            console.log("\n=== ADIM 2: TAKİP SORULARINA CEVAP ===");
            const followUpBody = {
                history: [
                    { sender: 'user', text: 'Çok sık idrara çıkıyorum' },
                    { sender: 'assistant', text: data1.result.asistan_notu }
                ],
                message: "1-2 haftadır var, yanma yok, su tüketimim normal.",
                analysisContext: data1.result
            };
            
            const res2 = await fetch('http://localhost:3000/api/chat-followup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(followUpBody)
            });
            const data2 = await res2.json();
            console.log(JSON.stringify(data2, null, 2));
        }
    } catch (e) {
        console.error(e);
    }
}
test();
