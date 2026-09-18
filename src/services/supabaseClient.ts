import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://xlbdypsxinbyqthszmvi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsYmR5cHN4aW5ieXF0aHN6bXZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3NjUwNTksImV4cCI6MjEwNDM0MTA1OX0.W0vaJznsbAKAHIvr0d1yFaIP70rjVH8FKEPig1FP0gE';

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
    if (!client) {
        client = createClient(supabaseUrl, supabaseKey);
    }
    return client;
}

export async function recordBookingInSupabase(booking: {
    id: string;
    booking_id: string;
    user_address?: string;
    operator_address?: string;
    satellite: string;
    norad_id?: number;
    window_text?: string;
    locked_amount?: string;
    status?: string;
    tx_hash?: string;
    etherscan_url?: string;
    metadata?: any;
}) {
    try {
        const sb = getSupabaseClient();
        const payload = {
            id: booking.id,
            booking_id: booking.booking_id,
            user_address: (booking.user_address || '0xc25f9F0Ce27A2D248c43563a32cDC4886D069176').toLowerCase(),
            operator_address: booking.operator_address || null,
            satellite: booking.satellite,
            norad_id: booking.norad_id || null,
            window_text: booking.window_text || 'Active Window',
            locked_amount: booking.locked_amount || '0.0001 ETH',
            status: booking.status || 'ACTIVE',
            tx_hash: booking.tx_hash || null,
            etherscan_url: booking.etherscan_url || (booking.tx_hash ? `https://sepolia.etherscan.io/tx/${booking.tx_hash}` : null),
            metadata: booking.metadata || {}
        };

        const { data, error } = await sb
            .from('bookings')
            .upsert(payload, { onConflict: 'id' })
            .select()
            .single();

        if (error) {
            console.error('[Supabase Backend] Error recording booking:', error.message);
            return null;
        }
        console.log(`[Supabase Backend] Successfully recorded booking ${booking.id}`);
        return data;
    } catch (e: any) {
        console.error('[Supabase Backend] Exception recording booking:', e.message);
        return null;
    }
}

export async function updateBookingSettlementInSupabase(
    bookingIdOrRef: string,
    status: 'SETTLED' | 'REFUNDED' | 'ACTIVE' | 'PENDING' | 'PARTIALLY_SETTLED',
    settlementTxHash: string,
    metadata?: any
) {
    try {
        const sb = getSupabaseClient();
        
        const { data: records } = await sb
            .from('bookings')
            .select('id')
            .or(`id.eq.${bookingIdOrRef},booking_id.eq.${bookingIdOrRef}`);

        if (records && records.length > 0) {
            for (const rec of records) {
                await sb
                    .from('bookings')
                    .update({
                        status,
                        settlement_tx_hash: settlementTxHash,
                        etherscan_url: `https://sepolia.etherscan.io/tx/${settlementTxHash}`,
                        metadata: metadata || {}
                    })
                    .eq('id', rec.id);
                console.log(`[Supabase Backend] Updated booking ${rec.id} to ${status}`);
            }
        }
    } catch (e: any) {
        console.error('[Supabase Backend] Exception updating settlement:', e.message);
    }
}

export async function getOperatorListingsFromSupabase() {
    try {
        const sb = getSupabaseClient();
        const { data, error } = await sb
            .from('operator_listings')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[Supabase Backend] Error fetching listings:', error.message);
            return [];
        }
        return data || [];
    } catch (e: any) {
        console.error('[Supabase Backend] Exception fetching listings:', e.message);
        return [];
    }
}

export async function getProfilesFromSupabase() {
    try {
        const sb = getSupabaseClient();
        const { data, error } = await sb
            .from('profiles')
            .select('*')
            .order('reputation_score', { ascending: false });

        if (error) {
            console.error('[Supabase Backend] Error fetching profiles:', error.message);
            return [];
        }
        return data || [];
    } catch (e: any) {
        console.error('[Supabase Backend] Exception fetching profiles:', e.message);
        return [];
    }
}
