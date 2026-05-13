import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedOpenClawBriefingScheduleRequest } from "./route";

const originalCronSecret = process.env.CRON_SECRET;

test.afterEach(() => {
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
});

test("scheduled OpenClaw briefing auth requires CRON_SECRET bearer token", () => {
  process.env.CRON_SECRET = "test-cron-secret";

  assert.equal(isAuthorizedOpenClawBriefingScheduleRequest(new Headers()), false);
  assert.equal(
    isAuthorizedOpenClawBriefingScheduleRequest(new Headers({ authorization: "Bearer wrong" })),
    false
  );
  assert.equal(
    isAuthorizedOpenClawBriefingScheduleRequest(new Headers({ authorization: "Bearer test-cron-secret" })),
    true
  );
});
