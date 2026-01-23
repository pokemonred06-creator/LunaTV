'use server';

import { ServerCrypto } from '@/lib/crypto';

// Placeholder for email service - replace with actual implementation
const emailService = {
  send: async (email: string, url: string) => {
    console.log(`[Magic Link] To: ${email}, URL: ${url}`);
    // In a real app, call your email provider here
  },
};

export async function sendMagicLink(email: string) {
  if (!process.env.AUTH_SECRET) {
    throw new Error('AUTH_SECRET is not defined');
  }

  // 1. Create a token valid for 15 minutes (900s) containing minimal user data
  const token = await ServerCrypto.encrypt(
    { email, type: 'magic-link' },
    process.env.AUTH_SECRET,
    900,
  );

  // 2. Send Email
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const url = `${baseUrl}/api/auth/verify?token=${token}`;

  await emailService.send(email, url);
  return { success: true };
}
