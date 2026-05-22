import assert from "node:assert/strict";
import test from "node:test";
import { PlaidConfigurationError } from "./config";
import { PlaidTokenDecryptionError } from "./token-vault";
import {
  getPlaidErrorStatus,
  getSafePlaidError,
  PlaidRouteConfigurationError
} from "./errors";

test("getSafePlaidError surfaces only safe code/type/requestId from Plaid API responses", () => {
  const safe = getSafePlaidError({
    response: {
      data: {
        error_code: "ITEM_LOGIN_REQUIRED",
        error_message: "the user must log in (access-token-abcdef1234)",
        error_type: "ITEM_ERROR",
        display_message: "Please log in again.",
        request_id: "req-123",
        causes: [{ error_message: "sensitive" }]
      },
      status: 400
    },
    // The Plaid client surfaces axios-style errors; the top-level Error.message
    // often echoes back sensitive request bodies. We must not surface it.
    message: "Plaid API call failed with access-token-abcdef1234 institution ins_109508"
  });

  assert.equal(safe.code, "ITEM_LOGIN_REQUIRED");
  assert.equal(safe.type, "ITEM_ERROR");
  assert.equal(safe.requestId, "req-123");
  assert.equal(safe.status, 400);
  // No provider-message, display message, causes, access tokens, or institution ids escape.
  for (const value of Object.values(safe)) {
    if (typeof value !== "string") continue;
    assert.equal(value.includes("access-token"), false);
    assert.equal(value.includes("ins_"), false);
    assert.equal(value.includes("Please log in"), false);
  }
});

test("getSafePlaidError defaults to PLAID_REQUEST_FAILED for plain Error instances", () => {
  const safe = getSafePlaidError(new Error("contains secret access-token-leaky"));

  assert.equal(safe.code, "PLAID_REQUEST_FAILED");
  assert.equal(safe.requestId, undefined);
  assert.equal(safe.status, undefined);
  assert.equal(safe.type, undefined);
});

test("getSafePlaidError preserves safe Plaid transport codes without leaking messages", () => {
  const safe = getSafePlaidError(Object.assign(new Error("access-token-leaky"), { code: "ECONNABORTED" }));

  assert.equal(safe.code, "PLAID_REQUEST_FAILED");
  assert.equal(safe.transportCode, "ECONNABORTED");
  assert.equal(Object.values(safe).some((value) => value === "access-token-leaky"), false);
});

test("getSafePlaidError ignores unsafe transport code strings", () => {
  const safe = getSafePlaidError(Object.assign(new Error("boom"), { code: "bad token value" }));

  assert.equal(safe.transportCode, undefined);
});

test("getSafePlaidError ignores empty-string request_id and error_code without throwing", () => {
  const safe = getSafePlaidError({
    response: {
      data: {
        error_code: "",
        error_type: "   ",
        request_id: ""
      },
      status: 500
    }
  });

  assert.equal(safe.code, "PLAID_REQUEST_FAILED");
  assert.equal(safe.type, undefined);
  assert.equal(safe.requestId, undefined);
  assert.equal(safe.status, 500);
});

test("getSafePlaidError tags known internal error classes with their own codes", () => {
  assert.equal(getSafePlaidError(new PlaidConfigurationError("missing env")).code, "PLAID_CONFIGURATION_ERROR");
  assert.equal(getSafePlaidError(new PlaidRouteConfigurationError()).code, "PLAID_ROUTE_CONFIGURATION_ERROR");
  assert.equal(getSafePlaidError(new PlaidTokenDecryptionError()).code, "PLAID_TOKEN_DECRYPTION_ERROR");
});

test("getPlaidErrorStatus maps configuration and decryption errors to 503", () => {
  assert.equal(getPlaidErrorStatus(new PlaidConfigurationError("missing env")), 503);
  assert.equal(getPlaidErrorStatus(new PlaidRouteConfigurationError()), 503);
  assert.equal(getPlaidErrorStatus(new PlaidTokenDecryptionError()), 503);
});

test("getPlaidErrorStatus preserves 429 rate-limit signal and folds other client errors to 400", () => {
  assert.equal(
    getPlaidErrorStatus({ response: { data: { error_code: "RATE_LIMIT_EXCEEDED" }, status: 429 } }),
    429
  );
  assert.equal(
    getPlaidErrorStatus({ response: { data: { error_code: "INVALID_INPUT" }, status: 400 } }),
    400
  );
  assert.equal(
    getPlaidErrorStatus({ response: { data: { error_code: "ITEM_LOGIN_REQUIRED" }, status: 401 } }),
    502
  );
});

test("getPlaidErrorStatus returns 500 for unknown error shapes without provider metadata", () => {
  assert.equal(getPlaidErrorStatus(new Error("boom")), 500);
  assert.equal(getPlaidErrorStatus("string failure"), 500);
});
