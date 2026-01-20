import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ ok: true });

  // 1. Kill the Server Session
  response.cookies.delete('auth');

  // 2. Kill the UI State
  response.cookies.delete('auth-user');

  return response;
}
