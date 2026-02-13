const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'isp',
  waitForConnections: true,
  connectionLimit: 10
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let dbStatus = { ok: false, error: null, ready: false };

// Health check — non richiede DB
app.get('/health', async (req, res) => {
  let dbTest = 'not tested';
  try {
    const [rows] = await pool.query('SELECT 1 AS ping');
    dbTest = 'connected';
  } catch (err) {
    dbTest = err.message;
  }
  res.json({
    status: 'running',
    node: process.version,
    db: dbTest,
    dbStatus,
    env: {
      DB_HOST: process.env.DB_HOST || '(default localhost)',
      DB_PORT: process.env.DB_PORT || '(default 3306)',
      DB_NAME: process.env.DB_NAME || '(default isp)',
      DB_USER: process.env.DB_USER || '(default root)',
      PORT: process.env.PORT || '(default 3000)'
    }
  });
});

function generatePin() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function generateConto() {
  return '1000/' + String(Math.floor(Math.random() * 99999999)).padStart(8, '0');
}

function generateIBAN() {
  let result = 'IT';
  for (let index = 0; index < 25; index += 1) result += Math.floor(Math.random() * 10);
  return result;
}

async function getFirstContoId(userId) {
  const [rows] = await pool.query(
    'SELECT id FROM conti WHERE user_id = ? ORDER BY ordine ASC, id ASC LIMIT 1',
    [userId]
  );
  return rows.length ? rows[0].id : null;
}

async function recalcUserSaldo(userId, conn = pool) {
  await conn.query(
    `
    UPDATE users
    SET saldo = (
      SELECT COALESCE(SUM(c.saldo), 0)
      FROM conti c
      WHERE c.user_id = ?
    )
    WHERE id = ?
  `,
    [userId, userId]
  );
}

