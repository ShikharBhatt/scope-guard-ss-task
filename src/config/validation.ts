export interface EnvironmentVariables {
  PORT: number;
  PROXY_PORT: number;
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_USER: string;
  DATABASE_PASSWORD: string;
  DATABASE_NAME: string;
  DATABASE_SSL: boolean;
  DATABASE_MAX_CONNECTIONS: number;
  ALLOW_LOCAL_MOCK_TARGETS: boolean;
  NODE_ENV: string;
  LOG_LEVEL: string;
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const errors: string[] = [];

  const port = parseInt(String(config.PORT ?? '3000'), 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    errors.push('PORT must be a valid port number between 1 and 65535');
  }

  const proxyPort = parseInt(String(config.PROXY_PORT ?? '3128'), 10);
  if (isNaN(proxyPort) || proxyPort <= 0 || proxyPort > 65535) {
    errors.push('PROXY_PORT must be a valid port number between 1 and 65535');
  }

  const dbPort = parseInt(String(config.DATABASE_PORT ?? '5432'), 10);
  if (isNaN(dbPort) || dbPort <= 0 || dbPort > 65535) {
    errors.push('DATABASE_PORT must be a valid port number between 1 and 65535');
  }

  const dbHost = String(config.DATABASE_HOST || '').trim();
  if (!dbHost) {
    errors.push('DATABASE_HOST is required');
  }

  const dbUser = String(config.DATABASE_USER || '').trim();
  if (!dbUser) {
    errors.push('DATABASE_USER is required');
  }

  const dbPassword = String(config.DATABASE_PASSWORD ?? '');
  // Password can be empty in local dev, but should be defined
  if (config.DATABASE_PASSWORD === undefined) {
    errors.push('DATABASE_PASSWORD is required');
  }

  const dbName = String(config.DATABASE_NAME || '').trim();
  if (!dbName) {
    errors.push('DATABASE_NAME is required');
  }

  const maxConnections = parseInt(String(config.DATABASE_MAX_CONNECTIONS ?? '20'), 10);
  if (isNaN(maxConnections) || maxConnections <= 0) {
    errors.push('DATABASE_MAX_CONNECTIONS must be a positive number');
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n - ${errors.join('\n - ')}`);
  }

  return {
    PORT: port,
    PROXY_PORT: proxyPort,
    DATABASE_HOST: dbHost,
    DATABASE_PORT: dbPort,
    DATABASE_USER: dbUser,
    DATABASE_PASSWORD: dbPassword,
    DATABASE_NAME: dbName,
    DATABASE_SSL: String(config.DATABASE_SSL).toLowerCase() === 'true',
    DATABASE_MAX_CONNECTIONS: maxConnections,
    ALLOW_LOCAL_MOCK_TARGETS: String(config.ALLOW_LOCAL_MOCK_TARGETS ?? 'false').toLowerCase() === 'true',
    NODE_ENV: String(config.NODE_ENV || 'development').toLowerCase(),
    LOG_LEVEL: String(config.LOG_LEVEL || 'info').toLowerCase(),
  };
}

