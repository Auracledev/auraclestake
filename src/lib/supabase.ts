import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const VAULT_WALLET = "7NRCgd7Sr9JCnNF4HXPJ5CAvi5G6MCfkpJHyaD2HqEpP";
export const ADMIN_WALLET = "5Yxovq832tezBgHRCMrwwAganP6Yg7TNk1npMQX5NfoD";
export const AURACLE_MINT = "5EoNPSEMcFMuzz3Fr7ho3TiweifUumLaBXMQpVZRpump";
