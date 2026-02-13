-- ISP database export (MySQL-compatible)
-- Date: 2026-02-13

SET NAMES utf8mb4;
SET time_zone = '+00:00';

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

INSERT INTO users (id, nome, cognome, pin, conto, iban, saldo, is_admin)
VALUES
  (1, 'Admin', 'Sistema', '00000', '0000/00000000', 'IT00X0000000000000000000000', 0.00, 1),
  (2, 'Giacomo', 'Tronconi', '12345', '1000/00940819', 'IT11H0338501601100000940819', 2354.32, 0)
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO conti (id, user_id, nome_piano, conto, iban, saldo, ordine)
VALUES
  (1, 2, 'PIANO ISYPRIME', '1000/00940819', 'IT11H0338501601100000940819', 821.42, 0),
  (2, 2, 'PIANO ISYPRIME', '1000/11223344', 'IT59H0338501601100001122334', 1532.90, 1)
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO movimenti (user_id, conto_id, tipo, importo, descrizione, categoria, stato, data)
VALUES
  (2, 1, 'addebito', 19.97, 'Enimoov S.p.A.', 'Pagamento', 'completato', '2026-02-13 14:30:00'),
  (2, 1, 'addebito', 100.00, 'Abi : 01005 Cab : 01624 Banca Nazionale Del', 'Bonifico', 'in_corso', '2026-02-13 10:15:00'),
  (2, 1, 'addebito', 5.03, 'Www.g2g.com', 'Pagamento', 'in_corso', '2026-02-12 18:45:00'),
  (2, 1, 'accredito', 89.45, 'Bonifico disposto da: STRIPE', 'Bonifico', 'completato', '2026-02-12 09:20:00'),
  (2, 1, 'addebito', 45.90, 'Pagamento COMUNE DI GENOVA', 'Pagamento', 'completato', '2026-02-10 11:00:00'),
  (2, 2, 'accredito', 2500.00, 'Stipendio Febbraio', 'Stipendio', 'completato', '2026-02-01 09:00:00'),
  (2, 2, 'addebito', 820.00, 'Affitto Febbraio', 'Casa', 'completato', '2026-02-03 10:30:00'),
  (2, 2, 'addebito', 65.90, 'Spesa Supermercato', 'Alimentari', 'completato', '2026-02-05 18:20:00'),
  (2, 2, 'addebito', 29.90, 'Netflix Abbonamento', 'Intrattenimento', 'completato', '2026-02-08 00:00:00'),
  (2, 2, 'accredito', 150.00, 'Bonifico da Luca Bianchi', 'Bonifico', 'completato', '2026-02-11 14:10:00');

ALTER TABLE users AUTO_INCREMENT = 3;
ALTER TABLE conti AUTO_INCREMENT = 3;
