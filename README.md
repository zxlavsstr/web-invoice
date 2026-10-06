# Web Sistem Data Entry & Invoice

Proyek: web-invoice

## Fitur
- Master data: Produk/Jasa, Pelanggan
- Modul invoice: buat invoice, tambah item, hitung subtotal/ppn/total, simpan
- Tampilan daftar invoice + detail invoice
- Ekspor: unduh invoice sebagai PDF (opsional) / cetak browser

## Stack (default)
- Backend: Node.js + Express
- Database: SQLite (file)
- Frontend: HTML/CSS/Vanilla JS (server-side templating sederhana)

## Jalankan
```bash
cd web-invoice
npm install
npm run dev
```
Akses: http://localhost:3000

## Struktur
- `server.js` - server Express
- `db.sqlite` - database SQLite (dibuat otomatis saat start pertama)
- `views/` - halaman
- `public/` - aset (CSS/JS)