async function migrateContiFromUsers() {
  const [users] = await pool.query(
    'SELECT id, conto, iban, saldo FROM users WHERE is_admin = 0'
  );

  for (const user of users) {
    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS c FROM conti WHERE user_id = ?',
      [user.id]
    );

    if (countRows[0].c === 0) {
      await pool.query(
        `
        INSERT INTO conti (user_id, nome_piano, conto, iban, saldo, ordine)
        VALUES (?, 'PIANO ISYPRIME', ?, ?, ?, 0)
      `,
        [user.id, user.conto, user.iban, user.saldo]
      );
    }

    const firstContoId = await getFirstContoId(user.id);
    if (firstContoId) {
      await pool.query(
        'UPDATE movimenti SET conto_id = ? WHERE user_id = ? AND conto_id IS NULL',
        [firstContoId, user.id]
      );
    }

    await recalcUserSaldo(user.id);
  }
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT NOT NULL AUTO_INCREMENT,
      nome VARCHAR(100) NOT NULL,
      cognome VARCHAR(100) NOT NULL,
      pin VARCHAR(5) NOT NULL,
      conto VARCHAR(32) NOT NULL,
      iban VARCHAR(34) NOT NULL,
      saldo DECIMAL(12,2) DEFAULT 0,
      is_admin TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_users_pin (pin)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conti (
      id INT NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      nome_piano VARCHAR(100) DEFAULT 'PIANO ISYPRIME',
      conto VARCHAR(32) NOT NULL,
      iban VARCHAR(34) NOT NULL,
      saldo DECIMAL(12,2) DEFAULT 0,
      ordine INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_conti_user_id (user_id),
      CONSTRAINT fk_conti_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movimenti (
      id INT NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      conto_id INT NULL,
      tipo ENUM('accredito','addebito') NOT NULL,
      importo DECIMAL(12,2) NOT NULL,
      descrizione VARCHAR(255) NOT NULL,
      categoria VARCHAR(100) DEFAULT 'Altro',
      stato VARCHAR(50) DEFAULT 'completato',
      data DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_movimenti_user_id (user_id),
      KEY idx_movimenti_conto_id (conto_id),
      CONSTRAINT fk_movimenti_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_movimenti_conto
        FOREIGN KEY (conto_id) REFERENCES conti(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function seedData() {
  const [adminRows] = await pool.query('SELECT id FROM users WHERE is_admin = 1 LIMIT 1');
  if (!adminRows.length) {
    await pool.query(
      `
      INSERT INTO users (nome, cognome, pin, conto, iban, saldo, is_admin)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      ['Admin', 'Sistema', '00000', '0000/00000000', 'IT00X0000000000000000000000', 0, 1]
    );
  }

  const [clientRows] = await pool.query('SELECT id FROM users WHERE is_admin = 0 LIMIT 1');
  if (!clientRows.length) {
    await pool.query(
      `
      INSERT INTO users (nome, cognome, pin, conto, iban, saldo, is_admin)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      ['Giacomo', 'Tronconi', '12345', '1000/00940819', 'IT11H0338501601100000940819', 821.42, 0]
    );
  }

  await migrateContiFromUsers();

  const [demoUsers] = await pool.query(
    'SELECT id FROM users WHERE pin = ? AND is_admin = 0 LIMIT 1',
    ['12345']
  );

  if (!demoUsers.length) {
    return;
  }

  const demoUserId = demoUsers[0].id;

  const [contiCountRows] = await pool.query(
    'SELECT COUNT(*) AS c FROM conti WHERE user_id = ?',
    [demoUserId]
  );

  if (contiCountRows[0].c < 2) {
    await pool.query(
      `
      INSERT INTO conti (user_id, nome_piano, conto, iban, saldo, ordine)
      VALUES (?, 'PIANO ISYPRIME', ?, ?, ?, ?)
    `,
      [demoUserId, '1000/11223344', 'IT59H0338501601100001122334', 1532.9, 1]
    );
    await recalcUserSaldo(demoUserId);
  }

  const [conti] = await pool.query(
    'SELECT id, ordine FROM conti WHERE user_id = ? ORDER BY ordine ASC, id ASC',
    [demoUserId]
  );

  const firstConto = conti[0];
  const secondConto = conti[1];

  if (firstConto) {
    const [firstCountRows] = await pool.query(
      'SELECT COUNT(*) AS c FROM movimenti WHERE user_id = ? AND conto_id = ?',
      [demoUserId, firstConto.id]
    );

    if (firstCountRows[0].c === 0) {
      await pool.query(
        `
        INSERT INTO movimenti (user_id, conto_id, tipo, importo, descrizione, categoria, stato, data)
        VALUES
          (?, ?, 'addebito', 19.97, 'Enimoov S.p.A.', 'Pagamento', 'completato', '2026-02-13 14:30:00'),
          (?, ?, 'addebito', 100.00, 'Abi : 01005 Cab : 01624 Banca Nazionale Del', 'Bonifico', 'in_corso', '2026-02-13 10:15:00'),
          (?, ?, 'addebito', 5.03, 'Www.g2g.com', 'Pagamento', 'in_corso', '2026-02-12 18:45:00'),
          (?, ?, 'accredito', 89.45, 'Bonifico disposto da: STRIPE', 'Bonifico', 'completato', '2026-02-12 09:20:00'),
          (?, ?, 'addebito', 45.90, 'Pagamento COMUNE DI GENOVA', 'Pagamento', 'completato', '2026-02-10 11:00:00')
      `,
        [
          demoUserId,
          firstConto.id,
          demoUserId,
          firstConto.id,
          demoUserId,
          firstConto.id,
          demoUserId,
          firstConto.id,
          demoUserId,
          firstConto.id
        ]
      );
    }
  }

  if (secondConto) {
    const [secondCountRows] = await pool.query(
      'SELECT COUNT(*) AS c FROM movimenti WHERE user_id = ? AND conto_id = ?',
      [demoUserId, secondConto.id]
    );

    if (secondCountRows[0].c === 0) {
      await pool.query(
        `
        INSERT INTO movimenti (user_id, conto_id, tipo, importo, descrizione, categoria, stato, data)
        VALUES
          (?, ?, 'accredito', 2500.00, 'Stipendio Febbraio', 'Stipendio', 'completato', '2026-02-01 09:00:00'),
          (?, ?, 'addebito', 820.00, 'Affitto Febbraio', 'Casa', 'completato', '2026-02-03 10:30:00'),
          (?, ?, 'addebito', 65.90, 'Spesa Supermercato', 'Alimentari', 'completato', '2026-02-05 18:20:00'),
          (?, ?, 'addebito', 29.90, 'Netflix Abbonamento', 'Intrattenimento', 'completato', '2026-02-08 00:00:00'),
          (?, ?, 'accredito', 150.00, 'Bonifico da Luca Bianchi', 'Bonifico', 'completato', '2026-02-11 14:10:00')
      `,
        [
          demoUserId,
          secondConto.id,
          demoUserId,
          secondConto.id,
          demoUserId,
          secondConto.id,
          demoUserId,
          secondConto.id,
          demoUserId,
          secondConto.id
        ]
      );
    }
  }
}

function errorResponse(res, statusCode, message) {
  return res.status(statusCode).json({ error: message });
}

app.post('/api/login', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return errorResponse(res, 400, 'PIN richiesto');

  const [rows] = await pool.query(
    'SELECT id, nome, cognome FROM users WHERE pin = ? AND is_admin = 0 LIMIT 1',
    [pin]
  );

  if (!rows.length) return errorResponse(res, 401, 'PIN non valido');

  return res.json({ success: true, user: rows[0] });
});

app.post('/api/admin/login', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return errorResponse(res, 400, 'PIN richiesto');

  const [rows] = await pool.query(
    'SELECT id, nome, cognome FROM users WHERE pin = ? AND is_admin = 1 LIMIT 1',
    [pin]
  );

  if (!rows.length) return errorResponse(res, 401, 'PIN admin non valido');

  return res.json({ success: true, admin: rows[0] });
});

app.get('/api/client/:id', async (req, res) => {
  const userId = Number(req.params.id);
  const [users] = await pool.query(
    'SELECT id, nome, cognome, pin FROM users WHERE id = ? AND is_admin = 0 LIMIT 1',
    [userId]
  );

  if (!users.length) return errorResponse(res, 404, 'Cliente non trovato');

  const [primoContoRows] = await pool.query(
    'SELECT id, conto, iban, saldo FROM conti WHERE user_id = ? ORDER BY ordine ASC, id ASC LIMIT 1',
    [userId]
  );

  const [totaleRows] = await pool.query(
    'SELECT COALESCE(SUM(saldo), 0) AS saldo FROM conti WHERE user_id = ?',
    [userId]
  );

  const primoConto = primoContoRows.length ? primoContoRows[0] : null;

  return res.json({
    ...users[0],
    conto: primoConto ? primoConto.conto : null,
    iban: primoConto ? primoConto.iban : null,
    saldo: Number(totaleRows[0].saldo)
  });
});

app.get('/api/client/:id/conti', async (req, res) => {
  const userId = Number(req.params.id);
  const [users] = await pool.query(
    'SELECT id FROM users WHERE id = ? AND is_admin = 0 LIMIT 1',
    [userId]
  );

  if (!users.length) return errorResponse(res, 404, 'Cliente non trovato');

  const [conti] = await pool.query(
    'SELECT id, nome_piano, conto, iban, saldo, ordine FROM conti WHERE user_id = ? ORDER BY ordine ASC, id ASC',
    [userId]
  );

  return res.json(conti);
});

app.get('/api/client/:id/conti/:contoId', async (req, res) => {
  const userId = Number(req.params.id);
  const contoId = Number(req.params.contoId);

  const [conti] = await pool.query(
    'SELECT id, user_id, nome_piano, conto, iban, saldo, ordine FROM conti WHERE id = ? AND user_id = ? LIMIT 1',
    [contoId, userId]
  );

  if (!conti.length) return errorResponse(res, 404, 'Conto non trovato');

  return res.json(conti[0]);
});

app.get('/api/client/:id/conti/:contoId/movimenti', async (req, res) => {
  const userId = Number(req.params.id);
  const contoId = Number(req.params.contoId);

  const [conti] = await pool.query(
    'SELECT id FROM conti WHERE id = ? AND user_id = ? LIMIT 1',
    [contoId, userId]
  );

  if (!conti.length) return errorResponse(res, 404, 'Conto non trovato');

  const [movimenti] = await pool.query(
    'SELECT * FROM movimenti WHERE user_id = ? AND conto_id = ? ORDER BY data DESC',
    [userId, contoId]
  );

  return res.json(movimenti);
});

app.get('/api/client/:id/conti/:contoId/riepilogo', async (req, res) => {
  const userId = Number(req.params.id);
  const contoId = Number(req.params.contoId);

  const [conti] = await pool.query(
    'SELECT id FROM conti WHERE id = ? AND user_id = ? LIMIT 1',
    [contoId, userId]
  );

  if (!conti.length) return errorResponse(res, 404, 'Conto non trovato');

  const now = new Date();
  const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const [entrateRows] = await pool.query(
    "SELECT COALESCE(SUM(importo),0) AS t FROM movimenti WHERE user_id = ? AND conto_id = ? AND tipo='accredito' AND data >= ?",
    [userId, contoId, firstDay]
  );

  const [usciteRows] = await pool.query(
    "SELECT COALESCE(SUM(importo),0) AS t FROM movimenti WHERE user_id = ? AND conto_id = ? AND tipo='addebito' AND data >= ?",
    [userId, contoId, firstDay]
  );

  return res.json({
    entrate: Number(entrateRows[0].t),
    uscite: Number(usciteRows[0].t)
  });
});

app.get('/api/client/:id/movimenti', async (req, res) => {
  const userId = Number(req.params.id);
  const firstContoId = await getFirstContoId(userId);
  if (!firstContoId) return res.json([]);

  const [movimenti] = await pool.query(
    'SELECT * FROM movimenti WHERE user_id = ? AND conto_id = ? ORDER BY data DESC',
    [userId, firstContoId]
  );

  return res.json(movimenti);
});

app.get('/api/client/:id/riepilogo', async (req, res) => {
  const userId = Number(req.params.id);
  const firstContoId = await getFirstContoId(userId);
  if (!firstContoId) return res.json({ entrate: 0, uscite: 0 });

  const now = new Date();
  const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const [entrateRows] = await pool.query(
    "SELECT COALESCE(SUM(importo),0) AS t FROM movimenti WHERE user_id=? AND conto_id=? AND tipo='accredito' AND data>=?",
    [userId, firstContoId, firstDay]
  );

  const [usciteRows] = await pool.query(
    "SELECT COALESCE(SUM(importo),0) AS t FROM movimenti WHERE user_id=? AND conto_id=? AND tipo='addebito' AND data>=?",
    [userId, firstContoId, firstDay]
  );

  return res.json({ entrate: Number(entrateRows[0].t), uscite: Number(usciteRows[0].t) });
});

app.get('/api/admin/clienti', async (req, res) => {
  const [clienti] = await pool.query(`
    SELECT
      u.id,
      u.nome,
      u.cognome,
      u.pin,
      (
        SELECT c.conto
        FROM conti c
        WHERE c.user_id = u.id
        ORDER BY c.ordine ASC, c.id ASC
        LIMIT 1
      ) AS conto,
      (
        SELECT c.iban
        FROM conti c
        WHERE c.user_id = u.id
        ORDER BY c.ordine ASC, c.id ASC
        LIMIT 1
      ) AS iban,
      COALESCE((SELECT SUM(c.saldo) FROM conti c WHERE c.user_id = u.id), 0) AS saldo
    FROM users u
    WHERE u.is_admin = 0
    ORDER BY u.cognome, u.nome
  `);

  return res.json(clienti);
});

app.post('/api/admin/clienti', async (req, res) => {
  const { nome, cognome, saldo_iniziale } = req.body;
  if (!nome || !cognome) return errorResponse(res, 400, 'Nome e cognome richiesti');

  const pin = generatePin();
  const conto = generateConto();
  const iban = generateIBAN();
  const saldo = Number(saldo_iniziale || 0);
  const saldoPulito = Number.isNaN(saldo) ? 0 : saldo;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `
      INSERT INTO users (nome, cognome, pin, conto, iban, saldo, is_admin)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `,
      [nome, cognome, pin, conto, iban, saldoPulito]
    );

    const userId = result.insertId;

    await connection.query(
      `
      INSERT INTO conti (user_id, nome_piano, conto, iban, saldo, ordine)
      VALUES (?, 'PIANO ISYPRIME', ?, ?, ?, 0)
    `,
      [userId, conto, iban, saldoPulito]
    );

    await recalcUserSaldo(userId, connection);

    await connection.commit();

    const [clienteRows] = await pool.query(
      'SELECT id, nome, cognome, pin FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    return res.json({
      success: true,
      cliente: {
        ...clienteRows[0],
        conto,
        iban,
        saldo: saldoPulito
      }
    });
  } catch (error) {
    await connection.rollback();
    return errorResponse(res, 500, 'Errore creazione cliente');
  } finally {
    connection.release();
  }
});

