// Set to true to bring back the login button and login/register/forgot-password screens.
export const AUTH_ENABLED = false;

// While accounts are off, guests save stories to their device instead of
// being asked to sign up.
export const canSaveStories = (hasUser: boolean) => hasUser || !AUTH_ENABLED;
