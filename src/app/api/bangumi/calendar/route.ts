import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Cache for 1 hour to prevent hitting the BGM API too frequently
export const revalidate = 3600;

export async function GET() {
  try {
    const response = await fetch('https://api.bgm.tv/calendar', {
      headers: {
        'User-Agent':
          'LunaTV/1.0 (https://github.com/pokemonred06-creator/LunaTV)',
        Accept: 'application/json',
      },
      // Next.js specific cache option (optional if `revalidate` is set, but explicit is good)
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return new NextResponse(
        `Failed to fetch Bangumi calendar: ${response.status} ${response.statusText}`,
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const err = error as Error;
    return new NextResponse(`Internal Server Error: ${err.message}`, {
      status: 500,
    });
  }
}
