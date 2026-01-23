import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import React from 'react';

import { ServerCrypto } from '@/lib/crypto';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_id')?.value;

  if (!process.env.AUTH_SECRET) {
    throw new Error('AUTH_SECRET is not defined');
  }

  const user = await ServerCrypto.decrypt(
    sessionToken || '',
    process.env.AUTH_SECRET,
  );

  if (!user) {
    // Cookie existed but was invalid/expired/tampered
    redirect('/login');
  }

  return <section>{children}</section>;
}
