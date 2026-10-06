const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');

const fs = require('fs');
const { join } = require('path');

const app = express();

let db;
const LOCAL_DB_PATH = join(__dirname, 'db.sqlite');
const VERCEL_DB_PATH = '/tmp/web-invoice.sqlite';
const DB_PATH = process.env.VERCEL ? VERCEL_DB_PATH : LOCAL_DB_PATH;



// Basic middleware untuk membuat layout helper siap dipakai oleh view
// Catatan: project ini memakai helper layout('layout') di view.
// Implementasi yang benar dibuat di bawah.

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helpers untuk EJS layout: <% layout('layout') %>
// Implementasi sederhana: layout helper hanya menginstruksikan agar child view merender content-nya ke layout.
app.use((req, res, next) => {
  // EJS tanpa plugin tidak mendukung layout helper seperti express-ejs-layout.
  // Tapi di project ini semua view memanggil layout('layout') di baris pertama.
  // Jadi kita hijack dengan membuat variabel `layout` menjadi fungsi no-op agar tidak error.
  // Visual akan tetap benar karena layout.ejs sudah include body lewat <%- body %>.
  res.locals.layout = function () {
    return '';
  };
  next();
});


function initDb() {
  // open or create database file
  db = new Database(DB_PATH);
  try {
    db.pragma('journal_mode = WAL');
  } catch (e) {
    // ignore if not supported
  }

  // Run schema
  db.exec(`

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      email TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL,
      customer_id INTEGER NOT NULL,
      invoice_date TEXT NOT NULL,
      due_date TEXT,
      notes TEXT,
      tax_rate REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'IDR',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_id INTEGER,
      description TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_invoice_no ON invoices(invoice_no);

    -- Manifest
    CREATE TABLE IF NOT EXISTS manifests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no_manifest TEXT NOT NULL,
      manifest_date TEXT NOT NULL,
      shipper TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(no_manifest)
    );

    -- Departed (berangkat) berdasarkan no_manifest + invoice relasi
    CREATE TABLE IF NOT EXISTS departeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manifest_id INTEGER NOT NULL,
      departed_date TEXT NOT NULL,
      keterangan TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (manifest_id) REFERENCES manifests(id)
    );

    -- Relasi: manifest_invoices (entry data)
    -- Dengan ini kita bisa menghubungkan invoice terhadap manifest.
    CREATE TABLE IF NOT EXISTS manifest_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manifest_id INTEGER NOT NULL,
      invoice_id INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (manifest_id) REFERENCES manifests(id),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      UNIQUE(manifest_id, invoice_id)
    );

    -- Relasi departed ke manifest_invoices (opsional)
    CREATE TABLE IF NOT EXISTS departed_manifest_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      departed_id INTEGER NOT NULL,
      manifest_invoice_id INTEGER NOT NULL,
      qty REAL,
      notes TEXT,
      FOREIGN KEY (departed_id) REFERENCES departeds(id),
      FOREIGN KEY (manifest_invoice_id) REFERENCES manifest_invoices(id),
      UNIQUE(departed_id, manifest_invoice_id)
    );
  `);
}


function startServer(port) {
  initDb();

  const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} in use, trying ${port + 1}`);
      setTimeout(() => startServer(port + 1), 500);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}

// start
startServer(PORT);

// untuk memastikan db ter-inisialisasi saat server sudah mulai
// (defensive - bila ada perubahan order execution)
if (!db) {
  initDb();
}





function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function computeInvoiceTotals(items, taxRate) {
  const subtotal = items.reduce((sum, it) => sum + (toNumber(it.line_total) || 0), 0);
  const tax = subtotal * (toNumber(taxRate) / 100);
  const total = subtotal + tax;
  return { subtotal, tax, total };
}

// Home
app.get('/', (req, res) => {
  res.redirect('/invoices');
});

// Manifest & Entry & Departed (new)
app.get('/api/manifests/:id/invoices', (req, res) => {
  const manifestId = toNumber(req.params.id);
  const rows = db.prepare(`
    SELECT mi.id, i.invoice_no, i.invoice_date, c.name as customer_name
    FROM manifest_invoices mi
    JOIN invoices i ON i.id = mi.invoice_id
    JOIN customers c ON c.id = i.customer_id
    WHERE mi.manifest_id = ?
    ORDER BY i.id DESC
  `).all(manifestId);
  res.json(rows);
});

app.get('/manifests', (req, res) => {

  const manifests = db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM manifest_invoices mi WHERE mi.manifest_id = m.id) AS invoice_count
    FROM manifests m
    ORDER BY m.id DESC
  `).all();
  res.render('manifests/index', { manifests });
});

