import type { Redis } from 'ioredis';
import { config } from '../config';

// Atomic: trim window, record this error, and claim the episode with SET NX.
// Episode ends (key deleted) the first time we observe the window below threshold.
const SCRIPT = `
local win, active = KEYS[1], KEYS[2]
local now, windowMs, threshold, member = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), ARGV[4]
redis.call('ZREMRANGEBYSCORE', win, '-inf', now - windowMs)
redis.call('ZADD', win, now, member)
redis.call('PEXPIRE', win, windowMs * 2)
local count = redis.call('ZCARD', win)
if count >= threshold then
  if redis.call('SET', active, '1', 'NX', 'PX', windowMs * 10) then return count end
  return 0
end
redis.call('DEL', active)
return 0
`;

export class AlertDetector {
  constructor(
    private readonly redis: Redis,
    private readonly threshold = config.alertThreshold,
    private readonly windowMs = config.alertWindowMs,
  ) {}

  /** Undo an episode claim whose alert row could not be saved, so the next error can raise it again. */
  async releaseEpisode(tenantId: string, learnerId: string): Promise<void> {
    await this.redis.del(`lp:erralert:${tenantId}:${learnerId}`);
  }

  /**
   * Records one lab.error. Returns the error count in the window if THIS call opened a
   * new alert episode (caller must emit exactly one alert), otherwise 0.
   * `nowMs` is injectable so tests can drive the clock.
   */
  async recordError(tenantId: string, learnerId: string, member: string, nowMs = Date.now()): Promise<number> {
    const res = await this.redis.eval(
      SCRIPT,
      2,
      `lp:errwin:${tenantId}:${learnerId}`,
      `lp:erralert:${tenantId}:${learnerId}`,
      String(nowMs),
      String(this.windowMs),
      String(this.threshold),
      member,
    );
    return Number(res);
  }
}
