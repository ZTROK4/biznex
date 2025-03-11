const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: '3.109.200.225',
  database: 'master_db',
  password: 'postgres',
  port: 5432,
});

module.exports = pool;
