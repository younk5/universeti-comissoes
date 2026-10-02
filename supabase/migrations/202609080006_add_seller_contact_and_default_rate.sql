BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN phone text,
  ADD COLUMN default_commission_rate_bps integer,
  ADD CONSTRAINT profiles_phone_digits_check
    CHECK (phone IS NULL OR phone ~ '^[0-9]{10,15}$'),
  ADD CONSTRAINT profiles_default_commission_rate_bps_check
    CHECK (default_commission_rate_bps IS NULL OR default_commission_rate_bps BETWEEN 0 AND 10000);

COMMIT;
