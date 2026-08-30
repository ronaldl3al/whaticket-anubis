require('../bootstrap');
const url = process.env.DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  module.exports = {
    dialect: 'postgres',
    dialectOptions: { ssl: process.env.DB_SSL === 'true' ? { require: true, rejectUnauthorized: false } : false },
    host: parsed.hostname,
    port: parsed.port || 5432,
    database: parsed.pathname.slice(1),
    username: parsed.username,
    password: parsed.password,
    logging: false
  };
} else {
  module.exports = {
    define: { charset: 'utf8mb4', collate: 'utf8mb4_bin' },
    dialect: process.env.DB_DIALECT || 'mysql',
    timezone: '-03:00',
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    logging: false
  };
}