app.delete('/api/admin/clienti/:id', async (req, res) => {
  const userId = Number(req.params.id);
  const [result] = await pool.query('DELETE FROM users WHERE id = ? AND is_admin = 0', [userId]);
  if (result.affectedRows === 0) return errorResponse(res, 404, 'Non trovato');
  return res.json({ success: true });
});

app.get('/api/admin/clienti/:id/conti', async (req, res) => {
  const userId = Number(req.params.id);
  const [users] = await pool.query(
    'SELECT id FROM users WHERE id = ? AND is_admin = 0 LIMIT 1',
    [userId]
  );

  if (!users.length) return errorResponse(res, 404, 'Cliente non trovato');

  const [conti] = await pool.query(
    'SELECT id, nome_piano, conto, iban, saldo, ordine FROM conti WHERE user_id = ? ORDER BY ordine ASC, id ASC',
    [userId]
  );

  return res.json(conti);
});

app.get('/api/admin/clienti/:id/conti/:contoId/movimenti', async (req, res) => {
  const userId = Number(req.params.id);
  const contoId = Number(req.params.contoId);

  const [conti] = await pool.query(
    'SELECT id FROM conti WHERE id = ? AND user_id = ? LIMIT 1',
    [contoId, userId]
  );

  if (!conti.length) return errorResponse(res, 404, 'Conto non trovato');

  const [movimenti] = await pool.query(
    'SELECT * FROM movimenti WHERE user_id = ? AND conto_id = ? ORDER BY data DESC',
    [userId, contoId]
  );

  return res.json(movimenti);
});

