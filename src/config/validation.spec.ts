import { validateEnvironment } from './validation';

describe('validateEnvironment', () => {
  const validConfig = {
    PORT: '3000',
    PROXY_PORT: '3128',
    DATABASE_HOST: 'localhost',
    DATABASE_PORT: '5432',
    DATABASE_USER: 'postgres',
    DATABASE_PASSWORD: 'secretpassword',
    DATABASE_NAME: 'scope_guard_test',
    DATABASE_SSL: 'false',
    DATABASE_MAX_CONNECTIONS: '10',
    ALLOW_LOCAL_MOCK_TARGETS: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
  };

  it('should parse and return valid environment variables', () => {
    const validated = validateEnvironment(validConfig);
    expect(validated.PORT).toBe(3000);
    expect(validated.PROXY_PORT).toBe(3128);
    expect(validated.DATABASE_HOST).toBe('localhost');
    expect(validated.DATABASE_PORT).toBe(5432);
    expect(validated.DATABASE_USER).toBe('postgres');
    expect(validated.DATABASE_PASSWORD).toBe('secretpassword');
    expect(validated.DATABASE_NAME).toBe('scope_guard_test');
    expect(validated.DATABASE_SSL).toBe(false);
    expect(validated.DATABASE_MAX_CONNECTIONS).toBe(10);
    expect(validated.ALLOW_LOCAL_MOCK_TARGETS).toBe(true);
    expect(validated.NODE_ENV).toBe('test');
    expect(validated.LOG_LEVEL).toBe('warn');
  });

  it('should apply default values for optional settings', () => {
    const minimalConfig = {
      DATABASE_HOST: 'localhost',
      DATABASE_USER: 'postgres',
      DATABASE_PASSWORD: '',
      DATABASE_NAME: 'scope_guard',
    };
    const validated = validateEnvironment(minimalConfig);
    expect(validated.PORT).toBe(3000);
    expect(validated.PROXY_PORT).toBe(3128);
    expect(validated.DATABASE_PORT).toBe(5432);
    expect(validated.DATABASE_MAX_CONNECTIONS).toBe(20);
    expect(validated.ALLOW_LOCAL_MOCK_TARGETS).toBe(false);
    expect(validated.NODE_ENV).toBe('development');
  });

  it('should fail when required database variables are missing', () => {
    expect(() =>
      validateEnvironment({
        PORT: '3000',
      }),
    ).toThrow('Environment validation failed:');
  });

  it('should fail when port is out of range', () => {
    expect(() =>
      validateEnvironment({
        ...validConfig,
        PORT: '999999',
      }),
    ).toThrow('PORT must be a valid port number');
  });

  it('should fail when proxy port is invalid', () => {
    expect(() =>
      validateEnvironment({
        ...validConfig,
        PROXY_PORT: '-1',
      }),
    ).toThrow('PROXY_PORT must be a valid port number');
  });
});

