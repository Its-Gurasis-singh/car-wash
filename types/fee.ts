/**
 * One job's commission, as the money sees it. From `booking_fees`, written by a
 * database trigger the moment a booking is completed and never recomputed after,
 * so a later change to the fee settings cannot rewrite what a job was charged.
 *
 * The detailer collected `customer_total` in full at the job and owes Absolute
 * the commission. That commission is Absolute's revenue on the job - the rest
 * never passes through the business at all.
 */
export interface BookingFee {
  id: string;
  booking_id: string;
  detailer_id: string;
  service: string;
  customer_total: number;
  /** Cars the package fee was charged for. 1 on rows from the old per-booking rule. */
  car_count: number;
  package_fee_per_car: number | null;
  package_fee: number | null;
  /** Absolute's share of the add-ons, included in fee_amount. */
  pet_hair_fee: number;
  engine_bay_commission: number;
  /** Computed at completion. Null = the package had no fee set ("Fee not set"). */
  fee_amount: number | null;
  commission_override: number | null;
  override_reason: string | null;
  /** The override if set, otherwise fee_amount. Null only when neither exists. */
  effective_amount: number | null;
  /** Null for an override on a job that was not completed (a no-show fee). */
  completed_at: string | null;
  /** Brampton date the commission is earned on: completion, or the service date for a no-show fee. */
  completed_on: string;
  week_start: string;
  /** 7 days after the week ends. Set by the database. */
  due_on: string;
  /** Joined for display. */
  detailer_name?: string;
  customer_name?: string;
}

/** A completed job whose package has no fee configured, and no override. */
export function isFeeNotSet(f: Pick<BookingFee, 'completed_at' | 'fee_amount' | 'commission_override'>): boolean {
  return f.completed_at != null && f.fee_amount == null && f.commission_override == null;
}

export type PaymentMethod = 'e_transfer' | 'cash' | 'other';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  e_transfer: 'e-Transfer',
  cash: 'Cash',
  other: 'Other',
};

/** Money a detailer paid Absolute. Recorded against the detailer, not a week or a job. */
export interface DetailerPayment {
  id: string;
  detailer_id: string;
  amount: number;
  /** Brampton date. It counts in the week of its Monday. */
  paid_on: string;
  method: PaymentMethod;
  note: string | null;
  created_at: string;
}

export interface PaymentInput {
  detailer_id: string;
  amount: number;
  paid_on: string;
  method: PaymentMethod;
  note: string | null;
}

/** One detailer's Mon-Sun week, from detailer_week_statements(). */
export interface WeekStatement {
  detailer_id: string;
  week_start: string;
  /** Carried from every earlier week. */
  opening: number;
  earned: number;
  paid: number;
  closing: number;
}

export interface ServiceFee {
  service_key: string;
  /** Null = no fee set. */
  fee_per_car: number | null;
  is_active: boolean;
  updated_at: string;
}

export type AddonKey = 'pet_hair' | 'engine_bay';

export interface AddonFee {
  addon_key: AddonKey;
  fee: number;
  is_active: boolean;
  updated_at: string;
}

export const ADDON_LABELS: Record<AddonKey, string> = {
  pet_hair: 'Pet hair',
  engine_bay: 'Engine bay',
};