app.post('/api/admin/clienti/:id/conti', async (req, res) => {
  const userId = Number(req.params.id);
  const { iban, saldo_iniziale } = req.body;

  const [users] = await pool.query(
    'SELECT id FROM users WHERE id = ? AND is_admin = 0 LIMIT 1',
    [userId]
  );

  if (!users.length) return errorResponse(res, 404, 'Cliente non trovato');

  const [countRows] = await pool.query('SELECT COUNT(*) AS c FROM conti WHERE user_id = ?', [userId]);
  if (countRows[0].c >= 2) return errorResponse(res, 400, 'Il cliente ha già due conti');

  const nuovoConto = generateConto();
  const nuovoIban = String(iban || generateIBAN()).toUpperCase().trim();
  const saldo = Number(saldo_iniziale || 0);
  const saldoPulito = Number.isNaN(saldo) ? 0 : saldo;

  const [result] = await pool.query(
    `
    INSERT INTO conti (user_id, nome_piano, conto, iban, saldo, ordine)
    VALUES (?, 'PIANO ISYPRIME', ?, ?, ?, ?)
  `,
    [userId, nuovoConto, nuovoIban, saldoPulito, countRows[0].c]
  );

  await recalcUserSaldo(userId);

  const [contoRows] = await pool.query(
    'SELECT id, nome_piano, conto, iban, saldo, ordine FROM conti WHERE id = ? LIMIT 1',
    [result.insertId]
  );

  return res.json({ success: true, conto: contoRows[0] });
});

