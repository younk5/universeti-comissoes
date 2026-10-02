BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.commissions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_batches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.commission_payment_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bootstrap_locks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_session_registry TO service_role;

COMMIT;
