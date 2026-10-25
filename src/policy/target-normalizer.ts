import { BadRequestException } from '@nestjs/common';

export interface ParsedTarget {
  host: string;
  port: number | '*' | null;
}

export class TargetNormalizer {
  /**
   * Normalizes a target string or URL into a canonical normalized target (host or host:port).
   *
   * Rules:
   * 1. If given a full URL (e.g. "https://App.Example.com:8443/login"):
   *    - Rejects credentials (user:pass@host).
   *    - Rejects unsupported protocols (only http: and https:).
   *    - Extracts canonical host and port (or default port for scheme: 80 for http, 443 for https).
   *    - Formats as `${host}:${port}`.
   * 2. If given a raw target with port (e.g. "App.Example.COM:8080" or "example.com:443" or "example.com:*"):
   *    - Strips trailing DNS dot from host.
   *    - Lowercases host.
   *    - Validates port (1-65535 or '*').
   *    - Formats as `${host}:${port}`.
   * 3. If given a bare hostname (e.g. "App.Example.COM."):
   *    - Strips trailing DNS dot.
   *    - Lowercases host.
   *    - Formats as `${host}`.
   * 4. Validates RFC 1123 hostname rules or valid IPv4 / bracketed IPv6.
   */
  static normalize(input: string): string {
    if (!input || typeof input !== 'string') {
      throw new BadRequestException('Target cannot be empty');
    }

    const trimmed = input.trim();
    if (!trimmed) {
      throw new BadRequestException('Target cannot be empty or whitespace');
    }

    // Check for userinfo tricks before parsing: e.g. "user:pass@evil.com"
    if (trimmed.includes('@')) {
      throw new BadRequestException('Target contains credentials or userinfo, which is forbidden');
    }

    let hostPart = '';
    let portPart: number | '*' | null = null;

    // Check if input starts with a scheme
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);

    if (hasScheme) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(trimmed);
      } catch {
        throw new BadRequestException(`Malformed URL: ${trimmed}`);
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new BadRequestException(
          `Unsupported protocol "${parsedUrl.protocol}". Only HTTP and HTTPS are permitted.`,
        );
      }

      if (parsedUrl.username || parsedUrl.password) {
        throw new BadRequestException('Target contains URL userinfo credentials');
      }

      hostPart = parsedUrl.hostname;
      if (parsedUrl.port) {
        const p = parseInt(parsedUrl.port, 10);
        if (isNaN(p) || p <= 0 || p > 65535) {
          throw new BadRequestException(`Invalid port in target: ${trimmed}`);
        }
        portPart = p;
      } else {
        portPart = parsedUrl.protocol === 'https:' ? 443 : 80;
      }
    } else {
      // Input might contain a path, query, or port, e.g. "api.example.com/v1" or "api.example.com:8080"
      if (trimmed.includes('/') || trimmed.includes('?')) {
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(`http://${trimmed}`);
        } catch {
          throw new BadRequestException(`Malformed target: ${trimmed}`);
        }
        hostPart = parsedUrl.hostname;
        if (parsedUrl.port) {
          const p = parseInt(parsedUrl.port, 10);
          if (isNaN(p) || p <= 0 || p > 65535) {
            throw new BadRequestException(`Invalid port in target: ${trimmed}`);
          }
          portPart = p;
        }
      } else {
        // Raw hostname, possibly with port like "example.com:8080", "example.com:*", or IPv6 "[::1]:80"
        const raw = trimmed;
        if (raw.startsWith('[')) {
          // IPv6 address
          const closeBracket = raw.indexOf(']');
          if (closeBracket === -1) {
            throw new BadRequestException(`Malformed IPv6 target: ${trimmed}`);
          }
          hostPart = raw.substring(0, closeBracket + 1);
          const rest = raw.substring(closeBracket + 1);
          if (rest.startsWith(':')) {
            const pStr = rest.substring(1);
            if (pStr === '*') {
              portPart = '*';
            } else {
              const p = parseInt(pStr, 10);
              if (isNaN(p) || p <= 0 || p > 65535) {
                throw new BadRequestException(`Invalid port in target: ${trimmed}`);
              }
              portPart = p;
            }
          }
        } else if (raw.includes(':')) {
          const colonIndex = raw.lastIndexOf(':');
          const pStr = raw.substring(colonIndex + 1);
          hostPart = raw.substring(0, colonIndex);
          if (pStr === '*') {
            portPart = '*';
          } else {
            const p = parseInt(pStr, 10);
            if (isNaN(p) || p <= 0 || p > 65535) {
              throw new BadRequestException(`Invalid port in target: ${trimmed}`);
            }
            portPart = p;
          }
        } else {
          hostPart = raw;
        }
      }
    }

    // Strip trailing DNS dot (e.g. "example.com." -> "example.com")
    if (hostPart.endsWith('.')) {
      hostPart = hostPart.slice(0, -1);
    }

    hostPart = hostPart.toLowerCase();

    if (!hostPart) {
      throw new BadRequestException(`Invalid empty hostname from target: ${trimmed}`);
    }

    // Disallow wildcards or invalid characters in hostname
    if (hostPart.includes('*') || hostPart.includes('%') || hostPart.includes('\\')) {
      throw new BadRequestException(`Wildcards and special pattern characters are not permitted in host: ${trimmed}`);
    }

    // Check against standard DNS hostname regex or IPv4 / IPv6
    const isIPv6 = /^\[[a-f0-9:]+\]$/.test(hostPart);
    const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostPart);
    const isHostname = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
      hostPart,
    );

    if (!isIPv6 && !isIPv4 && !isHostname) {
      throw new BadRequestException(`Invalid hostname format: ${hostPart}`);
    }

    return portPart !== null ? `${hostPart}:${portPart}` : hostPart;
  }

  /**
   * Parses a normalized target into discrete host and port components.
   */
  static parseTarget(target: string): ParsedTarget {
    const trimmed = target.trim();
    if (trimmed.startsWith('[')) {
      const closeBracket = trimmed.indexOf(']');
      if (closeBracket === -1) {
        return { host: trimmed.toLowerCase(), port: null };
      }
      const host = trimmed.substring(0, closeBracket + 1).toLowerCase();
      const rest = trimmed.substring(closeBracket + 1);
      if (rest.startsWith(':')) {
        const pStr = rest.substring(1);
        if (pStr === '*') {
          return { host, port: '*' };
        }
        const parsedInt = parseInt(pStr, 10);
        return { host, port: isNaN(parsedInt) ? null : parsedInt };
      }
      return { host, port: null };
    }

    if (trimmed.includes(':')) {
      const colonIndex = trimmed.lastIndexOf(':');
      const host = trimmed.substring(0, colonIndex).toLowerCase();
      const pStr = trimmed.substring(colonIndex + 1);
      if (pStr === '*') {
        return { host, port: '*' };
      }
      const parsedInt = parseInt(pStr, 10);
      return { host, port: isNaN(parsedInt) ? null : parsedInt };
    }

    return { host: trimmed.toLowerCase(), port: null };
  }
}