app.put('/api/admin/clienti/:id/conti/:contoId/iban', async (req, res) => {
  const userId = Number(req.params.id);
  const contoId = Number(req.params.contoId);
  const { iban } = req.body;

  if (!iban || !String(iban).trim()) {
    return errorResponse(res, 400, 'IBAN richiesto');
  }

  const [conti] = await pool.query(
    'SELECT id FROM conti WHERE id = ? AND user_id = ? LIMIT 1',
    [contoId, userId]
  );

  if (!conti.length) return errorResponse(res, 404, 'Conto non trovato');

  const ibanPulito = String(iban).toUpperCase().replace(/\s+/g, '');
  await pool.query('UPDATE conti SET iban = ? WHERE id = ?', [ibanPulito, contoId]);

  const [updatedRows] = await pool.query(
    'SELECT id, nome_piano, conto, iban, saldo, ordine FROM conti WHERE id = ? LIMIT 1',
    [contoId]
  );

  return res.json({ success: true, conto: updatedRows[0] });
});

app.post('/api/admin/clienti/:id/movimenti', async (req, res) => {
  const userId = Number(req.params.id);
  const { tipo, importo, descrizione, categoria, stato, conto_id } = req.body;

  if (!tipo || !importo || !descrizione) {
    return errorResponse(res, 400, 'Campi mancanti');
  }

  const contoId = conto_id ? Number(conto_id) : await getFirstContoId(userId);
  if (!contoId) return errorResponse(res, 404, 'Conto non trovato');

  const [contoRows] = await pool.query(
    'SELECT id, user_id, saldo FROM conti WHERE id = ? AND user_id = ? LIMIT 1',
    [contoId, userId]
  );

  if (!contoRows.length) return errorResponse(res, 404, 'Conto non trovato');

  const imp = Number(importo);
  if (Number.isNaN(imp) || imp <= 0) return errorResponse(res, 400, 'Importo non valido');

  const conto = contoRows[0];
  const saldoCorrente = Number(conto.saldo);
  const nuovoSaldo = tipo === 'accredito' ? saldoCorrente + imp : saldoCorrente - imp;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query('UPDATE conti SET saldo = ? WHERE id = ?', [nuovoSaldo, conto.id]);
    await connection.query(
      `
      INSERT INTO movimenti (user_id, conto_id, tipo, importo, descrizione, categoria, stato)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      [userId, conto.id, tipo, imp, descrizione, categoria || 'Altro', stato || 'completato']
    );

    await recalcUserSaldo(userId, connection);

    await connection.commit();
    return res.json({ success: true, nuovo_saldo: nuovoSaldo });
  } catch (error) {
    await connection.rollback();
    return errorResponse(res, 500, 'Errore salvataggio movimento');
  } finally {
    connection.release();
  }
});

app.delete('/api/admin/movimenti/:id', async (req, res) => {
  const movimentoId = Number(req.params.id);

  const [movRows] = await pool.query('SELECT * FROM movimenti WHERE id = ? LIMIT 1', [movimentoId]);
  if (!movRows.length) return errorResponse(res, 404, 'Non trovato');

  const mov = movRows[0];
  if (!mov.conto_id) return errorResponse(res, 400, 'Movimento senza conto associato');

  const [contoRows] = await pool.query('SELECT * FROM conti WHERE id = ? LIMIT 1', [mov.conto_id]);
  if (!contoRows.length) return errorResponse(res, 404, 'Conto non trovato');

  const conto = contoRows[0];
  const saldoConto = Number(conto.saldo);
  const importoMov = Number(mov.importo);
  const nuovoSaldo = mov.tipo === 'accredito' ? saldoConto - importoMov : saldoConto + importoMov;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query('UPDATE conti SET saldo = ? WHERE id = ?', [nuovoSaldo, mov.conto_id]);
    await connection.query('DELETE FROM movimenti WHERE id = ?', [movimentoId]);
    await recalcUserSaldo(conto.user_id, connection);

    await connection.commit();
    return res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    return errorResponse(res, 500, 'Errore eliminazione movimento');
  } finally {
    connection.release();
  }
});

app.get('/api/admin/clienti/:id/movimenti', async (req, res) => {
  const userId = Number(req.params.id);
  const firstContoId = await getFirstContoId(userId);
  if (!firstContoId) return res.json([]);

  const [movimenti] = await pool.query(
    'SELECT * FROM movimenti WHERE user_id = ? AND conto_id = ? ORDER BY data DESC',
    [userId, firstContoId]
  );

  return res.json(movimenti);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  return errorResponse(res, 500, 'Errore interno del server');
});

async function start() {
  // Avvia server PRIMA di tutto, così Passenger/proxy non danno 503
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server ISP avviato su porta ${PORT}`);
  });

  // Poi prova a connettere il DB
  try {
    await ensureSchema();
    await seedData();
    dbStatus = { ok: true, error: null, ready: true };
    console.log('DB connesso, tabelle OK, seed OK');
  } catch (error) {
    dbStatus = { ok: false, error: error.message, ready: false };
    console.error('ERRORE DB:', error.message);
    console.error(error.stack);
    // NON fare process.exit — il server resta su per diagnostica via /health
  }
}

start();

// Passenger compatibility
module.exports = app;
