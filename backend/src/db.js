const { Pool } = require('pg');

function createPool(connectionString) {
  const pool = new Pool({ connectionString });
  pool.on('error', (error) => console.error('PostgreSQL pool error', error));
  return pool;
}

module.exports = { createPool };