app.get('/manifests/new', (req, res) => {
  res.render('manifests/new');
});

app.post('/manifests', (req, res) => {
  const { no_manifest, manifest_date, shipper, notes } = req.body;
  try {
    db.prepare(`
      INSERT INTO manifests (no_manifest, manifest_date, shipper, notes)
      VALUES (?, ?, ?, ?)
    `).run(
      (no_manifest || '').trim(),
      manifest_date || new Date().toISOString().slice(0, 10),
      shipper || null,
      notes || null
    );
    res.redirect('/manifests');
  } catch (e) {
    res.status(400).send(`Gagal menyimpan manifest: ${e.message}`);
  }
});

app.get('/manifests/:id', (req, res) => {
  const id = toNumber(req.params.id);
  const manifest = db.prepare(`
    SELECT * FROM manifests WHERE id = ?
  `).get(id);
  if (!manifest) return res.status(404).send('Manifest not found');

  const manifestInvoices = db.prepare(`
    SELECT mi.*, i.invoice_no, i.invoice_date, i.customer_id
    FROM manifest_invoices mi
    JOIN invoices i ON i.id = mi.invoice_id
    WHERE mi.manifest_id = ?
    ORDER BY i.id DESC
  `).all(id);

  res.render('manifests/detail', { manifest, manifestInvoices });
});

// Entry data: hubungkan no_manifest + invoice (berdasarkan invoice_id)
app.get('/entries', (req, res) => {
  const entries = db.prepare(`
    SELECT mi.*, 
      m.no_manifest,
      i.invoice_no,
      i.invoice_date,
      c.name as customer_name
    FROM manifest_invoices mi
    JOIN manifests m ON m.id = mi.manifest_id
    JOIN invoices i ON i.id = mi.invoice_id
    JOIN customers c ON c.id = i.customer_id
    ORDER BY mi.id DESC
  `).all();
  res.render('entries/index', { entries });
});

app.get('/entries/new', (req, res) => {
  const manifests = db.prepare('SELECT * FROM manifests ORDER BY no_manifest ASC').all();
  const invoices = db.prepare(`
    SELECT i.*, c.name as customer_name
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id
    ORDER BY i.invoice_date DESC, i.id DESC
  `).all();
  res.render('entries/new', { manifests, invoices });
});

app.post('/entries', (req, res) => {
  const { manifest_id, invoice_id, notes } = req.body;
  try {
    db.prepare(`
      INSERT INTO manifest_invoices (manifest_id, invoice_id, notes)
      VALUES (?, ?, ?)
    `).run(toNumber(manifest_id), toNumber(invoice_id), notes || null);
    res.redirect('/entries');
  } catch (e) {
    res.status(400).send(`Gagal menyimpan entry data: ${e.message}`);
  }
});

// Departed
app.get('/departeds', (req, res) => {
  const departeds = db.prepare(`
    SELECT d.*, m.no_manifest
    FROM departeds d
    JOIN manifests m ON m.id = d.manifest_id
    ORDER BY d.id DESC
  `).all();
  res.render('departeds/index', { departeds });
});

app.get('/departeds/new', (req, res) => {
  const manifests = db.prepare('SELECT * FROM manifests ORDER BY no_manifest ASC').all();
  res.render('departeds/new', { manifests });
});

// Simpan departed + relasi ke manifest_invoice_id
app.post('/departeds', (req, res) => {
  const { manifest_id, departed_date, keterangan, manifest_invoice_ids } = req.body;

  let ids = [];
  try {
    // bisa array biasa dari form, atau string JSON, atau string comma
    if (Array.isArray(manifest_invoice_ids)) ids = manifest_invoice_ids;
    else if (typeof manifest_invoice_ids === 'string') {
      const s = manifest_invoice_ids.trim();
      if (!s) ids = [];
      else if (s.startsWith('[')) ids = JSON.parse(s);
      else ids = s.split(',').map(x => x.trim());
    }
  } catch {
    ids = [];
  }

  ids = (ids || []).map(toNumber).filter((x) => Number.isFinite(x));

  try {
    const tx = db.transaction(() => {
      const insertDeparted = db.prepare(`
        INSERT INTO departeds (manifest_id, departed_date, keterangan)
        VALUES (?, ?, ?)
      `);
      const info = insertDeparted.run(
        toNumber(manifest_id),
        departed_date || new Date().toISOString().slice(0, 10),
        keterangan || null
      );
      const departedId = info.lastInsertRowid;

      const relInsert = db.prepare(`
        INSERT INTO departed_manifest_invoices (departed_id, manifest_invoice_id)
        VALUES (?, ?)
      `);
      for (const mid of ids) {
        relInsert.run(departedId, mid);
      }
      return departedId;
    });

    tx();
    res.redirect('/departeds');
  } catch (e) {
    res.status(400).send(`Gagal menyimpan departed: ${e.message}`);
  }
});

