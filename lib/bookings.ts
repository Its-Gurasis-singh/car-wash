import { supabase, isSupabaseConfigured } from './supabase';
import { Booking, BookingStats, ServiceType } from '@/types/booking';

/**
 * Decodes a raw booking row from Supabase into the application's Booking type.
 * Ensures all dedicated database columns (customer_name, number, client_no,
 * instagram_user_id, car_count, assigned_detailer, service, address, etc.)
 * are mapped cleanly without any address contamination.
 */
function decodeBookingFromDb(row: any): Booking {
  const rawAddr = row.address || '';
  // Sanitize address in case legacy rows had embedded HTML comments
  const cleanAddress = rawAddr.replace(/\n?<!--meta:[\s\S]*?-->/g, '').trim();

  // Try extracting legacy metadata if row was created under old address-encoding scheme
  let legacyMeta: any = {};
  const match = rawAddr.match(/\n?<!--meta:([\s\S]*?)-->/);
  if (match) {
    try {
      legacyMeta = JSON.parse(match[1]);
    } catch (e) {
      console.warn('[decodeBookingFromDb legacy metadata parse error]:', e);
    }
  }

  const phone = row.number || row.client_no || legacyMeta.number || legacyMeta.client_no || undefined;
  const instagram_user_id = row.instagram_user_id || legacyMeta.instagram_user_id || undefined;
  const instagram_username = row.instagram_username || undefined;
  const email = row.email || undefined;
  const car_count = row.car_count ?? legacyMeta.car_count ?? 1;
  const assigned_detailer = row.assigned_detailer || legacyMeta.assigned_detailer || 'Unassigned';

  return {
    id: row.id,
    customer_name: row.customer_name,
    number: phone,
    client_no: phone,
    instagram_user_id,
    instagram_username,
    email,
    car_count,
    assigned_detailer,
    assigned_detailer_id: row.assigned_detailer_id || null,
    // How the booking was acquired. The website accent keys off this, so a
    // decoder that drops it makes every website booking look like any other.
    source: row.source ?? undefined,
    assignment_status: row.assignment_status ?? null,
    offered_at: row.offered_at ?? null,
    last_declined_by: row.last_declined_by ?? null,
    last_declined_at: row.last_declined_at ?? null,
    price: row.price !== null && row.price !== undefined ? Number(row.price) : undefined,
    engine_bay_fee: row.engine_bay_fee !== null && row.engine_bay_fee !== undefined
      ? Number(row.engine_bay_fee)
      : null,
    out_of_area_fee: row.out_of_area_fee !== null && row.out_of_area_fee !== undefined
      ? Number(row.out_of_area_fee)
      : null,
    service: row.service,
    // Rows created before the shop channel existed have the column default.
    service_location: row.service_location || 'mobile',
    address: cleanAddress,
    booking_date: row.booking_date,
    booking_time: row.booking_time,
    car_type: row.car_type ?? null,
    vehicle_make_model: row.vehicle_make_model || null,
    has_power: Boolean(row.has_power),
    has_water: Boolean(row.has_water),
    status: row.status,
    pet_hair: Boolean(row.pet_hair),
    notes: row.notes ?? null,
    created_at: row.created_at ?? undefined,
    completed_at: row.completed_at ?? null,
  };
}

/**
 * Fetch all bookings from Supabase, ordered by booking date and time.
 */
export async function getBookings(): Promise<Booking[]> {
  if (!isSupabaseConfigured()) {
    console.warn(
      '[Supabase] Credentials not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.'
    );
    return [];
  }

  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true });

  if (error) {
    console.error('[Supabase getBookings error]:', error.message);
    throw new Error(error.message);
  }

  const rows = data || [];
  return rows.map(decodeBookingFromDb);
}

/**
 * Fetch upcoming scheduled bookings (status = 'scheduled'), ordered by date and time ascending.
 */
export async function getUpcomingBookings(): Promise<Booking[]> {
  if (!isSupabaseConfigured()) {
    console.warn('[Supabase] Credentials not configured. Returning empty upcoming bookings.');
    return [];
  }

  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('status', 'scheduled')
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true });

  if (error) {
    console.error('[Supabase getUpcomingBookings error]:', error.message);
    throw new Error(error.message);
  }

  const rows = data || [];
  return rows.map(decodeBookingFromDb);
}

/**
 * Fetch summary statistics from the booking_stats view.
 */
