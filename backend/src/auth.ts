import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config';

export const claimsSchema = z.object({
  sub: z.string().min(1),
  tenantId: z.string().min(1),
  tenantName: z.string().min(1).optional(),
  role: z.enum(['instructor', 'learner']),
  exp: z.number().optional(),
});
export type Claims = z.infer<typeof claimsSchema>;

export function signToken(claims: Omit<Claims, 'exp'>, expiresInSec = 8 * 3600): string {
  return jwt.sign(claims, config.jwtSecret, { algorithm: 'HS256', expiresIn: expiresInSec });
}

export function verifyToken(token: string): Claims {
  const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  return claimsSchema.parse(decoded);
}
