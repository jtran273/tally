## Summary

-

## User Impact

-

## Security And Data Safety

- [ ] No real secrets, tokens, auth headers, or private financial data are included.
- [ ] Client components do not receive server-only secrets.
- [ ] User-owned data remains scoped by `user_id`.
- [ ] RLS, auth, or service-role behavior is documented if changed.
- [ ] Plaid access token handling is unchanged or explicitly reviewed.
- [ ] New mutating route handlers include same-origin protection or explain why not.

## Documentation

- [ ] README/docs updated for new routes, environment variables, setup, or behavior.
- [ ] Deployment/security/operations docs updated if production behavior changed.

## Verification

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm audit --omit=dev`
- [ ] `git diff --check`

## Screenshots Or Notes

-