export async function getStats(): Promise<BookingStats> {
  if (!isSupabaseConfigured()) {
    return {
      today_count: 0,
      week_count: 0,
      upcoming_count: 0,
      completed_count: 0,
    };
  }

  const { data, error } = await supabase
    .from('booking_stats')
    .select('*')
    .single();

  if (error) {
    console.error('[Supabase getStats error]:', error.message);
    return {
      today_count: 0,
      week_count: 0,
      upcoming_count: 0,
      completed_count: 0,
    };
  }

  return {
    today_count: Number(data?.today_count || 0),
    week_count: Number(data?.week_count || 0),
    upcoming_count: Number(data?.upcoming_count || 0),
    completed_count: Number(data?.completed_count || 0),
  };
}

function normalizeService(service?: ServiceType): ServiceType | undefined {
  if (!service) return service;
  if (service === 'interior') return 'interior_silver';
  if (service === 'full') return 'full_silver';
  return service;
}

/**
 * Add a new booking row to the bookings table.
 * Each piece of data is stored directly in its dedicated database column.
 */
export async function addBooking(
  data: Omit<Booking, 'id' | 'status'>
): Promise<Booking> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Please set your credentials in .env.local');
  }

  const phone = data.number?.trim() || data.client_no?.trim() || null;
  const instagramUserId = data.instagram_user_id?.trim() || null;
  const instagramUsername = data.instagram_username?.trim().replace(/^@/, '') || null;
  const emailValue = data.email?.trim() || null;
  const carCount = Number(data.car_count) || 1;
  const assignedDetailer = data.assigned_detailer?.trim() || 'Unassigned';
  const cleanAddress = (data.address || '').replace(/\n?<!--meta:[\s\S]*?-->/g, '').trim();

  const payload: any = {
    customer_name: data.customer_name.trim(),
    number: phone,
    client_no: phone,
    instagram_user_id: instagramUserId,
    instagram_username: instagramUsername,
    email: emailValue,
    car_count: carCount,
    assigned_detailer: assignedDetailer,
    assigned_detailer_id: data.assigned_detailer_id ?? null,
    service: normalizeService(data.service) || 'full_gold',
    service_location: data.service_location || 'mobile',
    // Null rather than 0 when left blank, so an unquoted booking stays visibly
    // unquoted instead of counting as a genuine $0 job in the revenue figures.
    price: data.price === undefined || data.price === null ? null : Number(data.price),
    // Null means the surcharge does not apply, so an untouched booking is not
    // recorded as having had a waived engine bay.
    engine_bay_fee:
      data.engine_bay_fee === undefined || data.engine_bay_fee === null
        ? null
        : Number(data.engine_bay_fee),
    out_of_area_fee:
      data.out_of_area_fee === undefined || data.out_of_area_fee === null
        ? null
        : Number(data.out_of_area_fee),
    address: cleanAddress,
    booking_date: data.booking_date,
    booking_time: data.booking_time,
    car_type: data.car_type ?? null,
    vehicle_make_model: data.vehicle_make_model?.trim() || null,
    has_power: Boolean(data.has_power),
    has_water: Boolean(data.has_water),
    status: 'scheduled',
  };

  const { data: created, error } = await supabase
    .from('bookings')
    .insert([payload])
    .select()
    .single();

  if (error) {
    console.error('[Supabase addBooking error]:', error.message);
    throw new Error(error.message);
  }

  return decodeBookingFromDb(created);
}

/**
 * Update an existing booking row.
 * Each piece of data is stored directly in its dedicated database column.
 */
