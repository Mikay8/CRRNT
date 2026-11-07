// Set to true to bring back the login button and login/register/forgot-password screens.
export const AUTH_ENABLED = false;

// While accounts are off, guests save stories to their device instead of
// being asked to sign up.
export const canSaveStories = (hasUser: boolean) => hasUser || !AUTH_ENABLED;

// Fallback save limit, used until the server's value loads (and if it
// can't be reached). Mirrors the backend default for the admin's
// Feed & Save Limits setting (app_settings feed_limits.daily); the
// live value comes from GET /api/config and overrides this.
export const DEFAULT_SAVE_LIMIT = 15;
