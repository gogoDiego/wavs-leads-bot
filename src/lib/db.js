import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export async function createFunnel(row) {
  const { data, error } = await supabase
    .from('funnels')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getFunnelByName(ownerSlackId, name) {
  const { data, error } = await supabase
    .from('funnels')
    .select('*')
    .eq('owner_slack_id', ownerSlackId)
    .ilike('name', name)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listFunnelsByOwner(ownerSlackId) {
  const { data, error } = await supabase
    .from('funnels')
    .select('*')
    .eq('owner_slack_id', ownerSlackId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
