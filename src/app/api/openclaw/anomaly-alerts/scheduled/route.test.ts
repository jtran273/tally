import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedAnomalyAlertScheduleRequest } from "./route";

const originalCronSecret = process.env.CRON_SECRET;

test.afterEach(() => {
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
});

test("scheduled anomaly alert scan auth requires CRON_SECRET bearer token", () => {
  process.env.CRON_SECRET = "test-cron-secret";

  assert.equal(isAuthorizedAnomalyAlertScheduleRequest(new Headers()), false);
  assert.equal(
    isAuthorizedAnomalyAlertScheduleRequest(new Headers({
      authorization: "Bearer wrong"
    })),
    false
  );
  assert.equal(
    isAuthorizedAnomalyAlertScheduleRequest(new Headers({
      authorization: "Bearer test-cron-secret"
    })),
    true
  );
});
