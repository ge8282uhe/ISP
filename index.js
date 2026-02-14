// Minimal test to verify Hostinger can start Node
const http = require('http');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'running',
    node: process.version,
    port: PORT,
    env_keys: Object.keys(process.env).filter(k => k.startsWith('DB_') || k === 'PORT')
  }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Test server running on port ' + PORT);
});
