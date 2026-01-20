/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | undefined) || 'localstorage';

import { calculateSignature } from '@/lib/auth/server';

// 生成认证Cookie（带签名）
async function generateAuthCookie(
  username?: string,
  password?: string,
  role?: 'owner' | 'admin' | 'user',
): Promise<string> {
  const authData: any = { role: role || 'user' };

  // NEVER store plaintext password in cookie, even for localstorage mode.
  // We will sign the cookie using the admin password as the secret key.

  // Use a default username for localstorage mode if none provided
  const effectiveUsername = username || 'admin';
  authData.username = effectiveUsername;

  if (process.env.PASSWORD) {
    // Sign the username + role + timestamp using the password as secret
    const timestamp = Date.now();
    const signature = calculateSignature(
      effectiveUsername,
      authData.role,
      timestamp,
    );

    authData.signature = signature;
    authData.timestamp = timestamp;
  }

  return encodeURIComponent(JSON.stringify(authData));
}

export async function POST(req: NextRequest) {
  try {
    console.log('[Login] Request received. Storage Type:', STORAGE_TYPE);

    // Check Env Vars Presence
    console.log('[Login] Env Check:', {
      hasPassword: !!process.env.PASSWORD,
      passwordLen: process.env.PASSWORD?.length,
      username: process.env.USERNAME || '(default: admin)',
      next_public_storage_type: process.env.NEXT_PUBLIC_STORAGE_TYPE,
    });

    // 本地 / localStorage 模式——仅校验固定密码
    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;
      console.log('[Login] Mode: LocalStorage');

      // 未配置 PASSWORD 时直接放行
      if (!envPassword) {
        console.log('[Login] No PASSWORD configured, allowing access.');
        const response = NextResponse.json({ ok: true });
        response.cookies.set('auth', '', {
          path: '/',
          expires: new Date(0),
          sameSite: 'lax',
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
        });
        return response;
      }

      const body = await req.json();
      const { password, username } = body;

      console.log('[Login] Body:', { username, passwordProvided: !!password });

      if (typeof password !== 'string' || !password) {
        console.log('[Login] Password missing or invalid type');
        return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
      }

      // Check password first
      if (password !== envPassword) {
        console.log(
          '[Login] Password mismatch. Provided len:',
          password.length,
          'Expected len:',
          envPassword.length,
        );
        return NextResponse.json(
          { ok: false, error: '密码错误' },
          { status: 401 },
        );
      }

      // If username was provided, also validate it matches the env USERNAME (or defaults to 'admin')
      if (username) {
        const envUsername = (process.env.USERNAME || 'admin').toLowerCase();
        if (username.toLowerCase() !== envUsername) {
          console.log(
            '[Login] Username mismatch:',
            username,
            'Expected:',
            envUsername,
          );
          return NextResponse.json(
            { ok: false, error: '用户名或密码错误' },
            { status: 401 },
          );
        }
      }

      console.log('[Login] LocalStorage Success');
      // 验证成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie('admin', password, 'owner');
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: false, // PWA compabitility
        secure:
          process.env.NODE_ENV === 'production' &&
          process.env.DISABLE_SECURE_COOKIES !== 'true',
      });

      // Set public UI cookie
      response.cookies.set(
        'auth-user',
        encodeURIComponent(
          JSON.stringify({
            username: 'admin',
            role: 'owner',
          }),
        ),
        {
          path: '/',
          expires,
          sameSite: 'lax',
          httpOnly: false,
          secure:
            process.env.NODE_ENV === 'production' &&
            process.env.DISABLE_SECURE_COOKIES !== 'true',
        },
      );

      return response;
    }

    // 数据库 / redis 模式——校验用户名并尝试连接数据库
    console.log('[Login] Mode: DB/Redis');
    const { username, password } = await req.json();
    console.log('[Login] Request Data:', {
      username,
      passwordProvided: !!password,
    });

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    const lowerUsername = username.toLowerCase();
    const envUsername = (process.env.USERNAME || 'admin').toLowerCase();
    const envPassword = process.env.PASSWORD;

    console.log('[Login] Check Env Match:', {
      lowerUsername,
      envUsername,
      passwordMatch: password === envPassword,
    });

    // 可能是站长，直接读环境变量
    if (lowerUsername === envUsername && password === envPassword) {
      console.log('[Login] Owner Success (Environment Variable Match)');
      // 验证成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(
        lowerUsername,
        password,
        'owner',
      );
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: false,
        secure:
          process.env.NODE_ENV === 'production' &&
          process.env.DISABLE_SECURE_COOKIES !== 'true',
      });

      // Set public UI cookie
      response.cookies.set(
        'auth-user',
        encodeURIComponent(
          JSON.stringify({
            username: lowerUsername,
            role: 'owner',
          }),
        ),
        {
          path: '/',
          expires,
          sameSite: 'lax',
          httpOnly: false,
          secure:
            process.env.NODE_ENV === 'production' &&
            process.env.DISABLE_SECURE_COOKIES !== 'true',
        },
      );

      return response;
    } else if (lowerUsername === envUsername) {
      console.log('[Login] Owner Username matched but Password mismatch');
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    console.log('[Login] Checking DB for user:', lowerUsername);
    const config = await getConfig();
    const user = config.UserConfig.Users.find(
      (u) => u.username.toLowerCase() === lowerUsername,
    );
    if (user && user.banned) {
      return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
    }

    // 校验用户密码
    try {
      const pass = await db.verifyUser(lowerUsername, password);
      console.log('[Login] DB verifyUser result:', pass);

      if (!pass) {
        // Fallback
        const passOriginal = await db.verifyUser(username, password);
        console.log('[Login] DB verifyUser(original) result:', passOriginal);
        if (!passOriginal) {
          return NextResponse.json(
            { error: '用户名或密码错误' },
            { status: 401 },
          );
        }
      }

      console.log('[Login] DB Success');
      // 验证成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(
        lowerUsername,
        password,
        user?.role || 'user',
      );
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: false,
        secure:
          process.env.NODE_ENV === 'production' &&
          process.env.DISABLE_SECURE_COOKIES !== 'true',
      });

      // Set public UI cookie
      response.cookies.set(
        'auth-user',
        encodeURIComponent(
          JSON.stringify({
            username: lowerUsername,
            role: user?.role || 'user',
          }),
        ),
        {
          path: '/',
          expires,
          sameSite: 'lax',
          httpOnly: false,
          secure:
            process.env.NODE_ENV === 'production' &&
            process.env.DISABLE_SECURE_COOKIES !== 'true',
        },
      );

      return response;
    } catch (err) {
      console.error('[Login] DB Verification Failed:', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('[Login] Exception:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
