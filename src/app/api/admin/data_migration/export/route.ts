import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gzip } from 'zlib';

import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { isOwnerUsername } from '@/lib/auth/shared';
import { captureBackup, MAX_BACKUP_JSON_BYTES } from '@/lib/backup';
import { ServerCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

const gzipAsync = promisify(gzip);

export async function POST(req: NextRequest) {
  try {
    // 检查存储类型
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '不支持本地存储进行数据迁移' },
        { status: 400 },
      );
    }

    // 验证身份和权限
    const authInfo = await getAuthInfoFromCookie(req);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 检查用户权限（只有站长可以导出数据）
    if (!isOwnerUsername(authInfo.username)) {
      return NextResponse.json(
        { error: '权限不足，只有站长可以导出数据' },
        { status: 401 },
      );
    }

    const config = await db.getAdminConfig();
    if (!config) {
      return NextResponse.json({ error: '无法获取配置' }, { status: 500 });
    }

    // 解析请求体获取密码
    const { password } = await req.json();
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '请提供加密密码' }, { status: 400 });
    }

    const exportData = {
      ...(await captureBackup()),
      serverVersion: CURRENT_VERSION,
    };

    // 将数据转换为JSON字符串
    const jsonData = JSON.stringify(exportData);

    // 先压缩数据
    if (Buffer.byteLength(jsonData) > MAX_BACKUP_JSON_BYTES)
      throw new Error('Backup exceeds uncompressed size limit');
    const compressedData = await gzipAsync(jsonData);

    // 使用提供的密码加密压缩后的数据
    const encryptedData = await ServerCrypto.encrypt(
      compressedData.toString('base64'),
      password,
      0, // No expiry for backups
      'backup',
    );

    // 生成文件名
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `moontv-backup-${timestamp}.dat`;

    // 返回加密的数据作为文件下载
    return new NextResponse(encryptedData, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': encryptedData.length.toString(),
      },
    });
  } catch (error) {
    console.error('数据导出失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导出失败' },
      { status: 500 },
    );
  }
}
