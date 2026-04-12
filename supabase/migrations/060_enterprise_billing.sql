-- Enterprise billing mode: organizations can be billed outside Stripe.
-- billing_type controls how the org handles payments:
--   'stripe'     — normal Stripe subscription (default)
--   'enterprise' — billed externally (invoice/contract), no Stripe checks
--   'trial'      — free trial period

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_type TEXT DEFAULT 'stripe'
  CHECK (billing_type IN ('stripe', 'enterprise', 'trial'));

-- For Stripe seat-based billing, track the quantity on the subscription
ALTER TABLE teams ADD COLUMN IF NOT EXISTS seat_count INTEGER DEFAULT 1;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS seat_count INTEGER DEFAULT 1;
