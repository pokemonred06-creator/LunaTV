import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, data, timestamp } = body;
    
    // Log to server console (visible in Docker logs)
    console.log(`[DEBUG ${timestamp}] ${message}`, data ? JSON.stringify(data) : '');
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DEBUG] Error processing debug log:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
