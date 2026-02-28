const ASK_URL = 'https://normativas-ia.vercel.app/api/ask';

async function run() {
    const resp = await fetch(ASK_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-debug': '1'
        },
        body: JSON.stringify({
            question: "¿Cuál es el objeto del RD 505/2007?",
            normaId: null,
            normaCodigo: "RD 505/2007"
        })
    });

    const json = await resp.json();
    console.log(JSON.stringify(json, null, 2));
}

run();
