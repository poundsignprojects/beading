// Google OAuth client id for the "Bead Pattern Designer" project — a public,
// browser-side identifier (not a secret; safe to commit), from Google Cloud
// Console > APIs & Services > Credentials > OAuth 2.0 Client IDs > (Web
// application). See the setup walkthrough in this session's chat / .work/
// notes for the exact steps. Google Sign-In requires HTTPS (localhost is the
// one exception) — this Client ID's "Authorized JavaScript origins" list must
// include every origin the app is actually loaded from (e.g. http://localhost:PORT
// for Mac dev, and the app's real HTTPS hosting URL for the iPad).
export const GOOGLE_CLIENT_ID = '551929475344-9o3op8uh7tp4doukgrhdr9d0di3frq87.apps.googleusercontent.com';

// drive.file (not the broader "drive" scope): this app can only ever see
// files/folders it created itself — least privilege, per the sync plan's
// Decision #2. It structurally cannot read anything else already in the
// user's Drive.
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
