import { Pool } from 'pg';
import { loadConfiguration } from '../config/configuration';
import { MigrationService } from './migration.service';
import { Logger } from '@nestjs/common';

async function main() {
  const logger = new Logger('MigrationRunner');
  try {
    const config = loadConfiguration();
    const pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name,
      ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
      max: 2,
    });

    const migrationService = new MigrationService(pool);
    const applied = await migrationService.runMigrations();
    logger.log(`Migration finished. Applied ${applied.length} new migrations.`);
    await pool.end();
    process.exit(0);
  } catch (err) {
    logger.error('Migration failed:', (err as Error).stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

