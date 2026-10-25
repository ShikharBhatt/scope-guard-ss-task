import { SsrfFilter } from './ssrf-filter';

describe('SsrfFilter', () => {
  describe('production mode (allowLocalMockTargets = false)', () => {
    it('should block IPv4 and IPv6 loopback addresses', () => {
      expect(SsrfFilter.isSafeDestinationIp('127.0.0.1', false)).toBe(false);
      expect(SsrfFilter.isSafeDestinationIp('127.0.1.1', false)).toBe(false);
      expect(SsrfFilter.isSafeDestinationIp('::1', false)).toBe(false);
    });

    it('should block RFC 1918 private subnets', () => {
      expect(SsrfFilter.isSafeDestinationIp('10.0.0.1', false)).toBe(false);
      expect(SsrfFilter.isSafeDestinationIp('172.16.0.1', false)).toBe(false);
      expect(SsrfFilter.isSafeDestinationIp('172.31.255.254', false)).toBe(false);
      expect(SsrfFilter.isSafeDestinationIp('192.168.1.1', false)).toBe(false);
    });

    it('should always block link-local and AWS/cloud metadata address', () => {
      expect(SsrfFilter.isSafeDestinationIp('169.254.169.254', false)).toBe(false);
      expect(SsrfFilter.isSafeDestinationIp('169.254.1.1', false)).toBe(false);
    });

    it('should block multicast and broadcast', () => {
      expect(SsrfFilter.isSafeDestinationIp('224.0.0.1', false)).toBe(false);
      expect(SsrfFilter.isSafeDestinationIp('255.255.255.255', false)).toBe(false);
      expect(SsrfFilter.isSafeDestinationIp('0.0.0.0', false)).toBe(false);
    });

    it('should permit public IPv4 addresses', () => {
      expect(SsrfFilter.isSafeDestinationIp('93.184.216.34', false)).toBe(true);
      expect(SsrfFilter.isSafeDestinationIp('8.8.8.8', false)).toBe(true);
      expect(SsrfFilter.isSafeDestinationIp('1.1.1.1', false)).toBe(true);
    });
  });

  describe('test override mode (allowLocalMockTargets = true)', () => {
    it('should permit loopback addresses exclusively for controlled test mock servers', () => {
      expect(SsrfFilter.isSafeDestinationIp('127.0.0.1', true)).toBe(true);
      expect(SsrfFilter.isSafeDestinationIp('::1', true)).toBe(true);
    });

    it('should still strictly block cloud metadata 169.254.169.254', () => {
      expect(SsrfFilter.isSafeDestinationIp('169.254.169.254', true)).toBe(false);
    });
  });
});

