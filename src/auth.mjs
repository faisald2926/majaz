import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const hash=token=>createHash('sha256').update(token).digest();
export function issue(){const token=randomBytes(32).toString('base64url');return {token,hash:hash(token).toString('hex')};}
export function authorized(req,stored){const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'');if(!match||!stored)return false;const actual=hash(match[1]),expected=Buffer.from(stored,'hex');return expected.length===actual.length&&timingSafeEqual(expected,actual);}
