export type CarType = 'sedan' | 'hatchback' | 'suv' | 'van' | 'mini_truck' | 'other';
export type ServiceType =
  | 'interior_silver'
  | 'interior_gold'
  | 'interior_titanium'
  | 'full_silver'
  | 'full_gold'
  | 'full_titanium'
  | 'ceramic_tint'
  | 'nano_ceramic_tint'
  | 'interior'
  | 'full';
export type BookingStatus = 'scheduled' | 'completed' | 'cancelled';

/**
 * Whether the assigned detailer has taken the job in the detailer portal.
 *
 * Separate from BookingStatus, which is the job's own lifecycle. Null means
 * nobody is assigned - including after a decline, which hands the booking back
 * to the unassigned queue rather than marking it rejected.
 */
export type AssignmentStatus = 'pending' | 'accepted';

/**
 * Which channel the job runs through: a mobile visit or an in-shop appointment.
 * Distinct from `source`, which records how the booking was acquired.
 */
export type ServiceLocation = 'mobile' | 'shop';

export interface Booking {
  id: string;
  customer_name: string;
  number?: string;
  client_no?: string;
  /** Numeric Instagram account ID, owned by the DM automation. Not linkable. */
  instagram_user_id?: string;
  /** Public Instagram @handle (stored without the leading "@"). */
  instagram_username?: string;
  /** Contact email. Suggested when booking, but never required. */
  email?: string;
  car_count?: number;
  assigned_detailer?: string;
  /**
   * The real link to a detailers row. assigned_detailer above is kept in sync
   * with that detailer name so existing name-based grouping keeps working.
   */
  assigned_detailer_id?: string | null;
  /** Set by the detailer portal when they accept; reset on every reassignment. */
  assignment_status?: AssignmentStatus | null;
  /**
   * When this job went onto the open board for detailers to claim. Null once
   * somebody holds it. The clock behind the "unclaimed for two hours" alert.
   */
  offered_at?: string | null;
  /** Which detailer last handed this booking back, if any. */
  last_declined_by?: string | null;
  last_declined_at?: string | null;
  /**
   * The BASE price for the service, tax included. Surcharges are NOT in here —
   * see bookingTotal() for what the customer actually pays.
   */
  price?: number;
  /**
   * Surcharges, stored as the amount charged rather than as a flag, so that
   * changing the standard rate later cannot silently rewrite what an old job
   * was billed. Null means the surcharge does not apply to this booking; 0
   * means it applies but was waived.
   */
  engine_bay_fee?: number | null;
  out_of_area_fee?: number | null;
  service: ServiceType;
  /** Mobile visit or in-shop job. Defaults to 'mobile' for pre-existing rows. */
  service_location?: ServiceLocation;
  /** How the booking was acquired: 'manual', 'instagram_dm' or 'website'. */
  source?: string;
  address: string;
  booking_date: string;
  booking_time: string;
  /** No longer collected - pricing is flat. Older rows keep theirs. */
  car_type?: CarType | null;
  /** Free text, e.g. "2021 Honda CR-V". Optional; it just tells the detailer what to expect. */
  vehicle_make_model?: string | null;
  has_power: boolean;
  has_water: boolean;
  status: BookingStatus;
}

export interface BookingStats {
  today_count: number;
  week_count: number;
  upcoming_count: number;
  completed_count: number;
}

/** Standard surcharges. Prefilled on the form; the stored amount is what counts. */
export const OUT_OF_AREA_FEE = 20;
/**
 * Per 7-seater vehicle, any package. Folded into `price` (like pet hair), with
 * "7-seater +$30" in the notes - the chatbot and website both do it that way.
 */
export const SEVEN_SEATER_FEE = 30;
export const PET_HAIR_FEE = 25;
/** Of which Absolute's share is $10; the detailer keeps $15. Mirrors sync_booking_fee(). */
export const PET_HAIR_FEE_TO_ABSOLUTE = 10;

/**
 * List price per vehicle for each package on offer. Flat - a sedan and an SUV
 * cost the same - which is why vehicle type is no longer asked. The form uses
 * this to prefill the price; it stays editable.
 */
export const SERVICE_PRICES: Partial<Record<ServiceType, number>> = {
  interior_gold: 130,
  full_gold: 160,
  interior_titanium: 170,
  full_titanium: 200,
};

/**
 * Standard engine bay price per vehicle, which depends on the package: cheapest
 * with Titanium Full (the upsell), dearest with an interior-only job. Same rates
 * the Instagram chatbot quotes.
 */
export function engineBayFeeFor(service: ServiceType): number {
  if (service.startsWith('interior')) return 60;
  if (service === 'full_titanium') return 30;
  return 50;
}

export const SURCHARGE_LABELS = {
  engine_bay: 'Engine bay',
  out_of_area: 'Outside service area',
};

/**
 * What the customer actually pays: the base price plus any surcharges.
 *
 * Every figure that represents money — the revenue on the Finance page, the
 * chip on a booking card, the amount a detailer sees — goes through this, so
 * the base and the extras can never be added up differently in two places.
 *
 * Returns null when the booking has no price and no surcharges at all, which is
 * how an unquoted job stays visibly unquoted instead of counting as $0.
 */
