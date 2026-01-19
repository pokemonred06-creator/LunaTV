import { NextRequest, NextResponse } from 'next/server';

const LOG_SECRET = process.env.NEXT_PUBLIC_LOG_SECRET;

export async function POST(request: NextRequest) {
  try {
    // 1. Secret Check (if configured)
    if (LOG_SECRET) {
      const secretHeader = request.headers.get('x-log-secret');
      if (secretHeader !== LOG_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // 2. Parse Body
    const body = await request.json();
    const { level, message, data, url, timestamp } = body;

    // 3. Format Log
    const logData = {
      timestamp: timestamp || new Date().toISOString(),
      level: level || 'info',
      url,
      message,
      data,
    };

    // 4. Output to Server Console (Stdout)
    // This will appear in Docker logs / Vercel logs
    const logString = JSON.stringify(logData);

    if (level === 'error') {
      console.error(`[REMOTE-Log] ${logString}`);
    } else {
      console.log(`[REMOTE-LOG] ${logString}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[REMOTE-LOG] Failed to process log:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
