import {env} from 'cloudflare:workers';
import {validAccessToken} from './access-token';
export function accessSecrets(){const runtime=env as unknown as Record<string,unknown>,password=String(runtime.HYRULE_ACCESS_PASSWORD||''),secret=String(runtime.PULSE_ENCRYPTION_KEY||'');if(!password||secret.length<32)throw Error('Acceso no configurado.');return {password,secret};}
export async function hasSiteAccess(token:string|undefined){try{return await validAccessToken(token,accessSecrets().secret)}catch{return false;}}
