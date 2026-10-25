import { validateEnvironment } from './validation';

export interface AppConfig {
  app: {
    port: number;
    proxyPort: number;
    allowLocalMockTargets: boolean;
    nodeEnv: string;
    logLevel: string;
  };
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    ssl: boolean;
    maxConnections: number;
  };
}

export function loadConfiguration(): AppConfig {
  const env = validateEnvironment(process.env);
  return {
    app: {
      port: env.PORT,
      proxyPort: env.PROXY_PORT,
      allowLocalMockTargets: env.ALLOW_LOCAL_MOCK_TARGETS,
      nodeEnv: env.NODE_ENV,
      logLevel: env.LOG_LEVEL,
    },
    database: {
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      name: env.DATABASE_NAME,
      ssl: env.DATABASE_SSL,
      maxConnections: env.DATABASE_MAX_CONNECTIONS,
    },
  };
}

