import * as net from 'net';

export class SsrfFilter {
  /**
   * Evaluates whether an IP address is safe for outbound egress forwarding.
   *
   * Blocks:
   * - Loopback (127.0.0.0/8, ::1)
   * - Private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
   * - Link-local (169.254.0.0/16 including AWS/GCP metadata 169.254.169.254)
   * - Multicast (224.0.0.0/4)
   * - Unspecified / Broadcast (0.0.0.0, 255.255.255.255)
   *
   * @param ip The resolved IP address to check
   * @param allowLocalMockTargets Development/test override for local mock target testing
   */
  static isSafeDestinationIp(ip: string, allowLocalMockTargets: boolean = false): boolean {
    if (!net.isIP(ip)) {
      return false;
    }

    // Check loopback
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')) {
      return allowLocalMockTargets;
    }

    if (ip === '0.0.0.0' || ip === '::') {
      return false;
    }

    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map((p) => parseInt(p, 10));
      const first = parts[0];
      const second = parts[1];

      if (first === undefined || second === undefined) {
        return false;
      }

      // 10.0.0.0/8
      if (first === 10) {
        return allowLocalMockTargets;
      }

      // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
      if (first === 172 && second >= 16 && second <= 31) {
        return allowLocalMockTargets;
      }

      // 192.168.0.0/16
      if (first === 192 && second === 168) {
        return allowLocalMockTargets;
      }

      // 169.254.0.0/16 (Link-local & cloud metadata)
      if (first === 169 && second === 254) {
        return false;
      }

      // Multicast 224.0.0.0 - 239.255.255.255
      if (first >= 224 && first <= 239) {
        return false;
      }

      // Broadcast
      if (first >= 240) {
        return false;
      }

      return true;
    }

    // IPv6 checks
    if (net.isIPv6(ip)) {
      const lower = ip.toLowerCase();
      // Link-local fe80::/10
      if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
        return false;
      }
      // Unique local fc00::/7
      if (lower.startsWith('fc') || lower.startsWith('fd')) {
        return allowLocalMockTargets;
      }
      // IPv4-mapped IPv6 ::ffff:x.x.x.x
      if (lower.startsWith('::ffff:')) {
        const v4Part = lower.substring(7);
        return this.isSafeDestinationIp(v4Part, allowLocalMockTargets);
      }
    }

    return true;
  }
}

