import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gunzip } from 'zlib';

import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { isOwnerUsername } from '@/lib/auth/shared';
import {
  MAX_BACKUP_JSON_BYTES,
  restoreBackup,
  validateBackup,
} from '@/lib/backup';
import { MAX_BACKUP_TOKEN_LENGTH, ServerCrypto } from '@/lib/crypto';

export const runtime = 'nodejs';

const gunzipAsync = promisify(gunzip);

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

    // 检查用户权限（只有站长可以导入数据）
    if (!isOwnerUsername(authInfo.username)) {
      return NextResponse.json(
        { error: '权限不足，只有站长可以导入数据' },
        { status: 401 },
      );
    }

    // 解析表单数据
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const password = formData.get('password') as string;

    if (
      !file ||
      typeof file === 'string' ||
      file.size > MAX_BACKUP_TOKEN_LENGTH
    ) {
      return NextResponse.json({ error: '请选择备份文件' }, { status: 400 });
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '请提供解密密码' }, { status: 400 });
    }

    // 读取文件内容
    const encryptedData = await file.text();

    // 解密数据
    let decryptedData: string;
    try {
      const result = await ServerCrypto.decrypt<string>(
        encryptedData,
        password,
        'backup',
      );
      if (!result) throw new Error('Decryption returned null');
      decryptedData = result;
    } catch (error) {
      return NextResponse.json(
        { error: '解密失败，请检查密码是否正确' },
        { status: 400 },
      );
    }

    let importData;
    try {
      const compressedBuffer = Buffer.from(decryptedData, 'base64');
      const decompressed = await gunzipAsync(compressedBuffer, {
        maxOutputLength: MAX_BACKUP_JSON_BYTES,
      });
      importData = validateBackup(JSON.parse(decompressed.toString()));
    } catch {
      return NextResponse.json({ error: '备份文件格式无效' }, { status: 400 });
    }
    await restoreBackup(importData, password);
    const userData = importData.data.userData;

    return NextResponse.json({
      message: '数据导入成功',
      importedUsers: Object.keys(userData).length,
      timestamp: importData.timestamp,
      serverVersion:
        typeof importData.serverVersion === 'string'
          ? importData.serverVersion
          : '未知版本',
    });
  } catch (error) {
    console.error('数据导入失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导入失败' },
      { status: 500 },
    );
  }
}
