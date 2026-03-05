# FLIP Schedule A Litigation

Simple case management web app for Schedule A litigation. Frontend is static HTML/CSS/JS, backend is Node + Express with Neon/Postgres.

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Create `.env`:
```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require"
DATABASE_SSL=true
PORT=3000
```

3. Run database schema in Neon:
```
schema.sql
```

4. Start server:
```bash
npm run dev
```

Open `http://localhost:3000`.

## Deploy (Railway)

1. Push this repo to GitHub.
2. Create a Railway project and connect the repo.
3. Add env vars in Railway:
   - `DATABASE_URL`
   - `DATABASE_SSL=true`
   - `PORT=3000`
4. Set `USE_API = true` in `data.js` and push.

Railway will deploy on every push to the connected branch.

## Notes

- `.env` is intentionally ignored.
- Large test CSVs should not be committed.
