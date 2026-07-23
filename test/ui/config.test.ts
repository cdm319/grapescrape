import { describe, expect, it } from "vitest";
import { loadPublicConfig } from "../../src/ui/src/config";

const validEnvironment = {
  VITE_API_BASE_URL: "https://api.grapescrape.com",
  VITE_COGNITO_AUTH_DOMAIN: "https://auth.grapescrape.com",
  VITE_COGNITO_REGION: "eu-west-2",
  VITE_COGNITO_USER_POOL_ID: "eu-west-2_example123",
  VITE_COGNITO_CLIENT_ID: "publicclient123",
  VITE_COGNITO_CALLBACK_URL: "http://localhost:5173/auth/callback",
  VITE_COGNITO_LOGOUT_URL: "http://localhost:5173/",
};

describe("public frontend configuration", () => {
  it("accepts matching loopback callback and logout URLs for development", () => {
    expect(
      loadPublicConfig(validEnvironment, "http://localhost:5173"),
    ).toMatchObject({
      apiBaseUrl: "https://api.grapescrape.com",
      authDomain: "https://auth.grapescrape.com",
      callbackUrl: "http://localhost:5173/auth/callback",
      logoutUrl: "http://localhost:5173/",
    });
  });

  it("rejects callbacks outside the current application origin", () => {
    expect(() =>
      loadPublicConfig(
        {
          ...validEnvironment,
          VITE_COGNITO_CALLBACK_URL:
            "https://unexpected.example/auth/callback",
        },
        "http://localhost:5173",
      ),
    ).toThrow(
      "VITE_COGNITO_CALLBACK_URL must match the application origin",
    );
  });

  it("rejects a user pool outside the configured region", () => {
    expect(() =>
      loadPublicConfig(
        {
          ...validEnvironment,
          VITE_COGNITO_USER_POOL_ID: "us-east-1_example123",
        },
        "http://localhost:5173",
      ),
    ).toThrow("VITE_COGNITO_USER_POOL_ID");
  });
});
