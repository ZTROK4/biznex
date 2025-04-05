const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: '65.0.19.183',
  database: 'master_db',
  password: 'MiniProBizNex@%32,8t%O1g-t@DontHackMe',
  port: 5432,
});

module.exports = pool;
