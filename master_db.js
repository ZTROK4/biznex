const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: '13.201.59.200',
  database: 'master_db',
  password: 'aCas()0aDskldnkn12124',
  port: 5432,
});

module.exports = pool;
