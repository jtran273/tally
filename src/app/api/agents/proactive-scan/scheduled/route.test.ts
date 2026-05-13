import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedProactiveScanScheduleRequest } from "./route";

const originalCronSecret = process.env.CRON_SECRET;

test.afterEach(() => {
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
});

test("scheduled proactive scan auth requires CRON_SECRET bearer token", () => {
  process.env.CRON_SECRET = "test-cron-secret";

  assert.equal(isAuthorizedProactiveScanScheduleRequest(new Headers()), false);
  assert.equal(
    isAuthorizedProactiveScanScheduleRequest(new Headers({ authorization: "Bearer wrong" })),
    false
  );
  assert.equal(
    isAuthorizedProactiveScanScheduleRequest(new Headers({ authorization: "Bearer test-cron-secret" })),
    true
  );
});
