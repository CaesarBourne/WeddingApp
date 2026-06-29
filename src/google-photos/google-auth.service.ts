import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

/**
 * Holds the single OAuth2 client for the wedding Google account.
 *
 * Google Photos does NOT support service accounts, so the backend authenticates
 * as a real user via a long-lived REFRESH TOKEN (stored in env / on the server).
 * google-auth-library transparently exchanges it for short-lived access tokens
 * and caches them until expiry, so getAccessToken() is cheap to call per request.
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly client: OAuth2Client;

  /** Scopes required for: uploading (appendonly) + reading app-created media. */
  static readonly SCOPES = [
    'https://www.googleapis.com/auth/photoslibrary.appendonly',
    'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
  ];

  constructor(private readonly config: ConfigService) {
    this.client = new OAuth2Client({
      clientId: this.config.get<string>('google.clientId'),
      clientSecret: this.config.get<string>('google.clientSecret'),
      redirectUri: this.config.get<string>('google.redirectUri'),
    });

    const refreshToken = this.config.get<string>('google.refreshToken');
    if (refreshToken) {
      this.client.setCredentials({ refresh_token: refreshToken });
    } else {
      this.logger.warn(
        'GOOGLE_REFRESH_TOKEN is not set — photo features will fail until you run `npm run get:token`.',
      );
    }
  }

  /** True once a refresh token is configured. */
  isConfigured(): boolean {
    return Boolean(this.config.get<string>('google.refreshToken'));
  }

  /** Returns a valid access token, refreshing automatically when needed. */
  async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Google Photos is not connected. Configure GOOGLE_REFRESH_TOKEN first.',
      );
    }
    try {
      const { token } = await this.client.getAccessToken();
      if (!token) throw new Error('Empty access token from Google.');
      return token;
    } catch (err) {
      this.logger.error(`Failed to obtain Google access token: ${err}`);
      throw new ServiceUnavailableException(
        'Could not authenticate with Google Photos. The refresh token may be revoked.',
      );
    }
  }

  // ── One-time setup helpers (used by the setup controller / get:token script) ──

  generateAuthUrl(): string {
    return this.client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // force a refresh_token to be returned
      scope: GoogleAuthService.SCOPES,
    });
  }

  async exchangeCode(code: string): Promise<{
    refreshToken?: string | null;
    accessToken?: string | null;
    expiryDate?: number | null;
  }> {
    const { tokens } = await this.client.getToken(code);
    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiryDate: tokens.expiry_date,
    };
  }
}
