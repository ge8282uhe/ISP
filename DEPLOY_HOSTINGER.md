# Deploy su Hostinger (VPS) - ISP

Questa app ora usa **Node.js + MySQL**.

## 1) Preparazione VPS

Connettiti in SSH al VPS e installa dipendenze base:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx mysql-server git
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

## 2) Database MySQL

```bash
sudo mysql -e "CREATE DATABASE IF NOT EXISTS isp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER IF NOT EXISTS 'isp_user'@'localhost' IDENTIFIED BY 'CAMBIA_PASSWORD';"
sudo mysql -e "GRANT ALL PRIVILEGES ON isp.* TO 'isp_user'@'localhost'; FLUSH PRIVILEGES;"
```

Importa lo schema:

```bash
mysql -u isp_user -p isp < database.sql
```

## 3) App Node

```bash
git clone <URL_DEL_TUO_REPO> isp
cd isp
npm install
cp .env.example .env
```

Modifica `.env`:

```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=isp_user
DB_PASSWORD=CAMBIA_PASSWORD
DB_NAME=isp
```

Avvio con PM2:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## 4) Nginx reverse proxy + dominio

Crea config Nginx:

```bash
sudo nano /etc/nginx/sites-available/isp
```

Contenuto:

```nginx
server {
    listen 80;
    server_name TUO_DOMINIO_O_IP;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Attiva e riavvia:

```bash
sudo ln -s /etc/nginx/sites-available/isp /etc/nginx/sites-enabled/isp
sudo nginx -t
sudo systemctl restart nginx
```

## 5) HTTPS (consigliato)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d TUO_DOMINIO
```

## Nota importante

Se hai un piano Hostinger **shared hosting senza processo Node persistente**, questa app non può girare così com'è. In quel caso servono:
- VPS Hostinger, oppure
- riscrittura backend in PHP.
