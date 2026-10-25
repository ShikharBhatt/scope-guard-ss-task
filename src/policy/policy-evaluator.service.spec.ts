import { PolicyEvaluatorService, TargetRule } from './policy-evaluator.service';

describe('PolicyEvaluatorService', () => {
  let evaluator: PolicyEvaluatorService;

  beforeEach(() => {
    evaluator = new PolicyEvaluatorService();
  });

  const baseRules: TargetRule[] = [
    { normalizedTarget: 'app.dev.example.com', effect: 'ALLOW' },
    { normalizedTarget: 'api.partner.org:8080', effect: 'ALLOW' },
    { normalizedTarget: 'internal.corp', effect: 'DENY' },
  ];

  it('should allow standard web ports (443 and 80) when bare host matches allow rule', () => {
    const resultHttps = evaluator.evaluate('https://app.dev.example.com/login', 'ACTIVE', baseRules);
    expect(resultHttps.decision).toBe('ALLOW');
    expect(resultHttps.reason).toBe('IN_SCOPE');
    expect(resultHttps.normalizedTarget).toBe('app.dev.example.com:443');

    const resultHttp = evaluator.evaluate('http://app.dev.example.com/login', 'ACTIVE', baseRules);
    expect(resultHttp.decision).toBe('ALLOW');
    expect(resultHttp.reason).toBe('IN_SCOPE');
    expect(resultHttp.normalizedTarget).toBe('app.dev.example.com:80');
  });

  it('should deny non-web ports (e.g. SSH 22, alt-port 8443) when only bare host is allowed', () => {
    const resultSsh = evaluator.evaluate('app.dev.example.com:22', 'ACTIVE', baseRules);
    expect(resultSsh.decision).toBe('DENY');
    expect(resultSsh.reason).toBe('NO_ALLOW_RULE');

    const resultAlt = evaluator.evaluate('app.dev.example.com:8080', 'ACTIVE', baseRules);
    expect(resultAlt.decision).toBe('DENY');
    expect(resultAlt.reason).toBe('NO_ALLOW_RULE');
  });

  it('should allow exact port when explicit port rule is configured', () => {
    const result = evaluator.evaluate('http://api.partner.org:8080/v1', 'ACTIVE', baseRules);
    expect(result.decision).toBe('ALLOW');
    expect(result.reason).toBe('IN_SCOPE');
    expect(result.normalizedTarget).toBe('api.partner.org:8080');

    // Port 80 should be denied since only 8080 is permitted
    const resultPort80 = evaluator.evaluate('http://api.partner.org/v1', 'ACTIVE', baseRules);
    expect(resultPort80.decision).toBe('DENY');
    expect(resultPort80.reason).toBe('NO_ALLOW_RULE');
  });

  it('should deny request when target is out of scope (default deny)', () => {
    const result = evaluator.evaluate('https://unauthorized.target.com', 'ACTIVE', baseRules);
    expect(result.decision).toBe('DENY');
    expect(result.reason).toBe('NO_ALLOW_RULE');
  });

  it('should deny all ports when matching a host-level deny rule', () => {
    const resultHttp = evaluator.evaluate('http://internal.corp:80/admin', 'ACTIVE', baseRules);
    expect(resultHttp.decision).toBe('DENY');
    expect(resultHttp.reason).toBe('DENY_RULE_MATCHED');

    const resultSsh = evaluator.evaluate('internal.corp:22', 'ACTIVE', baseRules);
    expect(resultSsh.decision).toBe('DENY');
    expect(resultSsh.reason).toBe('DENY_RULE_MATCHED');

    const resultAlt = evaluator.evaluate('http://internal.corp:8080/admin', 'ACTIVE', baseRules);
    expect(resultAlt.decision).toBe('DENY');
    expect(resultAlt.reason).toBe('DENY_RULE_MATCHED');
  });

  it('should prioritize port-specific DENY over host-wide ALLOW', () => {
    const rules: TargetRule[] = [
      { normalizedTarget: 'shared.example.com', effect: 'ALLOW' },
      { normalizedTarget: 'shared.example.com:80', effect: 'DENY' },
    ];

    // Port 80 denied
    const resultHttp = evaluator.evaluate('http://shared.example.com', 'ACTIVE', rules);
    expect(resultHttp.decision).toBe('DENY');
    expect(resultHttp.reason).toBe('DENY_RULE_MATCHED');

    // Port 443 still allowed
    const resultHttps = evaluator.evaluate('https://shared.example.com', 'ACTIVE', rules);
    expect(resultHttps.decision).toBe('ALLOW');
    expect(resultHttps.reason).toBe('IN_SCOPE');
  });

  it('should support wildcard port rules (host:*)', () => {
    const rules: TargetRule[] = [
      { normalizedTarget: 'dynamic.example.com:*', effect: 'ALLOW' },
    ];

    expect(evaluator.evaluate('dynamic.example.com:3000', 'ACTIVE', rules).decision).toBe('ALLOW');
    expect(evaluator.evaluate('dynamic.example.com:8080', 'ACTIVE', rules).decision).toBe('ALLOW');
    expect(evaluator.evaluate('dynamic.example.com:9999', 'ACTIVE', rules).decision).toBe('ALLOW');
  });

  it('should deny all requests when engagement status is REVOKED', () => {
    const result = evaluator.evaluate('https://app.dev.example.com', 'REVOKED', baseRules);
    expect(result.decision).toBe('DENY');
    expect(result.reason).toBe('ENGAGEMENT_REVOKED');
  });

  it('should deny all requests when engagement status is inactive/unknown', () => {
    const result = evaluator.evaluate('https://app.dev.example.com', 'PENDING', baseRules);
    expect(result.decision).toBe('DENY');
    expect(result.reason).toBe('ENGAGEMENT_INACTIVE');
  });

  it('should deny and report INVALID_TARGET on malformed inputs', () => {
    const result = evaluator.evaluate('ftp://malformed.target', 'ACTIVE', baseRules);
    expect(result.decision).toBe('DENY');
    expect(result.reason).toBe('INVALID_TARGET');
  });
});
