# TODO - Manifest & Departed Web

## Rencana Implementasi
1. Update database schema di `server.js`:
   - Tambah tabel `manifests`, `departeds`, dan relasi `manifest_invoices`.
2. Implement backend routes di `server.js`:
   - CRUD Manifest: `/manifests`, `/manifests/new`, `/manifests/:id`
   - CRUD Departed: `/departeds`, `/departeds/new`
   - Entry data (relasi no_manifest + invoice): `/entries`, `/entries/new`
3. Tambah views (EJS):
   - `views/manifests/index.ejs`, `views/manifests/new.ejs`, `views/manifests/detail.ejs`
   - `views/departeds/index.ejs`, `views/departeds/new.ejs`
   - `views/entries/index.ejs`, `views/entries/new.ejs`
4. Tambah navigation link sederhana dari halaman utama/list yang relevan (minimal di layout).
5. Test manual:
   - Buat invoice → buat manifest (no_manifest) → entry relasi manifest+invoice → create departed.

## Status
- [x] Step 1: DB schema update
- [x] Step 2: Routes backend
- [x] Step 3: EJS views
- [ ] Step 4: Navigation
- [ ] Step 5: Testing


