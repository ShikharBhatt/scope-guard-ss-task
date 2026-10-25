import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from './database.constants';
import * as fs from 'fs';
import * as path from 'path';

export interface MigrationFile {
  name: string;
  sql: string;
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async runMigrations(migrationsDir?: string): Promise<string[]> {
    const dir = migrationsDir || path.resolve(process.cwd(), 'migrations');
    this.logger.log(`Running database migrations from ${dir}`);

    const client = await this.pool.connect();
    try {
      await this.ensureMigrationTable(client);

      const appliedNames = await this.getAppliedMigrations(client);
      const migrationFiles = this.loadMigrationFiles(dir);

      const appliedThisRun: string[] = [];

      for (const file of migrationFiles) {
        if (!appliedNames.has(file.name)) {
          this.logger.log(`Applying migration: ${file.name}`);
          await this.applyMigration(client, file);
          appliedThisRun.push(file.name);
          this.logger.log(`Successfully applied: ${file.name}`);
        } else {
          this.logger.debug(`Migration ${file.name} already applied; skipping.`);
        }
      }

      return appliedThisRun;
    } finally {
      client.release();
    }
  }

  private async ensureMigrationTable(client: PoolClient): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await client.query(query);
  }

  private async getAppliedMigrations(client: PoolClient): Promise<Set<string>> {
    const result = await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY id ASC');
    return new Set(result.rows.map((r) => r.name));
  }

  private loadMigrationFiles(dir: string): MigrationFile[] {
    if (!fs.existsSync(dir)) {
      return [];
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    return files.map((fileName) => ({
      name: fileName,
      sql: fs.readFileSync(path.join(dir, fileName), 'utf-8'),
    }));
  }

  private async applyMigration(client: PoolClient, file: MigrationFile): Promise<void> {
    await client.query('BEGIN');
    try {
      await client.query(file.sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file.name]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to apply migration ${file.name}: ${(error as Error).message}`);
      throw error;
    }
  }
}

