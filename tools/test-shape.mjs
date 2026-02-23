import https from 'https';

const url = 'https://normativas-ia.vercel.app/api/ask';
const data = JSON.stringify({
    question: 'accesibilidad',
    normaId: null
});

const options = {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(url, options, (res) => {
    let body = '';
    res.on('data', (chunk) => {
        body += chunk;
    });
    res.on('end', () => {
        const json = JSON.parse(body);
        console.log("KEYS:", Object.keys(json));
        console.log("First element keys (if data exists):", json.data && json.data.length > 0 ? Object.keys(json.data[0]) : 'no data array');
        console.log("First element:", json.data && json.data.length > 0 ? json.data[0] : null);
    });
});

req.on('error', (e) => {
    console.error(e);
});

req.write(data);
req.end();