export async function updateBooking(
  id: string,
  data: Partial<Booking>
): Promise<Booking> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Please set your credentials in .env.local');
  }

  const phone =
    data.number !== undefined
      ? (data.number?.trim() || null)
      : (data.client_no !== undefined ? (data.client_no?.trim() || null) : undefined);
  const instagramUserId =
    data.instagram_user_id !== undefined ? (data.instagram_user_id?.trim() || null) : undefined;
  const instagramUsername =
    data.instagram_username !== undefined
      ? (data.instagram_username?.trim().replace(/^@/, '') || null)
      : undefined;
  const emailValue =
    data.email !== undefined ? (data.email?.trim() || null) : undefined;
  const carCount = data.car_count !== undefined ? (Number(data.car_count) || 1) : undefined;
  const assignedDetailer =
    data.assigned_detailer !== undefined ? (data.assigned_detailer?.trim() || 'Unassigned') : undefined;
  const cleanAddress =
    data.address !== undefined
      ? (data.address || '').replace(/\n?<!--meta:[\s\S]*?-->/g, '').trim()
      : undefined;

  const updatePayload: any = {
    ...(data.customer_name !== undefined ? { customer_name: data.customer_name.trim() } : {}),
    ...(phone !== undefined ? { number: phone, client_no: phone } : {}),
    ...(instagramUserId !== undefined ? { instagram_user_id: instagramUserId } : {}),
    ...(instagramUsername !== undefined ? { instagram_username: instagramUsername } : {}),
    ...(emailValue !== undefined ? { email: emailValue } : {}),
    ...(carCount !== undefined ? { car_count: carCount } : {}),
    ...(assignedDetailer !== undefined ? { assigned_detailer: assignedDetailer } : {}),
    ...(data.assigned_detailer_id !== undefined
      ? { assigned_detailer_id: data.assigned_detailer_id }
      : {}),
    ...(data.service ? { service: normalizeService(data.service) } : {}),
    // Sent even when null so clearing the field actually clears the column,
    // matching how instagram_username and email already behave.
    ...(data.price !== undefined
      ? { price: data.price === null ? null : Number(data.price) }
      : {}),
    ...(data.engine_bay_fee !== undefined
      ? { engine_bay_fee: data.engine_bay_fee === null ? null : Number(data.engine_bay_fee) }
      : {}),
    ...(data.out_of_area_fee !== undefined
      ? { out_of_area_fee: data.out_of_area_fee === null ? null : Number(data.out_of_area_fee) }
      : {}),
    ...(data.service_location !== undefined
      ? { service_location: data.service_location }
      : {}),
    ...(cleanAddress !== undefined ? { address: cleanAddress } : {}),
    ...(data.booking_date !== undefined ? { booking_date: data.booking_date } : {}),
    ...(data.booking_time !== undefined ? { booking_time: data.booking_time } : {}),
    ...(data.car_type !== undefined ? { car_type: data.car_type } : {}),
    ...(data.vehicle_make_model !== undefined
      ? { vehicle_make_model: data.vehicle_make_model?.trim() || null }
      : {}),
    ...(data.has_power !== undefined ? { has_power: Boolean(data.has_power) } : {}),
    ...(data.has_water !== undefined ? { has_water: Boolean(data.has_water) } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
  };

  const { data: updated, error } = await supabase
    .from('bookings')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[Supabase updateBooking error]:', error.message);
    throw new Error(error.message);
  }

  return decodeBookingFromDb(updated);
}

/**
 * Delete a booking row by ID.
 */
export async function deleteBooking(id: string): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Please set your credentials in .env.local');
  }

  const { error } = await supabase
    .from('bookings')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[Supabase deleteBooking error]:', error.message);
    throw new Error(error.message);
  }
}

/**
 * Subscribe to realtime changes on the bookings table across all devices.
 * Uses a unique channel name to prevent multi-tab/multi-device collision.
 * Returns an unsubscribe callback for cleanup.
 */
export function subscribeToBookings(callback: () => void): () => void {
  if (!isSupabaseConfigured()) {
    return () => {};
  }

  const channelId = `realtime_bookings_${Math.random().toString(36).substring(2, 9)}`;
  const channel = supabase
    .channel(channelId)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'bookings',
      },
      (payload) => {
        console.log('[Supabase Realtime event across devices]:', payload.eventType);
        callback();
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[Supabase Realtime] Connected and listening for cross-device live sync.');
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Assign (or clear) a booking's detailer.
 *
 * Writes both columns in one statement: assigned_detailer_id is the real link,
 * and assigned_detailer keeps the detailer's name so the Overview page's
 * name-based grouping, search and badges keep working unchanged. Doing it here,
 * in a single place, is what stops the two drifting apart.
 */
export async function assignDetailer(
  bookingId: string,
  detailer: { id: string; name: string } | null
): Promise<Booking> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Please set your credentials in .env.local');
  }

  const { data, error } = await supabase
    .from('bookings')
    .update({
      assigned_detailer_id: detailer ? detailer.id : null,
      assigned_detailer: detailer ? detailer.name : 'Unassigned',
    })
    .eq('id', bookingId)
    .select()
    .single();

  if (error) {
    console.error('[Supabase assignDetailer error]:', error.message);
    throw new Error(error.message);
  }

  return decodeBookingFromDb(data);
}
