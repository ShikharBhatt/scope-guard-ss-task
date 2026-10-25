import { TargetNormalizer } from './target-normalizer';
import { BadRequestException } from '@nestjs/common';

describe('TargetNormalizer', () => {
  it('should normalize uppercase hostname to lowercase', () => {
    expect(TargetNormalizer.normalize('APP.DEV.EXAMPLE.COM')).toBe('app.dev.example.com');
  });

  it('should strip trailing DNS dot', () => {
    expect(TargetNormalizer.normalize('app.dev.example.com.')).toBe('app.dev.example.com');
    expect(TargetNormalizer.normalize('HTTPS://APP.DEV.EXAMPLE.COM./LOGIN')).toBe(
      'app.dev.example.com:443',
    );
  });

  it('should normalize URLs and targets with ports', () => {
    expect(TargetNormalizer.normalize('https://app.dev.example.com:443/login?q=1')).toBe(
      'app.dev.example.com:443',
    );
    expect(TargetNormalizer.normalize('http://internal.service:80/health')).toBe('internal.service:80');
    expect(TargetNormalizer.normalize('api.service.test:8080')).toBe('api.service.test:8080');
    expect(TargetNormalizer.normalize('api.service.test:*')).toBe('api.service.test:*');
    expect(TargetNormalizer.normalize('bare.domain.test')).toBe('bare.domain.test');
  });

  it('should support IPv4 and IPv6 bracketed hosts with and without ports', () => {
    expect(TargetNormalizer.normalize('192.168.1.10')).toBe('192.168.1.10');
    expect(TargetNormalizer.normalize('http://127.0.0.1:3000/')).toBe('127.0.0.1:3000');
    expect(TargetNormalizer.normalize('[::1]:8080')).toBe('[::1]:8080');
    expect(TargetNormalizer.normalize('[::1]')).toBe('[::1]');
  });

  it('should parse targets into discrete host and port components', () => {
    expect(TargetNormalizer.parseTarget('api.example.com:8080')).toEqual({
      host: 'api.example.com',
      port: 8080,
    });
    expect(TargetNormalizer.parseTarget('api.example.com:*')).toEqual({
      host: 'api.example.com',
      port: '*',
    });
    expect(TargetNormalizer.parseTarget('api.example.com')).toEqual({
      host: 'api.example.com',
      port: null,
    });
    expect(TargetNormalizer.parseTarget('[::1]:8443')).toEqual({
      host: '[::1]',
      port: 8443,
    });
    expect(TargetNormalizer.parseTarget('[::1]')).toEqual({
      host: '[::1]',
      port: null,
    });
  });

  it('should reject userinfo tricks', () => {
    expect(() => TargetNormalizer.normalize('admin:password@attacker.com')).toThrow(
      BadRequestException,
    );
    expect(() => TargetNormalizer.normalize('https://user:pass@evil.com/path')).toThrow(
      BadRequestException,
    );
  });

  it('should reject wildcards and pattern characters in host', () => {
    expect(() => TargetNormalizer.normalize('*.example.com')).toThrow(BadRequestException);
    expect(() => TargetNormalizer.normalize('api-*.example.com')).toThrow(BadRequestException);
    expect(() => TargetNormalizer.normalize('%20example.com')).toThrow(BadRequestException);
  });

  it('should reject unsupported protocols', () => {
    expect(() => TargetNormalizer.normalize('ftp://ftp.example.com/file')).toThrow(
      BadRequestException,
    );
    expect(() => TargetNormalizer.normalize('file:///etc/passwd')).toThrow(BadRequestException);
  });

  it('should reject empty or whitespace inputs', () => {
    expect(() => TargetNormalizer.normalize('')).toThrow(BadRequestException);
    expect(() => TargetNormalizer.normalize('   ')).toThrow(BadRequestException);
  });

  it('proves suffix and subdomain confusion cannot produce matching normalized hosts', () => {
    const canonical = TargetNormalizer.normalize('example.com');
    const attackerPrefix = TargetNormalizer.normalize('notexample.com');
    const attackerSuffix = TargetNormalizer.normalize('example.com.attacker.test');
    const subdomain = TargetNormalizer.normalize('sub.example.com');

    expect(canonical).not.toBe(attackerPrefix);
    expect(canonical).not.toBe(attackerSuffix);
    expect(canonical).not.toBe(subdomain);
  });
});
