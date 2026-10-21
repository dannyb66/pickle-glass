const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const DEFAULT_WEB_PORT = 64980;

function getAvailablePort(preferredPort = 0) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', error => {
            if (preferredPort && error.code === 'EADDRINUSE') resolve(getAvailablePort());
            else reject(error);
        });
        server.listen(preferredPort, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

function createFrontend({ nodeApi, staticDir, runtimeConfig }) {
    const frontend = express();
    frontend.get('/runtime-config.json', (_req, res) => {
        // Keep configuration with its server, rather than a shared temporary file
        // that another app launch can overwrite.
        res.set('Cache-Control', 'no-store').json(runtimeConfig);
    });
    frontend.use((req, res, next) => {
        if (req.path === '/api' || req.path.startsWith('/api/')) return nodeApi(req, res, next);
        next();
    });
    frontend.use((req, res, next) => {
        if (!req.path.includes('.') && req.path !== '/') {
            const htmlPath = path.join(staticDir, req.path + '.html');
            if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
        }
        next();
    });
    frontend.use(express.static(staticDir));
    return frontend;
}

module.exports = { DEFAULT_WEB_PORT, getAvailablePort, createFrontend };
