import { Injectable } from '@nestjs/common';
import { TargetNormalizer, ParsedTarget } from './target-normalizer';

export interface TargetRule {
  normalizedTarget: string;
  effect: 'ALLOW' | 'DENY';
}

export type PolicyDecisionReason =
  | 'IN_SCOPE'
  | 'DENY_RULE_MATCHED'
  | 'NO_ALLOW_RULE'
  | 'ENGAGEMENT_REVOKED'
  | 'ENGAGEMENT_INACTIVE'
  | 'INVALID_TARGET';

export interface PolicyEvaluationResult {
  decision: 'ALLOW' | 'DENY';
  reason: PolicyDecisionReason;
  normalizedTarget: string;
}

@Injectable()
export class PolicyEvaluatorService {
  /**
   * Helper function to match a requested destination against a target policy rule.
   */
  private matchesRule(dest: ParsedTarget, ruleTarget: string, effect: 'ALLOW' | 'DENY'): boolean {
    const rule = TargetNormalizer.parseTarget(ruleTarget);
    if (rule.host !== dest.host) {
      return false;
    }

    if (effect === 'DENY') {
      // If deny rule has no port specified or wildcard port, it denies the host on ALL ports
      if (rule.port === null || rule.port === '*') {
        return true;
      }
      // If destination has no port specified, host match is sufficient to deny
      if (dest.port === null) {
        return true;
      }
      // Otherwise, exact port match required
      return rule.port === dest.port;
    }

    // ALLOW rule matching:
    // 1. Wildcard port matches any destination port
    if (rule.port === '*') {
      return true;
    }

    // 2. If destination did not specify a port
    if (dest.port === null) {
      return rule.port === null || rule.port === 80 || rule.port === 443;
    }

    // 3. Destination specified an explicit port
    if (rule.port !== null) {
      return rule.port === dest.port;
    }

    // 4. Rule is a bare host (e.g. 'example.com' without port):
    // Bare host ALLOW rule authorizes standard web ports (80 and 443) only.
    // Non-web ports (e.g. 22 SSH, 8080 alt-http, 3306 db) are rejected.
    return dest.port === 80 || dest.port === 443;
  }

  /**
   * Evaluates an outbound destination against an engagement's status and scope rules.
   *
   * Security guarantees:
   * 1. Engagement must be ACTIVE.
   * 2. Deny rules take absolute precedence over allow rules.
   * 3. Target matching validates both host and port.
   * 4. Default is DENY.
   */
  evaluate(
    rawDestination: string,
    engagementStatus: 'ACTIVE' | 'REVOKED' | string,
    rules: TargetRule[],
  ): PolicyEvaluationResult {
    let normalized: string;
    try {
      normalized = TargetNormalizer.normalize(rawDestination);
    } catch {
      return {
        decision: 'DENY',
        reason: 'INVALID_TARGET',
        normalizedTarget: rawDestination,
      };
    }

    if (engagementStatus === 'REVOKED') {
      return {
        decision: 'DENY',
        reason: 'ENGAGEMENT_REVOKED',
        normalizedTarget: normalized,
      };
    }

    if (engagementStatus !== 'ACTIVE') {
      return {
        decision: 'DENY',
        reason: 'ENGAGEMENT_INACTIVE',
        normalizedTarget: normalized,
      };
    }

    const dest = TargetNormalizer.parseTarget(normalized);

    // Check deny rules first (Deny overrides allow)
    const hasDenyMatch = rules.some(
      (r) => r.effect === 'DENY' && this.matchesRule(dest, r.normalizedTarget, 'DENY'),
    );
    if (hasDenyMatch) {
      return {
        decision: 'DENY',
        reason: 'DENY_RULE_MATCHED',
        normalizedTarget: normalized,
      };
    }

    // Check allow rules
    const hasAllowMatch = rules.some(
      (r) => r.effect === 'ALLOW' && this.matchesRule(dest, r.normalizedTarget, 'ALLOW'),
    );
    if (hasAllowMatch) {
      return {
        decision: 'ALLOW',
        reason: 'IN_SCOPE',
        normalizedTarget: normalized,
      };
    }

    // Default deny
    return {
      decision: 'DENY',
      reason: 'NO_ALLOW_RULE',
      normalizedTarget: normalized,
    };
  }
}