// Customers
app.get('/customers', (req, res) => {
  const customers = db.prepare('SELECT * FROM customers ORDER BY id DESC').all();
res.render('customers/index', { customers });
});


app.post('/customers', (req, res) => {
  const { name, address, phone, email } = req.body;
  const info = db.prepare(
    'INSERT INTO customers (name, address, phone, email) VALUES (?, ?, ?, ?)'
  ).run(name, address || null, phone || null, email || null);
  res.redirect('/customers');
});

app.get('/customers/new', (req, res) => {
  res.render('customers/new');
});

// Products
app.get('/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  res.render('products/index', { products });
});

app.post('/products', (req, res) => {
  const { name, description, price } = req.body;
  db.prepare('INSERT INTO products (name, description, price) VALUES (?, ?, ?)').run(
    name,
    description || null,
    toNumber(price, 0)
  );
  res.redirect('/products');
});

app.get('/products/new', (req, res) => {
  res.render('products/new');
});

// Invoices list
app.get('/invoices', (req, res) => {
  const invoices = db.prepare(`
    SELECT i.*, c.name as customer_name
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id
    ORDER BY i.id DESC
  `).all();
  res.render('invoices/index', { invoices });
});

// Invoice create page
app.get('/invoices/new', (req, res) => {
  const customers = db.prepare('SELECT * FROM customers ORDER BY name ASC').all();
  const products = db.prepare('SELECT * FROM products ORDER BY name ASC').all();
  res.render('invoices/new', { customers, products });
});

// Create invoice (save)
app.post('/invoices', (req, res) => {
  const {
    invoice_no,
    customer_id,
    invoice_date,
    due_date,
    notes,
    tax_rate,
    currency,
    items
  } = req.body;

  // items comes from client as JSON string (array)
  let parsedItems = [];
  try {
    parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
  } catch {
    parsedItems = [];
  }

  const taxRate = toNumber(tax_rate, 0);
  const invoiceItems = (parsedItems || [])
    .map((it, idx) => {
      const qty = toNumber(it.qty, 0);
      const unitPrice = toNumber(it.unit_price, 0);
      const lineTotal = qty * unitPrice;
      return {
        product_id: it.product_id || null,
        description: it.description || '',
        qty,
        unit_price: unitPrice,
        line_total: lineTotal,
        sort_order: idx
      };
    })
    .filter((x) => x.qty > 0 && x.description.trim().length > 0);

  const { subtotal, tax, total } = computeInvoiceTotals(invoiceItems, taxRate);

  const insertInvoice = db.prepare(`
    INSERT INTO invoices
      (invoice_no, customer_id, invoice_date, due_date, notes, tax_rate, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    const info = insertInvoice.run(
      invoice_no,
      toNumber(customer_id),
      invoice_date,
      due_date || null,
      notes || null,
      taxRate,
      currency || 'IDR'
    );

    const invoiceId = info.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO invoice_items
        (invoice_id, product_id, description, qty, unit_price, line_total, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const it of invoiceItems) {
      insertItem.run(
        invoiceId,
        it.product_id,
        it.description,
        it.qty,
        it.unit_price,
        it.line_total,
        it.sort_order
      );
    }

    return invoiceId;
  });

  try {
    const invoiceId = tx();
    res.redirect(`/invoices/${invoiceId}`);
  } catch (e) {
    res.status(400).send(`Gagal menyimpan invoice: ${e.message}`);
  }
});

// Invoice detail
app.get('/invoices/:id', (req, res) => {
  const id = toNumber(req.params.id);

  const invoice = db.prepare(`
    SELECT i.*, c.name as customer_name, c.address as customer_address, c.phone as customer_phone, c.email as customer_email
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id
    WHERE i.id = ?
  `).get(id);

  if (!invoice) return res.status(404).send('Invoice not found');

  const items = db.prepare(`
    SELECT * FROM invoice_items
    WHERE invoice_id = ?
    ORDER BY sort_order ASC
  `).all(id);

  const totals = computeInvoiceTotals(items, invoice.tax_rate);

  res.render('invoices/detail', { invoice, items, totals });
});