export function bookingTotal(booking: {
  price?: number;
  engine_bay_fee?: number | null;
  out_of_area_fee?: number | null;
}): number | null {
  const parts = [booking.price, booking.engine_bay_fee, booking.out_of_area_fee].filter(
    (v): v is number => v !== null && v !== undefined
  );
  if (parts.length === 0) return null;
  return parts.reduce((sum, v) => sum + v, 0);
}

export const SERVICE_LABELS: Record<string, string> = {
  interior_silver: 'Interior Silver',
  interior_gold: 'Interior Gold',
  interior_titanium: 'Interior Titanium',
  full_silver: 'Full Silver',
  full_gold: 'Full Gold',
  full_titanium: 'Full Titanium',
  ceramic_tint: 'Ceramic Tint',
  nano_ceramic_tint: 'Nano Ceramic Tint',
  interior: 'Interior Detailing',
  full: 'Full Detailing',
};

export const SERVICE_LOCATION_LABELS: Record<ServiceLocation, string> = {
  mobile: 'Mobile',
  shop: 'Shop',
};

/**
 * Services offered when creating a NEW booking, in dropdown order.
 *
 * Excludes the legacy 'interior' / 'full' values, which stay in ServiceType and
 * SERVICE_LABELS so any older row still renders. This list only controls what
 * can be picked going forward.
 */
export const BOOKABLE_SERVICES: ServiceType[] = [
  'full_gold',
  'interior_gold',
  'full_titanium',
  'interior_titanium',
];

/**
 * Some services get a visually distinct card so they can be picked out of a long
 * list at a glance. Tint is a different job from detailing — different kit,
 * different prep — so it reads as indigo rather than the usual sage.
 *
 * Defined once here because the dashboard, the admin list and the overview
 * explorer all render the same booking; keeping the classes in one place is what
 * stops those three views drifting apart.
 */
const TINT_CARD =
  'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300/80 dark:border-indigo-400/40 border-l-4 border-l-indigo-500 dark:border-l-indigo-400';
const TINT_BADGE = 'bg-indigo-100 text-indigo-800 border-indigo-300';
const TINT_ROW =
  'bg-indigo-50/70 dark:bg-indigo-500/10 hover:bg-indigo-100/70 dark:hover:bg-indigo-500/20';

const CARD_ACCENTS: Record<string, string> = {
  ceramic_tint: TINT_CARD,
  nano_ceramic_tint: TINT_CARD,
};

const BADGE_ACCENTS: Record<string, string> = {
  ceramic_tint: TINT_BADGE,
  nano_ceramic_tint: TINT_BADGE,
};

const ROW_ACCENTS: Record<string, string> = {
  ceramic_tint: TINT_ROW,
  nano_ceramic_tint: TINT_ROW,
};

/**
 * Bookings that arrive from the website form have had no conversation yet — the
 * customer is waiting on a confirmation call — so they read as amber rather than
 * sage, and carry a small badge. Applied on top of the service accent.
 */
const WEBSITE_CARD =
  'bg-amber-50 dark:bg-amber-500/10 border-amber-300/80 dark:border-amber-400/40 border-l-4 border-l-amber-500 dark:border-l-amber-400 hover:border-amber-400';
const WEBSITE_ROW =
  'bg-amber-50/70 dark:bg-amber-500/10 hover:bg-amber-100/70 dark:hover:bg-amber-500/20';
export const WEBSITE_BADGE = 'bg-amber-100 text-amber-900 border-amber-300';

export function isWebsiteBooking(b: { source?: string | null }): boolean {
  return b.source === 'website';
}

/** Card classes for a whole booking: website origin wins, then the service accent. */
export function bookingCardAccent(b: { source?: string | null; service?: string }, fallback: string = DEFAULT_CARD_ACCENT): string {
  return isWebsiteBooking(b) ? WEBSITE_CARD : serviceCardAccent(b.service, fallback);
}

/** Row classes for a whole booking, same precedence as bookingCardAccent. */
export function bookingRowAccent(b: { source?: string | null; service?: string }): string {
  return isWebsiteBooking(b) ? WEBSITE_ROW : serviceRowAccent(b.service);
}

export const DEFAULT_CARD_ACCENT =
  'bg-charcoal-card border-charcoal-border/60 hover:border-sage-300/80';
export const DEFAULT_SERVICE_BADGE = 'bg-sage-50 text-sage-800 border-sage-200';
export const DEFAULT_ROW_ACCENT = 'hover:bg-sage-50/40';

/** Card container classes for a booking, falling back to the standard card. */
export function serviceCardAccent(service?: string, fallback: string = DEFAULT_CARD_ACCENT): string {
  return (service && CARD_ACCENTS[service]) || fallback;
}

/** Service pill classes, falling back to the standard sage pill. */
export function serviceBadgeAccent(service?: string): string {
  return (service && BADGE_ACCENTS[service]) || DEFAULT_SERVICE_BADGE;
}

/** Table row classes for the overview explorer. */
export function serviceRowAccent(service?: string): string {
  return (service && ROW_ACCENTS[service]) || DEFAULT_ROW_ACCENT;
}

export const CAR_TYPE_LABELS: Record<CarType, string> = {
  sedan: 'Sedan',
  hatchback: 'Hatchback',
  suv: 'SUV',
  van: 'Van',
  mini_truck: 'Mini Truck',
  other: 'Other',
};

export const STATUS_LABELS: Record<BookingStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
