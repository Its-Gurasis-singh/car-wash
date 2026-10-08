import { supabase, isSupabaseConfigured } from './supabase';
import {
  AddonFee,
  BookingFee,
  DetailerPayment,
  PaymentInput,
  ServiceFee,
  WeekStatement,
} from '@/types/fee';

const num = (v: any): number | null => (v === null || v === undefined ? null : Number(v));

function decodeFee(row: any): BookingFee {
  const d = Array.isArray(row.detailers) ? row.detailers[0] : row.detailers;
  const b = Array.isArray(row.bookings) ? row.bookings[0] : row.bookings;
  return {
    id: row.id,
    booking_id: row.booking_id,
    detailer_id: row.detailer_id,
    service: row.service,
    customer_total: Number(row.customer_total ?? 0),
    car_count: Number(row.car_count ?? 1),
    package_fee_per_car: num(row.package_fee_per_car),
    package_fee: num(row.package_fee),
    pet_hair_fee: Number(row.pet_hair_fee ?? 0),
    engine_bay_commission: Number(row.engine_bay_commission ?? 0),
    fee_amount: num(row.fee_amount),
    commission_override: num(row.commission_override),
    override_reason: row.override_reason ?? null,
    effective_amount: num(row.effective_amount),
    completed_at: row.completed_at ?? null,
    completed_on: row.completed_on,
    week_start: row.week_start,
    due_on: row.due_on,
    detailer_name: d?.name,
    customer_name: b?.customer_name,
  };
}

function decodePayment(row: any): DetailerPayment {
  return {
    id: row.id,
    detailer_id: row.detailer_id,
    amount: Number(row.amount),
    paid_on: row.paid_on,
    method: row.method,
    note: row.note ?? null,
    created_at: row.created_at,
  };
}

function fail(where: string, error: { message: string }): never {
  console.error(`[${where}]`, error.message);
  throw new Error(error.message);
}

/** Every commission on the books, newest first. Admin-only by RLS. */
export async function getFees(): Promise<BookingFee[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('booking_fees')
    .select('*, detailers ( name ), bookings ( customer_name )')
    .order('completed_on', { ascending: false });
  if (error) fail('getFees', error);
  return (data || []).map(decodeFee);
}

export async function getPayments(): Promise<DetailerPayment[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('detailer_payments')
    .select('*')
    .order('paid_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) fail('getPayments', error);
  return (data || []).map(decodePayment);
}

export async function addPayment(input: PaymentInput): Promise<DetailerPayment> {
  const { data, error } = await supabase.from('detailer_payments').insert(input).select('*').single();
  if (error) fail('addPayment', error);
  return decodePayment(data);
}

export async function updatePayment(id: string, input: PaymentInput): Promise<DetailerPayment> {
  const { data, error } = await supabase.from('detailer_payments').update(input).eq('id', id).select('*').single();
  if (error) fail('updatePayment', error);
  return decodePayment(data);
}

export async function deletePayment(id: string): Promise<void> {
  const { error } = await supabase.from('detailer_payments').delete().eq('id', id);
  if (error) fail('deletePayment', error);
}

/**
 * Opening / earned / paid / closing for every detailer and every Monday in the
 * window. Computed by the database (detailer_week_statements), the same function
 * the detailer portal reads, so the two apps cannot disagree about a balance.
 */
export async function getStatements(fromMonday: string, toMonday: string): Promise<WeekStatement[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase.rpc('detailer_week_statements', { p_from: fromMonday, p_to: toMonday });
  if (error) fail('getStatements', error);
  return (data || []).map((r: any) => ({
    detailer_id: r.detailer_id,
    week_start: r.week_start,
    opening: Number(r.opening),
    earned: Number(r.earned),
    paid: Number(r.paid),
    closing: Number(r.closing),
  }));
}

/** Set (amount) or clear (null) an admin override on one job's commission. */
export async function setCommissionOverride(bookingId: string, amount: number | null, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_set_commission_override', {
    p_booking_id: bookingId,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) fail('setCommissionOverride', error);
}

export async function getServiceFees(): Promise<ServiceFee[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase.from('service_fees').select('*').order('service_key');
  if (error) fail('getServiceFees', error);
  return (data || []).map((r: any) => ({
    service_key: r.service_key,
    fee_per_car: num(r.fee_per_car),
    is_active: Boolean(r.is_active),
    updated_at: r.updated_at,
  }));
}

export async function getAddonFees(): Promise<AddonFee[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase.from('addon_fees').select('*').order('addon_key');
  if (error) fail('getAddonFees', error);
  return (data || []).map((r: any) => ({
    addon_key: r.addon_key,
    fee: Number(r.fee),
    is_active: Boolean(r.is_active),
    updated_at: r.updated_at,
  }));
}

export async function saveServiceFee(serviceKey: string, feePerCar: number | null, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('service_fees')
    .upsert({ service_key: serviceKey, fee_per_car: feePerCar, is_active: isActive });
  if (error) fail('saveServiceFee', error);
}

export async function saveAddonFee(addonKey: string, fee: number, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('addon_fees')
    .upsert({ addon_key: addonKey, fee, is_active: isActive });
  if (error) fail('saveAddonFee', error);
}

/** Live updates on commissions and payments. Returns an unsubscribe function. */
export function subscribeToLedger(callback: () => void): () => void {
  if (!isSupabaseConfigured()) return () => {};
  const channel = supabase
    .channel(`ledger_${Math.random().toString(36).slice(2, 9)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_fees' }, () => callback())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'detailer_payments' }, () => callback())
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
