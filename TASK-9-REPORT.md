# Task 9 — Final Review Fix Round 1 Report

## Red/green record

### Supabase secret scanner

1. **Secret key material**
   - RED: `node --test --test-name-pattern='rejeita valor secreto Supabase' tests/unit/assert-no-secrets.test.js` — exit 1, `Missing expected exception.`
   - GREEN: same command — 1 passing test.
2. **Publishable key material**
   - RED: `node --test --test-name-pattern='rejeita valor publicável Supabase' tests/unit/assert-no-secrets.test.js` — exit 1, `Missing expected exception.`
   - GREEN: same command — 1 passing test.
3. **Full legacy JWT material**
   - RED: `node --test --test-name-pattern='rejeita JWT legado completo' tests/unit/assert-no-secrets.test.js` — exit 1, `Missing expected exception.`
   - GREEN: same command — 1 passing test.
4. **Long documented placeholder**
   - RED: `node --test --test-name-pattern='rejeita valor secreto Supabase' tests/unit/assert-no-secrets.test.js` — exit 1, unwanted secret exception for the documented placeholder.
   - GREEN: same command — 1 passing test.

### Seller contact and default rate

1. **Migration contract**
   - RED: `node --test --test-name-pattern='seller profile migration constrains' tests/unit/supabase-migration.test.js` — exit 1, missing migration file (`ENOENT`).
   - GREEN: same command — 1 passing test.
2. **Create seller persistence**
   - RED: `node --test --test-name-pattern='persists normalized contact' tests/unit/user-service.test.js` — exit 1, missing `phone` and `default_commission_rate_bps` in the profile insert.
3. **Zero, precision, and upper bound validation**
   - RED: `node --test --test-name-pattern='accepts zero default rate' tests/unit/user-service.test.js` — exit 1, expected basis points were missing.
4. **List serialization**
   - RED: `node --test --test-name-pattern='listSellers maps persisted contact' tests/unit/user-service.test.js` — exit 1, selected columns omitted persisted seller fields.
5. **Update persistence**
   - RED: `node --test --test-name-pattern='updateSeller persists normalized contact' tests/unit/user-service.test.js` — exit 1, profile update omitted persisted seller fields.
   - GREEN: `node --test tests/unit/user-service.test.js` — 11 passing tests.

## Focused verification

- `node --test tests/unit/assert-no-secrets.test.js` — 18 passing.
- `node --test tests/unit/supabase-migration.test.js` — 14 passing.
- `node --test tests/unit/user-service.test.js` — 11 passing.
- `node --test --test-name-pattern='user router creates the Supabase-backed service' tests/api/users.test.js` — 1 passing after the API contract added empty contact and null rate fields.

## Final gates

- `npm test` — 172 passing, 0 failing.
- `npm run check` — exit 0.
- `npm run check:secrets` — exit 0.
- `git diff --check` — exit 0 (no whitespace errors).
