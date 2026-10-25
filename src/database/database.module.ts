import { Global, Module, OnApplicationShutdown, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DATABASE_POOL } from './database.constants';
import { AppConfig } from '../config/configuration';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>): Pool => {
        const dbConfig = configService.get('database', { infer: true });
        const pool = new Pool({
          host: dbConfig.host,
          port: dbConfig.port,
          user: dbConfig.user,
          password: dbConfig.password,
          database: dbConfig.name,
          ssl: dbConfig.ssl ? { rejectUnauthorized: false } : false,
          max: dbConfig.maxConnections,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });

        pool.on('error', (err) => {
          Logger.error('Unexpected error on idle PostgreSQL client', err.stack, 'DatabaseModule');
        });

        return pool;
      },
    },
  ],
  exports: [PrismaService, DATABASE_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Closing database connections');
  }
}
