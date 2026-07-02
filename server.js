const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// In-memory queue storage
let queue = [];

// Helper to get local Wi-Fi / Ethernet IP address
function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost';
}

const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = req.url.split('?')[0];

    // API Routes
    if (parsedUrl === '/api/config') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ localIp: getLocalIpAddress() }));
        return;
    }

    if (parsedUrl === '/api/queue') {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(queue));
        } else if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const item = JSON.parse(body);
                    queue.push(item);
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, item }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
                }
            });
        } else if (req.method === 'PUT') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const update = JSON.parse(body);
                    queue = queue.map(c => c.id === update.id ? { ...c, ...update } : c);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
                }
            });
        }
        return;
    }

    // Serve static files
    let filePath = '.' + parsedUrl;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('File Not Found', 'utf-8');
            } else {
                res.writeHead(500);
                res.end('Server error: ' + error.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

const PORT = 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`  Smart Queue server is running!`);
    console.log(`  Local URL:    http://localhost:${PORT}`);
    console.log(`  Network URL:  http://${getLocalIpAddress()}:${PORT}`);
    console.log(`======================================================\n`);
});
