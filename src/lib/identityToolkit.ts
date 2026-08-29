/**
 * Verifying a password against Firebase Auth's stored hash has no Admin SDK
 * method — that check only happens through a client-style sign-in call. For
 * username-based password login we can't let the client do that call itself
 * (it would need the real email/phone-alias, which resolveIdentifier
 * deliberately never reveals — that's the anti-enumeration boundary). So the
 * server performs the same check via the public Identity Toolkit REST API,
 * using the same (non-secret) Web API key already embedded in the app's own
 * Firebase config.
 */
export async function verifyPasswordViaIdentityToolkit(
  apiKey: string,
  email: string,
  password: string,
): Promise<boolean> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email, password, returnSecureToken: true}),
    },
  );
  return res.ok;
}
