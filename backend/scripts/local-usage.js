require('./local-env');

const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
  });
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT count(*) FROM public.profiles)::int AS users,
        (SELECT count(*) FROM public.reports)::int AS reports,
        (SELECT count(*) FROM storage.objects WHERE bucket_id = 'report-images')::int AS images,
        (SELECT coalesce(sum((metadata->>'size')::bigint), 0)
           FROM storage.objects WHERE bucket_id = 'report-images') AS image_bytes,
        pg_database_size(current_database()) AS database_bytes
    `);
    const usage = rows[0];
    const mib = (bytes) => (Number(bytes) / 1024 / 1024).toFixed(2);
    console.log(`الحسابات: ${usage.users}`);
    console.log(`البلاغات: ${usage.reports}`);
    console.log(`الصور: ${usage.images} (${mib(usage.image_bytes)} MB)`);
    console.log(`حجم قاعدة البيانات: ${mib(usage.database_bytes)} MB`);
    console.log('حجم قاعدة البيانات يشمل جداول Supabase الداخلية، ولا يشمل ملفات تشغيل الخدمات.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  if (error.code === 'ECONNREFUSED') {
    console.error('Supabase المحلي متوقف. شغّله أولًا: npm run supabase:start:local');
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});
