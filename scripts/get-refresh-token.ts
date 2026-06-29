/* eslint-disable no-console */
/**
 * One-time setup: obtain a long-lived Google refresh token for the wedding
 * account, WITHOUT running the full app.
 *
 *   1. Fill GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI in .env
 *      (the redirect URI must also be registered on your OAuth client in GCP).
 *   2. Run:  npm run get:token
 *   3. Open the printed URL, sign in as the WEDDING Google account, approve.
 *   4. Copy the printed refresh token into GOOGLE_REFRESH_TOKEN in .env.
 *
 * Run while the main server is stopped (it reuses the same port).
 */
import * as fs from 'fs';
import * as http from 'http';
import { URL } from 'url';
import { OAuth2Client } from 'google-auth-library';

const SCOPES = [
  'https://www.googleapis.com/auth/photoslibrary.appendonly',
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
];

// Minimal .env loader (no extra dependency).
function loadEnv(file = '.env'): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function main() {
  loadEnv();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/google/callback';

  if (!clientId || !clientSecret) {
    console.error('❌  Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
    process.exit(1);
  }

  const client = new OAuth2Client({ clientId, clientSecret, redirectUri });
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  const redirect = new URL(redirectUri);
  const port = Number(redirect.port || 3000);

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', `http://localhost:${port}`);
    if (reqUrl.pathname !== redirect.pathname) {
      res.writeHead(404).end('Not found');
      return;
    }
    const code = reqUrl.searchParams.get('code');
    const error = reqUrl.searchParams.get('error');
    if (error || !code) {
      res.writeHead(400).end(`OAuth error: ${error || 'missing code'}`);
      return;
    }
    try {
      const { tokens } = await client.getToken(code);
      res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end('<h2>✅ Done. Return to your terminal and copy the refresh token.</h2>');
      console.log('\n──────────────────────────────────────────────');
      if (tokens.refresh_token) {
        console.log('✅  GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
      } else {
        console.log(
          '⚠️  No refresh_token returned. Revoke the app at\n' +
            '    https://myaccount.google.com/permissions and run again.',
        );
      }
      console.log('──────────────────────────────────────────────\n');
      server.close();
      process.exit(0);
    } catch (e) {
      res.writeHead(500).end('Token exchange failed: ' + (e as Error).message);
      console.error(e);
    }
  });

  server.listen(port, () => {
    console.log('\n1) Open this URL in your browser and approve access:\n');
    console.log('   ' + authUrl + '\n');
    console.log(`2) Waiting for the redirect on ${redirectUri} ...\n`);
  });
}

main();
