export type IdentifierType = 'phone' | 'email' | 'username';

export interface ResolveIdentifierRequest {
  type: IdentifierType;
  value: string;
}

export interface ResolveIdentifierResponse {
  exists: boolean;
  verified: boolean;
  /** How the caller should proceed to authenticate this identifier. */
  method: 'phone' | 'email';
}

export type OtpPurpose = 'registration' | 'reset';

export interface SendEmailCodeRequest {
  email: string;
  purpose: OtpPurpose;
}

export interface VerifyEmailCodeRequest {
  email: string;
  code: string;
  purpose: OtpPurpose;
}

export interface VerifyEmailCodeResponse {
  /** Custom token for the client to call signInWithCustomToken with. */
  customToken: string;
}

export interface ReserveUsernameRequest {
  username: string;
}

export interface CompleteUserProfileRequest {
  username: string;
  birthday: string; // ISO date, e.g. "2000-01-31"
  interests: string[];
}
