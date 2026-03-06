const { Pool } = require("pg");

const normalizeConnectionString = (value) => {
  if (!value) return "";
  return value.trim().replace(/^['"]|['"]$/g, "");
};

const connectionString = normalizeConnectionString(process.env.DATABASE_URL);

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is missing. Set it in Railway Variables without surrounding quotes."
  );
}

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const query = (text, params) => pool.query(text, params);

module.exports = { query };
