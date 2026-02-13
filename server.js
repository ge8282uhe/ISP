const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database(path.join(__dirname, 'database.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ==================== DATABASE ====================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cognome TEXT NOT NULL,
    pin TEXT UNIQUE NOT NULL,
    conto TEXT NOT NULL,
    iban TEXT NOT NULL,
    saldo REAL DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conti (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    nome_piano TEXT DEFAULT 'PIANO ISYPRIME',
    conto TEXT NOT NULL,
    iban TEXT NOT NULL,
    saldo REAL DEFAULT 0,
    ordine INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS movimenti (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    conto_id INTEGER,
    tipo TEXT NOT NULL CHECK(tipo IN ('accredito','addebito')),
    importo REAL NOT NULL,
    descrizione TEXT NOT NULL,
    categoria TEXT DEFAULT 'Altro',
    stato TEXT DEFAULT 'completato',
    data DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (conto_id) REFERENCES conti(id) ON DELETE SET NULL
  );
`);

try {
  db.exec('ALTER TABLE movimenti ADD COLUMN conto_id INTEGER');
} catch (error) {
  // Column already exists
}

function generatePin() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function generateConto() {
  return '1000/' + String(Math.floor(Math.random() * 99999999)).padStart(8, '0');
}

function generateIBAN() {
  let result = 'IT';
  for (let i = 0; i < 25; i++) result += Math.floor(Math.random() * 10);
  return result;
}

function getFirstContoId(userId) {
  const conto = db.prepare('SELECT id FROM conti WHERE user_id = ? ORDER BY ordine ASC, id ASC LIMIT 1').get(userId);
  return conto ? conto.id : null;
}

function recalcUserSaldo(userId) {
  const sum = db.prepare('SELECT COALESCE(SUM(saldo), 0) as totale FROM conti WHERE user_id = ?').get(userId);
  db.prepare('UPDATE users SET saldo = ? WHERE id = ?').run(sum.totale, userId);
}

function migrateContiFromUsers() {
  const users = db.prepare('SELECT id, conto, iban, saldo, is_admin FROM users WHERE is_admin = 0').all();
  const insertConto = db.prepare(`
    INSERT INTO conti (user_id, nome_piano, conto, iban, saldo, ordine)
    VALUES (?, 'PIANO ISYPRIME', ?, ?, ?, ?)
  `);

  for (const user of users) {
    const count = db.prepare('SELECT COUNT(*) as c FROM conti WHERE user_id = ?').get(user.id).c;
    if (count === 0) {
      insertConto.run(user.id, user.conto, user.iban, user.saldo, 0);
    }

    const firstContoId = getFirstContoId(user.id);
    if (firstContoId) {
      db.prepare('UPDATE movimenti SET conto_id = ? WHERE user_id = ? AND conto_id IS NULL').run(firstContoId, user.id);
    }

    recalcUserSaldo(user.id);
  }
}

// Seed base users
const adminExists = db.prepare('SELECT id FROM users WHERE is_admin = 1').get();
if (!adminExists) {
  db.prepare('INSERT INTO users (nome,cognome,pin,conto,iban,saldo,is_admin) VALUES (?,?,?,?,?,?,?)')
    .run('Admin', 'Sistema', '00000', '0000/00000000', 'IT00X0000000000000000000000', 0, 1);
}

const clientExists = db.prepare('SELECT id FROM users WHERE is_admin = 0').get();
if (!clientExists) {
  db.prepare('INSERT INTO users (nome,cognome,pin,conto,iban,saldo,is_admin) VALUES (?,?,?,?,?,?,?)')
    .run('Giacomo', 'Tronconi', '12345', '1000/00940819', 'IT11H0338501601100000940819', 821.42, 0);
}

migrateContiFromUsers();

// Seed demo data if missing
const demoUser = db.prepare('SELECT id FROM users WHERE pin = ? AND is_admin = 0').get('12345');
if (demoUser) {
  const contiCount = db.prepare('SELECT COUNT(*) as c FROM conti WHERE user_id = ?').get(demoUser.id).c;
  if (contiCount < 2) {
    db.prepare('INSERT INTO conti (user_id, nome_piano, conto, iban, saldo, ordine) VALUES (?, ?, ?, ?, ?, ?)')
      .run(demoUser.id, 'PIANO ISYPRIME', '1000/11223344', 'IT59H0338501601100001122334', 1532.9, 1);
    recalcUserSaldo(demoUser.id);
  }

  const conti = db.prepare('SELECT id, ordine FROM conti WHERE user_id = ? ORDER BY ordine ASC, id ASC').all(demoUser.id);
  const firstConto = conti[0];
  const secondConto = conti[1];

  const ins = db.prepare('INSERT INTO movimenti (user_id, conto_id, tipo, importo, descrizione, categoria, stato, data) VALUES (?,?,?,?,?,?,?,?)');

  const firstMovCount = firstConto ? db.prepare('SELECT COUNT(*) as c FROM movimenti WHERE user_id = ? AND conto_id = ?').get(demoUser.id, firstConto.id).c : 0;
  if (firstConto && firstMovCount === 0) {
    ins.run(demoUser.id, firstConto.id, 'addebito', 19.97, 'Enimoov S.p.A.', 'Pagamento', 'completato', '2026-02-13 14:30:00');
    ins.run(demoUser.id, firstConto.id, 'addebito', 100.0, 'Abi : 01005 Cab : 01624 Banca Nazionale Del', 'Bonifico', 'in_corso', '2026-02-13 10:15:00');
    ins.run(demoUser.id, firstConto.id, 'addebito', 5.03, 'Www.g2g.com', 'Pagamento', 'in_corso', '2026-02-12 18:45:00');
    ins.run(demoUser.id, firstConto.id, 'accredito', 89.45, 'Bonifico disposto da: STRIPE', 'Bonifico', 'completato', '2026-02-12 09:20:00');
    ins.run(demoUser.id, firstConto.id, 'addebito', 45.9, 'Pagamento COMUNE DI GENOVA', 'Pagamento', 'completato', '2026-02-10 11:00:00');
  }

  const secondMovCount = secondConto ? db.prepare('SELECT COUNT(*) as c FROM movimenti WHERE user_id = ? AND conto_id = ?').get(demoUser.id, secondConto.id).c : 0;
  if (secondConto && secondMovCount === 0) {
    ins.run(demoUser.id, secondConto.id, 'accredito', 2500.0, 'Stipendio Febbraio', 'Stipendio', 'completato', '2026-02-01 09:00:00');
    ins.run(demoUser.id, secondConto.id, 'addebito', 820.0, 'Affitto Febbraio', 'Casa', 'completato', '2026-02-03 10:30:00');
    ins.run(demoUser.id, secondConto.id, 'addebito', 65.9, 'Spesa Supermercato', 'Alimentari', 'completato', '2026-02-05 18:20:00');
    ins.run(demoUser.id, secondConto.id, 'addebito', 29.9, 'Netflix Abbonamento', 'Intrattenimento', 'completato', '2026-02-08 00:00:00');
    ins.run(demoUser.id, secondConto.id, 'accredito', 150.0, 'Bonifico da Luca Bianchi', 'Bonifico', 'completato', '2026-02-11 14:10:00');
  }
}

// ==================== AUTH ====================
app.post('/api/login', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN richiesto' });

  const user = db.prepare('SELECT id, nome, cognome FROM users WHERE pin = ? AND is_admin = 0').get(pin);
  if (!user) return res.status(401).json({ error: 'PIN non valido' });

  res.json({ success: true, user });
});

app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN richiesto' });

  const admin = db.prepare('SELECT id, nome, cognome FROM users WHERE pin = ? AND is_admin = 1').get(pin);
  if (!admin) return res.status(401).json({ error: 'PIN admin non valido' });

  res.json({ success: true, admin });
});

// ==================== CLIENT ====================
app.get('/api/client/:id', (req, res) => {
  const user = db.prepare('SELECT id, nome, cognome, pin FROM users WHERE id = ? AND is_admin = 0').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Cliente non trovato' });

  const primoConto = db.prepare('SELECT id, conto, iban, saldo FROM conti WHERE user_id = ? ORDER BY ordine ASC, id ASC LIMIT 1').get(req.params.id);
  const totale = db.prepare('SELECT COALESCE(SUM(saldo), 0) as saldo FROM conti WHERE user_id = ?').get(req.params.id);

  res.json({
    ...user,
    conto: primoConto ? primoConto.conto : null,
    iban: primoConto ? primoConto.iban : null,
    saldo: totale.saldo
  });
});

app.get('/api/client/:id/conti', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND is_admin = 0').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Cliente non trovato' });

  const conti = db.prepare('SELECT id, nome_piano, conto, iban, saldo, ordine FROM conti WHERE user_id = ? ORDER BY ordine ASC, id ASC').all(req.params.id);
  res.json(conti);
});

app.get('/api/client/:id/conti/:contoId', (req, res) => {
  const conto = db.prepare('SELECT id, user_id, nome_piano, conto, iban, saldo, ordine FROM conti WHERE id = ? AND user_id = ?').get(req.params.contoId, req.params.id);
  if (!conto) return res.status(404).json({ error: 'Conto non trovato' });
  res.json(conto);
});

app.get('/api/client/:id/conti/:contoId/movimenti', (req, res) => {
  const conto = db.prepare('SELECT id FROM conti WHERE id = ? AND user_id = ?').get(req.params.contoId, req.params.id);
  if (!conto) return res.status(404).json({ error: 'Conto non trovato' });

  const movimenti = db.prepare('SELECT * FROM movimenti WHERE user_id = ? AND conto_id = ? ORDER BY data DESC').all(req.params.id, req.params.contoId);
  res.json(movimenti);
});

app.get('/api/client/:id/conti/:contoId/riepilogo', (req, res) => {
  const conto = db.prepare('SELECT id FROM conti WHERE id = ? AND user_id = ?').get(req.params.contoId, req.params.id);
  if (!conto) return res.status(404).json({ error: 'Conto non trovato' });

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

  const entrate = db.prepare("SELECT COALESCE(SUM(importo),0) as t FROM movimenti WHERE user_id = ? AND conto_id = ? AND tipo='accredito' AND data >= ?").get(req.params.id, req.params.contoId, firstDay);
  const uscite = db.prepare("SELECT COALESCE(SUM(importo),0) as t FROM movimenti WHERE user_id = ? AND conto_id = ? AND tipo='addebito' AND data >= ?").get(req.params.id, req.params.contoId, firstDay);

  res.json({ entrate: entrate.t, uscite: uscite.t });
});

// Backward-compatible routes
app.get('/api/client/:id/movimenti', (req, res) => {
  const firstContoId = getFirstContoId(req.params.id);
  if (!firstContoId) return res.json([]);
  const movimenti = db.prepare('SELECT * FROM movimenti WHERE user_id = ? AND conto_id = ? ORDER BY data DESC').all(req.params.id, firstContoId);
  res.json(movimenti);
});

app.get('/api/client/:id/riepilogo', (req, res) => {
  const firstContoId = getFirstContoId(req.params.id);
  if (!firstContoId) return res.json({ entrate: 0, uscite: 0 });

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const entrate = db.prepare("SELECT COALESCE(SUM(importo),0) as t FROM movimenti WHERE user_id=? AND conto_id=? AND tipo='accredito' AND data>=?").get(req.params.id, firstContoId, firstDay);
  const uscite = db.prepare("SELECT COALESCE(SUM(importo),0) as t FROM movimenti WHERE user_id=? AND conto_id=? AND tipo='addebito' AND data>=?").get(req.params.id, firstContoId, firstDay);
  res.json({ entrate: entrate.t, uscite: uscite.t });
});

// ==================== ADMIN ====================
app.get('/api/admin/clienti', (req, res) => {
  const clienti = db.prepare(`
    SELECT u.id, u.nome, u.cognome, u.pin,
      (SELECT conto FROM conti c WHERE c.user_id = u.id ORDER BY c.ordine ASC, c.id ASC LIMIT 1) as conto,
      (SELECT iban FROM conti c WHERE c.user_id = u.id ORDER BY c.ordine ASC, c.id ASC LIMIT 1) as iban,
      COALESCE((SELECT SUM(c.saldo) FROM conti c WHERE c.user_id = u.id), 0) as saldo
    FROM users u
    WHERE u.is_admin = 0
    ORDER BY u.cognome, u.nome
  `).all();
  res.json(clienti);
});

app.post('/api/admin/clienti', (req, res) => {
  const { nome, cognome, saldo_iniziale } = req.body;
  if (!nome || !cognome) return res.status(400).json({ error: 'Nome e cognome richiesti' });

  try {
    const pin = generatePin();
    const conto = generateConto();
    const iban = generateIBAN();
    const saldo = saldo_iniziale || 0;

    const result = db.prepare('INSERT INTO users (nome,cognome,pin,conto,iban,saldo,is_admin) VALUES (?,?,?,?,?,?,0)')
      .run(nome, cognome, pin, conto, iban, saldo);

    db.prepare('INSERT INTO conti (user_id, nome_piano, conto, iban, saldo, ordine) VALUES (?, ?, ?, ?, ?, 0)')
      .run(result.lastInsertRowid, 'PIANO ISYPRIME', conto, iban, saldo);

    recalcUserSaldo(result.lastInsertRowid);

    const cliente = db.prepare('SELECT id, nome, cognome, pin FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, cliente: { ...cliente, conto, iban, saldo } });
  } catch (error) {
    res.status(500).json({ error: 'Errore creazione cliente' });
  }
});

app.delete('/api/admin/clienti/:id', (req, res) => {
  const r = db.prepare('DELETE FROM users WHERE id = ? AND is_admin = 0').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Non trovato' });
  res.json({ success: true });
});

app.get('/api/admin/clienti/:id/conti', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND is_admin = 0').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Cliente non trovato' });

  const conti = db.prepare('SELECT id, nome_piano, conto, iban, saldo, ordine FROM conti WHERE user_id = ? ORDER BY ordine ASC, id ASC').all(req.params.id);
  res.json(conti);
});

app.get('/api/admin/clienti/:id/conti/:contoId/movimenti', (req, res) => {
  const conto = db.prepare('SELECT id FROM conti WHERE id = ? AND user_id = ?').get(req.params.contoId, req.params.id);
  if (!conto) return res.status(404).json({ error: 'Conto non trovato' });

  const movimenti = db.prepare('SELECT * FROM movimenti WHERE user_id = ? AND conto_id = ? ORDER BY data DESC').all(req.params.id, req.params.contoId);
  res.json(movimenti);
});

app.post('/api/admin/clienti/:id/conti', (req, res) => {
  const userId = parseInt(req.params.id);
  const { iban, saldo_iniziale } = req.body;

  const user = db.prepare('SELECT id FROM users WHERE id = ? AND is_admin = 0').get(userId);
  if (!user) return res.status(404).json({ error: 'Cliente non trovato' });

  const contiCount = db.prepare('SELECT COUNT(*) as c FROM conti WHERE user_id = ?').get(userId).c;
  if (contiCount >= 2) return res.status(400).json({ error: 'Il cliente ha già due conti' });

  const nuovoConto = generateConto();
  const nuovoIban = (iban || generateIBAN()).toUpperCase().trim();
  const saldo = parseFloat(saldo_iniziale || 0);

  const result = db.prepare(`
    INSERT INTO conti (user_id, nome_piano, conto, iban, saldo, ordine)
    VALUES (?, 'PIANO ISYPRIME', ?, ?, ?, ?)
  `).run(userId, nuovoConto, nuovoIban, isNaN(saldo) ? 0 : saldo, contiCount);

  recalcUserSaldo(userId);

  const conto = db.prepare('SELECT id, nome_piano, conto, iban, saldo, ordine FROM conti WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, conto });
});

app.put('/api/admin/clienti/:id/conti/:contoId/iban', (req, res) => {
  const userId = parseInt(req.params.id);
  const contoId = parseInt(req.params.contoId);
  const { iban } = req.body;

  if (!iban || !String(iban).trim()) {
    return res.status(400).json({ error: 'IBAN richiesto' });
  }

  const conto = db.prepare('SELECT id FROM conti WHERE id = ? AND user_id = ?').get(contoId, userId);
  if (!conto) return res.status(404).json({ error: 'Conto non trovato' });

  const ibanPulito = String(iban).toUpperCase().replace(/\s+/g, '');
  db.prepare('UPDATE conti SET iban = ? WHERE id = ?').run(ibanPulito, contoId);

  const updated = db.prepare('SELECT id, nome_piano, conto, iban, saldo, ordine FROM conti WHERE id = ?').get(contoId);
  res.json({ success: true, conto: updated });
});

app.post('/api/admin/clienti/:id/movimenti', (req, res) => {
  const { tipo, importo, descrizione, categoria, stato, conto_id } = req.body;
  if (!tipo || !importo || !descrizione) return res.status(400).json({ error: 'Campi mancanti' });

  const userId = parseInt(req.params.id);
  const contoId = conto_id ? parseInt(conto_id) : getFirstContoId(userId);
  if (!contoId) return res.status(404).json({ error: 'Conto non trovato' });

  const conto = db.prepare('SELECT * FROM conti WHERE id = ? AND user_id = ?').get(contoId, userId);
  if (!conto) return res.status(404).json({ error: 'Conto non trovato' });

  const imp = parseFloat(importo);
  if (isNaN(imp) || imp <= 0) return res.status(400).json({ error: 'Importo non valido' });

  const nuovoSaldo = tipo === 'accredito' ? conto.saldo + imp : conto.saldo - imp;

  db.transaction(() => {
    db.prepare('UPDATE conti SET saldo = ? WHERE id = ?').run(nuovoSaldo, conto.id);
    db.prepare('INSERT INTO movimenti (user_id, conto_id, tipo, importo, descrizione, categoria, stato) VALUES (?,?,?,?,?,?,?)')
      .run(userId, conto.id, tipo, imp, descrizione, categoria || 'Altro', stato || 'completato');
    recalcUserSaldo(userId);
  })();

  res.json({ success: true, nuovo_saldo: nuovoSaldo });
});

app.delete('/api/admin/movimenti/:id', (req, res) => {
  const mov = db.prepare('SELECT * FROM movimenti WHERE id = ?').get(req.params.id);
  if (!mov) return res.status(404).json({ error: 'Non trovato' });
  if (!mov.conto_id) return res.status(400).json({ error: 'Movimento senza conto associato' });

  const conto = db.prepare('SELECT * FROM conti WHERE id = ?').get(mov.conto_id);
  if (!conto) return res.status(404).json({ error: 'Conto non trovato' });

  db.transaction(() => {
    const ns = mov.tipo === 'accredito' ? conto.saldo - mov.importo : conto.saldo + mov.importo;
    db.prepare('UPDATE conti SET saldo = ? WHERE id = ?').run(ns, mov.conto_id);
    db.prepare('DELETE FROM movimenti WHERE id = ?').run(req.params.id);
    recalcUserSaldo(conto.user_id);
  })();

  res.json({ success: true });
});

app.get('/api/admin/clienti/:id/movimenti', (req, res) => {
  const firstContoId = getFirstContoId(req.params.id);
  if (!firstContoId) return res.json([]);
  const movimenti = db.prepare('SELECT * FROM movimenti WHERE user_id = ? AND conto_id = ? ORDER BY data DESC').all(req.params.id, firstContoId);
  res.json(movimenti);
});

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server ISP: http://localhost:${PORT}`));
