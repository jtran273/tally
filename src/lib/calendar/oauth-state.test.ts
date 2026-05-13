import assert from "node:assert/strict";
import test from "node:test";
import {
  createGoogleCalendarOAuthState,
  verifyGoogleCalendarOAuthState
} from "./oauth-state";

function withStateEnv(run: () => void) {
  const previousKey = process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY;
  const previousSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

  process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = "calendar-state-signing-key";
  delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

  try {
    run();
  } finally {
    if (previousKey === undefined) {
      delete process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = previousKey;
    }

    if (previousSecret === undefined) {
      delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    } else {
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET = previousSecret;
    }
  }
}

test("Google Calendar OAuth state is signed and bound to the initiating user", () => {
  withStateEnv(() => {
    const oauthState = createGoogleCalendarOAuthState("user-1");

    assert.notEqual(oauthState.cookieValue, oauthState.state);
    assert.deepEqual(verifyGoogleCalendarOAuthState(oauthState.state, oauthState.cookieValue), {
      state: oauthState.state,
      userId: "user-1"
    });
    assert.equal(verifyGoogleCalendarOAuthState("other-state", oauthState.cookieValue), null);
    assert.equal(verifyGoogleCalendarOAuthState(oauthState.state, `${oauthState.cookieValue}tampered`), null);
  });
});
