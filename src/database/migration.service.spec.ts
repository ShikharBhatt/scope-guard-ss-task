import { MigrationService } from './migration.service';
import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

describe('MigrationService', () => {
  let service: MigrationService;
  let mockPool: Partial<Pool>;
  let mockClient: Partial<PoolClient>;
  let tempMigrationsDir: string;

  beforeEach(() => {
    mockClient = {
      query: jest.fn().mockImplementation((query: string) => {
        if (query.includes('SELECT name FROM schema_migrations')) {
          return Promise.resolve({ rows: [{ name: '001_initial.sql' }] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient as PoolClient),
    };

    service = new MigrationService(mockPool as Pool);

    tempMigrationsDir = path.join(process.cwd(), 'temp_test_migrations');
    if (!fs.existsSync(tempMigrationsDir)) {
      fs.mkdirSync(tempMigrationsDir);
    }
    fs.writeFileSync(path.join(tempMigrationsDir, '001_initial.sql'), 'CREATE TABLE test1 (id INT);');
    fs.writeFileSync(path.join(tempMigrationsDir, '002_second.sql'), 'CREATE TABLE test2 (id INT);');
  });

  afterEach(() => {
    if (fs.existsSync(tempMigrationsDir)) {
      fs.rmSync(tempMigrationsDir, { recursive: true, force: true });
    }
  });

  it('should run only unapplied migrations in order within transactions', async () => {
    const applied = await service.runMigrations(tempMigrationsDir);

    expect(applied).toEqual(['002_second.sql']);
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('CREATE TABLE test2 (id INT);');
    expect(mockClient.query).toHaveBeenCalledWith(
      'INSERT INTO schema_migrations (name) VALUES ($1)',
      ['002_second.sql'],
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('should rollback transaction if migration fails', async () => {
    (mockClient.query as jest.Mock).mockImplementation((query: string) => {
      if (query.includes('SELECT name FROM schema_migrations')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('CREATE TABLE test1')) {
        throw new Error('Syntax error');
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(service.runMigrations(tempMigrationsDir)).rejects.toThrow('Syntax error');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

