'use client';

import React, { useState } from 'react';
import {
  Booking,
  ServiceType,
  BookingStatus,
  SERVICE_LABELS,
  SERVICE_PRICES,
  STATUS_LABELS,
  BOOKABLE_SERVICES,
  SURCHARGE_LABELS,
  engineBayFeeFor,
  OUT_OF_AREA_FEE,
  bookingTotal,
} from '@/types/booking';
import { formatMoney } from '@/types/expense';
import { Detailer } from '@/types/detailer';
import { resolveInstagram } from '@/lib/instagram';
import {
  Calendar,
  Clock,
  MapPin,
  User,
  Car,
  Zap,
  Droplet,
  CheckCircle2,
  AlertCircle,
  PlusCircle,
  Phone,
  UserCheck,
  Hash,
  DollarSign,
  Wrench,
  MapPinned,
  Instagram,
  Mail,
} from 'lucide-react';

export type BookingFormData = Omit<Booking, 'id' | 'status'> & { status?: BookingStatus };

/**
 * One optional surcharge: a toggle that applies the standard rate, plus the
 * amount itself so it can be adjusted or waived to zero on a given job.
 * An empty value means the surcharge does not apply at all.
 */
function SurchargeRow({
  id,
  icon: Icon,
  label,
  hint,
  defaultAmount,
  value,
  onChange,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  defaultAmount: number;
  value: string;
  onChange: (next: string) => void;
}) {
  const applied = value.trim() !== '';

  return (
    <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-canvas border border-charcoal-border/70">
      <label htmlFor={id} className="flex items-center gap-2.5 min-w-0 cursor-pointer">
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
            applied ? 'bg-sage-100 text-sage-700' : 'bg-charcoal-border/50 text-charcoal-muted'
          }`}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <span className="text-xs font-semibold text-charcoal block">{label}</span>
          <span className="text-[11px] text-charcoal-muted block">{hint}</span>
        </div>
      </label>

      <div className="flex items-center gap-2 shrink-0">
        {applied && (
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-charcoal-muted text-xs">
              $
            </span>
            <input
              id={id}
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              aria-label={`${label} amount`}
              className="w-20 pl-5 pr-2 py-1.5 rounded-lg text-base sm:text-xs bg-charcoal-card border border-charcoal-border focus:border-sage-500 text-charcoal transition-colors"
            />
          </div>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={applied}
          aria-label={label}
          onClick={() => onChange(applied ? '' : String(defaultAmount))}
          className={`w-10 h-6 rounded-full relative transition-colors ${
            applied ? 'bg-sage-500' : 'bg-charcoal-border'
          }`}
        >
          <span
            className={`absolute top-[2px] h-5 w-5 rounded-full border border-charcoal-border bg-charcoal-card transition-all ${
              applied ? 'left-[18px]' : 'left-[2px]'
            }`}
          />
        </button>
      </div>
    </div>
  );
}

interface BookingFormProps {
  onSubmit?: (data: BookingFormData) => void | Promise<void>;
  initialData?: Partial<Booking>;
  submitButtonLabel?: string;
  isEditing?: boolean;
  /** Active detailers offered in the Assign Detailer dropdown. */
  detailers?: Detailer[];
}

// 9:00 AM to 7:00 PM with 30-minute intervals
const TIME_SLOTS = [
  { value: '09:00:00', label: '9:00 AM' },
  { value: '09:30:00', label: '9:30 AM' },
  { value: '10:00:00', label: '10:00 AM' },
  { value: '10:30:00', label: '10:30 AM' },
  { value: '11:00:00', label: '11:00 AM' },
  { value: '11:30:00', label: '11:30 AM' },
  { value: '12:00:00', label: '12:00 PM' },
  { value: '12:30:00', label: '12:30 PM' },
  { value: '13:00:00', label: '1:00 PM' },
  { value: '13:30:00', label: '1:30 PM' },
  { value: '14:00:00', label: '2:00 PM' },
  { value: '14:30:00', label: '2:30 PM' },
  { value: '15:00:00', label: '3:00 PM' },
  { value: '15:30:00', label: '3:30 PM' },
  { value: '16:00:00', label: '4:00 PM' },
  { value: '16:30:00', label: '4:30 PM' },
  { value: '17:00:00', label: '5:00 PM' },
  { value: '17:30:00', label: '5:30 PM' },
  { value: '18:00:00', label: '6:00 PM' },
  { value: '18:30:00', label: '6:30 PM' },
  { value: '19:00:00', label: '7:00 PM' },
];

export default function BookingForm({
  onSubmit,
  initialData,
  submitButtonLabel = 'Create Booking',
  isEditing = false,
  detailers = [],
}: BookingFormProps) {
  // Get today in YYYY-MM-DD format for min date validation
  const todayDateString = new Date().toISOString().split('T')[0];

  const [customerName, setCustomerName] = useState(initialData?.customer_name || '');
  const [clientNo, setClientNo] = useState(initialData?.number || initialData?.client_no || '');
  // The form edits the public @handle. The numeric instagram_user_id is owned by
  // the DM automation and is deliberately left untouched here.
  const [instagramUsername, setInstagramUsername] = useState(
    resolveInstagram(initialData?.instagram_user_id, initialData?.instagram_username)?.handle || ''
  );
  const [email, setEmail] = useState(initialData?.email || '');
  const [carCount, setCarCount] = useState<number>(initialData?.car_count || 1);
  // Kept as text, not a number, so the field can be genuinely empty. A numeric
  // state would force 0 into an unquoted booking and make it look like free work
  // in the revenue figures.
  const [priceText, setPriceText] = useState<string>(
    initialData?.price != null ? String(initialData.price) : ''
  );
  // Surcharges are held as text for the same reason as price: null (not charged)
  // and 0 (charged but waived) are different facts and both must be expressible.
  const [engineBayText, setEngineBayText] = useState<string>(
    initialData?.engine_bay_fee != null ? String(initialData.engine_bay_fee) : ''
  );
  const [outOfAreaText, setOutOfAreaText] = useState<string>(
    initialData?.out_of_area_fee != null ? String(initialData.out_of_area_fee) : ''
  );
  const [assignedDetailerId, setAssignedDetailerId] = useState<string>(
    initialData?.assigned_detailer_id || ''
  );
  const [service, setService] = useState<ServiceType>(initialData?.service || 'full_gold');

  // A booking made before a service was retired keeps that value in the list, so
  // opening it for edit cannot silently switch it to a different service.
  const serviceOptions: ServiceType[] = BOOKABLE_SERVICES.includes(service)
    ? BOOKABLE_SERVICES
    : [service, ...BOOKABLE_SERVICES];
  const [status, setStatus] = useState<BookingStatus>(initialData?.status || 'scheduled');
  const [address, setAddress] = useState(initialData?.address || '');
  const [bookingDate, setBookingDate] = useState(initialData?.booking_date || todayDateString);
  const [bookingTime, setBookingTime] = useState(initialData?.booking_time || '09:00:00');
  const [vehicleMakeModel, setVehicleMakeModel] = useState(initialData?.vehicle_make_model || '');
  const [hasPower, setHasPower] = useState(initialData?.has_power ?? false);
  const [hasWater, setHasWater] = useState(initialData?.has_water ?? false);

  // What the customer will be charged, as the form currently stands. Computed
  // through the same bookingTotal() the cards and the revenue figures use, so
  // the number shown here is the number that gets counted.
  const liveTotal = bookingTotal({
    price: priceText.trim() === '' ? undefined : Number(priceText),
    engine_bay_fee: engineBayText.trim() === '' ? null : Number(engineBayText),
    out_of_area_fee: outOfAreaText.trim() === '' ? null : Number(outOfAreaText),
  });

  // Changing the package fills in its list price, but never over a figure the
  // admin typed by hand - only over blank, or over the previous package's own
  // list price. Editing an existing booking never touches the price. The engine
  // bay follows the same rule, since its standard rate depends on the package.
  const handleServiceChange = (next: ServiceType) => {
    const current = priceText.trim();
    const wasListPrice = current === '' || Number(current) === SERVICE_PRICES[service];
    const engineBay = engineBayText.trim();
    const wasStandardEngineBay = engineBay !== '' && Number(engineBay) === engineBayFeeFor(service);
    setService(next);
    if (!isEditing && wasListPrice && SERVICE_PRICES[next] != null) {
      setPriceText(String(SERVICE_PRICES[next]));
    }
    if (!isEditing && wasStandardEngineBay) {
      setEngineBayText(String(engineBayFeeFor(next)));
    }
  };

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    if (initialData) {
      setCustomerName(initialData.customer_name || '');
      setClientNo(initialData.number || initialData.client_no || '');
      setInstagramUsername(
        resolveInstagram(initialData.instagram_user_id, initialData.instagram_username)?.handle || ''
      );
      setEmail(initialData.email || '');
      setCarCount(initialData.car_count || 1);
      setPriceText(initialData.price != null ? String(initialData.price) : '');
      setEngineBayText(initialData.engine_bay_fee != null ? String(initialData.engine_bay_fee) : '');
      setOutOfAreaText(initialData.out_of_area_fee != null ? String(initialData.out_of_area_fee) : '');
      setAssignedDetailerId(initialData.assigned_detailer_id || '');
      setService(initialData.service || 'full_gold');
      setStatus(initialData.status || 'scheduled');
      setAddress(initialData.address || '');
      setBookingDate(initialData.booking_date || todayDateString);
      setBookingTime(initialData.booking_time || '09:00:00');
      setVehicleMakeModel(initialData.vehicle_make_model || '');
      setHasPower(initialData.has_power ?? false);
      setHasWater(initialData.has_water ?? false);
    }
  }, [initialData, todayDateString]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!customerName.trim()) {
      newErrors.customer_name = 'Customer name is required';
    }

    if (!address.trim()) {
      newErrors.address = 'Service address is required';
    }

    if (!bookingDate) {
      newErrors.booking_date = 'Booking date is required';
    } else if (bookingDate < todayDateString) {
      newErrors.booking_date = 'Booking date cannot be in the past';
    }

    if (!bookingTime) {
      newErrors.booking_time = 'Booking time is required';
    }

    if (!carCount || carCount < 1) {
      newErrors.car_count = 'Must specify at least 1 vehicle';
    }

    // Price is optional in the same way. Validated only when something was
    // typed, so a booking taken before the quote is settled is still bookable.
    if (priceText.trim()) {
      const parsed = Number(priceText);
      if (!Number.isFinite(parsed) || parsed < 0) {
        newErrors.price = 'Enter a price of 0 or more, or leave it blank';
      }
    }

    // Email is optional. Only validate the format when something was typed,
    // so leaving it blank can never block a booking.
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      newErrors.email = 'Enter a valid email address, or leave it blank';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage(null);

    if (!validateForm()) {
      return;
    }

    const phoneVal = clientNo.trim() || undefined;

    const payload: BookingFormData = {
      customer_name: customerName.trim(),
      number: phoneVal,
      client_no: phoneVal,
      // Sent even when blank so clearing the field actually clears the column.
      instagram_username: instagramUsername.trim().replace(/^@/, ''),
      email: email.trim(),
      car_count: Number(carCount) || 1,
      // undefined would leave the column alone on edit; null clears it. An empty
      // field means "not quoted", which has to be storable.
      price: priceText.trim() === '' ? (null as any) : Number(priceText),
      engine_bay_fee: engineBayText.trim() === '' ? null : Number(engineBayText),
      out_of_area_fee: outOfAreaText.trim() === '' ? null : Number(outOfAreaText),
      assigned_detailer_id: assignedDetailerId || null,
      assigned_detailer:
        detailers.find((d) => d.id === assignedDetailerId)?.name ||
        (assignedDetailerId ? initialData?.assigned_detailer : undefined) ||
        'Unassigned',
      service,
      status: isEditing ? status : undefined,
      address: address.trim(),
      booking_date: bookingDate,
      booking_time: bookingTime,
      vehicle_make_model: vehicleMakeModel.trim() || null,
      has_power: hasPower,
      has_water: hasWater,
    };

    setIsSubmitting(true);

    try {
      if (onSubmit) {
        await onSubmit(payload);
      } else {
        console.log('[BookingForm submit]', payload);
      }

      setSuccessMessage(
        isEditing
          ? 'Booking updated successfully!'
          : 'New booking created successfully!'
      );

      // If creating new (not editing), clear form
      if (!isEditing) {
        setCustomerName('');
        setClientNo('');
        setInstagramUsername('');
        setEmail('');
        setCarCount(1);
        setAssignedDetailerId('');
        setAddress('');
        setService('full_gold');
        setVehicleMakeModel('');
        setPriceText('');
        setBookingDate(todayDateString);
        setBookingTime('09:00:00');
        setHasPower(false);
        setHasWater(false);
        setErrors({});
      }

      setTimeout(() => {
        setSuccessMessage(null);
      }, 4000);
    } catch (err: any) {
      setErrors({ form: err?.message || 'An unexpected error occurred while saving.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-charcoal-card rounded-2xl p-4 sm:p-7 border border-charcoal-border/60 shadow-soft-md w-full max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6 pb-3 sm:pb-4 border-b border-charcoal-border/40">
        <div>
          <h2 className="text-base sm:text-xl font-bold text-charcoal tracking-tight flex items-center gap-2">
            <PlusCircle className="w-4 h-4 sm:w-5 sm:h-5 text-sage-600 shrink-0" />
            <span>{isEditing ? 'Edit Appointment' : 'New Appointment'}</span>
          </h2>
          <p className="text-[11px] sm:text-xs text-charcoal-muted mt-0.5">
            {isEditing
              ? 'Update appointment details, client info, and assignments'
              : 'Enter customer, vehicle, and dispatch details'}
          </p>
        </div>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="mb-4 sm:mb-5 p-3 sm:p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* General Form Error */}
      {errors.form && (
        <div className="mb-4 sm:mb-5 p-3 sm:p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-medium flex items-center gap-2 animate-fade-in">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errors.form}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3.5 sm:space-y-4" noValidate>
        {/* Row 1: Customer Name & Client Phone / No. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
          {/* Customer Name */}
          <div>
            <label
              htmlFor="customer_name"
              className="block text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5"
            >
              Customer Name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-charcoal-muted">
                <User className="w-4 h-4 text-sage-600" />
              </div>
              <input
                id="customer_name"
                type="text"
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  if (errors.customer_name) setErrors((prev) => ({ ...prev, customer_name: '' }));
                }}
                placeholder="e.g. Sarah Jenkins"
                className={`w-full pl-10 pr-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border ${
                  errors.customer_name
                    ? 'border-red-400 focus:border-red-500'
                    : 'border-charcoal-border focus:border-sage-500'
                } text-charcoal placeholder:text-charcoal-light/70 focus:bg-charcoal-card transition-colors`}
              />
            </div>
            {errors.customer_name && (
              <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {errors.customer_name}
              </p>
            )}
          </div>

          {/* Phone / Mobile Number */}
          <div>
            <label
              htmlFor="client_no"
              className="block text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5"
            >
              Phone / Mobile Number
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-charcoal-muted">
                <Phone className="w-4 h-4 text-sage-600" />
              </div>
              <input
                id="client_no"
                name="number"
                type="tel"
                value={clientNo}
                onChange={(e) => setClientNo(e.target.value)}
                placeholder="e.g. (555) 019-2834"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border border-charcoal-border text-charcoal placeholder:text-charcoal-light/70 focus:border-sage-500 focus:bg-charcoal-card transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Row 2: Email (optional but suggested) */}
        <div>
          <label
            htmlFor="email"
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5"
          >
            <span>Email Address</span>
            <span className="normal-case tracking-normal font-medium px-1.5 py-0.5 rounded-full text-[10px] bg-sage-100 text-sage-800 border border-sage-200">
              Optional &mdash; suggested
            </span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-charcoal-muted">
              <Mail className="w-4 h-4 text-sage-600" />
            </div>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors((prev) => ({ ...prev, email: '' }));
              }}
              placeholder="e.g. sarah@example.com"
              className={`w-full pl-10 pr-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border ${
                errors.email
                  ? 'border-red-400 focus:border-red-500'
                  : 'border-charcoal-border focus:border-sage-500'
              } text-charcoal placeholder:text-charcoal-light/70 focus:bg-charcoal-card transition-colors`}
            />
          </div>
          {errors.email ? (
            <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {errors.email}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-charcoal-muted">
              Used for booking confirmations and receipts. Leave blank if the customer prefers not to share it.
            </p>
          )}
        </div>

        {/* Row 3: Instagram User ID & Assigned Detailer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
          {/* Instagram Username / Handle */}
          <div>
            <label
              htmlFor="instagram_username"
              className="block text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5"
            >
              Instagram Username
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-charcoal-muted">
                <Instagram className="w-4 h-4 text-pink-600" />
              </div>
              <input
                id="instagram_username"
                type="text"
                value={instagramUsername}
                onChange={(e) => setInstagramUsername(e.target.value)}
                placeholder="e.g. @sarah_detailing"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border border-charcoal-border text-charcoal placeholder:text-charcoal-light/70 focus:border-sage-500 focus:bg-charcoal-card transition-colors"
              />
            </div>
          </div>

          {/* Assigned Detailer */}
          <div>
            <label
              htmlFor="assigned_detailer"
              className="block text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5"
            >
              Assign Detailer
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-charcoal-muted">
                <UserCheck className="w-4 h-4 text-sage-600" />
              </div>
              {/* A select rather than free text, so the name can never disagree
                  with assigned_detailer_id. Add detailers on the Admin page. */}
              <select
                id="assigned_detailer"
                value={assignedDetailerId}
                onChange={(e) => setAssignedDetailerId(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border border-charcoal-border text-charcoal focus:border-sage-500 focus:bg-charcoal-card transition-colors cursor-pointer"
              >
                <option value="">Unassigned</option>
                {/* Keep an already-assigned but now-inactive detailer selectable
                    so editing a booking cannot silently unassign them. */}
                {assignedDetailerId &&
                  !detailers.some((d) => d.id === assignedDetailerId) && (
                    <option value={assignedDetailerId}>
                      {initialData?.assigned_detailer || 'Current detailer'}
                    </option>
                  )}
                {detailers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Row 3: Service Package & Vehicle */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Service Type */}
          <div>
            <label
              htmlFor="service"
              className="block text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5"
            >
              Service Package <span className="text-red-500">*</span>
            </label>
            <select
              id="service"
              value={service}
              onChange={(e) => handleServiceChange(e.target.value as ServiceType)}
              className="w-full px-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border border-charcoal-border text-charcoal focus:border-sage-500 focus:bg-charcoal-card transition-colors cursor-pointer"
            >
              {serviceOptions.map((value) => (
                <option key={value} value={value}>
                  {SERVICE_LABELS[value] || value}
                </option>
              ))}
            </select>
          </div>

          {/* Vehicle: free text, optional. Pricing is flat, so there is no type
              to pick; this just tells the detailer what is in the driveway. */}
          <div>
            <label
              htmlFor="vehicle_make_model"
              className="block text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5"
            >
              Vehicle <span className="text-charcoal-muted normal-case font-medium">(optional)</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-charcoal-muted">
                <Car className="w-4 h-4 text-sage-600" />
              </div>
              <input
                id="vehicle_make_model"
                type="text"
                value={vehicleMakeModel}
                onChange={(e) => setVehicleMakeModel(e.target.value)}
                placeholder="e.g. 2021 Honda CR-V"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border border-charcoal-border text-charcoal placeholder:text-charcoal-muted/60 focus:border-sage-500 focus:bg-charcoal-card transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Row 4: Number of Cars */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
          <div>
            <label
              htmlFor="car_count"
              className="block text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5"
            >
              No. of Cars / Vehicles <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-charcoal-muted">
                <Hash className="w-4 h-4 text-sage-600" />
              </div>
              <input
                id="car_count"
                type="number"
                min={1}
                max={20}
                value={carCount}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setCarCount(isNaN(val) ? 1 : Math.max(1, val));
                  if (errors.car_count) setErrors((prev) => ({ ...prev, car_count: '' }));
                }}
                className={`w-full pl-10 pr-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border ${
                  errors.car_count
                    ? 'border-red-400 focus:border-red-500'
                    : 'border-charcoal-border focus:border-sage-500'
                } text-charcoal focus:bg-charcoal-card transition-colors`}
              />
            </div>
            {errors.car_count && (
              <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {errors.car_count}
              </p>
            )}
          </div>

          {/* Price. Optional, because a booking is often taken before the quote
              is settled — but leaving it blank keeps the job out of every
              revenue figure, so the hint says so rather than letting it be
              skipped silently. */}
          <div>
            <label
              htmlFor="price"
              className="block text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5"
            >
              Price <span className="text-charcoal-muted font-medium normal-case">(tax included)</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-charcoal-muted">
                <DollarSign className="w-4 h-4 text-sage-600" />
              </div>
              <input
                id="price"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={priceText}
                onChange={(e) => {
                  setPriceText(e.target.value);
                  if (errors.price) setErrors((prev) => ({ ...prev, price: '' }));
                }}
                placeholder="e.g. 130"
                className={`w-full pl-10 pr-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border ${
                  errors.price
                    ? 'border-red-400 focus:border-red-500'
                    : 'border-charcoal-border focus:border-sage-500'
                } text-charcoal focus:bg-charcoal-card transition-colors`}
              />
            </div>
            {errors.price ? (
              <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {errors.price}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-charcoal-muted">
                Base price for all vehicles, before any extras below.
              </p>
            )}
          </div>
        </div>

        {/* Extras. Held as amounts rather than as ticks, so changing the standard
            rate later cannot rewrite what an old job was billed. The running
            total is shown because these ADD to the base price — seeing the sum
            is what stops an extra being typed into the price and ticked here. */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold uppercase tracking-wider text-charcoal">
            Extras
          </span>

          <SurchargeRow
            id="engine_bay_fee"
            icon={Wrench}
            label={SURCHARGE_LABELS.engine_bay}
            hint={`Standard ${'$'}${engineBayFeeFor(service)} with this package`}
            defaultAmount={engineBayFeeFor(service)}
            value={engineBayText}
            onChange={setEngineBayText}
          />

          <SurchargeRow
            id="out_of_area_fee"
            icon={MapPinned}
            label={SURCHARGE_LABELS.out_of_area}
            hint={`Standard ${'$'}${OUT_OF_AREA_FEE}`}
            defaultAmount={OUT_OF_AREA_FEE}
            value={outOfAreaText}
            onChange={setOutOfAreaText}
          />

          {liveTotal !== null && (
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-sage-50 border border-sage-200">
              <span className="text-xs font-semibold text-charcoal">Customer pays</span>
              <span className="text-sm font-bold text-sage-800 tabular-nums">
                {formatMoney(liveTotal)}
              </span>
            </div>
          )}
        </div>

        {/* Row 4: Service Address */}
        <div>
          <label
            htmlFor="address"
            className="block text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5"
          >
            Service Address <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-charcoal-muted">
              <MapPin className="w-4 h-4 text-sage-600" />
            </div>
            <input
              id="address"
              type="text"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                if (errors.address) setErrors((prev) => ({ ...prev, address: '' }));
              }}
              placeholder="e.g. 742 Evergreen Terrace, Springfield"
              className={`w-full pl-10 pr-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border ${
                errors.address
                  ? 'border-red-400 focus:border-red-500'
                  : 'border-charcoal-border focus:border-sage-500'
              } text-charcoal placeholder:text-charcoal-light/70 focus:bg-charcoal-card transition-colors`}
            />
          </div>
          {errors.address && (
            <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {errors.address}
            </p>
          )}
        </div>

        {/* Row 5: Date and Time (2-col grid) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
          {/* Date Picker */}
          <div>
            <label
              htmlFor="booking_date"
              className="block text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5"
            >
              Date <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                id="booking_date"
                type="date"
                min={todayDateString}
                value={bookingDate}
                onChange={(e) => {
                  setBookingDate(e.target.value);
                  if (errors.booking_date) setErrors((prev) => ({ ...prev, booking_date: '' }));
                }}
                className={`w-full px-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border ${
                  errors.booking_date
                    ? 'border-red-400 focus:border-red-500'
                    : 'border-charcoal-border focus:border-sage-500'
                } text-charcoal focus:bg-charcoal-card transition-colors cursor-pointer`}
              />
            </div>
            {errors.booking_date && (
              <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {errors.booking_date}
              </p>
            )}
          </div>

          {/* Time Selector */}
          <div>
            <label
              htmlFor="booking_time"
              className="block text-xs font-semibold uppercase tracking-wider text-charcoal mb-1.5"
            >
              Time Slot <span className="text-red-500">*</span>
            </label>
            <select
              id="booking_time"
              value={bookingTime}
              onChange={(e) => {
                setBookingTime(e.target.value);
                if (errors.booking_time) setErrors((prev) => ({ ...prev, booking_time: '' }));
              }}
              className={`w-full px-3.5 py-2.5 rounded-xl text-base sm:text-sm bg-canvas border ${
                errors.booking_time
                  ? 'border-red-400 focus:border-red-500'
                  : 'border-charcoal-border focus:border-sage-500'
              } text-charcoal focus:bg-charcoal-card transition-colors cursor-pointer`}
            >
              {TIME_SLOTS.map((slot) => (
                <option key={slot.value} value={slot.value}>
                  {slot.label}
                </option>
              ))}
            </select>
            {errors.booking_time && (
              <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {errors.booking_time}
              </p>
            )}
          </div>
        </div>

        {/* On-site Utility Toggles */}
        <div className="pt-1.5 space-y-2.5">
          <span className="block text-xs font-semibold uppercase tracking-wider text-charcoal">
            On-Site Utilities
          </span>

          {/* Power toggle */}
          <label className="flex items-center justify-between p-3 rounded-xl bg-canvas border border-charcoal-border/70 hover:border-sage-300 transition-colors cursor-pointer">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                  hasPower ? 'bg-amber-100 text-amber-700' : 'bg-charcoal-border/50 text-charcoal-muted'
                }`}
              >
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-charcoal block">
                  Power Available On-Site
                </span>
                <span className="text-[11px] text-charcoal-muted block">
                  Standard electrical outlet accessible for equipment
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={hasPower}
              onChange={(e) => setHasPower(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-10 h-6 bg-charcoal-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-charcoal-card after:border-charcoal-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sage-500 relative"></div>
          </label>

          {/* Water toggle */}
          <label className="flex items-center justify-between p-3 rounded-xl bg-canvas border border-charcoal-border/70 hover:border-sage-300 transition-colors cursor-pointer">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                  hasWater ? 'bg-sky-100 text-sky-700' : 'bg-charcoal-border/50 text-charcoal-muted'
                }`}
              >
                <Droplet className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-charcoal block">
                  Water Available On-Site
                </span>
                <span className="text-[11px] text-charcoal-muted block">
                  Outdoor spigot or hose connection available
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={hasWater}
              onChange={(e) => setHasWater(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-10 h-6 bg-charcoal-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-charcoal-card after:border-charcoal-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sage-500 relative"></div>
          </label>
        </div>

        {/* Booking Status selector when in Edit Mode */}
        {isEditing && (
          <div className="pt-1.5 space-y-2">
            <span className="block text-xs font-semibold uppercase tracking-wider text-charcoal">
              Booking Status
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setStatus('scheduled')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition-all ${
                  status === 'scheduled'
                    ? 'bg-sage-100 text-sage-900 border-sage-400 ring-2 ring-sage-400/30 font-bold shadow-soft-xs'
                    : 'bg-canvas text-charcoal-muted border-charcoal-border hover:bg-charcoal-card hover:text-charcoal'
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-sage-700" />
                <span>Scheduled</span>
              </button>

              <button
                type="button"
                onClick={() => setStatus('completed')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition-all ${
                  status === 'completed'
                    ? 'bg-emerald-100 text-emerald-900 border-emerald-400 ring-2 ring-emerald-400/30 font-bold shadow-soft-xs'
                    : 'bg-canvas text-charcoal-muted border-charcoal-border hover:bg-charcoal-card hover:text-charcoal'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>Completed</span>
              </button>

              <button
                type="button"
                onClick={() => setStatus('cancelled')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition-all ${
                  status === 'cancelled'
                    ? 'bg-red-100 text-red-900 border-red-400 ring-2 ring-red-400/30 font-bold shadow-soft-xs'
                    : 'bg-canvas text-charcoal-muted border-charcoal-border hover:bg-charcoal-card hover:text-charcoal'
                }`}
              >
                <AlertCircle className="w-3.5 h-3.5 text-red-700" />
                <span>Cancelled</span>
              </button>
            </div>
          </div>
        )}

        {/* Submit button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 sm:py-3 px-4 rounded-xl bg-sage-500 hover:bg-sage-600 active:scale-[0.99] text-white dark:text-charcoal-card font-semibold sm:font-medium text-sm shadow-soft-sm transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span>Saving Appointment...</span>
            ) : (
              <>
                <PlusCircle className="w-4 h-4" />
                <span>{submitButtonLabel}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
