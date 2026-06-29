import { Controller, Get, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { GoogleAuthService } from './google-auth.service';

/**
 * One-time setup endpoints to connect the wedding Google account.
 *
 * SECURITY: these are intentionally @Public() because the OAuth redirect from
 * Google arrives without a JWT. They only ever EXPOSE a refresh token to the
 * person completing the consent flow in their own browser. Disable this
 * controller (or put it behind a network allow-list) once GOOGLE_REFRESH_TOKEN
 * is set in production. Prefer `npm run get:token` for a fully offline setup.
 */
@ApiExcludeController()
@Controller('google')
export class GooglePhotosController {
  constructor(private readonly auth: GoogleAuthService) {}

  @Public()
  @Get('auth-url')
  authUrl() {
    return {
      message:
        'Open this URL in a browser, sign in as the WEDDING Google account, and approve access.',
      url: this.auth.generateAuthUrl(),
    };
  }

  @Public()
  @Get('callback')
  async callback(@Query('code') code?: string, @Query('error') error?: string) {
    if (error) return { error };
    if (!code) return { error: 'Missing ?code in callback.' };

    const tokens = await this.auth.exchangeCode(code);
    if (!tokens.refreshToken) {
      return {
        warning:
          'No refresh_token returned. Revoke the app at myaccount.google.com/permissions ' +
          'and retry — a refresh token is only issued on first consent.',
        accessToken: tokens.accessToken,
      };
    }
    return {
      message:
        'Success! Copy the refreshToken below into GOOGLE_REFRESH_TOKEN in your .env, then restart the server.',
      refreshToken: tokens.refreshToken,
    };
  }
}
